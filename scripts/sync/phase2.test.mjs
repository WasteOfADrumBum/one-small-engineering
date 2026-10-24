// Phase 2: eight-project operation. Access failures named precisely, partial failures that
// never read as success, head rewrites, tags and package metadata, staged activation,
// readiness from the Definition of Done (never from CI), governance protection, CRLF.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { collect, checkObservation, SyncError } from './collect.mjs'
import { plan } from './plan.mjs'
import { guardRegistryChange } from './guard.mjs'
import { collectAll, processAll, runVerdict } from './run.mjs'
import { renderStatus } from './status.mjs'
import { resolveRun, effectiveStage, StageError } from './stage.mjs'
import { createClient, describeAccess, GitHubError } from './github.mjs'
import { readiness, renderReadiness, provenance } from '../readiness.mjs'
import { validateRegistry, validateText, parseDefinitionOfDone } from '../validate-registry.mjs'
import { readJson, ROOT, serializeRegistry } from './lib.mjs'
import { FakeGitHub, projectRepo, hubRepo } from '../../fixtures/sync/fake-github.mjs'
import { loadRegistry, registryText, taskforgeState, allProjectRepos, NOW, TF_HEAD, fakeSha } from '../../fixtures/sync/scenario.mjs'

const schema = readJson('projects/registry.schema.json')
const dod = parseDefinitionOfDone(readFileSync(resolve(ROOT, 'standards/definition-of-done.md'), 'utf8'))
const validate = r => validateRegistry(r, schema, { dod })
const tf = r => r.projects.find(p => p.id === 'taskforge')
const byId = (r, id) => r.projects.find(p => p.id === id)
const clientFor = gh => createClient({ token: 't', fetchImpl: gh.fetch, sleep: async () => {}, random: () => 0 })
function tfWorld(overrides = {}) {
  const gh = new FakeGitHub()
  const state = projectRepo(gh, taskforgeState(overrides))
  return { gh, state, client: clientFor(gh) }
}
const observe = async (overrides, registry = loadRegistry()) => collect({ project: tf(registry), client: tfWorld(overrides).client, now: NOW })

// Discovery ---------------------------------------------------------------------

test('all eight active projects are registered, sync-enabled and pinned where readable', () => {
  const reg = loadRegistry()
  const active = reg.projects.filter(p => p.lifecycle === 'active')
  assert.deepEqual(active.map(p => p.repository.split('/').pop()), ['one-small-mods-pack', 'one-small-ui', 'joshsmall-site', 'one-small-studio', 'one-small-photography', 'TaskForge', 'cortex-brain-task', 'one-small-ai-workforce'])
  for (const p of active) {
    assert.equal(p.sync.enabled, true, p.id)
    assert.equal(p.sync.mode, 'observe', `${p.id} stays observe-only: no file is required in the project repository`)
    if (p.visibility === 'public') assert.ok(Number.isInteger(p.sync.repositoryId), `${p.id} is pinned`)
  }
  assert.equal(byId(reg, 'one-small-ai-workforce').sync.repositoryId, null, 'private and not yet readable: unpinned')
})

// Access failures ---------------------------------------------------------------

test('a private repository without the reader credential, and with one that cannot see it, are each named', async () => {
  const gh = new FakeGitHub()
  allProjectRepos(gh)
  const reg = loadRegistry()
  const without = await collectAll({ registry: reg, only: 'one-small-ai-workforce', clients: { publicReader: clientFor(gh), privateReader: null }, now: NOW })
  assert.equal(without[0].error.code, 'needs-reader-token')
  // A reader that is configured but cannot pin the identity yet: refused before any read.
  const reader = clientFor(gh)
  const unpinned = await collectAll({ registry: reg, only: 'one-small-ai-workforce', clients: { publicReader: reader, privateReader: reader }, now: NOW })
  assert.equal(unpinned[0].error.code, 'identity-unpinned')
  assert.match(unpinned[0].error.message, /npm run onboard -- one-small-ai-workforce/)
  assert.equal(gh.calls.filter(c => c.path.includes('one-small-ai-workforce')).length, 0, 'nothing is read for an unpinned project')
  // Pinned, but the reader is not installed on it: GitHub answers 404, reported as not visible.
  byId(reg, 'one-small-ai-workforce').sync.repositoryId = 4242
  const hidden = await collectAll({ registry: reg, only: 'one-small-ai-workforce', clients: { publicReader: reader, privateReader: reader }, now: NOW })
  assert.equal(hidden[0].error.code, 'repo-unreachable')
  assert.match(hidden[0].error.message, /not visible to the current token \(HTTP 404\)/)
})

test('HTTP 401, 403 (with the permission GitHub names) and 5xx are diagnosed precisely, never as empty data', async () => {
  const cases = [
    [401, {}, 'token-rejected', /token was rejected \(HTTP 401\)/],
    [403, { 'x-accepted-github-permissions': 'pull_requests=read' }, 'permission-denied', /lacks permission \(HTTP 403\) \(GitHub says this call needs pull_requests=read\)/],
    [403, { 'x-accepted-github-permissions': 'ghp_' + 'x'.repeat(36) }, 'permission-denied', /lacks permission \(HTTP 403\)$/],
    [503, {}, 'github-unavailable', /HTTP 503 after retries/]
  ]
  for (const [status, headers, code, message] of cases) {
    const { gh, client } = tfWorld()
    gh.failNext(/\/TaskForge\/pulls\?state=open/, status, { headers, times: 5 })
    const [r] = await collectAll({ registry: loadRegistry(), only: 'taskforge', clients: { publicReader: client, privateReader: null }, now: NOW })
    assert.equal(r.ok, false)
    assert.equal(r.error.code, code, `${status}`)
    assert.match(r.error.message, message)
    assert.doesNotMatch(r.error.message, /ghp_/, 'a header value that is not a permission list is never echoed')
  }
  assert.equal(describeAccess(new Error('x'), 'w'), null, 'only GitHub errors are access errors')
})

// Partial failures ----------------------------------------------------------------

test('a section GitHub cannot answer is unavailable: a named gap, the old value kept, and the run fails', async () => {
  const reg = loadRegistry()
  tf(reg).repositorySnapshot.latestTag = { name: 'v1.0.0', version: '1.0.0', commitSha: fakeSha('t1') }
  const obs = await observe({ tagsError: 500 }, reg)
  assert.equal(obs.tags.status, 'unavailable')
  assert.deepEqual(obs.collection.unavailable, ['tags'])
  assert.equal(obs.collection.complete, false)
  assert.match(obs.collection.gaps.join(), /tags could not be read: tags: GitHub returned HTTP 500 after retries/)
  const r = plan(reg, obs)
  assert.deepEqual(tf(r.registry).repositorySnapshot.latestTag, { name: 'v1.0.0', version: '1.0.0', commitSha: fakeSha('t1') }, 'missing data never overwrites what was recorded')
  assert.ok(r.notes.some(n => /recorded latest tag is kept/.test(n)))
  assert.ok(!r.suggestions.some(s => /CI passed/.test(s)), 'no positive CI conclusion from an incomplete collection')
  const v = runVerdict([{ projectId: 'taskforge', outcome: 'changed', gaps: obs.collection.gaps, unavailable: obs.collection.unavailable }])
  assert.equal(v.result, 'failed')
  assert.equal(v.exitCode, 1)
})

test('a malformed optional section still fails the project closed', async () => {
  const gh = new FakeGitHub()
  projectRepo(gh, taskforgeState())
  gh.routes.unshift({ method: 'GET', re: /\/TaskForge\/tags$/, handler: () => ({ not: 'a list' }) })
  await assert.rejects(collect({ project: tf(loadRegistry()), client: clientFor(gh), now: NOW }), /malformed response/)
  const gh2 = new FakeGitHub()
  projectRepo(gh2, taskforgeState({ tagList: [{ name: 'v1.0.0', sha: 'nope' }] }))
  await assert.rejects(collect({ project: tf(loadRegistry()), client: clientFor(gh2), now: NOW }), e => e instanceof SyncError && e.code === 'malformed-response')
})

test('one project failing part-way never stops the others, and the status says which evidence is missing', async () => {
  const gh = new FakeGitHub()
  const { tf: t } = allProjectRepos(gh)
  t.packageError = 502
  const reg = loadRegistry()
  const collected = await collectAll({ registry: reg, clients: { publicReader: clientFor(gh), privateReader: null }, now: NOW })
  const results = await processAll({ registry: reg, collected, mode: 'dry-run', hubClient: null, mainSha: fakeSha('m'), validate })
  assert.equal(results.filter(r => r.outcome === 'changed').length, 7, 'seven public projects planned')
  const { markdown } = renderStatus({ runAt: '2026-10-24T22:00:00Z', trigger: 'workflow_dispatch', mode: 'dry-run', results, registry: reg })
  assert.match(markdown, /Run result: FAILED: 2 of 8 project\(s\) not fully observed \(taskforge, one-small-ai-workforce\); 6 complete\./)
  assert.match(markdown, /\| taskforge \| Changes found \| Unavailable: package \|/)
  assert.match(markdown, /\| one-small-ai-workforce \| Error \| Not collected \|/)
  assert.match(markdown, /## Incomplete evidence/)
  assert.match(markdown, /## Release readiness/)
})

test('pending evidence (a run still in progress) is incomplete, never complete, and does not fail the run', async () => {
  const obs = await observe({ runs: [{ id: 101, name: 'CI', path: '.github/workflows/ci.yml', head_sha: TF_HEAD, event: 'push', status: 'in_progress', conclusion: null, updated_at: '2026-10-09T19:10:23Z' }] })
  assert.equal(obs.collection.complete, false)
  assert.deepEqual(obs.collection.unavailable, [])
  const v = runVerdict([{ projectId: 'taskforge', outcome: 'changed', gaps: obs.collection.gaps, unavailable: [] }])
  assert.equal(v.result, 'incomplete')
  assert.match(v.summary, /^INCOMPLETE: /)
  assert.notEqual(v.result, 'complete')
  assert.equal(runVerdict([{ projectId: 'taskforge', outcome: 'unchanged', gaps: [], unavailable: [] }]).result, 'complete')
})

test('the CLI exits non-zero for a run with unavailable evidence and says FAILED', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'p2-'))
  const reg = loadRegistry()
  const ids = reg.projects.filter(p => p.sync && p.sync.enabled).map(p => p.id)
  const file = resolve(dir, 'obs.json')
  writeFileSync(file, JSON.stringify(ids.map(id => ({ projectId: id, ok: false, error: { code: 'permission-denied', message: 'pulls: the token lacks permission (HTTP 403)' } }))))
  let code = 0
  let out = ''
  try {
    execFileSync('node', [resolve(ROOT, 'scripts/sync/run.mjs'), 'write', '--in', file, '--mode', 'dry-run', '--out-dir', dir], { cwd: ROOT, env: { ...process.env, GITHUB_TOKEN: '', SYNC_STATUS_ISSUE: '', SYNC_PROJECT: '' }, stdio: 'pipe', encoding: 'utf8' })
  } catch (e) {
    code = e.status
    out = String(e.stdout)
  }
  assert.equal(code, 1)
  assert.match(out, /::error title=Registry sync failed::FAILED: 8 of 8 project\(s\) not fully observed/)
  assert.match(readFileSync(resolve(dir, 'STATUS.md'), 'utf8'), /permission-denied: pulls: the token lacks permission \(HTTP 403\)/)
})

// Pagination and truncation -------------------------------------------------------

test('tags: none is confirmed absence, more than one page is flagged, and the highest version wins', async () => {
  assert.deepEqual((await observe({})).tags, { status: 'none', count: 0, truncated: false, latest: null })
  const many = Array.from({ length: 120 }, (_, i) => ({ name: `v0.${i}.0`, sha: fakeSha(`t${i}`) }))
  const obs = await observe({ tagList: [...many, { name: 'v1.0.0-rc.1', sha: fakeSha('rc') }, { name: 'not-a-version', sha: fakeSha('x') }] })
  assert.equal(obs.tags.status, 'observed')
  assert.equal(obs.tags.count, 100)
  assert.equal(obs.tags.truncated, true)
  assert.equal(obs.tags.latest.name, 'v0.99.0', 'the cap is honoured; the note says the choice is partial')
  const r = plan(loadRegistry(), obs)
  assert.ok(r.notes.some(n => /More than 100 tags exist/.test(n)))
  const few = await observe({ tagList: [{ name: 'v1.2.0', sha: fakeSha('a') }, { name: 'v1.10.0-beta.1', sha: fakeSha('b') }, { name: '1.9.9', sha: fakeSha('c') }] })
  assert.equal(few.tags.latest.name, 'v1.10.0-beta.1')
})

// Package metadata ----------------------------------------------------------------

test('package.json: none, invalid and observed are distinct, and a sensitive-looking name is withheld', async () => {
  assert.deepEqual((await observe({})).package, { status: 'none' })
  assert.deepEqual((await observe({ packageJson: '{ broken' })).package, { status: 'invalid', reason: 'not valid JSON' })
  assert.deepEqual((await observe({ packageJson: '[1]' })).package, { status: 'invalid', reason: 'not a JSON object' })
  assert.deepEqual((await observe({ packageJson: { name: 'taskforge', version: '1.2.3', private: true } })).package, { status: 'observed', name: 'taskforge', version: '1.2.3', private: true })
  const secret = 'ghp_' + 'a'.repeat(36)
  const leaky = await observe({ packageJson: { name: secret, version: 'not-semver' } })
  assert.deepEqual(leaky.package, { status: 'observed', name: null, version: null, private: false })
  assert.doesNotMatch(JSON.stringify(leaky), /ghp_/)
  const r = plan(loadRegistry(), await observe({ packageJson: { name: 'taskforge', version: '3.0.0' } }))
  assert.ok(r.suggestions.some(s => /package\.json declares 3\.0\.0 .* currentVersion moves only from a published release/.test(s)))
  assert.equal(tf(r.registry).release.currentVersion, null, 'package.json never moves currentVersion')
})

// Head movement and force pushes --------------------------------------------------

test('default-branch movement: fast-forward, rewrite, vanished head and unreadable comparison', async () => {
  const next = fakeSha('tf-next')
  const ff = await observe({ headSha: next, runs: [] })
  assert.equal(ff.head.relation, 'fast-forward')
  assert.ok(plan(loadRegistry(), ff).changes.some(c => /moved from 11975d0 to .* \(fast-forward\)/.test(c)))

  const rw = await observe({ headSha: next, runs: [], ancestry: { [TF_HEAD]: 'diverged' } })
  assert.equal(rw.head.relation, 'rewritten')
  const p = plan(loadRegistry(), rw)
  assert.ok(p.changes.some(c => /history was rewritten: 11975d0 is not an ancestor/.test(c)))
  assert.ok(p.suggestions.some(s => /History on main was rewritten/.test(s)))
  assert.equal((await observe({ headSha: next, runs: [], ancestry: { [TF_HEAD]: 'behind' } })).head.relation, 'rewritten')

  const { gh, client } = tfWorld({ headSha: next, runs: [] })
  gh.routes.unshift({ method: 'GET', re: /\/compare\/11975d0/, handler: () => null })
  assert.equal((await collect({ project: tf(loadRegistry()), client, now: NOW })).head.relation, 'unreachable')

  const w = tfWorld({ headSha: next, runs: [] })
  w.gh.failNext(/\/compare\/11975d0/, 500, { times: 5 })
  const unknown = await collect({ project: tf(loadRegistry()), client: w.client, now: NOW })
  assert.equal(unknown.head.relation, 'unknown')
  assert.deepEqual(unknown.collection.unavailable, ['head-comparison'])
  assert.equal(unknown.collection.complete, false)
})

test('an observation cannot claim a section is available while saying it is not', async () => {
  const reg = loadRegistry()
  const obs = await observe({})
  const bad = structuredClone(obs)
  bad.tags = { status: 'unavailable' }
  assert.throws(() => checkObservation(tf(reg), bad), /tags availability does not match/)
  const bad2 = structuredClone(obs)
  bad2.head.relation = 'unknown'
  assert.throws(() => checkObservation(tf(reg), bad2), /head comparison availability/)
  const old = structuredClone(obs)
  old.observationVersion = 1
  assert.throws(() => checkObservation(tf(reg), old), /observationVersion/)
})

// Idempotency and bootstrap --------------------------------------------------------

test('first run bootstraps every snapshot field, and the rerun is byte-identical and unchanged', async () => {
  const reg = loadRegistry()
  const obs = await observe({ tagList: [{ name: 'v0.1.0', sha: TF_HEAD }], packageJson: { name: 'taskforge', version: '0.1.0' } })
  const first = plan(reg, obs)
  assert.equal(first.changed, true)
  assert.deepEqual(Object.keys(tf(first.registry).repositorySnapshot), ['defaultBranch', 'headSha', 'archived', 'observedAt', 'visibility', 'latestTag', 'package'])
  assert.deepEqual(validate(first.registry), [])
  assert.deepEqual(guardRegistryChange(reg, first.registry, 'taskforge'), [])
  const later = await collect({ project: tf(first.registry), client: tfWorld({ tagList: [{ name: 'v0.1.0', sha: TF_HEAD }], packageJson: { name: 'taskforge', version: '0.1.0' } }).client, now: new Date(NOW.getTime() + 6 * 3600_000) })
  const second = plan(first.registry, later)
  assert.equal(second.changed, false)
  assert.equal(second.registry, first.registry, 'unchanged facts return the same registry object')
  assert.equal(serializeRegistry(plan(reg, obs).registry), serializeRegistry(first.registry), 'same inputs, same bytes')
})

test('a visibility change on GitHub is recorded in the snapshot and suggested, never applied to the manual field', async () => {
  const r = plan(loadRegistry(), await observe({ private: true }))
  assert.equal(tf(r.registry).repositorySnapshot.visibility, 'private')
  assert.equal(tf(r.registry).visibility, 'public')
  assert.ok(r.suggestions.some(s => /GitHub reports the repository as private but the registry says public/.test(s)))
})

// Governance ---------------------------------------------------------------------

test('sync can never change a governance field, including on the new snapshot and identity fields', async () => {
  const base = loadRegistry()
  const head = plan(base, await observe({ tagList: [{ name: 'v1.0.0', sha: TF_HEAD }] })).registry
  assert.deepEqual(guardRegistryChange(base, head, 'taskforge'), [])
  const cases = [
    [p => { p.visibility = 'private' }, 'visibility'],
    [p => { p.sync.repositoryId = null }, 'sync.repositoryId'],
    [p => { p.releaseGates.find(g => g.id === 'automated-checks').status = 'not_applicable' }, 'releaseGates'],
    [p => { p.releaseGates[0].notes = 'Not needed.' }, 'releaseGates'],
    [p => { p.release.blockers.push({ id: 'new', description: 'x', status: 'open', evidenceRefs: [] }) }, 'release.blockers'],
    [p => { p.release.blockers[0].status = 'resolved' }, 'release.blockers'],
    [p => { p.ownership.builder = 'One Small Engineering Sync' }, 'ownership'],
    [p => { p.approval = { status: 'approved', approvedBy: 'Joshua Small', approvedAt: '2026-10-24T00:00:00Z', evidenceRefs: [] } }, 'approval'],
    [p => { p.evidence.push({ id: 'tf-security-exception', type: 'document', url: 'https://github.com/WasteOfADrumBum/TaskForge/pull/1', commitSha: TF_HEAD, verifiedAt: '2026-10-24T00:00:00Z', result: 'pass', description: 'Security exception approved', recordedBy: 'Joshua Small' }) }, 'manual evidence'],
    [p => { p.evidence.find(e => e.origin !== 'sync').recordedBy = 'One Small Engineering Sync' }, 'manual evidence'],
    [p => { p.evidence.find(e => e.origin === 'sync').result = 'pass' }, 'cannot have result pass'],
    [p => { p.release.scopeDocument = 'https://github.com/WasteOfADrumBum/TaskForge/blob/main/SCOPE.md' }, 'release.scopeDocument'],
    [p => { p.tier = 'library' }, 'tier']
  ]
  for (const [mutate, fragment] of cases) {
    const h = structuredClone(head)
    mutate(tf(h))
    const errors = guardRegistryChange(base, h, 'taskforge')
    assert.ok(errors.some(e => e.includes(fragment)), `${mutate}: expected "${fragment}" in ${errors.join('; ')}`)
  }
})

test('across many random observations the planner never touches a governance field', async () => {
  const conclusions = ['success', 'failure', 'cancelled', 'timed_out']
  let seed = 7
  const rnd = n => (seed = (seed * 1103515245 + 12345) % 2147483648) % n
  const base = loadRegistry()
  const manual = p => JSON.stringify({ ...p, repositorySnapshot: null, openPullRequests: null, evidence: p.evidence.filter(e => e.origin !== 'sync'), sync: { ...p.sync, lastSyncedAt: null, lastSyncedHead: null, configSource: null } })
  for (let i = 0; i < 25; i++) {
    const head = rnd(2) ? TF_HEAD : fakeSha(`h${i}`)
    const obs = await observe({
      headSha: head,
      ancestry: { [TF_HEAD]: ['ahead', 'diverged', 'behind'][rnd(3)] },
      runs: [{ id: 1000 + i, run_attempt: 1 + rnd(3), name: 'CI', path: '.github/workflows/ci.yml', head_sha: head, event: 'push', conclusion: conclusions[rnd(4)], updated_at: '2026-10-20T00:00:00Z' }],
      pulls: rnd(2) ? [{ number: 9, state: 'open', draft: Boolean(rnd(2)), title: 'Work', headSha: fakeSha(`p${i}`) }] : [],
      tagList: rnd(2) ? [{ name: `v1.${i}.0`, sha: head }] : [],
      packageJson: rnd(2) ? { name: 'taskforge', version: `1.${i}.0` } : undefined
    })
    const r = plan(base, obs)
    assert.equal(manual(tf(r.registry)), manual(tf(base)), `observation ${i}`)
    assert.deepEqual(guardRegistryChange(base, r.registry, 'taskforge'), [], `observation ${i}`)
    assert.deepEqual(validate(r.registry), [], `observation ${i}`)
    assert.equal(tf(r.registry).release.releaseStatus, tf(base).release.releaseStatus)
  }
})

// Readiness ----------------------------------------------------------------------

function releasable() {
  const reg = loadRegistry()
  const p = tf(reg)
  p.ownership.builder = 'Builder Bot'
  p.ownership.verifier = 'Joshua Small'
  p.release.targetVersion = '1.0.0'
  p.release.scopeDocument = 'https://github.com/WasteOfADrumBum/TaskForge/blob/main/SCOPE.md'
  p.release.blockers = []
  p.evidence.push({ id: 'tf-verify', type: 'test_record', url: 'https://github.com/WasteOfADrumBum/TaskForge/pull/1', commitSha: TF_HEAD, verifiedAt: '2026-10-22T00:00:00Z', result: 'pass', description: 'Re-run by the verifier.', recordedBy: 'Joshua Small' })
  for (const g of p.releaseGates) Object.assign(g, { status: 'verified', evidenceRefs: ['tf-verify'], verifiedAt: '2026-10-22T00:00:00Z', notes: null })
  return reg
}

test('readiness: green CI alone never makes a project ready', async () => {
  const reg = loadRegistry()
  const r = plan(reg, await observe({}))
  const x = readiness(tf(r.registry))
  assert.deepEqual(x.ci.map(c => c.conclusion), ['success'])
  assert.equal(x.verdict, 'not-scoped')
  assert.equal(x.gates.satisfied.length, 0)
  const md = renderReadiness(r.registry, { only: 'taskforge' })
  assert.match(md, /success \(builder-reported\)/)
  assert.match(md, /CI results are builder-reported and never make a project ready/)
})

test('readiness: every gate independently verified waits for the owner; approval then release', () => {
  const reg = releasable()
  const x = readiness(tf(reg))
  assert.equal(x.verdict, 'awaiting-owner-approval')
  assert.ok(x.reasons.some(r => /only Joshua Small approves/.test(r)))
  tf(reg).approval = { status: 'approved', approvedBy: 'Joshua Small', approvedAt: '2026-10-23T00:00:00Z', evidenceRefs: ['tf-verify'] }
  assert.equal(readiness(tf(reg)).verdict, 'approved-not-released')
  tf(reg).release.releaseStatus = 'released'
  assert.equal(readiness(tf(reg)).verdict, 'released')
  assert.equal(provenance(tf(reg)).ownerApproval, 1)
})

test('readiness: a gate marked verified on builder-reported or sync evidence is unproven, not satisfied', () => {
  for (const tamper of [
    e => { e.recordedBy = 'Builder Bot' },
    e => { e.result = 'builder_reported' },
    e => { e.type = 'repository_metadata' },
    e => { e.origin = 'sync' }
  ]) {
    const reg = releasable()
    tamper(tf(reg).evidence.find(e => e.id === 'tf-verify'))
    const x = readiness(tf(reg))
    assert.equal(x.gates.satisfied.length, 0, tamper.toString())
    assert.equal(x.gates.unproven.length, tf(reg).releaseGates.length)
    assert.equal(x.verdict, 'not-ready')
  }
  const reg = releasable()
  tf(reg).ownership.verifier = 'builder bot'
  assert.equal(readiness(tf(reg)).verdict, 'not-ready', 'builder and verifier must differ')
})

test('readiness: not applicable, blocked, in progress and not started are counted apart', () => {
  const reg = loadRegistry()
  const x = readiness(byId(reg, 'one-small-mods-pack'))
  assert.equal(x.gates.notApplicable.length, 1)
  assert.equal(x.gates.blocked.length, 1)
  assert.equal(x.gates.inProgress.length, 13)
  assert.equal(x.gates.notStarted.length, 7)
  assert.equal(x.verdict, 'not-ready')
  assert.ok(x.reasons.some(r => /7 open blocker/.test(r)))
  const cli = execFileSync('node', [resolve(ROOT, 'scripts/readiness.mjs')], { cwd: ROOT, encoding: 'utf8' })
  for (const p of reg.projects) assert.match(cli, new RegExp(`\\| ${p.id} \\|`))
})

// Staged activation ---------------------------------------------------------------

test('stages: A is read-only, B writes only on a manual run, C adds the schedule, unknown is refused', () => {
  const main = 'refs/heads/main'
  const at = (stage, event, dryRunInput = '', ref = main, legacy = '') => resolveRun({ stage, legacyWriteEnabled: legacy, event, dryRunInput, ref })
  assert.deepEqual([at('', 'workflow_dispatch', 'false').mode, at('', 'workflow_dispatch', 'false').statusIssue], ['dry-run', false])
  assert.equal(at('', 'schedule').skip, true)
  assert.equal(at('B', 'schedule').skip, true)
  assert.equal(at('B', 'workflow_dispatch', 'true').mode, 'dry-run')
  assert.equal(at('B', 'workflow_dispatch', '').mode, 'dry-run', 'a missing input is a dry run')
  assert.equal(at('B', 'workflow_dispatch', 'false').mode, 'write')
  assert.equal(at('b', 'workflow_dispatch', 'false').mode, 'write')
  assert.equal(at('B', 'workflow_dispatch', 'false', 'refs/heads/feature').mode, 'dry-run', 'writes only from main')
  assert.equal(at('C', 'schedule').mode, 'write')
  assert.equal(at('C', 'schedule').skip, false)
  assert.equal(at('', 'schedule', '', main, 'true').mode, 'write', 'Phase 1 SYNC_WRITE_ENABLED=true means stage C')
  for (const bad of ['D', 'write', 'true', 'A;rm -rf /']) assert.throws(() => effectiveStage({ stage: bad }), StageError)
  assert.throws(() => at('C', 'pull_request'), /only on schedule or workflow_dispatch/)
})

test('the stage A report job never writes, even if the stage variable says otherwise', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'p2s-'))
  const file = resolve(dir, 'obs.json')
  writeFileSync(file, JSON.stringify(loadRegistry().projects.filter(p => p.sync && p.sync.enabled).map(p => ({ projectId: p.id, ok: false, error: { code: 'x', message: 'y' } }))))
  let out = ''
  try {
    execFileSync('node', [resolve(ROOT, 'scripts/sync/run.mjs'), 'write', '--in', file, '--mode', 'auto', '--read-only', '--out-dir', dir], { cwd: ROOT, env: { ...process.env, GITHUB_TOKEN: '', SYNC_STAGE: 'C', GITHUB_EVENT_NAME: 'workflow_dispatch', SYNC_DRY_RUN_INPUT: 'false', GITHUB_REF: 'refs/heads/main', SYNC_PROJECT: '' }, stdio: 'pipe', encoding: 'utf8' })
  } catch (e) {
    out = String(e.stdout) + String(e.stderr)
  }
  assert.match(readFileSync(resolve(dir, 'STATUS.md'), 'utf8'), /Mode: dry run/)
  assert.doesNotMatch(out, /write mode needs GITHUB_TOKEN/, 'write mode was never entered')
  let refused = ''
  try {
    execFileSync('node', [resolve(ROOT, 'scripts/sync/run.mjs'), 'write', '--in', file, '--mode', 'auto', '--out-dir', dir], { cwd: ROOT, env: { ...process.env, SYNC_STAGE: 'Z', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main' }, stdio: 'pipe', encoding: 'utf8' })
  } catch (e) {
    refused = String(e.stdout) + String(e.stderr)
  }
  assert.match(refused, /SYNC_STAGE must be A, B or C/)
})

// Schema, validator and line endings ----------------------------------------------

test('schema 1.2.0: snapshot extras are typed, a public project must be pinned', () => {
  const reg = loadRegistry()
  assert.equal(reg.schemaVersion, '1.2.0')
  const bad = (mutate, re) => {
    const r = loadRegistry()
    mutate(r)
    assert.ok(validate(r).some(e => re.test(e)), `${mutate}: ${validate(r).join('; ')}`)
  }
  bad(r => { tf(r).repositorySnapshot.latestTag = { name: 'v1', version: 'one', commitSha: TF_HEAD } }, /latestTag\.version/)
  bad(r => { tf(r).repositorySnapshot.package = { status: 'unavailable', name: null, version: null, private: null } }, /package\.status/)
  bad(r => { tf(r).repositorySnapshot.visibility = 'secret' }, /visibility/)
  bad(r => { tf(r).sync.repositoryId = null }, /public repository must have its repositoryId pinned/)
  bad(r => { tf(r).sync.repositoryId = 0 }, /repositoryId: must be at least 1/)
})

test('LF and CRLF registry text validate, plan and serialize the same', async () => {
  const lf = registryText()
  const crlf = lf.replace(/\n/g, '\r\n')
  assert.deepEqual(validateText(crlf, schema, { dod }), validateText(lf, schema, { dod }))
  const fromCrlf = JSON.parse(crlf)
  const obs = await observe({})
  assert.equal(serializeRegistry(plan(fromCrlf, obs).registry), serializeRegistry(plan(JSON.parse(lf), obs).registry))
  assert.doesNotMatch(serializeRegistry(fromCrlf), /\r/, 'automation always writes LF')
  const dodCrlf = parseDefinitionOfDone(readFileSync(resolve(ROOT, 'standards/definition-of-done.md'), 'utf8').replace(/\r?\n/g, '\r\n'))
  assert.deepEqual(dodCrlf, dod)
})

test('the readiness section in a sync PR body is redacted like the rest', async () => {
  const reg = loadRegistry()
  const { gh, client } = tfWorld()
  const hub = hubRepo(gh, { registryText: registryText(), mainSha: fakeSha('m2') })
  tf(reg).name = 'TaskForge ghp_' + 'z'.repeat(36)
  const collected = await collectAll({ registry: reg, only: 'taskforge', clients: { publicReader: client, privateReader: null }, now: NOW })
  // The validator refuses this registry, so nothing is written; the status text is still redacted.
  const results = await processAll({ registry: reg, collected, mode: 'write', hubClient: client, mainSha: hub.refs['heads/main'], validate })
  assert.equal(results[0].outcome, 'error')
  assert.equal(hub.pulls.length, 0)
  const { markdown } = renderStatus({ runAt: '2026-10-24T22:00:00Z', trigger: 'schedule', mode: 'write', results, registry: reg })
  assert.doesNotMatch(markdown, /ghp_z/)
})

test('GitHubError keeps only a well-formed permission list', () => {
  const e = new GitHubError('GET /x: HTTP 403', 403, '', { acceptedPermissions: 'contents=read' })
  assert.match(describeAccess(e, 'x').message, /needs contents=read/)
})
