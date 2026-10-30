import { test } from 'node:test'
import assert from 'node:assert/strict'
import { verificationAssessment, applyVerifications, GATE_STATES, registryEvidenceId } from './overlay.mjs'
import { liveEv as ev, liveVerification as verification, fixtureRegistry, realRegistry, policy, schema, dodText, SHA, SHA2, LIVE } from '../../fixtures/verify/helpers.mjs'

const AS_OF = new Date(LIVE.asOf)

const pol = policy()
const sch = schema()
const dod = dodText()
const ID = 'one-small-mods-pack'
const pack = ev({ name: 'release-packaging', version: '1.0.0', gates: ['package-metadata-exports', 'package-archive-inspection', 'versioning-changelog'] })
const v1 = verification({ evidence: [{ id: pack.id, digest: pack.digest }] })

function assess({ registry = fixtureRegistry(), evidence = [pack], records = [], target = SHA } = {}) {
  return verificationAssessment({ registry, schema: sch, dodText: dod, asOf: AS_OF, policy: pol, ledgers: new Map([[ID, evidence]]), verifications: new Map([[ID, records]]), targets: new Map([[ID, { sha: target, source: 'test' }]]) })
    .projects.find(p => p.id === ID)
}

test('one valid independent verification raises readiness by exactly one gate', () => {
  const before = assess()
  const after = assess({ records: [v1] })
  assert.equal(before.readiness.verifiedGates, 0)
  assert.equal(after.readiness.verifiedGates, 1)
  assert.equal(after.readiness.applicableGates, 21)
  assert.equal(after.readiness.percentage, Math.floor(1000 / 21) / 10)
  assert.equal(after.readiness.previousPercentage, 0)
  assert.equal(after.gates.find(g => g.id === 'package-metadata-exports').state, 'independently_verified')
  assert.equal(after.lastVerification, LIVE.verifiedAt)
})

test('false readiness increases: no invalid record moves the score', () => {
  const cases = {
    'builder verifies own work': verification({ evidence: [{ id: pack.id, digest: pack.digest }], verifier: { name: 'Claude Code', kind: 'ai', tool: 'Claude Code' } }),
    'wrong commit': verification({ evidence: [{ id: pack.id, digest: pack.digest }], commitSha: SHA2 }),
    'forged digest': verification({ evidence: [{ id: pack.id, digest: '0'.repeat(64) }] }),
    'unknown verifier': verification({ evidence: [{ id: pack.id, digest: pack.digest }], verifier: { name: 'Mallory', kind: 'human' } }),
    'automated pass on a partial gate': verification({ gate: 'supply-chain-review', evidence: [{ id: pack.id, digest: pack.digest }] }),
    'no evidence': verification({ evidence: [] }),
    'failing record': verification({ evidence: [{ id: pack.id, digest: pack.digest }], result: 'fail' })
  }
  for (const [name, rec] of Object.entries(cases)) {
    const a = assess({ records: [rec] })
    assert.equal(a.readiness.verifiedGates, 0, name)
    assert.equal(a.readiness.percentage, 0, name)
  }
  // Valid record, but no verifier in the registry (the real state of every project).
  assert.equal(assess({ registry: fixtureRegistry({ builder: null, verifier: null }), records: [v1] }).readiness.verifiedGates, 0)
  // Collector passes alone never verify.
  const all = ['build-test', 'lint-format-types', 'ci-results', 'secret-scan', 'dependency-audit', 'documentation', 'compatibility', 'accessibility'].map(n => ev({ name: n, version: '1.0.0', gates: Object.keys(pol.gates).filter(g => (pol.gates[g].collectors || []).includes(n)) }))
  const a = assess({ evidence: [pack, ...all] })
  assert.equal(a.readiness.verifiedGates, 0)
  assert.ok(a.gates.filter(g => g.state === 'passed_by_builder').length >= 5)
})

test('a valid failing verification marks the gate failed', () => {
  const a = assess({ records: [verification({ evidence: [{ id: pack.id, digest: pack.digest }], result: 'fail', method: 're-executed' })] })
  assert.equal(a.gates.find(g => g.id === 'package-metadata-exports').state, 'failed')
  assert.equal(a.readiness.verifiedGates, 0)
})

test('the six gate states are distinguished', () => {
  const failing = ev({ name: 'secret-scan', version: '1.0.0', gates: ['security-privacy-review', 'sensitive-data-handling'] }, 'fail')
  const unreachable = ev({ name: 'dependency-audit', version: '1.0.0', gates: ['supply-chain-review'] }, 'unavailable')
  const r = fixtureRegistry()
  const a = assess({ registry: r, evidence: [pack, failing, unreachable], records: [v1] })
  const s = id => a.gates.find(g => g.id === id).state
  assert.equal(s('package-metadata-exports'), 'independently_verified')
  assert.equal(s('package-archive-inspection'), 'passed_by_builder')
  assert.equal(s('security-privacy-review'), 'failed')
  assert.equal(s('supply-chain-review'), 'inconclusive')
  assert.equal(s('production-deployment'), 'not_applicable')
  assert.ok(a.gates.some(g => g.state === 'not_tested'))
  assert.deepEqual(Object.keys(a.gateStates), GATE_STATES)
  assert.equal(a.findings.find(f => f.collector === 'secret-scan').severity, 'critical')
})

test('stale evidence: evidence for another commit is reported stale and does not count', () => {
  const old = ev({ name: 'release-packaging', version: '1.0.0', gates: ['package-metadata-exports'] }, 'pass', { commitSha: SHA2 })
  const a = assess({ evidence: [old] })
  assert.equal(a.staleEvidence.length, 1)
  assert.match(a.staleEvidence[0].reason, /not the evaluated commit/)
  assert.equal(a.gates.find(g => g.id === 'package-metadata-exports').state, 'inconclusive')
})

test('the real registry is never modified, and nothing is applied if the derived registry would be invalid', () => {
  const r = fixtureRegistry()
  const snapshot = JSON.stringify(r)
  const out = applyVerifications(r, { policy: pol, ledgers: new Map([[ID, [pack]]]), verifications: new Map([[ID, [v1]]]), targets: new Map([[ID, { sha: SHA }]]), asOf: AS_OF, schema: sch, dodText: dod })
  assert.equal(JSON.stringify(r), snapshot)
  assert.equal(out.errors.length, 0)
  assert.equal(out.registry.projects.find(p => p.id === ID).releaseGates.find(g => g.id === 'package-metadata-exports').status, 'verified')
  // Break the derived registry: an evidence id that collides with an existing one.
  const broken = fixtureRegistry()
  broken.projects.find(p => p.id === 'one-small-ui').evidence.push({ ...broken.projects.find(p => p.id === 'one-small-ui').evidence[0], id: registryEvidenceId(v1.id) })
  const bad = applyVerifications(broken, { policy: pol, ledgers: new Map([[ID, [pack]]]), verifications: new Map([[ID, [v1]]]), targets: new Map([[ID, { sha: SHA }]]), asOf: AS_OF, schema: sch, dodText: dod })
  assert.ok(bad.errors.length > 0)
  assert.equal(bad.judged[0].valid, false)
  assert.match(bad.judged[0].reasons[0], /fails validation/)
})

test('real registry today: every project is 0% and nothing is independently verified', () => {
  const r = realRegistry()
  const ids = r.projects.filter(p => p.tier !== 'legacy').map(p => p.id)
  const a = verificationAssessment({ registry: r, schema: sch, dodText: dod, asOf: AS_OF, policy: pol, ledgers: new Map(ids.map(i => [i, []])), verifications: new Map(ids.map(i => [i, []])), targets: new Map() })
  assert.equal(a.projects.length, 8)
  for (const p of a.projects) {
    assert.equal(p.readiness.verifiedGates, 0, p.id)
    assert.equal(p.gateStates.independently_verified, 0, p.id)
    assert.equal(p.releaseEligible, false, p.id)
  }
})

test('deterministic: the same input gives the same output', () => {
  assert.deepEqual(assess({ records: [v1] }), assess({ records: [v1] }))
})
