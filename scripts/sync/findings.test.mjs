// Regression tests for the independent verification findings F-02 to F-06 on PR #3
// (F-01 and the integrity half of F-03 are in main-integrity.test.mjs). Each test fails
// on 3c082db and passes with the fix.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { collect } from './collect.mjs'
import { plan } from './plan.mjs'
import { renderStatus, renderPrBody, parseState } from './status.mjs'
import { writeSync } from './write.mjs'
import { createClient } from './github.mjs'
import { loadObservations, reconcileCollected, collectAll, processAll } from './run.mjs'
import { annotation, withholdValues, ROOT } from './lib.mjs'
import { FakeGitHub, projectRepo } from '../../fixtures/sync/fake-github.mjs'
import { world, loadRegistry, taskforgeState, NOW, TF_HEAD, fakeSha } from '../../fixtures/sync/scenario.mjs'

const tf = r => r.projects.find(p => p.id === 'taskforge')
const client = gh => createClient({ token: 't', fetchImpl: gh.fetch, sleep: async () => {}, random: () => 0 })
const repoWith = overrides => {
  const gh = new FakeGitHub()
  const state = projectRepo(gh, taskforgeState(overrides))
  return { gh, state, client: client(gh) }
}
const collectError = async c => {
  try {
    await collect({ project: tf(loadRegistry()), client: c, now: NOW })
  } catch (e) {
    return e
  }
  throw new Error('collect unexpectedly succeeded')
}

// Synthetic secrets: shaped like real credentials, valid for nothing.
const SECRETS = ['ghp_' + 'Q'.repeat(36), 'github_pat_' + 'Z'.repeat(30), 'sk-' + 'a'.repeat(30), 'AKIA' + 'B'.repeat(16), 'xoxb-' + '1'.repeat(12)]
const leaks = (text, secret) => String(text).includes(secret)

// F-02 -----------------------------------------------------------------------

test('F-02: a secret in a config value never appears in the collect error', async () => {
  for (const secret of SECRETS) {
    const { client: c } = repoWith({ config: { configVersion: 1, projectId: secret } })
    const e = await collectError(c)
    // A slug-shaped secret passes the schema and fails the registry match instead; both must withhold it.
    assert.ok(['config-invalid', 'project-mismatch'].includes(e.code), secret)
    assert.ok(!leaks(e.message, secret), `${secret} leaked: ${e.message}`)
    if (e.code === 'config-invalid') assert.match(e.message, /\$\.projectId: \(value withheld\) does not match/, 'the failing path is still named')
    else assert.match(e.message, /has a different projectId \(value withheld\) but the registry maps this repository to "taskforge"/)
  }
})

test('F-02: a secret in a config key or nested value never appears in the collect error', async () => {
  const secret = SECRETS[0]
  for (const config of [
    { configVersion: 1, projectId: 'taskforge', [`api_key=${secret}`]: true },
    { configVersion: 1, projectId: 'taskforge', reporting: { evidenceLabel: { token: secret } } },
    { configVersion: 1, projectId: 'taskforge', reporting: { workflows: [secret] } }
  ]) {
    const e = await collectError(repoWith({ config }).client)
    assert.ok(!leaks(e.message, secret), `leaked: ${e.message}`)
  }
})

test('F-02: errors reach the status issue, its hidden state, PR bodies and log lines redacted', () => {
  for (const secret of SECRETS) {
    const results = [{ projectId: 'taskforge', outcome: 'error', changes: [`changed ${secret}`], suggestions: [secret], notes: [secret], errors: [`config-invalid: ${secret}`], pr: null }]
    const { markdown } = renderStatus({ runAt: '2026-10-23T06:23:00Z', trigger: 'schedule', mode: 'dry-run', results })
    assert.ok(!leaks(markdown, secret), 'visible markdown')
    const state = parseState(markdown)
    assert.ok(!leaks(JSON.stringify(state), secret), 'decoded hidden state')
    assert.match(state.projects.taskforge.lastError, /\[redacted /)
    const body = renderPrBody({ projectId: 'taskforge', result: { changes: [secret], suggestions: [secret], notes: [secret] }, observation: { repo: { fullName: 'x/y', url: 'https://github.com/x/y' }, head: { sha: TF_HEAD }, collectedAt: '2026-10-23T06:23:00Z' } })
    assert.ok(!leaks(body, secret), 'PR body')
    assert.ok(!leaks(annotation(`sync taskforge: error - ${secret}`), secret), 'log line')
  }
})

test('F-02: a log line cannot start a workflow command or break onto a new line', () => {
  const line = annotation('error: bad\n::add-mask::x\r\n::set-env name=A::1 100%')
  assert.ok(!/[\r\n]/.test(line))
  assert.match(line, /100%25$/)
})

test('F-02: collect errors are redacted before they enter the run results', async () => {
  const secret = SECRETS[1]
  const gh = new FakeGitHub()
  projectRepo(gh, taskforgeState({ config: { configVersion: 1, projectId: secret } }))
  const reg = loadRegistry()
  const collected = await collectAll({ registry: reg, only: 'taskforge', clients: { publicReader: client(gh), privateReader: null }, now: NOW })
  assert.ok(!leaks(JSON.stringify(collected), secret))
  const results = await processAll({ registry: reg, collected, mode: 'dry-run', validate: () => [] })
  assert.ok(!leaks(JSON.stringify(results), secret))
})

test('F-02: diagnostics stay actionable: path and rule are kept, only the value is withheld', () => {
  assert.equal(withholdValues('$.reporting.lookbackDays: "x" is not one of 7, 14'), '$.reporting.lookbackDays: (value withheld) is not one of 7, 14')
  assert.equal(withholdValues('$: missing required property "projectId"'), '$: missing required property "projectId"')
})

// F-03 -----------------------------------------------------------------------

test('F-03: malformed project API responses fail closed instead of reading as empty', async () => {
  const cases = [
    [/\/TaskForge\/actions\/runs$/, () => ({ message: 'unexpected' }), /workflow runs: malformed response \(missing total_count, workflow_runs\)/],
    [/\/TaskForge\/actions\/runs$/, () => ({ total_count: 1, workflow_runs: null }), /workflow runs: malformed response \(expected a list, got an empty body\)/],
    [/\/TaskForge\/pulls$/, () => ({ message: 'unexpected' }), /malformed response \(expected a list, got object\)/],
    [/\/TaskForge\/releases$/, () => new Response('', { status: 200 }), /releases: malformed response \(expected a list, got an empty body\)/],
    [/\/TaskForge\/branches\/main$/, () => ({ name: 'main' }), /default branch: malformed response \(missing commit\)/],
    [/\/TaskForge$/, () => ({ id: 962181990 }), /repository: malformed response \(missing owner, full_name, default_branch, html_url\)/]
  ]
  for (const [re, handler, expected] of cases) {
    const { gh, client: c } = repoWith({})
    gh.routes.unshift({ method: 'GET', re, handler })
    const e = await collectError(c)
    assert.match(e.message, expected, String(re))
  }
})

test('F-03: malformed hub responses stop a write before anything is sent', async () => {
  const w = world({ withHub: true, mainSha: fakeSha('main-1') })
  const base = loadRegistry()
  const planned = plan(base, await collect({ project: tf(base), client: w.client, now: NOW }))
  w.gh.routes.unshift({ method: 'GET', re: /\/one-small-engineering\/pulls$/, handler: () => ({ message: 'odd' }) })
  await assert.rejects(writeSync({ client: w.client, projectId: 'taskforge', baseRegistry: base, nextRegistry: planned.registry, mainSha: fakeSha('main-1'), title: 't', body: 'b' }), /open sync pull requests: malformed response/)
  assert.equal(w.hub.pulls.length, 0)
})

// F-04 -----------------------------------------------------------------------

const failingRelease = {
  id: 'sync-taskforge-run-release-yml-11975d0-2s-1', type: 'workflow_run', url: 'https://github.com/WasteOfADrumBum/TaskForge/actions/runs/100', commitSha: TF_HEAD,
  verifiedAt: '2026-10-09T19:00:00Z', result: 'builder_reported', description: 'Automated observation: workflow release.yml concluded failure.',
  recordedBy: 'One Small Engineering Sync', origin: 'sync', eventKey: 'taskforge:workflow_run:release.yml/11975d0/2s/1'
}
const ciRun = { id: 101, name: 'CI', path: '.github/workflows/ci.yml', head_sha: TF_HEAD, event: 'push', conclusion: 'success', updated_at: '2026-10-09T19:10:23Z' }

async function planWith(overrides, mutateRegistry = () => {}) {
  const reg = loadRegistry()
  mutateRegistry(reg)
  const { client: c } = repoWith(overrides)
  const observation = await collect({ project: tf(reg), client: c, now: NOW })
  return { observation, planned: plan(reg, observation) }
}

test('F-04: a truncated runs page is incomplete: no CI pass, older failing evidence kept', async () => {
  const { observation, planned } = await planWith({ runs: [ciRun], runsTotal: 150 }, reg => tf(reg).evidence.push(failingRelease))
  assert.equal(observation.collection.complete, false)
  assert.match(observation.collection.gaps[0], /reports 150 runs .* returned 1/)
  assert.ok(!planned.suggestions.some(s => /CI passed/.test(s)))
  assert.ok(planned.suggestions.some(s => /incomplete .*automated-checks must not be verified/.test(s)))
  assert.ok(tf(planned.registry).evidence.some(e => e.id === failingRelease.id), 'the older failing record is not pruned')
})

test('F-04: a newer attempt still running is incomplete, and the earlier success is not recorded as current', async () => {
  const { observation, planned } = await planWith({ runs: [{ ...ciRun, run_attempt: 2, status: 'in_progress', conclusion: null }] })
  assert.equal(observation.collection.complete, false)
  assert.match(observation.collection.gaps[0], /ci\.yml run 101 attempt 2 is in_progress/)
  assert.equal(observation.workflowRuns.length, 0)
  assert.ok(!planned.suggestions.some(s => /CI passed/.test(s)))
})

test('F-04: a configured workflow with no completed run is incomplete', async () => {
  const { observation, planned } = await planWith({ config: { configVersion: 1, projectId: 'taskforge', reporting: { workflows: ['ci.yml', 'release.yml'] } }, runs: [ciRun] })
  assert.deepEqual(observation.collection.gaps, ['release.yml is configured but has no completed run on 11975d0'])
  assert.ok(!planned.suggestions.some(s => /CI passed/.test(s)))
})

test('F-04: complete collection still reports the pass suggestion and prunes stale uncited records', async () => {
  const { observation, planned } = await planWith({ runs: [ciRun] }, reg => tf(reg).evidence.push(failingRelease))
  assert.equal(observation.collection.complete, true)
  assert.ok(planned.suggestions.some(s => /CI passed/.test(s)))
  assert.ok(!tf(planned.registry).evidence.some(e => e.id === failingRelease.id))
})

test('F-04: more open PRs than one page can hold fails the project instead of dropping PRs', async () => {
  const pulls = Array.from({ length: 101 }, (_, i) => ({ number: i + 1, state: 'open', title: `PR ${i + 1}`, headSha: fakeSha(`h${i}`) }))
  const { gh, client: c } = repoWith({ pulls })
  gh.routes.unshift({ method: 'GET', re: /\/TaskForge\/pulls$/, handler: ({ q }) => {
    if (q.get('state') !== 'open') return []
    const page = +(q.get('page') || 1)
    return pulls.slice((page - 1) * 100, page * 100).map(p => ({ number: p.number, html_url: `https://github.com/WasteOfADrumBum/TaskForge/pull/${p.number}`, title: p.title, draft: false, head: { sha: p.headSha } }))
  } })
  const e = await collectError(c)
  assert.equal(e.code, 'incomplete-collection')
})

// F-05 -----------------------------------------------------------------------

async function prSetup() {
  const mainSha = fakeSha('main-1')
  const w = world({ withHub: true, mainSha })
  const base = loadRegistry()
  const planned = plan(base, await collect({ project: tf(base), client: w.client, now: NOW }))
  const args = { client: w.client, projectId: 'taskforge', baseRegistry: base, nextRegistry: planned.registry, mainSha, title: 'sync(taskforge): first', body: 'body v1' }
  await writeSync(args)
  const next = structuredClone(planned.registry)
  tf(next).openPullRequests = [{ number: 9, url: 'https://github.com/WasteOfADrumBum/TaskForge/pull/9', title: 'New', headSha: fakeSha('9'), draft: false }]
  return { w, args: { ...args, nextRegistry: next, title: 'sync(taskforge): second', body: 'body v2' } }
}

test('F-05: a failed PR description update is redone on the next run', async () => {
  const { w, args } = await prSetup()
  w.gh.failNext(/\/one-small-engineering\/pulls\/\d+$/, 422)
  await assert.rejects(writeSync(args), /HTTP 422/)
  assert.match(w.hub.pulls[0].body, /^body v1/, 'the update failed')
  const retry = await writeSync(args)
  assert.deepEqual(retry.steps, { branch: 'unchanged', pr: 'updated', validation: 'dispatched' }, 'the failed run stopped before dispatching too')
  assert.equal(retry.action, 'repaired')
  assert.equal(w.hub.pulls[0].title, 'sync(taskforge): second')
  assert.match(w.hub.pulls[0].body, /^body v2/)
  assert.ok(w.hub.pulls[0].body.includes(`<!-- sync-head: ${retry.commitSha} -->`))
})

test('F-05: once the description matches the head, re-runs send nothing, even with a new collection time', async () => {
  const { w, args } = await prSetup()
  await writeSync(args)
  const before = w.gh.writes().length
  const again = await writeSync({ ...args, body: 'body v2 (collected later)' })
  assert.equal(again.action, 'unchanged')
  assert.equal(w.gh.writes().length, before)
})

test('F-05: a PR edited by hand away from the head marker is restored', async () => {
  const { w, args } = await prSetup()
  await writeSync(args)
  w.hub.pulls[0].body = 'edited by someone'
  const r = await writeSync(args)
  assert.equal(r.steps.pr, 'updated')
  assert.match(w.hub.pulls[0].body, /^body v2/)
})

// F-06 -----------------------------------------------------------------------

test('F-06: missing, empty or malformed collection input is an error, not zero projects', () => {
  assert.throws(() => loadObservations({ encoded: '' }), /no observations received/)
  assert.throws(() => loadObservations({ encoded: Buffer.from('not json').toString('base64') }), /not valid JSON/)
  assert.throws(() => loadObservations({ encoded: Buffer.from('{}').toString('base64') }), /must be a list/)
  assert.throws(() => loadObservations({ encoded: Buffer.from('[{"projectId":"taskforge"}]').toString('base64') }), /malformed/)
  assert.throws(() => loadObservations({ encoded: Buffer.from('[{"projectId":"taskforge","ok":true}]').toString('base64') }), /has no observation/)
})

test('F-06: a project the collect job did not report is an error for that project', () => {
  const reg = loadRegistry()
  const r = reconcileCollected({ registry: reg, only: null, collected: [] })
  const enabled = reg.projects.filter(p => p.sync && p.sync.enabled).map(p => p.id)
  assert.equal(enabled.length, 8, 'all eight active projects are sync-enabled')
  assert.deepEqual(r.map(c => [c.projectId, c.ok, c.error.code]), enabled.map(id => [id, false, 'not-collected']))
  assert.throws(() => reconcileCollected({ registry: reg, only: 'taskforge', collected: [{ projectId: 'one-small-mods-pack', ok: false, error: { code: 'x' } }] }), /does not cover/)
  assert.throws(() => reconcileCollected({ registry: reg, only: null, collected: [{ projectId: 'taskforge', ok: false, error: { code: 'x' } }, { projectId: 'taskforge', ok: false, error: { code: 'x' } }] }), /twice/)
})

test('F-06: an empty list is legitimate only when no project is sync-enabled', () => {
  const reg = loadRegistry()
  for (const p of reg.projects) if (p.sync) p.sync.enabled = false
  assert.deepEqual(reconcileCollected({ registry: reg, only: null, collected: loadObservations({ encoded: Buffer.from('[]').toString('base64') }) }), [])
})

test('F-06: the write command exits non-zero without input, and when a project is missing from it', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'f06-'))
  const run = (env, args = []) => {
    try {
      execFileSync('node', [resolve(ROOT, 'scripts/sync/run.mjs'), 'write', '--mode', 'dry-run', '--out-dir', dir, ...args], { cwd: ROOT, env: { ...process.env, GITHUB_TOKEN: '', SYNC_STATUS_ISSUE: '', SYNC_PROJECT: '', ...env }, stdio: 'pipe', encoding: 'utf8' })
      return { code: 0 }
    } catch (e) {
      return { code: e.status, out: String(e.stdout) + String(e.stderr) }
    }
  }
  const none = run({ SYNC_OBSERVATIONS: '' })
  assert.equal(none.code, 1)
  assert.match(none.out, /::error title=Registry sync failed::no observations received/)
  const file = resolve(dir, 'empty.json')
  writeFileSync(file, '[]')
  const missing = run({}, ['--in', file])
  assert.equal(missing.code, 1)
  assert.match(missing.out, /sync taskforge: error - not-collected/)
})
