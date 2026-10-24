// Regression tests for the residual F-02, F-03 and F-04 defects found in the paths next to
// the first fixes (verification of d44e7b4). Each test fails on d44e7b4 and passes with the fix;
// the reproductions are round2-probes.mjs in the Phase 1 remediation evidence.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { collect, checkObservation } from './collect.mjs'
import { plan } from './plan.mjs'
import { renderStatus, parseState } from './status.mjs'
import { listSyncPrs } from './write.mjs'
import { createClient } from './github.mjs'
import { commitsInPush } from './main-integrity.mjs'
import { validateText } from '../validate-registry.mjs'
import { withholdValues, ROOT } from './lib.mjs'
import { FakeGitHub, projectRepo } from '../../fixtures/sync/fake-github.mjs'
import { loadRegistry, taskforgeState, NOW, TF_HEAD, fakeSha } from '../../fixtures/sync/scenario.mjs'

const tf = r => r.projects.find(p => p.id === 'taskforge')
const client = gh => createClient({ token: 't', fetchImpl: gh.fetch, sleep: async () => {}, random: () => 0 })
// Earlier routes win, so `routes` override the fake repository's own.
function repoWith(overrides = {}, routes = []) {
  const gh = new FakeGitHub()
  for (const [method, re, handler] of routes) gh.on(method, re, handler)
  projectRepo(gh, taskforgeState(overrides))
  return client(gh)
}
const observe = c => collect({ project: tf(loadRegistry()), client: c, now: NOW })
const RUNS = /\/TaskForge\/actions\/runs$/
const OPEN = /\/TaskForge\/pulls$/
const run = (o = {}) => ({ id: 101, name: 'CI', path: '.github/workflows/ci.yml', head_sha: TF_HEAD, event: 'push', status: 'completed', conclusion: 'success', updated_at: '2026-10-09T19:10:23Z', html_url: 'https://github.com/WasteOfADrumBum/TaskForge/actions/runs/101', ...o })
const openPr = o => ({ number: 5, html_url: 'https://github.com/WasteOfADrumBum/TaskForge/pull/5', title: 't', draft: false, state: 'open', head: { sha: TF_HEAD }, ...o })
const openList = list => ['GET', OPEN, ({ q }) => (q.get('state') === 'open' && +(q.get('page') || 1) === 1 ? list : [])]

// Synthetic secrets: one in a known credential shape, one no pattern knows (only withholding protects it).
const SECRET = 'ghp_' + 'Q'.repeat(36)
const OPAQUE = 'hunter2-opaque-credential-value-77'
const hiddenState = projects => `<!-- registry-sync-state:${Buffer.from(JSON.stringify({ projects })).toString('base64')} -->`
const result = (projectId, outcome, errors = []) => ({ projectId, outcome, changes: [], suggestions: [], notes: [], errors })
const status = (results, previous) => renderStatus({ runAt: '2026-10-23T06:23:00Z', trigger: 'schedule', mode: 'dry-run', results, previous })
const cli = (args, opts = {}) => {
  try {
    return { code: 0, out: execFileSync('node', args, { cwd: ROOT, encoding: 'utf8', stdio: 'pipe', ...opts }) }
  } catch (e) {
    return { code: e.status, out: String(e.stdout) + String(e.stderr) }
  }
}

// F-02 -----------------------------------------------------------------------

test('F-02: secrets in historical persisted status state are withheld before they are persisted again', () => {
  const previous = parseState(hiddenState({
    'one-small-mods-pack': { lastSuccessAt: null, lastErrorAt: '2026-10-22T00:00:00Z', lastError: `config-invalid: $.projectId: "${OPAQUE}" does not match ^x$; key ${SECRET}`, consecutiveFailures: 2 }
  }))
  for (const text of [JSON.stringify(previous), status([result('taskforge', 'unchanged')], previous).markdown]) {
    assert.ok(!text.includes(OPAQUE) && !text.includes(SECRET))
  }
  const kept = parseState(status([result('taskforge', 'unchanged')], previous).markdown).projects['one-small-mods-pack']
  assert.equal(kept.consecutiveFailures, 2, 'the history itself is kept')
  assert.match(kept.lastError, /\$\.projectId: \(value withheld\) does not match/)
  assert.match(kept.lastError, /\[redacted GitHub token\]/)
})

test('F-02: invalid persisted state records are rebuilt from known fields, never trusted', () => {
  const previous = parseState(hiddenState({
    taskforge: { lastError: 'x', consecutiveFailures: 'many', lastSuccessAt: 'yesterday', extra: SECRET },
    'Not A Slug': { consecutiveFailures: 1 },
    'one-small-mods-pack': 'text'
  }))
  assert.deepEqual(previous.projects, { taskforge: { lastSuccessAt: null, lastErrorAt: null, lastError: 'x', consecutiveFailures: 0 } })
  const { markdown } = status([result('taskforge', 'error', ['e'])], previous)
  assert.doesNotMatch(markdown, /NaN|undefined/)
  assert.equal(parseState(markdown).projects.taskforge.consecutiveFailures, 1)
})

test('F-02: config keys and slug-shaped values are withheld whatever their shape', async () => {
  for (const config of [
    { configVersion: 1, projectId: 'taskforge', [OPAQUE]: true },
    { configVersion: 1, projectId: 'taskforge', [`${OPAQUE}"quoted`]: true },
    { configVersion: 1, projectId: OPAQUE }
  ]) {
    const e = await observe(repoWith({ config })).then(() => null, x => x)
    assert.ok(e && !e.message.includes(OPAQUE), e && e.message)
  }
  assert.equal(withholdValues(`$: unknown property "${OPAQUE}"`), '$: unknown property (name withheld)')
  assert.equal(withholdValues(`$.workflows: duplicate item ${OPAQUE}`), '$.workflows: duplicate item (value withheld)')
})

test('F-02: parse errors give a position, never the text that failed to parse', async () => {
  const schema = JSON.parse(readFileSync(resolve(ROOT, 'projects/registry.schema.json'), 'utf8'))
  const [msg] = validateText(`{"schemaVersion": ${OPAQUE}}`, schema)
  assert.ok(!msg.includes(OPAQUE.slice(0, 8)), msg)
  assert.match(msg, /^\$: invalid JSON(?: \(at position \d+[^)]*\))?$/)

  const gh = new FakeGitHub()
  gh.on('GET', /\/x$/, () => new Response(`${OPAQUE} {`, { status: 200 }))
  await assert.rejects(client(gh).get('/x'), e => !e.message.includes(OPAQUE.slice(0, 8)) && /GET \/x: malformed response \(body is not JSON\)/.test(e.message))
})

test('F-02: validator and guard command-line output redact secrets', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'f02-'))
  const bad = JSON.parse(readFileSync(resolve(ROOT, 'projects/registry.json'), 'utf8'))
  bad.projects[0].repository = SECRET
  writeFileSync(resolve(dir, 'r.json'), JSON.stringify(bad))
  const v = cli([resolve(ROOT, 'scripts/validate-registry.mjs'), resolve(dir, 'r.json')])
  assert.equal(v.code, 1)
  assert.ok(!v.out.includes(SECRET), v.out)
  assert.match(v.out, /\$\.projects\[0\]\.repository: "\[redacted GitHub token\]" does not match/)

  const g = cli([resolve(ROOT, 'scripts/sync/guard.mjs'), '--branch', `sync/${SECRET}`])
  assert.equal(g.code, 1)
  assert.ok(!g.out.includes(SECRET), g.out)
  assert.match(g.out, /is not a sync branch/)
})

test('F-02: external run text never reaches the observation unclean', async () => {
  const gapped = await observe(repoWith({}, [['GET', RUNS, () => ({ total_count: 1, workflow_runs: [run({ status: SECRET, conclusion: null })] })]]))
  assert.ok(!JSON.stringify(gapped).includes(SECRET))
  assert.match(gapped.collection.gaps[0], /ci\.yml run 101 attempt 1 is \[withheld: possible sensitive data\]/)
  // An event name is not free text: anything but a GitHub event name is a malformed run.
  await assert.rejects(observe(repoWith({}, [['GET', RUNS, () => ({ total_count: 1, workflow_runs: [run({ event: SECRET })] })]])), /workflow runs: malformed response/)
})

test('F-02: a cited URL must be exactly GitHub\'s form, so no text can ride after the id', async () => {
  await assert.rejects(observe(repoWith({}, [openList([openPr({ html_url: `https://github.com/WasteOfADrumBum/TaskForge/pull/5/${SECRET}` })])])), e => e.code === 'malformed-response' && !e.message.includes(SECRET))
  const obs = await observe(repoWith())
  obs.workflowRuns[0].url += `?${SECRET}`
  assert.throws(() => checkObservation(tf(loadRegistry()), obs), e => e.code === 'evidence-outside-repo' && !e.message.includes(SECRET))
})

// F-03 -----------------------------------------------------------------------

test('F-03: a missing or invalid run count fails closed instead of reading as complete', async () => {
  for (const total_count of [null, '1', -1, 1.5, 0]) {
    await assert.rejects(observe(repoWith({}, [['GET', RUNS, () => ({ total_count, workflow_runs: [run()] })]])), /workflow runs \(total_count\): malformed response/, String(total_count))
  }
})

test('F-03: an invalid run record fails the collection instead of being dropped', async () => {
  for (const bad of [{ path: undefined }, { id: 'x' }, { head_sha: fakeSha('other') }, { html_url: 'https://github.com/WasteOfADrumBum/Other/actions/runs/102' }, { run_attempt: 0 }, { updated_at: 'soon' }]) {
    const runs = [run(), run({ id: 102, conclusion: 'failure', html_url: 'https://github.com/WasteOfADrumBum/TaskForge/actions/runs/102', ...bad })]
    await assert.rejects(observe(repoWith({}, [['GET', RUNS, () => ({ total_count: 2, workflow_runs: runs })]])), /workflow runs: malformed response/, JSON.stringify(bad))
  }
  await assert.rejects(observe(repoWith({}, [['GET', RUNS, () => ({ total_count: 1, workflow_runs: ['x'] })]])), /workflow runs: malformed response/)
  // A dynamic run (no workflow file, e.g. GitHub Pages) is not project CI and is still skipped.
  const obs = await observe(repoWith({}, [['GET', RUNS, () => ({ total_count: 2, workflow_runs: [run(), run({ id: 103, path: 'dynamic/pages/pages-build-deployment', conclusion: 'failure', html_url: 'https://github.com/WasteOfADrumBum/TaskForge/actions/runs/103' })] })]]))
  assert.deepEqual(obs.workflowRuns.map(r => r.runId), [101])
})

test('F-03: invalid pull request and release records fail closed', async () => {
  for (const bad of [openPr({ head: { sha: 'not-a-sha' } }), openPr({ head: null }), openPr({ number: '5' }), 'x']) {
    await assert.rejects(observe(repoWith({}, [openList([bad])])), /open pull requests.*malformed response/, JSON.stringify(bad))
  }
  const merged = { number: 7, html_url: 'https://github.com/WasteOfADrumBum/TaskForge/pull/7', state: 'closed', title: 't', merged_at: '2026-10-22T00:00:00Z', head: { sha: TF_HEAD } }
  await assert.rejects(observe(repoWith({}, [['GET', OPEN, ({ q }) => (q.get('state') === 'closed' ? [merged] : [])]])), /pull request #7: malformed response/)
  await assert.rejects(observe(repoWith({}, [['GET', OPEN, ({ q }) => (q.get('state') === 'closed' ? [{ ...merged, merge_commit_sha: fakeSha('m'), labels: [{}] }] : [])]])), /pull request #7 \(labels\): malformed response/)
  await assert.rejects(observe(repoWith({}, [['GET', /\/TaskForge\/releases$/, () => [null]]])), /releases: malformed response/)
  await assert.rejects(observe(repoWith({}, [['GET', /\/TaskForge\/releases$/, () => [{ html_url: 'https://github.com/WasteOfADrumBum/TaskForge/releases/tag/v1', published_at: 'later', tag_name: 'v1' }]]])), /releases: malformed response/)
})

test('F-03: a push comparison without a usable commit count fails closed', async () => {
  for (const cmp of [{ status: 'ahead', commits: [] }, { status: 'ahead', commits: [{ sha: fakeSha('c') }], total_commits: null }, { status: 'ahead', commits: [{ sha: fakeSha('c') }], total_commits: 0 }]) {
    const gh = new FakeGitHub()
    gh.on('GET', /\/compare\//, () => cmp)
    await assert.rejects(commitsInPush({ client: client(gh), before: fakeSha('b'), after: fakeSha('c'), forced: false }), /malformed response/, JSON.stringify(cmp))
  }
})

// F-04 -----------------------------------------------------------------------

test('F-04: an observation claiming completeness it does not have is rejected, so it cannot report CI passed', async () => {
  const reg = loadRegistry()
  const obs = await observe(repoWith())
  obs.collection = { complete: true, gaps: ['ci.yml run 9 is in_progress'], unavailable: [] }
  assert.throws(() => checkObservation(tf(reg), obs), /collection\.complete does not match collection\.gaps/)
  assert.throws(() => plan(reg, obs), /collection\.complete does not match/)
  obs.collection = { complete: false, gaps: [], unavailable: [] }
  assert.throws(() => plan(reg, obs), /collection\.complete does not match/)
  // An unavailable section is a gap too: it cannot be hidden behind complete: true.
  obs.collection = { complete: true, gaps: [], unavailable: ['tags'] }
  obs.tags = { status: 'unavailable' }
  assert.throws(() => plan(reg, obs), /collection\.unavailable lists sections but collection\.complete is true/)
})

test('F-04: a full page of recently closed pull requests marks the collection incomplete', async () => {
  const closed = Array.from({ length: 50 }, (_, i) => ({ number: 100 + i, html_url: `https://github.com/WasteOfADrumBum/TaskForge/pull/${100 + i}`, state: 'closed', title: 't', merged_at: null, updated_at: '2026-10-22T00:00:00Z' }))
  const obs = await observe(repoWith({}, [['GET', OPEN, ({ q }) => (q.get('state') === 'closed' ? closed : [])]]))
  assert.equal(obs.collection.complete, false)
  assert.match(obs.collection.gaps[0], /more than 50 pull requests closed within the 14-day look-back/)
  assert.ok(!plan(loadRegistry(), obs).suggestions.some(s => s.startsWith('CI passed')))
  // A full page whose oldest entry is outside the window is complete.
  closed[49].updated_at = '2026-09-01T00:00:00Z'
  assert.equal((await observe(repoWith({}, [['GET', OPEN, ({ q }) => (q.get('state') === 'closed' ? closed : [])]]))).collection.complete, true)
})

test('F-04: a truncated pull request file list marks the collection incomplete', async () => {
  const files = Array.from({ length: 301 }, (_, i) => ({ filename: `f${i}.txt` }))
  const c = repoWith(
    { config: { configVersion: 1, projectId: 'taskforge', reporting: { materialPaths: ['src/**'] } }, pulls: [{ number: 7, state: 'closed', title: 't', headSha: TF_HEAD, mergedAt: '2026-10-22T00:00:00Z', mergeCommitSha: fakeSha('m7') }] },
    [['GET', /\/TaskForge\/pulls\/7\/files$/, ({ q }) => files.slice((+(q.get('page') || 1) - 1) * 100, +(q.get('page') || 1) * 100)]]
  )
  const obs = await observe(c)
  assert.equal(obs.collection.complete, false)
  assert.match(obs.collection.gaps[0], /pull request #7 changes more than 300 files/)
})

test('F-04: more open sync PRs than one page holds is reported as an incomplete list', async () => {
  const gh = new FakeGitHub()
  const prs = Array.from({ length: 101 }, (_, i) => ({ number: i + 1, html_url: `https://github.com/WasteOfADrumBum/one-small-engineering/pull/${i + 1}`, title: 't', head: { ref: `sync/p${i}` }, draft: true }))
  gh.on('GET', /\/one-small-engineering\/pulls$/, ({ q }) => prs.slice((+(q.get('page') || 1) - 1) * 100, +(q.get('page') || 1) * 100))
  const list = await listSyncPrs(client(gh))
  assert.equal(list.length, 100)
  assert.equal(list.truncated, true)
  const { markdown } = renderStatus({ runAt: '2026-10-23T06:23:00Z', trigger: 'schedule', mode: 'dry-run', results: [], openSyncPrs: list })
  assert.match(markdown, /Incomplete: more than 100 open registry sync PRs exist/)
})

test('F-04: keyed pagination checks the extra page in the same shape', async () => {
  const gh = new FakeGitHub()
  gh.on('GET', /\/k$/, ({ q }) => ({ items: +q.get('page') <= 2 ? Array.from({ length: 100 }, (_, i) => i) : [] }))
  const list = await client(gh).paginate('/k', { max: 200, key: 'items' })
  assert.equal(list.length, 200)
  assert.equal(list.truncated, undefined)
})

test('F-04: more merged pull requests than the cap marks the collection incomplete', async () => {
  const pulls = Array.from({ length: 31 }, (_, i) => ({ number: 200 + i, state: 'closed', title: 't', headSha: TF_HEAD, mergedAt: '2026-10-22T00:00:00Z', mergeCommitSha: fakeSha(`m${i}`) }))
  const obs = await observe(repoWith({ pulls }))
  assert.equal(obs.mergedPullRequests.length, 30)
  assert.equal(obs.collection.complete, false)
  assert.match(obs.collection.gaps[0], /more than 30 pull requests merged within the 14-day look-back/)
  pulls.pop()
  assert.equal((await observe(repoWith({ pulls }))).collection.complete, true)
})
