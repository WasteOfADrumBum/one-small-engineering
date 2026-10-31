// Release-readiness engine: tiers, gate states, provenance, percentages, blockers, approval,
// dependencies and next actions, including adversarial inputs. Run: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assessRegistry, gateRequirements, classifyEvidence, ownershipState, summarize, ReadinessInputError, POST_PUBLICATION_GATES } from './engine.mjs'
import { validateRegistry, parseDefinitionOfDone, SYNC_RECORDER, dependencyCycles } from '../validate-registry.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
// A frozen copy, not the live registry: automated sync updates the live one (for example a project's CI turning red), which must not break unrelated tests.
const registryText = readFileSync(resolve(ROOT, 'fixtures/sync/registry-baseline.json'), 'utf8')
const dodText = readFileSync(resolve(ROOT, 'standards/definition-of-done.md'), 'utf8')
const schema = JSON.parse(readFileSync(resolve(ROOT, 'projects/registry.schema.json'), 'utf8'))
const dod = parseDefinitionOfDone(dodText)
const AS_OF = new Date('2026-10-26T02:00:00Z')
const T = '2026-10-25T12:00:00Z'
const SHA = 'a'.repeat(40)
const SHA2 = 'b'.repeat(40)

const load = () => JSON.parse(registryText)
// Fixture records are dated T; the live registry may have been updated since, never earlier.
const atLeast = (a, b) => (a > b ? a : b)
const byId = (r, id) => r.projects.find(p => p.id === id)
const assess = (r, opts = {}) => assessRegistry(r, { dodText, asOf: AS_OF, ...opts })
const one = (r, id, opts) => assess(r, opts).projects.find(p => p.id === id)
const validate = r => validateRegistry(r, schema, { now: new Date('2030-01-01T00:00:00Z'), dod })

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v) }
  return o
}

// A project carried through a complete, independently verified release on candidate SHA.
// approved: also records Joshua Small's approval and marks the release released.
function verifiedProject(r, id, { approved = true, recordedBy = 'Codex verifier', when = T } = {}) {
  const p = byId(r, id)
  p.ownership = { builder: 'Claude Code', verifier: 'ChatGPT Codex', approvalOwner: 'Joshua Small' }
  p.evidence.push({ id: `${id}-verifier-pass`, type: 'manual_test', url: `${p.repository}/pull/99`, commitSha: SHA, verifiedAt: when, result: 'pass', description: 'Fixture: verifier re-check.', recordedBy })
  p.evidence.push({ id: `${id}-owner-approval`, type: 'pull_request', url: `${p.repository}/pull/99#pullrequestreview-1`, commitSha: SHA, verifiedAt: when, result: 'pass', description: 'Fixture: owner approving review.', recordedBy: 'Joshua Small' })
  p.releaseGates = p.releaseGates.map(g => g.status === 'not_applicable' ? g : { ...g, status: 'verified', evidenceRefs: [`${id}-verifier-pass`], verifiedAt: when, notes: null })
  p.release = { ...p.release, targetVersion: '9.0.0', scopeDocument: `${p.repository}/blob/${SHA}/docs/scope.md`, blockers: p.release.blockers.map(b => ({ ...b, status: 'resolved', evidenceRefs: [`${id}-verifier-pass`] })), candidate: { pullRequest: 99, ref: 'release', headSha: SHA, observedAt: when } }
  p.openPullRequests = [{ number: 99, url: `${p.repository}/pull/99`, title: 'Release', headSha: SHA, draft: false }]
  p.lastVerifiedAt = when
  if (approved) {
    p.release.releaseStatus = 'released'
    p.release.currentVersion = '9.0.0'
    p.approval = { status: 'approved', approvedBy: 'Joshua Small', approvedAt: when, evidenceRefs: [`${id}-owner-approval`] }
  } else {
    p.release.releaseStatus = 'verified'
  }
  p.dependencies = []
  return p
}

test('fixtures used below are valid registries (so engine results are about real inputs)', () => {
  const r = load()
  for (const id of ['one-small-studio', 'one-small-ui', 'taskforge']) verifiedProject(r, id)
  r.lastUpdatedAt = atLeast(r.lastUpdatedAt, '2026-10-26T01:59:00Z')
  assert.deepEqual(validate(r), [])
})

test('all three tiers: a verified, approved release is release-ready at 100% (showcase, library, application)', () => {
  const r = load()
  for (const id of ['one-small-studio', 'one-small-ui', 'taskforge']) verifiedProject(r, id)
  for (const [id, applicable] of [['one-small-studio', 10], ['one-small-ui', 22], ['taskforge', 20]]) {
    const a = one(r, id).derived.readiness
    assert.equal(a.applicableGates, applicable, id)
    assert.equal(a.verifiedGates, applicable, id)
    assert.equal(a.percentage, 100, id)
    assert.equal(a.eligibility, 'released', id)
    assert.equal(a.releaseReady, true, id)
    assert.equal(a.blockingFindings, 0, id)
  }
})

test('library tier: production-deployment not applicable with a rationale is excluded from the denominator', () => {
  const r = load()
  verifiedProject(r, 'one-small-mods-pack')
  const a = one(r, 'one-small-mods-pack')
  assert.equal(a.derived.readiness.totalGates, 22)
  assert.equal(a.derived.readiness.applicableGates, 21)
  assert.equal(a.derived.gates.find(g => g.id === 'production-deployment').state, 'not_applicable')
  assert.equal(a.derived.readiness.percentage, 100)
})

test('not applicable without a written rationale is unknown, not excluded', () => {
  const r = load()
  verifiedProject(r, 'one-small-mods-pack')
  byId(r, 'one-small-mods-pack').releaseGates.find(g => g.id === 'production-deployment').notes = 'n/a'
  const a = one(r, 'one-small-mods-pack')
  const g = a.derived.gates.find(x => x.id === 'production-deployment')
  assert.equal(g.state, 'unknown_stale')
  assert.equal(a.derived.readiness.applicableGates, 22)
  assert.equal(a.derived.readiness.releaseReady, false)
})

test('percentages: verified over applicable, rounded down to one decimal, null with nothing applicable', () => {
  const r = load()
  const p = verifiedProject(r, 'one-small-studio', { approved: false })
  // 2 of 3 would round up to 66.7; the engine never overstates.
  p.releaseGates.forEach((g, i) => { if (i >= 3) { g.status = 'not_applicable'; g.notes = 'Fixture: not applicable to this test project at all.'; g.verifiedAt = null; g.evidenceRefs = [] } })
  p.releaseGates[2] = { ...p.releaseGates[2], status: 'in_progress', verifiedAt: null }
  let a = one(r, 'one-small-studio').derived.readiness
  assert.equal(a.applicableGates, 3)
  assert.equal(a.verifiedGates, 2)
  assert.equal(a.remainingGates, 1)
  assert.equal(a.percentage, 66.6)
  p.releaseGates[0] = { ...p.releaseGates[0], status: 'not_verified', verifiedAt: null }
  assert.equal(one(r, 'one-small-studio').derived.readiness.percentage, 33.3)
  for (const g of p.releaseGates) { g.status = 'not_applicable'; g.notes = 'Fixture: not applicable to this test project at all.' }
  a = one(r, 'one-small-studio').derived.readiness
  assert.equal(a.percentage, null)
  assert.equal(a.releaseReady, false, 'nothing applicable is never ready')
})

test('states are counted apart and always sum to the tier gate count', () => {
  const a = assess(load())
  assert.equal(a.projects.length, 8)
  for (const p of a.projects) {
    const r = p.derived.readiness
    assert.equal(Object.values(r.byState).reduce((x, y) => x + y, 0), r.totalGates, p.id)
    assert.equal(r.applicableGates, r.totalGates - r.byState.not_applicable, p.id)
    assert.equal(r.remainingGates, r.applicableGates - r.verifiedGates, p.id)
  }
})

test('false-positive readiness: green CI, an open PR and a deployment verify nothing', () => {
  const r = load()
  const p = byId(r, 'one-small-studio')
  p.release.targetVersion = '1.0.0'
  p.release.scopeDocument = `${p.repository}/blob/${SHA}/docs/scope.md`
  for (const [id, type] of [['studio-ci-green', 'workflow_run'], ['studio-pr', 'pull_request'], ['studio-deploy', 'deployment']]) {
    p.evidence.push({ id, type, url: `${p.repository}/pull/1`, commitSha: SHA, verifiedAt: T, result: 'builder_reported', description: 'Fixture.', recordedBy: 'Claude Code' })
  }
  p.releaseGates.forEach(g => { g.status = 'in_progress'; g.evidenceRefs = ['studio-ci-green', 'studio-pr', 'studio-deploy'] })
  const a = one(r, 'one-small-studio')
  assert.equal(a.derived.readiness.verifiedGates, 0)
  assert.equal(a.derived.readiness.percentage, 0)
  assert.equal(a.derived.readiness.releaseReady, false)
  assert.deepEqual(a.derived.readiness.missingIndependentVerification.length, 10)
})

test('false-positive readiness: gates marked verified on builder, sync or metadata evidence are unknown, not verified', () => {
  const cases = {
    'recorded by the builder': p => { p.evidence.find(e => e.id.endsWith('verifier-pass')).recordedBy = 'Claude Code' },
    'builder_reported result': p => { p.evidence.find(e => e.id.endsWith('verifier-pass')).result = 'builder_reported' },
    'repository metadata': p => { p.evidence.find(e => e.id.endsWith('verifier-pass')).type = 'repository_metadata' },
    'sync origin': p => { Object.assign(p.evidence.find(e => e.id.endsWith('verifier-pass')), { origin: 'sync', recordedBy: SYNC_RECORDER }) },
    'builder equals verifier': p => { p.ownership.verifier = 'claude code ' },
    'verifier is automation': p => { p.ownership.verifier = SYNC_RECORDER },
    'verifier missing': p => { p.ownership.verifier = null }
  }
  for (const [name, mutate] of Object.entries(cases)) {
    const r = load()
    mutate(verifiedProject(r, 'one-small-studio'))
    const a = one(r, 'one-small-studio')
    assert.equal(a.derived.readiness.verifiedGates, 0, name)
    assert.ok(a.derived.gates.every(g => g.state === 'unknown_stale'), name)
    assert.equal(a.derived.readiness.releaseReady, false, name)
    assert.notEqual(a.derived.readiness.eligibility, 'released', name)
    assert.ok(a.derived.blockers.release.some(b => b.category === 'stale-evidence'), name)
  }
})

test('provenance: each evidence class is told apart', () => {
  const r = load()
  const p = verifiedProject(r, 'one-small-studio')
  const own = ownershipState(p)
  const e = over => ({ id: 'x', type: 'manual_test', result: 'pass', recordedBy: 'Codex verifier', verifiedAt: T, ...over })
  assert.equal(classifyEvidence(p, e({}), own), 'independent')
  assert.equal(classifyEvidence(p, e({ recordedBy: 'Claude Code' }), own), 'pass-without-independent-verifier')
  // Neither builder nor verifier: a third party's pass is not independent verification.
  assert.equal(classifyEvidence(p, e({ recordedBy: 'GitHub Copilot' }), own), 'pass-without-independent-verifier')
  assert.equal(classifyEvidence(p, e({ recordedBy: 'Joshua Small' }), own), 'pass-without-independent-verifier')
  assert.equal(classifyEvidence(p, e({ result: 'builder_reported' }), own), 'builder-reported')
  assert.equal(classifyEvidence(p, e({ result: 'informational' }), own), 'observation')
  assert.equal(classifyEvidence(p, e({ type: 'repository_metadata' }), own), 'observation')
  assert.equal(classifyEvidence(p, e({ origin: 'sync' }), own), 'observation')
  assert.equal(classifyEvidence(p, e({ origin: 'ai-assessment' }), own), 'observation')
  assert.equal(classifyEvidence(p, e({ result: 'fail' }), own), 'failed')
  p.ownership.verifier = null
  assert.equal(classifyEvidence(p, e({}), ownershipState(p)), 'pass-without-independent-verifier')
})

test('stale evidence: older than the window, for another commit, or dated after the report', () => {
  let r = load()
  verifiedProject(r, 'one-small-studio', { when: '2026-09-01T00:00:00Z' })
  let a = one(r, 'one-small-studio')
  assert.ok(a.derived.gates.every(g => g.state === 'unknown_stale'))
  assert.match(a.derived.gates[0].missing.join(' '), /55 days old \(window 30 days\)/)
  assert.equal(one(r, 'one-small-studio', { staleDays: 60 }).derived.readiness.verifiedGates, 10, 'a wider window accepts it')

  r = load()
  verifiedProject(r, 'one-small-studio').release.candidate.headSha = SHA2
  r.projects.find(p => p.id === 'one-small-studio').openPullRequests[0].headSha = SHA2
  a = one(r, 'one-small-studio')
  assert.equal(a.derived.readiness.verifiedGates, 0)
  assert.match(a.derived.gates[0].missing.join(' '), /not the release candidate bbbbbbb/)

  r = load()
  verifiedProject(r, 'one-small-studio', { when: '2026-10-27T00:00:00Z' })
  assert.equal(one(r, 'one-small-studio').derived.readiness.verifiedGates, 0, 'evidence from the future is not current')
})

test('stale evidence: an in-progress gate whose only evidence is stale is unknown', () => {
  const r = load()
  const p = byId(r, 'one-small-studio')
  p.evidence.push({ id: 'studio-old', type: 'document', url: `${p.repository}/blob/x`, commitSha: null, verifiedAt: '2026-01-01T00:00:00Z', result: 'builder_reported', description: 'Old.', recordedBy: 'Claude Code' })
  Object.assign(p.releaseGates[0], { status: 'in_progress', evidenceRefs: ['studio-old'] })
  const a = one(r, 'one-small-studio')
  assert.equal(a.derived.gates[0].state, 'unknown_stale')
  assert.ok(a.derived.blockers.release.some(b => b.id === `auto-stale-${p.releaseGates[0].id}`))
})

test('a moved release candidate makes every commit-pinned record stale and adds a blocker', () => {
  const r = load()
  const p = verifiedProject(r, 'one-small-studio')
  p.openPullRequests[0].headSha = SHA2
  const a = one(r, 'one-small-studio')
  assert.equal(a.derived.readiness.candidateMoved, true)
  assert.equal(a.derived.readiness.verifiedGates, 0)
  assert.ok(a.derived.blockers.release.some(b => b.id === 'auto-candidate-moved'))
  assert.equal(a.derived.readiness.releaseReady, false)
})

test('approval rules: only the approval owner, with manual evidence that exists', () => {
  const variants = {
    pending: p => { p.approval = { status: 'pending', approvedBy: null, approvedAt: null, evidenceRefs: [] } },
    'approved by someone else': p => { p.approval.approvedBy = 'Claude Code' },
    'no evidence': p => { p.approval.evidenceRefs = [] },
    'evidence missing': p => { p.approval.evidenceRefs = ['nope'] },
    'evidence written by sync': p => { Object.assign(p.evidence.find(e => e.id.endsWith('owner-approval')), { origin: 'sync', recordedBy: SYNC_RECORDER }) },
    rejected: p => { p.approval.status = 'rejected' }
  }
  for (const [name, mutate] of Object.entries(variants)) {
    const r = load()
    mutate(verifiedProject(r, 'one-small-studio'))
    const a = one(r, 'one-small-studio')
    assert.equal(a.derived.approval.valid, false, name)
    assert.equal(a.derived.readiness.releaseReady, false, name)
    assert.ok(a.derived.blockers.release.some(b => b.category === 'approval'), name)
  }
})

test('all gates verified without approval: awaiting the owner, never ready; the approval is the only action', () => {
  const r = load()
  verifiedProject(r, 'one-small-studio', { approved: false })
  const a = one(r, 'one-small-studio')
  assert.equal(a.derived.readiness.percentage, 100)
  assert.equal(a.derived.readiness.eligibility, 'awaiting-owner-decision')
  assert.equal(a.derived.readiness.releaseReady, false)
  assert.equal(a.derived.nextActions.length, 1)
  assert.match(a.derived.nextActions[0].text, /Ask Joshua Small/)
})

test('pre-publication gates verified and post-publication gates pending: ready for the owner decision only', () => {
  const r = load()
  const p = verifiedProject(r, 'one-small-mods-pack', { approved: false })
  for (const g of p.releaseGates) if (POST_PUBLICATION_GATES.has(g.id) && g.status !== 'not_applicable') Object.assign(g, { status: 'not_verified', evidenceRefs: [], verifiedAt: null })
  const a = one(r, 'one-small-mods-pack')
  assert.equal(a.derived.readiness.eligibility, 'awaiting-owner-decision')
  assert.equal(a.derived.readiness.prePublication.verified, a.derived.readiness.prePublication.applicable)
  assert.ok(a.derived.readiness.percentage < 100)
  assert.equal(a.derived.readiness.releaseReady, false)
})

test('missing release scope: not scoped, with a derived scope blocker unless one is recorded', () => {
  const r = load()
  const tf = one(r, 'taskforge')
  assert.equal(tf.derived.readiness.eligibility, 'not-scoped')
  const scope = tf.derived.blockers.release.find(b => b.id === 'auto-scope-missing')
  assert.ok(scope)
  assert.match(scope.action, /target version/)
  const studio = one(r, 'one-small-studio')
  assert.ok(!studio.derived.blockers.release.some(b => b.id === 'auto-scope-missing'), 'the recorded scope-document-missing blocker covers it')
  assert.ok(studio.derived.blockers.release.some(b => b.id === 'scope-document-missing' && b.origin === 'registry'))
  assert.match(studio.derived.nextActions[0].text, /scope-document-missing/)
})

test('blockers: registry blockers always block whatever their classification; resolved ones do not', () => {
  const r = load()
  const p = verifiedProject(r, 'one-small-studio')
  p.release.blockers.push({ id: 'minor-header', description: 'Missing security header on a static page.', status: 'open', evidenceRefs: [], category: 'security', severity: 'low', gates: ['security-privacy-review'] })
  const a = one(r, 'one-small-studio')
  const b = a.derived.blockers.release.find(x => x.id === 'minor-header')
  assert.ok(b, 'a low-severity recorded blocker is never downgraded or dropped')
  assert.equal(a.derived.readiness.releaseReady, false)
  assert.ok(a.derived.gates.find(g => g.id === 'security-privacy-review').blockers.includes('minor-header'))
  assert.ok(a.derived.gates.find(g => g.id === 'no-release-blockers').blockers.includes('minor-header'))
  p.release.blockers.at(-1).status = 'resolved'
  assert.equal(one(r, 'one-small-studio').derived.readiness.releaseReady, true)
})

test('blockers: merge, release and post-release are separated; failing CI blocks merge', () => {
  const r = load()
  const p = verifiedProject(r, 'one-small-studio')
  p.evidence.push({ id: 'studio-ci-red', type: 'workflow_run', url: `${p.repository}/actions/runs/1`, commitSha: SHA, verifiedAt: T, result: 'builder_reported', description: 'CI on the head concluded failure (builder-reported).', recordedBy: 'Claude Code' })
  p.release.enhancements = ['More photos.']
  p.release.blockers.push({ id: 'pr-text', description: 'PR text out of date.', status: 'open', evidenceRefs: [], category: 'documentation', blocks: 'merge' })
  const a = one(r, 'one-small-studio')
  assert.deepEqual(a.derived.blockers.merge.map(b => b.id), ['pr-text', 'auto-ci-failed-studio-ci-red'])
  assert.deepEqual(a.derived.blockers.postRelease.map(b => b.text), ['More photos.'])
  assert.ok(!a.derived.blockers.release.some(b => b.id === 'pr-text'))
  assert.equal(a.derived.readiness.releaseReady, false)
})

test('blockers: failed gate evidence is a release blocker; unclassified security failure ranks first', () => {
  const r = load()
  const p = byId(r, 'one-small-studio')
  p.evidence.push({ id: 'studio-sec-fail', type: 'audit', url: `${p.repository}/pull/2`, commitSha: SHA, verifiedAt: T, result: 'fail', description: 'Fixture: review found an issue.', recordedBy: 'Codex verifier' })
  p.evidence.push({ id: 'studio-a11y-fail', type: 'manual_test', url: `${p.repository}/pull/3`, commitSha: SHA, verifiedAt: T, result: 'fail', description: 'Fixture.', recordedBy: 'Codex verifier' })
  p.releaseGates.find(g => g.id === 'security-privacy-review').evidenceRefs = ['studio-sec-fail']
  p.releaseGates.find(g => g.id === 'wcag-22-aa').evidenceRefs = ['studio-a11y-fail']
  const a = one(r, 'one-small-studio')
  const sec = a.derived.blockers.release.find(b => b.id === 'auto-gate-failed-security-privacy-review')
  assert.equal(sec.category, 'security')
  assert.match(sec.description, /severity not classified/)
  assert.equal(a.derived.blockers.release.find(b => b.id === 'auto-gate-failed-wcag-22-aa').category, 'accessibility')
  assert.equal(a.derived.nextActions[0].source, 'auto-gate-failed-security-privacy-review')
  assert.equal(a.derived.nextActions[0].priority, 1)
})

test('next actions follow the priority order and never invent work', () => {
  const r = load()
  const p = verifiedProject(r, 'one-small-studio')
  const add = (id, category, extra = {}) => p.release.blockers.push({ id, description: `Fixture ${id}.`, status: 'open', evidenceRefs: [], category, ...extra })
  add('docs', 'documentation'); add('dist', 'distribution'); add('a11y', 'accessibility'); add('ci', 'ci'); add('verify', 'evidence'); add('broken', 'defect'); add('sec', 'security', { severity: 'high' }); add('sec-low', 'security', { severity: 'low' })
  const a = one(r, 'one-small-studio')
  assert.deepEqual(a.derived.nextActions.map(x => x.source), ['sec', 'broken', 'verify', 'ci', 'a11y', 'dist', 'docs', 'sec-low'])
  assert.deepEqual(a.derived.nextActions.map(x => x.rank), [1, 2, 3, 4, 5, 6, 7, 8])
  // A finished, approved release with nothing open has no actions at all.
  assert.deepEqual(one(load().projects && (() => { const x = load(); verifiedProject(x, 'one-small-studio'); return x })(), 'one-small-studio').derived.nextActions, [])
})

test('summaries are one short sentence', () => {
  assert.equal(summarize('Resolve blocker x: long text here. More.'), 'Resolve blocker x.')
  assert.equal(summarize('No punctuation'), 'No punctuation')
  assert.ok(summarize(`${'word '.repeat(60)}end.`).length <= 143)
})

test('dependencies: required and unreleased blocks; satisfied, optional and informational do not', () => {
  const r = load()
  const ev = byId(r, 'one-small-studio')
  ev.evidence.push({ id: 'studio-uses-ui', type: 'document', url: `${ev.repository}/blob/x/package.json`, commitSha: null, verifiedAt: T, result: 'informational', description: 'Fixture.', recordedBy: 'Claude Code' })
  ev.dependencies = [{ project: 'one-small-ui', relationship: 'uses-components', requiredForRelease: true, minVersion: '0.6.0', reason: 'Fixture.', evidenceRefs: ['studio-uses-ui'] }]
  let a = one(r, 'one-small-studio')
  const d = a.derived.dependencies.find(x => x.project === 'one-small-ui')
  assert.equal(d.kind, 'blocked')
  assert.ok(a.derived.blockers.release.some(b => b.id === 'auto-dependency-blocked-one-small-ui' && b.category === 'dependency'))
  ev.dependencies[0].minVersion = '0.5.0'
  a = one(r, 'one-small-studio')
  assert.equal(a.derived.dependencies.find(x => x.project === 'one-small-ui').kind, 'satisfied')
  assert.ok(!a.derived.blockers.release.some(b => b.category === 'dependency'))
  ev.dependencies[0].minVersion = '0.10.0'
  assert.equal(one(r, 'one-small-studio').derived.dependencies[0].kind, 'blocked', 'versions compare numerically, not as text')
  ev.dependencies[0] = { ...ev.dependencies[0], requiredForRelease: false, minVersion: '9.0.0' }
  a = one(r, 'one-small-studio')
  assert.equal(a.derived.dependencies[0].kind, 'informational', 'an unreleased enhancement of an optional dependency never blocks')
  assert.ok(!a.derived.blockers.release.some(b => b.category === 'dependency'))
})

test('dependencies: missing, self, unsupported and stale declarations are reported', () => {
  const r = load()
  const p = byId(r, 'one-small-studio')
  p.evidence.push({ id: 'studio-old-dep', type: 'document', url: `${p.repository}/blob/x`, commitSha: null, verifiedAt: '2026-01-01T00:00:00Z', result: 'informational', description: 'Fixture.', recordedBy: 'Claude Code' })
  p.dependencies = [
    { project: 'not-a-project', relationship: 'adopts', requiredForRelease: true, minVersion: null, reason: 'x', evidenceRefs: [] },
    { project: 'one-small-studio', relationship: 'adopts', requiredForRelease: false, minVersion: null, reason: 'x', evidenceRefs: [] },
    { project: 'taskforge', relationship: 'integrates', requiredForRelease: true, minVersion: null, reason: 'x', evidenceRefs: ['studio-old-dep'] }
  ]
  const kinds = one(r, 'one-small-studio').derived.dependencies.map(d => `${d.project}:${d.kind}:${d.blocking}`)
  assert.ok(kinds.includes('not-a-project:missing:true'))
  assert.ok(kinds.includes('one-small-studio:self:false'))
  assert.ok(kinds.includes('taskforge:stale:true'))
  assert.ok(kinds.includes('taskforge:blocked:true'))
  const errors = validate(r).join('\n')
  assert.match(errors, /"not-a-project" is not a project in this registry/)
  assert.match(errors, /cannot depend on itself/)
  assert.match(errors, /needs evidence for the relationship/)
})

test('dependencies: cycles are found once each; only release-required cycles fail validation', () => {
  const projects = [
    { id: 'a', dependencies: [{ project: 'b', requiredForRelease: true }] },
    { id: 'b', dependencies: [{ project: 'c', requiredForRelease: false }, { project: 'a', requiredForRelease: true }] },
    { id: 'c', dependencies: [{ project: 'a', requiredForRelease: false }] }
  ]
  assert.deepEqual(dependencyCycles(projects), [['a', 'b', 'a'], ['a', 'b', 'c', 'a']])
  assert.deepEqual(dependencyCycles(projects, d => d.requiredForRelease), [['a', 'b', 'a']])

  const r = load()
  const ui = byId(r, 'one-small-ui')
  const studio = byId(r, 'one-small-studio')
  ui.evidence.push({ id: 'ui-dep-ev', type: 'document', url: `${ui.repository}/blob/x`, commitSha: null, verifiedAt: T, result: 'informational', description: 'Fixture.', recordedBy: 'Claude Code' })
  studio.evidence.push({ id: 'studio-dep-ev', type: 'document', url: `${studio.repository}/blob/x`, commitSha: null, verifiedAt: T, result: 'informational', description: 'Fixture.', recordedBy: 'Claude Code' })
  ui.dependencies = [{ project: 'one-small-studio', relationship: 'integrates', requiredForRelease: false, minVersion: null, reason: 'x', evidenceRefs: ['ui-dep-ev'] }]
  studio.dependencies = [{ project: 'one-small-ui', relationship: 'uses-components', requiredForRelease: false, minVersion: null, reason: 'x', evidenceRefs: ['studio-dep-ev'] }]
  r.lastUpdatedAt = atLeast(r.lastUpdatedAt, '2026-10-26T01:59:00Z')
  assert.deepEqual(validate(r), [], 'an optional cycle is legal')
  const a = assess(r)
  assert.deepEqual(a.dependencyCycles, [['one-small-studio', 'one-small-ui', 'one-small-studio']])
  assert.ok(a.projects.find(p => p.id === 'one-small-ui').derived.dependencies.some(d => d.kind === 'cycle' && !d.blocking))
  ui.dependencies[0].requiredForRelease = true
  studio.dependencies[0].requiredForRelease = true
  assert.match(validate(r).join('\n'), /release-required dependency cycle: one-small-studio -> one-small-ui -> one-small-studio/)
  assert.ok(assess(r).projects.find(p => p.id === 'one-small-ui').derived.blockers.release.some(b => b.id === 'auto-dependency-cycle-one-small-studio'))
})

test('the live registry declares only evidenced, non-blocking dependencies (Cortex status integrations)', () => {
  const a = assess(load())
  const cortex = a.projects.find(p => p.id === 'cortex')
  assert.deepEqual(cortex.derived.dependencies.map(d => `${d.project}:${d.kind}`), ['one-small-ui:informational', 'personal-portfolio:informational'])
  assert.deepEqual(a.dependencyCycles, [])
  for (const p of a.projects) assert.ok(!p.derived.blockers.release.some(b => b.category === 'dependency'), p.id)
})

test('malformed or missing source data is refused, never read as success', () => {
  const bad = [
    [null, /not an object/],
    [{}, /no gateCatalog/],
    [{ gateCatalog: {}, approvalOwner: 'Joshua Small' }, /no projects array/],
    [{ ...load(), approvalOwner: '' }, /no approvalOwner/]
  ]
  for (const [r, re] of bad) assert.throws(() => assess(r), e => e instanceof ReadinessInputError && re.test(e.message))
  const mutations = [
    [r => { delete r.projects[0].releaseGates }, /releaseGates is not an array/],
    [r => { r.projects[0].evidence = 'x' }, /evidence is not an array/],
    [r => { r.projects[0].release.blockers = null }, /blockers is not an array/],
    [r => { r.projects[0].tier = 'enterprise' }, /unknown tier/],
    [r => { r.projects[0].evidence[0].verifiedAt = 'yesterday' }, /no valid verifiedAt/],
    [r => { r.projects[0].approval = {} }, /approval is missing or malformed/],
    [r => { r.projects[0].releaseGates[0].evidenceRefs = null }, /malformed release gate/]
  ]
  for (const [mutate, re] of mutations) {
    const r = load()
    mutate(r)
    assert.throws(() => assess(r), e => e instanceof ReadinessInputError && re.test(e.message), String(re))
  }
  assert.throws(() => assessRegistry(load(), { dodText }), /asOf must be a valid Date/)
  assert.throws(() => assess(load(), { staleDays: 0 }), /staleDays/)
})

test('a gate missing from the entry is unknown and keeps the release closed; extra gates are ignored', () => {
  const r = load()
  const p = verifiedProject(r, 'one-small-studio')
  const removed = p.releaseGates.shift()
  p.releaseGates.push({ id: 'authentication', status: 'verified', evidenceRefs: [], verifiedAt: T, notes: null })
  const a = one(r, 'one-small-studio')
  assert.equal(a.derived.gates.find(g => g.id === removed.id).state, 'unknown_stale')
  assert.ok(!a.derived.gates.some(g => g.id === 'authentication'))
  assert.deepEqual(a.derived.findings.map(f => f.kind).sort(), ['extra-gate', 'missing-gate'])
  assert.equal(a.derived.readiness.releaseReady, false)
  assert.equal(a.derived.readiness.totalGates, 10)
})

test('cited evidence that does not exist is reported, not ignored', () => {
  const r = load()
  verifiedProject(r, 'one-small-studio').releaseGates[0].evidenceRefs.push('ghost')
  const g = one(r, 'one-small-studio').derived.gates[0]
  assert.equal(g.state, 'verified', 'the real independent record still counts')
  const r2 = load()
  const p = byId(r2, 'one-small-studio')
  Object.assign(p.releaseGates[0], { status: 'in_progress', evidenceRefs: ['ghost'] })
  assert.match(one(r2, 'one-small-studio').derived.gates[0].missing.join(' '), /cited evidence not found: ghost/)
})

test('the engine never modifies its input (frozen registry) and is deterministic', () => {
  const r = deepFreeze(load())
  const a = assess(r)
  const b = assess(load())
  assert.deepEqual(a, b)
  assert.equal(JSON.stringify(assess(r)), JSON.stringify(a))
})

test('gate requirements are read from the Definition of Done, LF or CRLF, for every catalogued gate', () => {
  const lf = gateRequirements(dodText)
  const crlf = gateRequirements(dodText.replace(/\n/g, '\r\n'))
  assert.deepEqual(crlf, lf)
  for (const id of new Set([...dod.library, ...dod.application])) assert.ok(lf[id], id)
  assert.equal(Object.keys(lf).length, new Set([...dod.library, ...dod.application]).size, 'nothing beyond the Definition of Done')
})

test('the gate list comes from the catalog: the engine defines no gate of its own', () => {
  const a = assess(load())
  const r = load()
  for (const p of a.projects) assert.deepEqual(p.derived.gates.map(g => g.id), r.gateCatalog[p.tier], p.id)
})
