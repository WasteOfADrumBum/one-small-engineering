// Integration: the real auto-merge orchestration (run, evaluate, merge), the real write allowlist
// and the real GitHub REST client (retries, pagination, size caps, malformed-response handling)
// against a controlled local HTTP server that behaves like the GitHub API. No network beyond
// 127.0.0.1; deterministic (sleep is injected).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createClient } from './github.mjs'
import { run, loadPolicy } from './automerge.mjs'
import { loadRegistry, fakeSha } from '../../fixtures/sync/scenario.mjs'

const HUB = '/repos/WasteOfADrumBum/one-small-engineering'
const MAIN = fakeSha('int-main')
const HEAD = fakeSha('int-head')
const SUITE = 555

function routine() {
  const next = structuredClone(loadRegistry())
  const tf = next.projects.find(p => p.id === 'taskforge')
  next.lastUpdatedAt = '2026-11-05T06:23:00Z'
  tf.sync.lastSyncedAt = '2026-11-05T06:23:00Z'
  return next
}

const check = (id, name, conclusion = 'success', extra = {}) => ({ id, name, status: 'completed', conclusion, head_sha: HEAD, app: { id: 15368 }, check_suite: { id: SUITE }, ...extra })

// state.faults: { [routeKey]: [{ status, headers, body }] } served (and consumed) before the real answer.
function startHub(overrides = {}) {
  const st = {
    main: MAIN, merged: [], comments: [], requests: [],
    pr: { number: 41, state: 'open', draft: false, title: 'sync(taskforge): registry update', node_id: 'PR_i', commits: 1, labels: [], base: { ref: 'main' }, user: { login: 'github-actions[bot]', type: 'Bot' }, head: { ref: 'sync/taskforge', sha: HEAD, repo: { full_name: 'WasteOfADrumBum/one-small-engineering' } } },
    checks: [check(1, 'validate'), check(2, 'ci-gate')],
    runs: [{ id: 9001, path: '.github/workflows/validate.yml', head_sha: HEAD, check_suite_id: SUITE, run_attempt: 1 }],
    base: loadRegistry(), next: routine(), faults: {}, ...overrides
  }
  const page = (items, url) => {
    const per = Number(url.searchParams.get('per_page') || 30)
    const n = Number(url.searchParams.get('page') || 1)
    return items.slice((n - 1) * per, n * per)
  }
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x')
    const key = `${req.method} ${url.pathname}`
    st.requests.push(key)
    let body = ''
    req.on('data', d => { body += d })
    req.on('end', () => {
      const send = (status, data, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(typeof data === 'string' ? data : JSON.stringify(data)) }
      const fault = (st.faults[key] || []).shift()
      if (fault) return send(fault.status, fault.body ?? { message: 'fault' }, fault.headers)
      const p = url.pathname
      if (req.method === 'GET' && p === `${HUB}/pulls`) return send(200, page(st.pr.state === 'open' ? [st.pr] : [], url))
      if (req.method === 'GET' && p === `${HUB}/pulls/41`) return send(200, st.pr)
      if (req.method === 'GET' && p === `${HUB}/pulls/41/reviews`) return send(200, page([], url))
      if (req.method === 'GET' && p === `${HUB}/pulls/41/files`) return send(200, page([{ filename: 'projects/registry.json', status: 'modified' }], url))
      if (req.method === 'GET' && p === `${HUB}/git/ref/heads/main`) return send(200, { object: { sha: st.main } })
      if (req.method === 'GET' && p === `${HUB}/commits/${HEAD}`) return send(200, { parents: [{ sha: MAIN }], commit: { author: { name: 'One Small Engineering Sync' } } })
      if (req.method === 'GET' && p === `${HUB}/commits/${HEAD}/check-runs`) return send(200, { total_count: st.checks.length, check_runs: page(st.checks, url) })
      if (req.method === 'GET' && p === `${HUB}/actions/runs`) return send(200, { total_count: st.runs.length, workflow_runs: page(st.runs.filter(r => r.head_sha === url.searchParams.get('head_sha')), url) })
      if (req.method === 'GET' && p === `${HUB}/contents/projects/registry.json`) {
        const content = Buffer.from(JSON.stringify(url.searchParams.get('ref') === st.main ? st.base : st.next)).toString('base64')
        return send(200, { content, size: content.length })
      }
      if (req.method === 'PUT' && p === `${HUB}/pulls/41/merge`) {
        const b = JSON.parse(body)
        if (b.sha !== st.pr.head.sha) return send(409, { message: 'Head branch was modified' })
        st.merged.push(b); st.pr.state = 'closed'; st.main = fakeSha('int-main-2')
        return send(200, { sha: st.main, merged: true })
      }
      if (req.method === 'POST' && p === `${HUB}/issues/41/comments`) { st.comments.push(JSON.parse(body).body); return send(201, { id: 1 }) }
      send(404, { message: 'Not Found' })
    })
  })
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ st, server, baseUrl: `http://127.0.0.1:${server.address().port}` })))
}

async function withHub(overrides, fn) {
  const hub = await startHub(overrides)
  try {
    const client = createClient({ token: 'test-token', baseUrl: hub.baseUrl, sleep: async () => {}, maxRetries: 3 })
    await fn(hub, client)
  } finally {
    hub.server.close()
  }
}

const go = (client, extra = {}) => run({ client, policy: { ...loadPolicy(), reconcileAfterMerge: false }, validate: () => [], ...extra })

test('integration: a routine sync PR merges on its exact head through the real client', async () => {
  await withHub({}, async (hub, client) => {
    const out = await go(client)
    assert.equal(out.results[0].decision, 'merged', out.results[0].reasons.join('; '))
    assert.equal(hub.st.merged[0].sha, HEAD)
    assert.equal(hub.st.merged[0].merge_method, 'squash')
    assert.match(hub.st.comments[0], /Merged automatically/)
    assert.ok(hub.st.requests.includes(`GET ${HUB}/actions/runs`), 'the trusted workflow run list was read')
  })
})

test('integration: transient 502s and a short secondary rate limit are retried, then the merge proceeds', async () => {
  const faults = {
    [`GET ${HUB}/commits/${HEAD}/check-runs`]: [{ status: 502 }, { status: 503 }],
    [`GET ${HUB}/actions/runs`]: [{ status: 403, body: { message: 'You have exceeded a secondary rate limit' }, headers: { 'retry-after': '1' } }]
  }
  await withHub({ faults }, async (hub, client) => {
    const out = await go(client)
    assert.equal(out.results[0].decision, 'merged', out.results[0].reasons.join('; '))
    assert.equal(hub.st.requests.filter(r => r === `GET ${HUB}/commits/${HEAD}/check-runs`).length, 3)
  })
})

test('integration: a primary rate limit resetting far in the future fails the PR as an error, with no merge', async () => {
  const reset = String(Math.floor(Date.now() / 1000) + 3600)
  const faults = { [`GET ${HUB}/pulls/41/files`]: Array(5).fill({ status: 403, body: { message: 'API rate limit exceeded' }, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset } }) }
  await withHub({ faults }, async (hub, client) => {
    const out = await go(client)
    assert.equal(out.results[0].decision, 'error')
    assert.match(out.results[0].reasons[0], /HTTP 403/)
    assert.equal(hub.st.merged.length, 0)
  })
})

test('integration: a failing newer attempt on page 2 of the check runs is found (pagination)', async () => {
  const filler = Array.from({ length: 150 }, (_, i) => check(100 + i, `lint-${i}`))
  await withHub({ checks: [check(1, 'validate'), check(2, 'ci-gate'), ...filler, check(999, 'ci-gate', 'failure')] }, async (hub, client) => {
    const out = await go(client)
    assert.equal(out.results[0].decision, 'reject')
    assert.match(out.results[0].reasons[0], /"ci-gate" concluded failure/)
    assert.equal(hub.st.merged.length, 0)
  })
})

test('integration: a same-named success created by another app is not accepted', async () => {
  await withHub({ checks: [check(1, 'validate'), check(2, 'ci-gate', 'success', { app: { id: 4242 } })] }, async (hub, client) => {
    const out = await go(client)
    assert.equal(out.results[0].decision, 'wait')
    assert.equal(hub.st.merged.length, 0)
  })
})

test('integration: malformed and oversized API responses fail closed', async () => {
  for (const fault of [{ status: 200, body: 'not json' }, { status: 200, body: { check_runs: 'nope' } }]) {
    await withHub({ faults: { [`GET ${HUB}/commits/${HEAD}/check-runs`]: [fault] } }, async (hub, client) => {
      const out = await go(client)
      assert.equal(out.results[0].decision, 'error', JSON.stringify(fault))
      assert.match(out.results[0].reasons[0], /malformed response/)
      assert.equal(hub.st.merged.length, 0)
    })
  }
  await withHub({ faults: { [`GET ${HUB}/pulls/41/files`]: [{ status: 200, body: JSON.stringify([{ filename: 'x'.repeat(6_000_000) }]) }] } }, async (hub, client) => {
    const out = await go(client)
    assert.equal(out.results[0].decision, 'error')
    assert.match(out.results[0].reasons[0], /larger than/)
    assert.equal(hub.st.merged.length, 0)
  })
})

test('integration: the head moving during evaluation makes GitHub refuse the merge, which is recorded, not forced', async () => {
  await withHub({}, async (hub, client) => {
    const orig = client.request
    let prReads = 0
    const racing = { ...client, request: async (m, p, o) => { const r = await orig(m, p, o); if (m === 'GET' && p.endsWith('/pulls/41') && ++prReads === 2) hub.st.pr.head.sha = fakeSha('pushed-later'); return r }, get: (p, o) => racing.request('GET', p, o) }
    const out = await go(racing)
    assert.equal(out.results[0].decision, 'wait')
    assert.equal(hub.st.merged.length, 0)
  })
})
