import { test } from 'node:test'
import assert from 'node:assert/strict'
import { judgeVerification, toolFamily, sameParty, routeRequests, loadVerifications, checkShape } from './verification.mjs'
import { digestOf } from './evidence.mjs'
import { ev, verification, fixtureRegistry, policy, SHA, SHA2, AS_OF } from '../../fixtures/verify/helpers.mjs'

const pol = policy()
const reg = fixtureRegistry()
const msp = reg.projects.find(p => p.id === 'one-small-mods-pack')
const catalog = reg.gateCatalog.library
const pack = ev({ name: 'release-packaging', version: '1.0.0', gates: ['package-metadata-exports', 'package-archive-inspection', 'versioning-changelog'] })
const ctx = (over = {}) => ({ project: msp, policy: pol, evidence: [pack], targetSha: SHA, asOf: AS_OF, gateCatalog: catalog, ...over })
const good = (over = {}) => verification({ evidence: [{ id: pack.id, digest: pack.digest }], ...over })
const judge = (v, c = {}) => judgeVerification(v, ctx(c))

test('a correct independent verification counts', () => {
  assert.deepEqual(judge(good()), { valid: true, reasons: [] })
})

test('tool families: Claude, OpenAI, Copilot and Gemini identities are recognised; people are not', () => {
  assert.equal(toolFamily('Claude Code (Phase 4 session)', pol), 'claude')
  assert.equal(toolFamily('ChatGPT Codex', pol), 'openai')
  assert.equal(toolFamily('GitHub Copilot', pol), 'copilot')
  assert.equal(toolFamily('Gemini CLI', pol), 'gemini')
  assert.equal(toolFamily('Joshua Small', pol), null)
  assert.ok(sameParty('Claude Code', 'claude code (another session)', pol))
  assert.ok(!sameParty('Claude Code', 'Joshua Small', pol))
})

test('identity separation: the builder, the builder\'s tool family and automation can never verify', () => {
  // A second Claude identity is not independent of a Claude builder.
  let r = judge(good({ verifier: { name: 'Claude Code (verifier session)', kind: 'ai', tool: 'Claude Code' } }))
  assert.equal(r.valid, false)
  assert.match(r.reasons.join(';'), /cannot verify its own work/)
  assert.match(r.reasons.join(';'), /same tool family as the builder/)
  r = judge(good({ verifier: { name: 'Claude Code', kind: 'human' } }))
  assert.match(r.reasons.join(';'), /recorded as human/)
  for (const name of ['One Small Engineering Sync', 'One Small Engineering Verify']) {
    r = judge(good({ verifier: { name, kind: 'human' } }))
    assert.match(r.reasons.join(';'), /automation cannot verify/)
  }
  // Registry builder and verifier the same person: nothing can verify.
  const same = fixtureRegistry({ builder: 'Joshua Small', verifier: 'joshua small' }).projects.find(p => p.id === 'one-small-mods-pack')
  r = judge(good(), { project: same })
  assert.match(r.reasons.join(';'), /same party/)
})

test('missing ownership: with no builder and verifier in the registry nothing verifies (the real state)', () => {
  const real = fixtureRegistry({ builder: null, verifier: null }).projects.find(p => p.id === 'one-small-mods-pack')
  const r = judge(good(), { project: real })
  assert.equal(r.valid, false)
  assert.match(r.reasons.join(';'), /does not name both a builder and a verifier/)
})

test('a verifier other than the one named in the registry does not count', () => {
  const r = judge(good({ verifier: { name: 'Someone Else', kind: 'human' } }))
  assert.match(r.reasons.join(';'), /not the verifier named in the registry/)
})

test('AI verifiers: refused by default; allowed only when policy names the project, tool and identity, and the family differs', () => {
  const p = fixtureRegistry({ builder: 'Claude Code', verifier: 'Codex (OpenAI)' }).projects.find(x => x.id === 'one-small-mods-pack')
  const v = good({ verifier: { name: 'Codex (OpenAI)', kind: 'ai', tool: 'Codex' } })
  let r = judge(v, { project: p })
  assert.match(r.reasons.join(';'), /not permitted for one-small-mods-pack/)
  const allowed = { ...pol, aiVerifiers: { allowed: [{ project: 'one-small-mods-pack', tool: 'Codex', identity: 'Codex (OpenAI)' }] } }
  r = judge(v, { project: p, policy: allowed })
  assert.deepEqual(r, { valid: true, reasons: [] })
  // Same family as builder stays refused even if listed.
  const claudeBuilt = fixtureRegistry({ builder: 'Codex', verifier: 'Codex (OpenAI)' }).projects.find(x => x.id === 'one-small-mods-pack')
  r = judge(v, { project: claudeBuilt, policy: allowed })
  assert.equal(r.valid, false)
  // An AI cannot record a manual test.
  r = judge({ ...v, gate: 'documentation-accurate', method: 'manual-test' }, { project: p, policy: allowed })
  assert.match(r.reasons.join(';'), /cannot record a manual test/)
})

test('human-only gates and gates needing manual review', () => {
  let r = judge(good({ gate: 'keyboard-screen-reader', evidence: [], method: 'manual-test', verifier: { name: 'Joshua Small', kind: 'human' } }))
  assert.equal(r.valid, true, r.reasons.join(';'))
  const p = fixtureRegistry({ builder: 'Claude Code', verifier: 'Gemini CLI' }).projects.find(x => x.id === 'one-small-mods-pack')
  const allowed = { ...pol, aiVerifiers: { allowed: [{ project: 'one-small-mods-pack', tool: 'Gemini CLI', identity: 'Gemini CLI' }] } }
  r = judge(good({ gate: 'no-release-blockers', evidence: [], method: 'reviewed-artifacts', verifier: { name: 'Gemini CLI', kind: 'ai', tool: 'Gemini CLI' } }), { project: p, policy: allowed })
  assert.match(r.reasons.join(';'), /human-only/)
  // A partly automatable gate cannot be passed on automated evidence alone.
  const docs = ev({ name: 'documentation', version: '1.0.0', gates: ['documentation-accurate'] })
  r = judge(good({ gate: 'documentation-accurate', evidence: [{ id: docs.id, digest: docs.digest }] }), { evidence: [pack, docs] })
  assert.match(r.reasons.join(';'), /only partly automatable; a pass needs method manual-test/)
})

test('verification is bound to the exact commit and the exact evidence examined', () => {
  let r = judge(good({ commitSha: SHA2 }))
  assert.match(r.reasons.join(';'), /evaluated commit is aaaaaaa/)
  r = judge(good(), { targetSha: SHA2 })
  assert.match(r.reasons.join(';'), /verifies aaaaaaa, but the evaluated commit is bbbbbbb/)
  r = judge(good({ evidence: [{ id: pack.id, digest: 'c'.repeat(64) }] }))
  assert.match(r.reasons.join(';'), /changed after it was examined/)
  r = judge(good({ evidence: [{ id: 'ev-one-small-mods-pack-nope', digest: 'c'.repeat(64) }] }))
  assert.match(r.reasons.join(';'), /not in the ledger/)
  const old = ev({ name: 'release-packaging', version: '1.0.0', gates: ['package-metadata-exports'] }, 'pass', { commitSha: SHA2 })
  r = judge(good({ evidence: [{ id: old.id, digest: old.digest }] }), { evidence: [old] })
  assert.match(r.reasons.join(';'), /is for bbbbbbb, not aaaaaaa/)
  const forged = { ...structuredClone(pack), result: 'fail' }
  r = judge(good(), { evidence: [forged] })
  assert.match(r.reasons.join(';'), /malformed or forged/)
})

test('a pass needs passing evidence from every required collector, examined after collection', () => {
  const failing = ev({ name: 'release-packaging', version: '1.0.0', gates: ['package-metadata-exports'] }, 'fail')
  let r = judge(good({ evidence: [{ id: failing.id, digest: failing.digest }] }), { evidence: [failing] })
  assert.match(r.reasons.join(';'), /evidence is fail; an automated pass cannot rest on it/)
  r = judge(good({ evidence: [] }))
  assert.match(r.reasons.join(';'), /needs the release-packaging collector's evidence/)
  r = judge(good({ verifiedAt: '2026-10-27T00:30:00Z' }))
  assert.match(r.reasons.join(';'), /before the evidence it cites was collected/)
  r = judge(good({ verifiedAt: '2026-10-28T00:00:00Z' }))
  assert.match(r.reasons.join(';'), /after the evaluation time/)
  // Evidence from a collector that does not speak for the gate.
  const secrets = ev({ name: 'secret-scan', version: '1.0.0', gates: ['security-privacy-review'] })
  r = judge(good({ evidence: [{ id: pack.id, digest: pack.digest }, { id: secrets.id, digest: secrets.digest }] }), { evidence: [pack, secrets] })
  assert.match(r.reasons.join(';'), /does not speak for package-metadata-exports/)
})

test('gate applicability: a gate outside the tier cannot be verified', () => {
  const r = judge(good({ gate: 'authentication', method: 'manual-test' }))
  assert.match(r.reasons.join(';'), /not part of the library tier/)
})

test('malformed and duplicate verification records are rejected', () => {
  assert.deepEqual(checkShape(null), ['verification: not an object'])
  const bad = good({ attestation: 'https://evil.example/approve', notes: 'ok', verifier: { name: '', kind: 'robot' }, method: 'vibes', result: 'approved' })
  const reasons = checkShape(bad).join(';')
  for (const re of [/attestation/, /notes/, /verifier/, /method/, /result/]) assert.match(reasons, re)
  const l = loadVerifications({ project: 'one-small-mods-pack', verifications: [good(), good(), bad] }, 'one-small-mods-pack')
  assert.equal(l.verifications.length, 1)
  assert.match(l.problems.join(';'), /duplicate record/)
})

test('routing sends ready evidence to the registry verifier and blocks routing when none is assigned', () => {
  const route = p => routeRequests({ project: p, policy: pol, evidence: [pack], targetSha: SHA, asOf: AS_OF, gateCatalog: catalog, verifiedGates: new Set() })
  const ready = route(msp).find(q => q.gate === 'package-metadata-exports')
  assert.equal(ready.status, 'ready for verifier')
  assert.equal(ready.routedTo, 'Joshua Small')
  assert.equal(ready.method, 're-executed')
  assert.equal(route(msp).find(q => q.gate === 'scope-complete').status, 'manual verification only')
  assert.deepEqual(route(msp).find(q => q.gate === 'automated-checks').missingCollectors, ['build-test', 'lint-format-types', 'ci-results'])
  const real = fixtureRegistry({ builder: null, verifier: null }).projects.find(p => p.id === 'one-small-mods-pack')
  for (const q of route(real)) { assert.equal(q.routedTo, null); assert.match(q.status, /no independent verifier/) }
  assert.equal(digestOf(pack), pack.digest)
})
