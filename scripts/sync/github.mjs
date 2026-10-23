// Small GitHub REST client: retries with backoff, rate-limit awareness, size caps.
// fetch and sleep are injectable so tests never touch the network.

export class GitHubError extends Error {
  constructor(message, status, body) {
    super(message)
    this.status = status
    this.body = body
  }
}

export class MalformedResponse extends GitHubError {}

// Fail closed on a response that is not the documented shape: a missing list must never
// read as an empty one. `what` names the call for the diagnostic; the body is not echoed.
export function expectArray(data, what) {
  if (!Array.isArray(data)) throw new MalformedResponse(`${what}: malformed response (expected a list, got ${data === null ? 'an empty body' : typeof data})`, 200, '')
  return data
}

export function expectObject(data, what, keys = []) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new MalformedResponse(`${what}: malformed response (expected an object, got ${data === null ? 'an empty body' : Array.isArray(data) ? 'a list' : typeof data})`, 200, '')
  const missing = keys.filter(k => !(k in data))
  if (missing.length) throw new MalformedResponse(`${what}: malformed response (missing ${missing.join(', ')})`, 200, '')
  return data
}

const MAX_WAIT_MS = 60_000
// A network error or 5xx on a POST may still have been applied (an issue or comment would be
// created twice), so only these methods are retried after one. Rate-limit refusals are
// never applied, so they are retried for every method. The sync writer reconciles state on
// the next run, so a write that is not retried is repaired rather than lost.
const IDEMPOTENT = new Set(['GET', 'PATCH', 'PUT', 'DELETE'])

export function createClient({
  token,
  fetchImpl = globalThis.fetch,
  sleep = ms => new Promise(r => setTimeout(r, ms)),
  baseUrl = 'https://api.github.com',
  maxRetries = 4,
  baseDelayMs = 2000,
  maxBodyBytes = 5_000_000,
  random = Math.random
} = {}) {
  const backoff = attempt => Math.min(MAX_WAIT_MS, baseDelayMs * 2 ** attempt + Math.floor(random() * baseDelayMs))

  // Seconds to wait from Retry-After or the rate-limit reset header, if the response gives one.
  function serverWait(res, now = Date.now()) {
    const after = res.headers.get('retry-after')
    if (after && /^\d+$/.test(after)) return +after * 1000
    if (res.headers.get('x-ratelimit-remaining') === '0') {
      const reset = +res.headers.get('x-ratelimit-reset')
      if (reset) return Math.max(0, reset * 1000 - now)
    }
    return null
  }

  async function request(method, path, { body, allow404 = false } = {}) {
    if (!path.startsWith('/')) throw new Error(`path must start with /: ${path}`)
    const headers = {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'one-small-engineering-sync'
    }
    if (token) headers.authorization = `Bearer ${token}`
    if (body !== undefined) headers['content-type'] = 'application/json'
    for (let attempt = 0; ; attempt++) {
      let res
      try {
        res = await fetchImpl(baseUrl + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
      } catch (e) {
        if (attempt < maxRetries && IDEMPOTENT.has(method)) { await sleep(backoff(attempt)); continue }
        throw new GitHubError(`${method} ${path}: network error after ${attempt + 1} attempts (${e.message})`, 0, '')
      }
      const text = await res.text()
      if (text.length > maxBodyBytes) throw new GitHubError(`${method} ${path}: response larger than ${maxBodyBytes} bytes`, res.status, '')
      if (res.status === 404 && allow404) return null
      const rateLimited = res.status === 429 || (res.status === 403 && (res.headers.get('x-ratelimit-remaining') === '0' || /secondary rate limit/i.test(text)))
      if (((res.status >= 500 && IDEMPOTENT.has(method)) || rateLimited) && attempt < maxRetries) {
        const wait = serverWait(res) ?? backoff(attempt)
        // A reset far in the future is not worth holding the job for; the next scheduled run catches up.
        if (wait <= MAX_WAIT_MS) {
          await sleep(wait)
          continue
        }
      }
      if (!res.ok) throw new GitHubError(`${method} ${path}: HTTP ${res.status}`, res.status, text.slice(0, 300))
      return text ? JSON.parse(text) : null
    }
  }

  // Page-number pagination; stops at a short page or `max` items. Every page must be a
  // list. When more items exist past `max`, the result carries truncated: true, so a caller
  // can refuse to treat a partial list as complete.
  async function paginate(path, { max = 300, key } = {}) {
    const out = []
    const sep = path.includes('?') ? '&' : '?'
    let truncated = false
    for (let page = 1; ; page++) {
      const data = await request('GET', `${path}${sep}per_page=100&page=${page}`)
      const items = expectArray(key ? expectObject(data, `GET ${path}`, [key])[key] : data, `GET ${path}`)
      out.push(...items)
      if (items.length < 100) break
      if (out.length >= max) {
        // One more page tells a list of exactly `max` from a longer one.
        const more = expectArray(await request('GET', `${path}${sep}per_page=100&page=${page + 1}`), `GET ${path}`)
        truncated = out.length > max || more.length > 0
        break
      }
    }
    const result = out.slice(0, max)
    if (truncated || out.length > max) Object.defineProperty(result, 'truncated', { value: true })
    return result
  }

  return {
    request,
    paginate,
    get: (path, options) => request('GET', path, options)
  }
}
