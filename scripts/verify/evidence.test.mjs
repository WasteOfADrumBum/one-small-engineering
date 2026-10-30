import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkEvidence, digestOf, staleness, loadLedger, mergeLedger, makeEvidence, cacheKey, canonical } from './evidence.mjs'
import { ev, policy, SHA, SHA2, T0 } from '../../fixtures/verify/helpers.mjs'

test('a collected record is well formed, digested and carries every required field', () => {
  const e = ev('release-packaging', 'pass', { gates: ['package-metadata-exports'] })
  assert.deepEqual(checkEvidence(e), [])
  for (const k of ['project', 'gates', 'repository', 'commitSha', 'collector', 'executedAt', 'result', 'artifacts', 'provenance', 'freshness', 'digest']) assert.ok(k in e, k)
  assert.equal(e.provenance.collectorIdentity, 'One Small Engineering Verify')
  assert.equal(e.freshness.expiresAt, '2026-11-26T01:00:00Z')
  assert.equal(e.failureReason, null)
})

test('forged evidence: any edit after collection breaks the digest', () => {
  const e = ev('build-test', 'fail', { gates: ['automated-checks'] })
  for (const forge of [x => { x.result = 'pass' }, x => { x.commitSha = SHA2 }, x => { x.gates.push('scope-complete') }, x => { x.provenance.executor = 'github-actions' }, x => { x.freshness.expiresAt = '2099-01-01T00:00:00Z' }]) {
    const f = structuredClone(e)
    forge(f)
    assert.match(checkEvidence(f).join(';'), /digest does not match/)
  }
  // Re-digesting a forged record makes it consistent again, which is why the digest is integrity,
  // not authorship: verification records pin the digest the verifier examined.
  const f = structuredClone(e)
  f.result = 'pass'
  f.failureReason = null
  f.digest = digestOf(f)
  assert.deepEqual(checkEvidence(f), [])
  assert.notEqual(f.digest, e.digest)
})

test('malformed evidence is rejected with reasons, never read as passing', () => {
  assert.deepEqual(checkEvidence(null), ['evidence: not an object'])
  assert.deepEqual(checkEvidence([]), ['evidence: not an object'])
  const e = ev('secret-scan')
  const cases = [
    [x => { x.commitSha = 'abc' }, /commitSha/],
    [x => { x.result = 'ok' }, /result must be/],
    [x => { x.executedAt = 'yesterday' }, /executedAt/],
    [x => { x.repository = 'https://evil.example/x/y' }, /repository/],
    [x => { x.provenance = {} }, /provenance/],
    [x => { x.schema = 2 }, /schema/],
    [x => { delete x.freshness }, /freshness/]
  ]
  for (const [mut, re] of cases) { const f = structuredClone(e); mut(f); f.digest = digestOf(f); assert.match(checkEvidence(f).join(';'), re) }
  const nf = ev('build-test', 'fail')
  nf.failureReason = ''
  nf.digest = digestOf(nf)
  assert.match(checkEvidence(nf).join(';'), /needs a failureReason/)
})

test('stale and mismatched evidence: wrong commit, expired, or dated in the future', () => {
  const e = ev('build-test')
  assert.equal(staleness(e, { commitSha: SHA, asOf: new Date('2026-10-28T00:00:00Z') }), null)
  assert.match(staleness(e, { commitSha: SHA2, asOf: new Date('2026-10-28T00:00:00Z') }), /not the evaluated commit/)
  assert.match(staleness(e, { commitSha: SHA, asOf: new Date('2026-12-01T00:00:00Z') }), /expired/)
  assert.match(staleness(e, { commitSha: SHA, asOf: new Date('2026-10-26T00:00:00Z') }), /after the evaluation time/)
  const ci = ev({ name: 'ci-results', version: '1.0.0', gates: ['automated-checks'] })
  assert.match(staleness(ci, { commitSha: SHA, asOf: new Date('2026-11-04T00:00:00Z') }), /expired/, 'ci-results expires after 7 days')
})

test('access failures: current at their own commit and when no commit is known, stale at any other commit', () => {
  const u = ev('repo-structure', 'unavailable')
  assert.equal(staleness(u, { commitSha: SHA, asOf: new Date('2026-12-31T00:00:00Z') }), null, 'a real access failure never expires')
  assert.equal(staleness(u, { commitSha: null, asOf: new Date('2026-10-28T00:00:00Z') }), null)
  assert.match(staleness(u, { commitSha: SHA2, asOf: new Date('2026-10-28T00:00:00Z') }), /access failure recorded for aaaaaaa, not the evaluated commit bbbbbbb/)
  const noCommit = ev('repo-structure', 'unavailable', { commitSha: null })
  assert.equal(staleness(noCommit, { commitSha: SHA, asOf: new Date('2026-10-28T00:00:00Z') }), null, 'a failure before any commit was resolved stays visible')
})

test('ledgers reject duplicates, forged and foreign records; merging is idempotent and ordered', () => {
  const a = ev('build-test', 'pass', { at: T0 })
  const b = ev('secret-scan', 'pass', { at: '2026-10-27T01:05:00Z' })
  const forged = { ...structuredClone(a), id: 'ev-one-small-mods-pack-x', result: 'fail' }
  const foreign = ev('build-test', 'pass', { project: 'one-small-ui' })
  const l = loadLedger({ project: 'one-small-mods-pack', evidence: [a, b, a, forged, foreign] }, 'one-small-mods-pack')
  assert.deepEqual(l.evidence.map(e => e.id), [a.id, b.id])
  assert.equal(l.problems.length, 4)
  assert.match(l.problems.join(';'), /duplicate record/)
  assert.match(l.problems.join(';'), /digest/)
  assert.match(l.problems.join(';'), /belongs to one-small-ui/)
  assert.match(loadLedger(null, 'x').problems[0], /must be an object/)
  const once = mergeLedger([a], [b])
  assert.deepEqual(mergeLedger(once, [a, b]), once)
  assert.deepEqual(once.map(e => e.id), [b.id, a.id], 'newest first')
})

test('secret redaction: credentials in collector output never reach the record', () => {
  const token = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'
  const e = makeEvidence({
    project: 'one-small-mods-pack', repository: 'https://github.com/WasteOfADrumBum/one-small-mods-pack', commitSha: SHA, collector: { name: 'build-test', version: '1.0.0' }, gates: ['automated-checks'],
    outcome: { result: 'fail', summary: `npm test printed ${token}`, failureReason: `token=${token}`, checks: [{ name: 'test', result: 'fail', detail: `Authorization: Bearer ${token}` }] },
    executedAt: new Date(T0), provenance: { executor: 'local' }, policy: policy(), policyHash: 'f'.repeat(64)
  })
  assert.ok(!JSON.stringify(e).includes(token))
  assert.match(e.summary, /redacted GitHub token/)
  assert.deepEqual(checkEvidence(e), [])
})

test('cache keys change with commit, collector version, policy and execution mode only', () => {
  const base = { project: 'p', commitSha: SHA, collector: { name: 'c', version: '1.0.0' }, policyHash: 'x', execute: true }
  const k = cacheKey(base)
  assert.equal(cacheKey({ ...base }), k)
  for (const over of [{ commitSha: SHA2 }, { collector: { name: 'c', version: '1.0.1' } }, { policyHash: 'y' }, { execute: false }]) assert.notEqual(cacheKey({ ...base, ...over }), k)
  assert.equal(canonical({ b: 1, a: [2, { d: 1, c: 2 }] }), '{"a":[2,{"c":2,"d":1}],"b":1}')
})
