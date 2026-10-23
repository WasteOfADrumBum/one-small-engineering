// API client tests: retries, backoff, rate limits, pagination, size caps.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createClient, GitHubError } from './github.mjs'

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
