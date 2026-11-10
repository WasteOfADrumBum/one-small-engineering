// API client tests: retries, backoff, rate limits, pagination, size caps.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createClient, GitHubError } from './github.mjs'
import { FakeGitHub } from '../../fixtures/sync/fake-github.mjs'

function scripted(responses) {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    const r = responses.shift()
    if (r instanceof Error) throw r
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status, headers: r.headers || {} })
  }
  const sleeps = []
  const client = createClient({ token: 't', fetchImpl, sleep: async ms => { sleeps.push(ms) }, random: () => 0, baseDelayMs: 1000 })
  return { client, calls, sleeps }
}

test('retries 5xx with exponential backoff, then succeeds', async () => {
  const { client, sleeps } = scripted([{ status: 502, body: {} }, { status: 503, body: {} }, { status: 200, body: { ok: 1 } }])
  assert.deepEqual(await client.get('/x'), { ok: 1 })
  assert.deepEqual(sleeps, [1000, 2000])
})

test('honours Retry-After on 429 and secondary rate limits', async () => {
  const { client, sleeps } = scripted([
    { status: 429, body: {}, headers: { 'retry-after': '3' } },
    { status: 403, body: { message: 'You have exceeded a secondary rate limit' } },
    { status: 200, body: [] }
  ])
  assert.deepEqual(await client.get('/x'), [])
  assert.deepEqual(sleeps, [3000, 2000])
})

test('a far-off rate-limit reset fails fast instead of holding the job', async () => {
  const reset = String(Math.floor(Date.now() / 1000) + 3600)
  const { client, sleeps } = scripted([{ status: 403, body: { message: 'API rate limit exceeded' }, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset } }])
  await assert.rejects(client.get('/x'), e => e instanceof GitHubError && e.status === 403)
  assert.deepEqual(sleeps, [])
})

test('retries network errors, then gives up after maxRetries', async () => {
  const { client, calls } = scripted([new Error('reset'), new Error('reset'), new Error('reset'), new Error('reset'), new Error('reset')])
  await assert.rejects(client.get('/x'), /network error after 5 attempts/)
  assert.equal(calls.length, 5)
})

test('does not retry 4xx errors, and allow404 returns null', async () => {
  const { client, calls } = scripted([{ status: 422, body: { message: 'nope' } }, { status: 404, body: {} }])
  await assert.rejects(client.get('/x'), e => e.status === 422)
  assert.equal(await client.get('/y', { allow404: true }), null)
  assert.equal(calls.length, 2)
})

test('paginates until a short page', async () => {
  const page = n => Array.from({ length: n }, (_, i) => ({ i }))
  const { client, calls } = scripted([{ status: 200, body: page(100) }, { status: 200, body: page(5) }])
  assert.equal((await client.paginate('/items?state=open')).length, 105)
  assert.match(calls[1].url, /state=open&per_page=100&page=2$/)
})

test('rejects oversized responses and sends auth and API version headers', async () => {
  const calls = []
  const client = createClient({ token: 'abc', maxBodyBytes: 10, fetchImpl: async (url, init) => { calls.push(init); return new Response(JSON.stringify({ big: 'x'.repeat(50) })) } })
  await assert.rejects(client.get('/x'), /larger than 10 bytes/)
  assert.equal(calls[0].headers.authorization, 'Bearer abc')
  assert.equal(calls[0].headers['x-github-api-version'], '2022-11-28')
})

test('a POST is not retried after a 5xx or network error (it may have been applied), but is after a rate limit', async () => {
  const a = scripted([{ status: 502, body: {} }, { status: 201, body: { number: 1 } }])
  await assert.rejects(a.client.request('POST', '/repos/o/r/issues', { body: { title: 't' } }), e => e.status === 502)
  assert.equal(a.calls.length, 1)
  const b = scripted([new Error('reset'), { status: 201, body: { number: 1 } }])
  await assert.rejects(b.client.request('POST', '/repos/o/r/issues', { body: { title: 't' } }), /network error after 1 attempts/)
  assert.equal(b.calls.length, 1)
  const c = scripted([{ status: 429, body: {}, headers: { 'retry-after': '1' } }, { status: 201, body: { number: 1 } }])
  assert.deepEqual(await c.client.request('POST', '/repos/o/r/issues', { body: { title: 't' } }), { number: 1 })
  assert.equal(c.calls.length, 2)
  const d = scripted([{ status: 502, body: {} }, { status: 200, body: { ok: 1 } }])
  assert.deepEqual(await d.client.request('PATCH', '/repos/o/r/issues/1', { body: { body: 'x' } }), { ok: 1 })
})

test('paginateCursor stops at its page cap when a server keeps linking to empty pages', async () => {
  const gh = new FakeGitHub()
  gh.on('GET', /\/repos\/o\/r\/activity$/, ({ q }) => new Response('[]', { status: 200, headers: { 'content-type': 'application/json', link: `<https://api.github.com/repos/o/r/activity?after=${+(q.get('after') || 0) + 1}>; rel="next"` } }))
  const client = createClient({ token: 't', fetchImpl: gh.fetch, sleep: async () => {} })
  const out = await client.paginateCursor('/repos/o/r/activity', { max: 200 })
  assert.equal(out.length, 0)
  assert.equal(out.truncated, true)
  assert.equal(gh.calls.length, 3)
})
