// Writer tests: only sync/* branches, one changed path, draft PRs, idempotent, never main.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeSync, closeStale, restrictWrites, upsertStatusIssue, WriteRefused, gitBlobSha } from './write.mjs'
import { collect } from './collect.mjs'
import { plan } from './plan.mjs'
import { serializeRegistry } from './lib.mjs'
import { world, loadRegistry, NOW, fakeSha } from '../../fixtures/sync/scenario.mjs'

const HUB = '/repos/WasteOfADrumBum/one-small-engineering'
const tf = r => r.projects.find(p => p.id === 'taskforge')

async function setup() {
  const mainSha = fakeSha('main-1')
  const w = world({ withHub: true, mainSha })
  const base = loadRegistry()
  const obs = await collect({ project: tf(base), client: w.client, now: NOW })
  const planned = plan(base, obs)
  const args = { client: w.client, projectId: 'taskforge', baseRegistry: base, nextRegistry: planned.registry, mainSha, title: 'sync(taskforge): registry update from 11975d0', body: 'body' }
  return { ...w, mainSha, base, planned, args }
}

test('creates sync/<id> from main with exactly one changed path and a draft PR', async () => {
  const { args, hub, gh, mainSha, planned } = await setup()
  const r = await writeSync(args)
  assert.equal(r.action, 'created')
  assert.equal(hub.refs['heads/main'], mainSha, 'main is untouched')
  const commit = hub.commits[hub.refs['heads/sync/taskforge']]
  assert.deepEqual(commit.parents, [mainSha])
  assert.equal(commit.author.name, 'One Small Engineering Sync')
  assert.equal(commit.registryText, serializeRegistry(planned.registry))
  const pr = hub.pulls[0]
  assert.equal(pr.draft, true)
  assert.equal(pr.base, 'main')
  assert.equal(pr.head, 'sync/taskforge')
  assert.deepEqual(hub.dispatches, ['sync/taskforge'])
  const tree = gh.calls.find(c => c.method === 'POST' && c.path.endsWith('/git/trees'))
  assert.deepEqual(tree.body.tree.map(t => t.path), ['projects/registry.json'])
})

test('a second run with the same facts pushes nothing', async () => {
  const { args, gh } = await setup()
  await writeSync(args)
  const before = gh.writes().length
  const again = await writeSync(args)
  assert.equal(again.action, 'unchanged')
  assert.equal(gh.writes().length, before)
})

test('new facts on top of an existing PR update it in place', async () => {
  const { args, hub } = await setup()
  await writeSync(args)
  const next = structuredClone(args.nextRegistry)
  tf(next).openPullRequests = [{ number: 9, url: 'https://github.com/WasteOfADrumBum/TaskForge/pull/9', title: 'New', headSha: fakeSha('9'), draft: false }]
  const r = await writeSync({ ...args, nextRegistry: next })
  assert.equal(r.action, 'updated')
  assert.equal(hub.pulls.length, 1)
})

test('refuses to overwrite a sync branch carrying someone else\'s commit', async () => {
  const { args, hub, mainSha } = await setup()
  const foreign = fakeSha('foreign')
  hub.commits[foreign] = { tree: 't', parents: [mainSha], author: { name: 'Joshua Small' }, registryText: '{}' }
  hub.refs['heads/sync/taskforge'] = foreign
  const r = await writeSync(args)
  assert.equal(r.action, 'skipped')
  assert.equal(hub.refs['heads/sync/taskforge'], foreign)
})

test('skips when main moved after the run started', async () => {
  const { args, hub } = await setup()
  hub.refs['heads/main'] = fakeSha('main-2')
  const r = await writeSync(args)
  assert.equal(r.action, 'skipped')
  assert.equal(hub.refs['heads/sync/taskforge'], undefined)
})

test('a proposal that touches manual fields is refused before any request', async () => {
  const { args, gh } = await setup()
  const bad = structuredClone(args.nextRegistry)
  tf(bad).releaseGates[0].status = 'verified'
  const before = gh.calls.length
  await assert.rejects(writeSync({ ...args, nextRegistry: bad }), WriteRefused)
  assert.equal(gh.calls.length, before)
})

test('the restricted client refuses every write outside the sync allowlist', async () => {
  const { client } = await setup()
  const c = restrictWrites(client)
  const refused = [
    ['PATCH', `${HUB}/git/refs/heads/main`, { sha: fakeSha('x'), force: true }],
    ['PATCH', `${HUB}/git/refs/heads/sync/../main`, { sha: fakeSha('x') }],
    ['POST', `${HUB}/git/refs`, { ref: 'refs/heads/main', sha: fakeSha('x') }],
    ['POST', `${HUB}/git/refs`, { ref: 'refs/tags/v1', sha: fakeSha('x') }],
    ['DELETE', `${HUB}/git/refs/heads/sync/taskforge`, {}],
    ['PUT', `${HUB}/pulls/1/merge`, {}],
    ['PUT', `${HUB}/contents/projects/registry.json`, { message: 'x', content: '' }],
    ['POST', `${HUB}/merges`, { base: 'main', head: 'sync/taskforge' }],
    ['POST', `${HUB}/pulls`, { title: 't', head: 'sync/taskforge', base: 'main', draft: false }],
    ['POST', `${HUB}/pulls`, { title: 't', head: 'feature', base: 'main', draft: true }],
    ['PATCH', `${HUB}/pulls/1`, { base: 'other' }],
    ['POST', `${HUB}/pulls/1/reviews`, { event: 'APPROVE' }],
    ['POST', `${HUB}/git/trees`, { base_tree: 'x', tree: [{ path: '.github/workflows/validate.yml', mode: '100644', type: 'blob', sha: 'x' }] }],
    ['POST', `${HUB}/git/trees`, { base_tree: 'x', tree: [{ path: 'projects/registry.json', mode: '100644', type: 'blob', sha: 'x' }, { path: 'README.md', mode: '100644', type: 'blob', sha: 'y' }] }],
    ['POST', '/repos/WasteOfADrumBum/TaskForge/git/refs', { ref: 'refs/heads/sync/x', sha: 'x' }],
    ['POST', `${HUB}/actions/workflows/registry-sync.yml/dispatches`, { ref: 'main' }],
    ['PATCH', `${HUB}/issues/1`, { state: 'closed' }]
  ]
  for (const [m, p, b] of refused) assert.throws(() => c.request(m, p, { body: b }), WriteRefused, `${m} ${p} should be refused`)
})

test('closes a redundant sync PR once main reflects the facts', async () => {
  const { args, hub } = await setup()
  await writeSync(args)
  const r = await closeStale({ client: args.client, projectId: 'taskforge' })
  assert.equal(r.action, 'closed')
  assert.equal(hub.pulls[0].state, 'closed')
  assert.match(hub.comments[0].body, /Generated by One Small Engineering Sync/)
})

test('status issue is created once and then updated in place', async () => {
  const { client, hub } = await setup()
  assert.equal((await upsertStatusIssue({ client, body: 'one' })).action, 'created')
  assert.equal((await upsertStatusIssue({ client, body: 'two' })).action, 'updated')
  assert.equal(hub.issues.length, 1)
  assert.equal(hub.issues[0].body, 'two')
})

test('git blob sha matches git hash-object', () => {
  assert.equal(gitBlobSha('hello\n'), 'ce013625030ba8dba906f756967f9e9ca394464a')
})
