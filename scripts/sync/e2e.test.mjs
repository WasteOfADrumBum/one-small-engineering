// End to end against the in-memory GitHub: collect → plan → guard → validate → write,
// across several runs, with TaskForge (pilot) and ModsPack (observe-only).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { collectAll, processAll } from './run.mjs'
import { renderStatus } from './status.mjs'
import { checkMainCommit } from './main-integrity.mjs'
import { createClient } from './github.mjs'
import { validateRegistry, parseDefinitionOfDone } from '../validate-registry.mjs'
import { readJson, ROOT } from './lib.mjs'
import { FakeGitHub, projectRepo, hubRepo } from '../../fixtures/sync/fake-github.mjs'
import { loadRegistry, registryText, taskforgeState, modspackState, NOW, fakeSha } from '../../fixtures/sync/scenario.mjs'

const schema = readJson('projects/registry.schema.json')
const dod = parseDefinitionOfDone(readFileSync(resolve(ROOT, 'standards/definition-of-done.md'), 'utf8'))
const validate = r => validateRegistry(r, schema, { dod })

function universe() {
  const gh = new FakeGitHub()
  const tf = projectRepo(gh, taskforgeState())
  const mp = projectRepo(gh, modspackState())
  const mainSha = fakeSha('main-e2e')
  const hub = hubRepo(gh, { registryText: registryText(), mainSha })
  const client = createClient({ token: 't', fetchImpl: gh.fetch, sleep: async () => {}, random: () => 0 })
  return { gh, tf, mp, hub, client, mainSha }
}

async function runOnce(u, registry, mode, now = NOW) {
  const collected = await collectAll({ registry, clients: { publicReader: u.client, privateReader: null }, now })
  return processAll({ registry, collected, mode, hubClient: u.client, mainSha: u.hub.refs['heads/main'], validate })
}

const writesTo = (u, re) => u.gh.writes().filter(c => re.test(c.path))

test('dry run reads both pilots and writes nothing at all', async () => {
  const u = universe()
  const results = await runOnce(u, loadRegistry(), 'dry-run')
  assert.deepEqual(results.map(r => [r.projectId, r.outcome]), [['one-small-mods-pack', 'changed'], ['taskforge', 'changed']])
  assert.equal(u.gh.writes().length, 0)
})

test('write mode: one draft PR per project, never a write to a project repo or main', async () => {
  const u = universe()
  const results = await runOnce(u, loadRegistry(), 'write')
  assert.deepEqual(results.map(r => r.prAction), ['created', 'created'])
  assert.deepEqual(u.hub.pulls.map(p => [p.head, p.draft]), [['sync/one-small-mods-pack', true], ['sync/taskforge', true]])
  assert.equal(u.hub.refs['heads/main'], u.mainSha)
  assert.equal(writesTo(u, /\/repos\/WasteOfADrumBum\/(TaskForge|one-small-mods-pack)\//).length, 0, 'no write to any project repository')
  assert.equal(writesTo(u, /\/merge/).length, 0)

  // Each branch's registry passes the validator and touches only its own project.
  for (const id of ['taskforge', 'one-small-mods-pack']) {
    const reg = JSON.parse(u.hub.commits[u.hub.refs[`heads/sync/${id}`]].registryText)
    assert.deepEqual(validate(reg), [])
    const base = loadRegistry()
    for (const p of reg.projects) if (p.id !== id) assert.deepEqual(p, base.projects.find(x => x.id === p.id))
  }
})

test('the next scheduled run with no GitHub change is a no-op', async () => {
  const u = universe()
  await runOnce(u, loadRegistry(), 'write')
  const before = u.gh.writes().length
  const results = await runOnce(u, loadRegistry(), 'write', new Date(NOW.getTime() + 6 * 3600_000))
  assert.deepEqual(results.map(r => r.prAction), ['unchanged', 'unchanged'])
  assert.equal(u.gh.writes().length, before)
})

test('after the owner merges, main holds the facts and the next run proposes nothing', async () => {
  const u = universe()
  await runOnce(u, loadRegistry(), 'write')
  // Simulate merging the TaskForge PR: main now has its registry.
  const merged = JSON.parse(u.hub.commits[u.hub.refs['heads/sync/taskforge']].registryText)
  const results = await runOnce(u, merged, 'write', new Date(NOW.getTime() + 6 * 3600_000))
  const t = results.find(r => r.projectId === 'taskforge')
  assert.equal(t.outcome, 'unchanged')
})

test('a project error is isolated and reported; the other project still syncs', async () => {
  const u = universe()
  u.tf.repoId = 42
  const results = await runOnce(u, loadRegistry(), 'write')
  const t = results.find(r => r.projectId === 'taskforge')
  assert.equal(t.outcome, 'error')
  assert.match(t.errors[0], /repo-id-mismatch/)
  assert.equal(results.find(r => r.projectId === 'one-small-mods-pack').prAction, 'created')
  const { markdown } = renderStatus({ runAt: '2026-10-23T06:23:00Z', trigger: 'schedule', mode: 'write', results })
  assert.match(markdown, /taskforge \| Error/)
})

test('a private project without the reader credential is reported, not silently skipped', async () => {
  const u = universe()
  const reg = loadRegistry()
  reg.projects.find(p => p.id === 'taskforge').visibility = 'private'
  const collected = await collectAll({ registry: reg, clients: { publicReader: u.client, privateReader: null }, now: NOW })
  assert.equal(collected.find(c => c.projectId === 'taskforge').error.code, 'needs-reader-token')
})

test('main integrity: a merge commit passes, a direct push is flagged', async () => {
  const gh = new FakeGitHub()
  const good = fakeSha('good')
  gh.on('GET', /\/commits\/([0-9a-f]{40})\/pulls$/, ({ m }) => (m[1] === good ? [{ number: 5, html_url: 'https://github.com/x/pull/5', merged_at: '2026-10-23T00:00:00Z', base: { ref: 'main' } }] : []))
  const client = createClient({ token: 't', fetchImpl: gh.fetch, sleep: async () => {} })
  assert.equal((await checkMainCommit({ client, sha: good, sleep: async () => {} })).ok, true)
  assert.equal((await checkMainCommit({ client, sha: fakeSha('direct'), sleep: async () => {} })).ok, false)
})
