// Planner tests: material changes, idempotency, evidence separation, manual-field preservation.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collect } from './collect.mjs'
import { plan, materialView } from './plan.mjs'
import { guardRegistryChange } from './guard.mjs'
import { validateRegistry, parseDefinitionOfDone } from '../validate-registry.mjs'
import { readJson, ROOT } from './lib.mjs'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { world, loadRegistry, taskforgeState, NOW, TF_HEAD, fakeSha } from '../../fixtures/sync/scenario.mjs'

const schema = readJson('projects/registry.schema.json')
const dod = parseDefinitionOfDone(readFileSync(resolve(ROOT, 'standards/definition-of-done.md'), 'utf8'))
const valid = r => assert.deepEqual(validateRegistry(r, schema, { dod, now: new Date('2030-01-01T00:00:00Z') }), [])
const tf = r => r.projects.find(p => p.id === 'taskforge')

async function observe(tfState, registry = loadRegistry(), now = NOW) {
  const { client } = world({ tf: tfState })
  return collect({ project: tf(registry), client, now })
}

// Everything automation does not own, for "nothing manual changed" assertions.
function manualView(p) {
  const { repositorySnapshot, openPullRequests, evidence, sync, release, ...rest } = p
  const { currentVersion, currentVersionSource, ...releaseRest } = release
  return { ...rest, release: releaseRest, manualEvidence: evidence.filter(e => e.origin !== 'sync'), syncIdentity: { enabled: sync.enabled, mode: sync.mode, repositoryId: sync.repositoryId } }
}

test('first sync records CI as builder_reported and changes no manual field', async () => {
  const registry = loadRegistry()
  const r = plan(registry, await observe(taskforgeState()))
  assert.equal(r.changed, true)
  const p = tf(r.registry)
  const e = p.evidence.find(x => x.origin === 'sync')
  assert.equal(e.result, 'builder_reported')
  assert.equal(e.recordedBy, 'One Small Engineering Sync')
  assert.equal(e.eventKey, 'taskforge:workflow_run:ci.yml/11975d0')
  assert.deepEqual(manualView(p), manualView(tf(registry)))
  assert.ok(r.suggestions.some(s => s.includes('automation will not')))
  assert.deepEqual(guardRegistryChange(registry, r.registry, 'taskforge'), [])
  valid(r.registry)
})

test('re-running against unchanged GitHub state is a no-op (idempotent)', async () => {
  const first = plan(loadRegistry(), await observe(taskforgeState()))
  const later = new Date(NOW.getTime() + 6 * 3600_000)
  const second = plan(first.registry, await observe(taskforgeState(), first.registry, later))
  assert.equal(second.changed, false)
  assert.equal(second.registry, first.registry)
})

test('the same observation always produces byte-identical output', async () => {
  const obs = await observe(taskforgeState())
  const a = plan(loadRegistry(), obs)
  const b = plan(loadRegistry(), structuredClone(obs))
  assert.equal(JSON.stringify(a.registry), JSON.stringify(b.registry))
})

test('a CI failure never verifies or fails a gate; it is a suggestion', async () => {
  const s = taskforgeState()
  s.runs[0].conclusion = 'failure'
  const r = plan(loadRegistry(), await observe(s))
  const p = tf(r.registry)
  assert.ok(p.evidence.filter(e => e.origin === 'sync').every(e => e.result === 'builder_reported'))
  assert.deepEqual(p.releaseGates, tf(loadRegistry()).releaseGates)
  assert.ok(r.suggestions.some(x => x.includes('must not be verified')))
})

test('a new merge moves the snapshot and supersedes the older CI record', async () => {
  const first = plan(loadRegistry(), await observe(taskforgeState()))
  const head2 = fakeSha('tf-head-2')
  const s = taskforgeState({ headSha: head2, runs: [{ id: 202, name: 'CI', path: '.github/workflows/ci.yml', head_sha: head2, event: 'push', conclusion: 'success', updated_at: '2026-10-23T05:00:00Z' }] })
  s.pulls = [{ number: 43, state: 'closed', title: 'KAN-49: next', mergedAt: '2026-10-23T04:59:00Z', mergeCommitSha: head2, headSha: fakeSha('pr43') }]
  const r = plan(first.registry, await observe(s, first.registry))
  const p = tf(r.registry)
  assert.equal(p.repositorySnapshot.headSha, head2)
  const runs = p.evidence.filter(e => e.origin === 'sync' && e.type === 'workflow_run')
  assert.deepEqual(runs.map(e => e.id), [`sync-taskforge-run-ci-yml-${head2.slice(0, 7)}`])
  assert.ok(r.changes.some(c => c.includes('Superseded 1')))
  // An unlabelled merge with no material paths is reported in the snapshot only, not as evidence.
  assert.ok(!p.evidence.some(e => e.type === 'pull_request' && e.origin === 'sync'))
  valid(r.registry)
})

test('a cited automated record is never pruned', async () => {
  const first = plan(loadRegistry(), await observe(taskforgeState()))
  const reg = structuredClone(first.registry)
  const gate = tf(reg).releaseGates.find(g => g.id === 'automated-checks')
  gate.status = 'in_progress'
  gate.evidenceRefs = ['sync-taskforge-run-ci-yml-11975d0']
  const head2 = fakeSha('tf-head-3')
  const s = taskforgeState({ headSha: head2, runs: [{ id: 303, name: 'CI', path: '.github/workflows/ci.yml', head_sha: head2, event: 'push', conclusion: 'success', updated_at: '2026-10-23T05:00:00Z' }] })
  const r = plan(reg, await observe(s, reg))
  assert.ok(tf(r.registry).evidence.some(e => e.id === 'sync-taskforge-run-ci-yml-11975d0'))
  assert.deepEqual(guardRegistryChange(reg, r.registry, 'taskforge'), [])
})

test('labelled or material-path merges become informational evidence', async () => {
  const s = taskforgeState({ config: { configVersion: 1, projectId: 'taskforge', reporting: { materialPaths: ['docs/**'] } } })
  s.pulls = [
    { number: 50, state: 'closed', title: 'Scope doc', mergedAt: '2026-10-20T00:00:00Z', mergeCommitSha: fakeSha('m50'), headSha: fakeSha('h50') },
    { number: 51, state: 'closed', title: 'Release notes', labels: ['release-evidence'], mergedAt: '2026-10-21T00:00:00Z', mergeCommitSha: fakeSha('m51'), headSha: fakeSha('h51') },
    { number: 52, state: 'closed', title: 'Refactor', mergedAt: '2026-10-21T00:00:00Z', mergeCommitSha: fakeSha('m52'), headSha: fakeSha('h52') },
    { number: 53, state: 'closed', title: 'Old', mergedAt: '2026-09-01T00:00:00Z', mergeCommitSha: fakeSha('m53'), headSha: fakeSha('h53') }
  ]
  s.prFiles = { 50: ['docs/scope/phase-3.md'], 52: ['client/src/app.ts'], 53: ['docs/x.md'] }
  const r = plan(loadRegistry(), await observe(s))
  const prs = tf(r.registry).evidence.filter(e => e.type === 'pull_request' && e.origin === 'sync')
  assert.deepEqual(prs.map(e => e.id), ['sync-taskforge-pr-50', 'sync-taskforge-pr-51'])
  assert.ok(prs.every(e => e.result === 'informational'))
  valid(r.registry)
})

test('missed windows: merges across a multi-day gap are each recorded exactly once', async () => {
  const s = taskforgeState({ config: { configVersion: 1, projectId: 'taskforge', reporting: { evidenceLabel: 'evidence' } } })
  s.pulls = [1, 2, 3].map(i => ({ number: 60 + i, state: 'closed', title: `Day ${i}`, labels: ['evidence'], mergedAt: `2026-10-2${i}T00:00:00Z`, mergeCommitSha: fakeSha(`gap${i}`), headSha: fakeSha(`gh${i}`) }))
  const r1 = plan(loadRegistry(), await observe(s))
  const r2 = plan(r1.registry, await observe(s, r1.registry, new Date(NOW.getTime() + 3 * 86400_000)))
  assert.equal(r2.changed, false)
  assert.equal(tf(r1.registry).evidence.filter(e => e.type === 'pull_request').length, 3)
})

test('a published release moves currentVersion forward only under the release rules', async () => {
  const tagSha = fakeSha('v1')
  const s = taskforgeState({
    releases: [
      { tag_name: 'v1.0.0', published_at: '2026-10-22T00:00:00Z' },
      { tag_name: 'v1.1.0-rc.1', published_at: '2026-10-22T01:00:00Z', prerelease: true },
      { tag_name: 'v2.0.0', published_at: '2026-10-22T02:00:00Z' }
    ],
    tags: { 'v1.0.0': { type: 'commit', sha: tagSha }, 'v1.1.0-rc.1': { type: 'commit', sha: fakeSha('rc') }, 'v2.0.0': { type: 'tag', sha: fakeSha('annot') } },
    annotated: { [fakeSha('annot')]: { type: 'commit', sha: fakeSha('v2') } },
    ancestry: { [tagSha]: 'ahead', [fakeSha('rc')]: 'ahead', [fakeSha('v2')]: 'diverged' }
  })
  const r = plan(loadRegistry(), await observe(s))
  const p = tf(r.registry)
  // v2.0.0 is not on main and v1.1.0-rc.1 is a prerelease, so only v1.0.0 counts.
  assert.equal(p.release.currentVersion, '1.0.0')
  assert.match(p.release.currentVersionSource, /evidence sync-taskforge-release-v1-0-0/)
  assert.equal(p.release.releaseStatus, tf(loadRegistry()).release.releaseStatus)
  assert.equal(p.evidence.filter(e => e.type === 'release').length, 3)
  assert.deepEqual(guardRegistryChange(loadRegistry(), r.registry, 'taskforge'), [])
  valid(r.registry)

  // An older release later never moves the version back.
  const back = structuredClone(r.registry)
  tf(back).release.currentVersion = '3.0.0'
  const r2 = plan(back, await observe(s, back))
  assert.equal(tf(r2.registry).release.currentVersion, '3.0.0')
})

test('draft PRs are excluded when the config says so; PR lifecycle is reported', async () => {
  const s = taskforgeState({ config: { configVersion: 1, projectId: 'taskforge', reporting: { includeDraftPullRequests: false } } })
  s.pulls = [
    { number: 70, state: 'open', title: 'Ready one', headSha: fakeSha('70') },
    { number: 71, state: 'open', draft: true, title: 'Draft one', headSha: fakeSha('71') }
  ]
  const r = plan(loadRegistry(), await observe(s))
  assert.deepEqual(tf(r.registry).openPullRequests.map(p => p.number), [70])
  assert.ok(r.changes.some(c => c.startsWith('PR #70 opened')))
})

test('reporting.enabled false pauses the project with no change', async () => {
  const s = taskforgeState({ config: { configVersion: 1, projectId: 'taskforge', reporting: { enabled: false } } })
  const registry = loadRegistry()
  const r = plan(registry, await observe(s))
  assert.equal(r.changed, false)
  assert.equal(r.registry, registry)
  assert.match(r.notes[0], /Paused/)
})

test('materialView ignores sync timestamps', () => {
  const p = tf(loadRegistry())
  const q = structuredClone(p)
  q.repositorySnapshot.observedAt = '2030-01-01T00:00:00Z'
  q.sync.lastSyncedAt = '2030-01-01T00:00:00Z'
  assert.deepEqual(materialView(p), materialView(q))
})

test('a tampered observation is rejected by the planner', async () => {
  const obs = await observe(taskforgeState())
  obs.repo.id = 1
  assert.throws(() => plan(loadRegistry(), obs), /pinned id/)
  const obs2 = await observe(taskforgeState())
  obs2.workflowRuns[0].url = 'https://github.com/WasteOfADrumBum/other/actions/runs/1'
  assert.throws(() => plan(loadRegistry(), obs2), /outside/)
  const obs3 = await observe(taskforgeState())
  obs3.head.sha = TF_HEAD.slice(0, 10)
  assert.throws(() => plan(loadRegistry(), obs3), /does not match/)
})
