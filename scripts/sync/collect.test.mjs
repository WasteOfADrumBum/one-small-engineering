// Collection tests: identity, ownership, config and payload validation all fail closed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collect, SyncError } from './collect.mjs'
import { world, loadRegistry, taskforgeState, modspackState, NOW, fakeSha } from '../../fixtures/sync/scenario.mjs'
import { FakeGitHub, projectRepo } from '../../fixtures/sync/fake-github.mjs'
import { createClient } from './github.mjs'

const tf = r => r.projects.find(p => p.id === 'taskforge')

async function fails(state, code, mutateProject = () => {}) {
  const { client } = world({ tf: state })
  const project = tf(loadRegistry())
  mutateProject(project)
  await assert.rejects(collect({ project, client, now: NOW }), e => e instanceof SyncError && e.code === code, `expected ${code}`)
}

test('collects a valid observation with hub defaults when the repo has no config', async () => {
  const { client, gh } = world()
  const obs = await collect({ project: tf(loadRegistry()), client, now: NOW })
  assert.equal(obs.config.source, 'defaults')
  assert.equal(obs.workflowRuns.length, 1)
  assert.ok(gh.calls.every(c => c.method === 'GET'), 'collection only reads')
})

test('ModsPack is collected in observe mode with no repository files and only GET calls', async () => {
  const gh = new FakeGitHub()
  projectRepo(gh, modspackState())
  const client = createClient({ token: 't', fetchImpl: gh.fetch, sleep: async () => {} })
  const project = loadRegistry().projects.find(p => p.id === 'one-small-mods-pack')
  assert.equal(project.sync.mode, 'observe')
  const obs = await collect({ project, client, now: NOW })
  assert.deepEqual(obs.openPullRequests.map(p => p.number), [3])
  assert.ok(gh.calls.every(c => c.method === 'GET'))
})

test('fails closed on identity problems', async () => {
  await fails(taskforgeState({ repoId: 1 }), 'repo-id-mismatch')
  await fails(taskforgeState({ owner: 'someone-else' }), 'owner-mismatch')
  await fails(taskforgeState({ fullName: 'WasteOfADrumBum/TaskForge2' }), 'repo-renamed')
  await fails(taskforgeState({ missing: true }), 'repo-unreachable')
  await fails(taskforgeState(), 'not-enabled', p => { p.sync.enabled = false })
})

test('fails closed on bad configuration', async () => {
  await fails(taskforgeState({ config: { configVersion: 1, projectId: 'cortex' } }), 'project-mismatch')
  await fails(taskforgeState({ config: { configVersion: 2, projectId: 'taskforge' } }), 'config-invalid')
  await fails(taskforgeState({ config: { configVersion: 1, projectId: 'taskforge', surprise: true } }), 'config-invalid')
  await fails(taskforgeState({ config: { configVersion: 1, projectId: 'taskforge', registry: 'someone/else' } }), 'config-invalid')
  await fails(taskforgeState({ config: { configVersion: 1, projectId: 'taskforge', reporting: { releaseTagPattern: '(' } } }), 'config-invalid')
  await fails(taskforgeState({ configText: '{ not json' }), 'config-invalid')
  await fails(taskforgeState({ configText: JSON.stringify({ configVersion: 1, projectId: 'taskforge', pad: 'x'.repeat(17000) }) }), 'config-invalid')
  await fails(taskforgeState(), 'config-missing', p => { p.sync.mode = 'integrated' })
})

test('external text is cleaned and sensitive titles are withheld', async () => {
  const s = taskforgeState()
  s.pulls = [
    { number: 80, state: 'open', title: 'Fix\u0007 login\n\n  flow', headSha: fakeSha('80') },
    { number: 81, state: 'open', title: 'Rotate ghp_' + 'a'.repeat(36), headSha: fakeSha('81') },
    { number: 82, state: 'open', title: 'x'.repeat(500), headSha: fakeSha('82') }
  ]
  const { client } = world({ tf: s })
  const obs = await collect({ project: tf(loadRegistry()), client, now: NOW })
  const titles = obs.openPullRequests.map(p => p.title)
  assert.equal(titles[0], 'Fix login flow')
  assert.equal(titles[1], '[withheld: possible sensitive data]')
  assert.equal(titles[2].length, 200)
})

test('workflow filter and latest-run selection', async () => {
  const head = taskforgeState().headSha
  const s = taskforgeState({
    config: { configVersion: 1, projectId: 'taskforge', reporting: { workflows: ['ci.yml'] } },
    runs: [
      { id: 1, name: 'CI', path: '.github/workflows/ci.yml', head_sha: head, event: 'push', conclusion: 'failure', updated_at: '2026-10-09T19:00:00Z' },
      { id: 2, name: 'CI', path: '.github/workflows/ci.yml', head_sha: head, event: 'push', conclusion: 'success', updated_at: '2026-10-09T19:30:00Z' },
      { id: 3, name: 'Deploy', path: '.github/workflows/deploy.yml', head_sha: head, event: 'push', conclusion: 'success', updated_at: '2026-10-09T19:30:00Z' }
    ]
  })
  const { client } = world({ tf: s })
  const obs = await collect({ project: tf(loadRegistry()), client, now: NOW })
  assert.deepEqual(obs.workflowRuns.map(r => [r.workflow, r.conclusion]), [['ci.yml', 'success']])
})

test('template version is detected from the first line', async () => {
  const s = taskforgeState({ template: '# one-small-report template v1. Generated by ...\nname: x\n' })
  const { client } = world({ tf: s })
  const obs = await collect({ project: tf(loadRegistry()), client, now: NOW })
  assert.deepEqual(obs.template, { present: true, version: 1 })
})
