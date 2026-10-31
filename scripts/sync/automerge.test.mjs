// Auto-merge tests: routine sync PRs merge; every governance change, unsafe PR and unsafe
// state is left alone. The GitHub API is a small in-memory fake; nothing touches the network.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run, evaluate, restrictAutomergeWrites, AutomergeRefused, loadPolicy } from './automerge.mjs'
import { loadRegistry, fakeSha } from '../../fixtures/sync/scenario.mjs'

const HUB = '/repos/WasteOfADrumBum/one-small-engineering'
const policy = { ...loadPolicy(), reconcileAfterMerge: true }
const MAIN = fakeSha('main-1')
const tf = r => r.projects.find(p => p.id === 'taskforge')
const b64 = obj => Buffer.from(JSON.stringify(obj)).toString('base64')

function routine(reg) {
  const next = structuredClone(reg)
  next.lastUpdatedAt = '2026-10-31T06:23:00Z'
  tf(next).sync.lastSyncedAt = '2026-10-31T06:23:00Z'
  tf(next).sync.lastSyncedHead = fakeSha('tf-head')
  tf(next).repositorySnapshot = { ...tf(next).repositorySnapshot, head: fakeSha('tf-head') }
  return next
}

// One open sync PR (number 31) plus everything the evaluator reads.
function world({ next = routine(loadRegistry()), mutate = {} } = {}) {
  const base = loadRegistry()
  const head = fakeSha('pr-head')
  const st = {
    main: MAIN, writes: [], merged: [], comments: [], dispatches: [], ready: 0,
    pr: { number: 31, state: 'open', draft: true, title: 'sync(taskforge): registry update', node_id: 'PR_x', commits: 1, labels: [], base: { ref: 'main' }, user: { login: 'github-actions[bot]', type: 'Bot' }, head: { ref: 'sync/taskforge', sha: head, repo: { full_name: 'WasteOfADrumBum/one-small-engineering' } } },
    commit: { parents: [{ sha: MAIN }], commit: { author: { name: 'One Small Engineering Sync' } } },
    files: [{ filename: 'projects/registry.json', status: 'modified' }],
    reviews: [], base, next,
    checks: [{ id: 1, name: 'validate', status: 'completed', conclusion: 'success' }],
    mergeStatus: null
  }
  Object.assign(st, mutate)
  const client = {
    paginate: async path => {
      if (/\/pulls\?/.test(path)) return st.pr.state === 'open' ? [st.pr] : []
      if (/\/files$/.test(path)) return Object.assign([...st.files], st.filesTruncated ? { truncated: true } : {})
      if (/check-runs$/.test(path)) return st.checks
      throw new Error(`unexpected paginate ${path}`)
    },
    get: async path => client.request('GET', path),
    request: async (method, path, { body } = {}) => {
      const bare = path.split('?')[0]
      if (method === 'GET') {
        if (bare.endsWith('/git/ref/heads/main')) return { object: { sha: st.main } }
        if (/\/pulls\/31$/.test(bare)) return st.pr
        if (/\/pulls\/31\/reviews$/.test(bare)) return st.reviews
        if (/\/commits\/[0-9a-f]{40}$/.test(bare)) return st.commit
        if (bare.endsWith('/contents/projects/registry.json')) {
          const ref = path.split('ref=')[1]
          const reg = ref === st.main ? st.base : st.next
          const content = b64(reg)
          return { content, size: content.length }
        }
      }
      st.writes.push(`${method} ${bare}`)
      if (method === 'POST' && bare === '/graphql') { st.ready++; st.pr.draft = false; return {} }
      if (method === 'PUT' && /\/merge$/.test(bare)) {
        if (st.mergeStatus) { const { GitHubError } = await import('./github.mjs'); throw new GitHubError('merge', st.mergeStatus, '') }
        if (body.sha !== st.pr.head.sha) { const { GitHubError } = await import('./github.mjs'); throw new GitHubError('merge', 409, '') }
        st.merged.push(body); st.pr.state = 'closed'; st.main = fakeSha('main-2'); return { sha: st.main }
      }
      if (/\/comments$/.test(bare)) { st.comments.push(body.body); return {} }
      if (/dispatches$/.test(bare)) { st.dispatches.push(body); return null }
      throw new Error(`unexpected ${method} ${path}`)
    }
  }
  return { st, client }
}

const validate = () => []
const go = (w, extra = {}) => run({ client: w.client, policy, validate, ...extra })

test('a routine sync PR is validated, marked ready, squash-merged on its exact head and recorded', async () => {
  const w = world()
  const out = await go(w)
  assert.equal(out.merges, 1)
  assert.equal(out.results[0].decision, 'merged')
  assert.equal(w.st.ready, 1)
  assert.equal(w.st.merged[0].sha, w.st.pr.head.sha)
  assert.equal(w.st.merged[0].merge_method, 'squash')
  assert.match(w.st.comments[0], /Merged automatically as/)
  assert.deepEqual(w.st.dispatches, [])
})

test('dry run reports would-merge and writes nothing', async () => {
  const w = world()
  const out = await go(w, { dryRun: true })
  assert.equal(out.results[0].decision, 'would-merge')
  assert.deepEqual(w.st.writes, [])
})

test('paused or disabled policy never merges', async () => {
  for (const o of [{ paused: true }, { policy: { ...policy, enabled: false } }]) {
    const w = world()
    const out = await run({ client: w.client, policy, validate, ...o })
    assert.equal(out.merges, 0)
    assert.deepEqual(w.st.writes, [])
  }
})

// Governance: each of these must be refused by the field-ownership guard.
const governance = {
  'verifier assignment': r => { tf(r).ownership.verifier = 'Claude Code' },
  'builder assignment': r => { tf(r).ownership.builder = 'ChatGPT' },
  'project ownership': r => { tf(r).ownership.approvalOwner = 'Someone Else' },
  'release approval': r => { tf(r).approval = { status: 'approved', approvedBy: 'Claude Code', approvedAt: '2026-10-31T06:00:00Z', evidenceRefs: [] } },
  'release blocker resolution': r => { tf(r).release.blockers = [] ; tf(r).release.target = '9.9.9' },
  'release gate status': r => { if (tf(r).releaseGates[0]) tf(r).releaseGates[0].status = 'verified'; else tf(r).releaseGates = [{ id: 'x' }] },
  'manual evidence record': r => { tf(r).evidence.push({ id: 'ev-human', origin: 'manual', result: 'pass' }) },
  'another project': r => { r.projects.find(p => p.id !== 'taskforge').lifecycle = 'retired' },
  'tier': r => { tf(r).tier = 'critical' },
  'sync mode': r => { tf(r).sync.mode = 'write' }
}
for (const [name, edit] of Object.entries(governance)) {
  test(`governance change is never merged: ${name}`, async () => {
    const next = routine(loadRegistry())
    edit(next)
    const w = world({ next })
    const out = await go(w)
    assert.equal(out.merges, 0)
    assert.equal(out.results[0].decision, 'reject', out.results[0].reasons.join('; '))
    assert.deepEqual(w.st.writes, [])
  })
}

test('an AI-forged human verification cannot ride a sync PR', async () => {
  const next = routine(loadRegistry())
  tf(next).evidence.push({ id: 'ev-forged', origin: 'sync', type: 'verification', result: 'pass' })
  const out = await go(world({ next }))
  assert.equal(out.results[0].decision, 'reject')
})

const unsafe = {
  'untrusted author': { pr: (p) => ({ ...p, user: { login: 'someone', type: 'User' } }) },
  'fork head': { pr: p => ({ ...p, head: { ...p.head, repo: { full_name: 'evil/one-small-engineering' } } }) },
  'two commits': { pr: p => ({ ...p, commits: 2 }) },
  'extra file': { files: [{ filename: 'projects/registry.json', status: 'modified' }, { filename: '.github/workflows/validate.yml', status: 'modified' }] },
  'workflow file only': { files: [{ filename: '.github/workflows/validate.yml', status: 'modified' }] },
  'truncated file list': { filesTruncated: true },
  'non-sync commit author': { commit: { parents: [{ sha: MAIN }], commit: { author: { name: 'Mallory' } } } },
  'failed CI': { checks: [{ id: 1, name: 'validate', status: 'completed', conclusion: 'failure' }] },
  'extra failing check': { checks: [{ id: 1, name: 'validate', status: 'completed', conclusion: 'success' }, { id: 2, name: 'other', status: 'completed', conclusion: 'cancelled' }] }
}
for (const [name, m] of Object.entries(unsafe)) {
  test(`unsafe PR is not merged: ${name}`, async () => {
    const w = world()
    if (m.pr) w.st.pr = m.pr(w.st.pr)
    for (const k of ['files', 'filesTruncated', 'commit', 'checks']) if (k in m) w.st[k] = m[k]
    const out = await go(w)
    assert.equal(out.merges, 0)
    assert.equal(out.results[0].decision, 'reject', out.results[0].reasons.join('; '))
    assert.deepEqual(w.st.writes, [])
  })
}

test('missing or pending required check waits instead of merging', async () => {
  for (const checks of [[], [{ id: 1, name: 'validate', status: 'in_progress', conclusion: null }]]) {
    const w = world({ mutate: { checks } })
    const out = await go(w)
    assert.equal(out.results[0].decision, 'wait')
    assert.deepEqual(w.st.writes, [])
  }
})

test('a rerun that succeeds supersedes an earlier failed run of the same check', async () => {
  const w = world({ mutate: { checks: [{ id: 1, name: 'validate', status: 'completed', conclusion: 'failure' }, { id: 5, name: 'validate', status: 'completed', conclusion: 'success' }] } })
  assert.equal((await go(w)).merges, 1)
})

test('stale branch (main moved) waits and is never merged', async () => {
  const w = world({ mutate: { main: fakeSha('main-2') } })
  const out = await go(w)
  assert.equal(out.results[0].decision, 'wait')
  assert.match(out.results[0].reasons[0], /sync must rebuild/)
  assert.deepEqual(w.st.writes, [])
})

test('hold label and requested changes leave the PR to a human', async () => {
  let w = world(); w.st.pr.labels = [{ name: 'hold' }]
  assert.equal((await go(w)).results[0].decision, 'skip')
  w = world({ mutate: { reviews: [{ state: 'CHANGES_REQUESTED' }] } })
  assert.equal((await go(w)).results[0].decision, 'skip')
  assert.deepEqual(w.st.writes, [])
})

test('non-sync PRs are ignored entirely', async () => {
  const w = world(); w.st.pr.head.ref = 'feature/x'
  const out = await go(w)
  assert.equal(out.results.length, 0)
})

test('head moves between evaluation and merge: nothing is merged', async () => {
  const w = world()
  const orig = w.client.request
  w.client.request = async (m, p, o) => { const r = await orig(m, p, o); if (m === 'GET' && /\/pulls\/31$/.test(p)) return { ...r, head: { ...r.head, sha: fakeSha('moved') } }; return r }
  const out = await go(w)
  assert.equal(out.merges, 0)
  assert.equal(out.results[0].decision, 'wait')
  assert.equal(w.st.merged.length, 0)
})

test('GitHub refusing the merge (conflict) is recorded, not forced', async () => {
  const w = world({ mutate: { mergeStatus: 405 } })
  const out = await go(w)
  assert.equal(out.merges, 0)
  assert.equal(out.results[0].decision, 'wait')
})

test('an API outage on one PR is an error result, not a crash or a merge', async () => {
  const w = world()
  const orig = w.client.request
  w.client.request = async (m, p, o) => { if (/\/reviews/.test(p)) { const { GitHubError } = await import('./github.mjs'); throw new GitHubError('boom', 503, '') } return orig(m, p, o) }
  const out = await go(w)
  assert.equal(out.results[0].decision, 'error')
  assert.equal(w.st.merged.length, 0)
})

test('after a merge, remaining stale sync PRs trigger a rebuild dispatch', async () => {
  const w = world()
  const second = structuredClone(w.st.pr); second.number = 32; second.head = { ...second.head, ref: 'sync/studio', sha: fakeSha('p2') }
  const orig = w.client.paginate
  w.client.paginate = async p => /\/pulls\?/.test(p) ? [w.st.pr, second] : orig(p)
  const o2 = w.client.request
  w.client.request = async (m, p, o) => /\/pulls\/32\/reviews/.test(p) ? [] : /\/pulls\/32/.test(p) ? second : /commits\/.{40}$/.test(p) && p.includes(second.head.sha) ? { parents: [{ sha: MAIN }], commit: { author: { name: 'One Small Engineering Sync' } } } : o2(m, p, o)
  const out = await go(w)
  assert.equal(out.merges, 1)
  assert.equal(out.results[1].decision, 'wait')
  assert.deepEqual(w.st.dispatches, [{ ref: 'main', inputs: { dry_run: 'false' } }])
})

test('the write allowlist refuses everything outside auto-merge', () => {
  const calls = []
  const c = restrictAutomergeWrites({ request: async (m, p) => calls.push([m, p]), paginate: async () => [] })
  for (const [m, p, body] of [
    ['PUT', `${HUB}/contents/projects/registry.json`, { sha: 'x' }],
    ['PATCH', `${HUB}/git/refs/heads/main`, { sha: fakeSha('x') }],
    ['DELETE', `${HUB}/git/refs/heads/sync/x`, {}],
    ['PUT', `${HUB}/pulls/1/merge`, { sha: 'short', merge_method: 'squash' }],
    ['POST', `${HUB}/pulls/1/reviews`, { event: 'APPROVE' }],
    ['POST', `${HUB}/actions/workflows/registry-sync.yml/dispatches`, { ref: 'evil', inputs: { dry_run: 'false' } }]
  ]) assert.throws(() => c.request(m, p, { body }), AutomergeRefused, `${m} ${p}`)
  assert.equal(calls.length, 0)
})

test('real registry: validator accepts the committed registry as the merge baseline', () => {
  assert.ok(Array.isArray(loadRegistry().projects))
})
