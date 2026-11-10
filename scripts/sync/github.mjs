// Small GitHub REST client: retries with backoff, rate-limit awareness, size caps.
// fetch and sleep are injectable so tests never touch the network.

export class GitHubError extends Error {
  constructor(message, status, body, { acceptedPermissions = null } = {}) {
    super(message)
    this.status = status
    this.body = body
    // GitHub names the permission a refused call needed (x-accepted-github-permissions),
    // for example "pull_requests=read". Permission names only; never a value.
    this.acceptedPermissions = acceptedPermissions
  }
}

const PERMISSIONS = /^[a-z_]+=(?:read|write|admin)(?:[,;] ?[a-z_]+=(?:read|write|admin))*$/

// A precise, value-free diagnosis of a refused read: what failed and what would fix it.
// GitHub answers 404 (not 403) for a private repository the token cannot see, so a 404 is
// "not found or not visible", never proof that the repository does not exist.
export function describeAccess(e, what) {
  if (!(e instanceof GitHubError) || e instanceof MalformedResponse) return null
  const perms = e.acceptedPermissions ? ` (GitHub says this call needs ${e.acceptedPermissions})` : ''
  if (e.status === 401) return { code: 'token-rejected', message: `${what}: the token was rejected (HTTP 401); it is missing, expired or revoked` }
  if (e.status === 403) return { code: 'permission-denied', message: `${what}: the token lacks permission (HTTP 403)${perms}` }
  if (e.status === 404) return { code: 'not-visible', message: `${what}: not found or not visible to this token (HTTP 404)${perms}` }
  if (e.status === 429) return { code: 'rate-limited', message: `${what}: rate limited (HTTP 429); the next scheduled run retries` }
  if (e.status === 0) return { code: 'network-error', message: `${what}: network error after retries` }
  if (e.status >= 500) return { code: 'github-unavailable', message: `${what}: GitHub returned HTTP ${e.status} after retries` }
  return { code: 'request-failed', message: `${what}: HTTP ${e.status}${perms}` }
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

  async function request(method, path, { body, allow404 = false, withLink = false } = {}) {
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
      if (!res.ok) {
        const accepted = res.headers.get('x-accepted-github-permissions')
        throw new GitHubError(`${method} ${path}: HTTP ${res.status}`, res.status, text.slice(0, 300), { acceptedPermissions: accepted && PERMISSIONS.test(accepted) ? accepted : null })
      }
      if (!text) return withLink ? { data: null, link: res.headers.get('link') } : null
      try {
        const data = JSON.parse(text)
        return withLink ? { data, link: res.headers.get('link') } : data
      } catch {
        // The parser's message quotes the body; the diagnostic must not.
        throw new MalformedResponse(`${method} ${path}: malformed response (body is not JSON)`, res.status, '')
      }
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
        const next = await request('GET', `${path}${sep}per_page=100&page=${page + 1}`)
        const more = expectArray(key ? expectObject(next, `GET ${path}`, [key])[key] : next, `GET ${path}`)
        truncated = out.length > max || more.length > 0
        break
      }
    }
    const result = out.slice(0, max)
    if (truncated || out.length > max) Object.defineProperty(result, 'truncated', { value: true })
    return result
  }

  // Cursor pagination for endpoints that page with before/after cursors in the Link header
  // (for example the repository activity log). Follows rel="next" only while it points at the
  // same API origin and the same endpoint path; any other link is refused, never fetched.
  // Stops at `max` items; when more exist the result carries truncated: true.
  async function paginateCursor(path, { max = 1000, what = `GET ${path}` } = {}) {
    const sep = path.includes('?') ? '&' : '?'
    const base = new URL(baseUrl)
    const prefix = base.pathname.replace(/\/$/, '')
    const endpoint = new URL(baseUrl + path).pathname
    const out = []
    let next = `${path}${sep}per_page=100`
    let truncated = false
    // Page cap as well as item cap, so a server that keeps sending empty pages cannot loop us.
    const maxPages = Math.ceil(max / 100) + 1
    for (let pages = 1; next; pages++) {
      const { data, link } = await request('GET', next, { withLink: true })
      out.push(...expectArray(data, what))
      next = nextLink(link, base, endpoint, prefix)
      if (next && (out.length >= max || pages >= maxPages)) { truncated = true; break }
    }
    const result = out.slice(0, max)
    if (truncated || out.length > max) Object.defineProperty(result, 'truncated', { value: true })
    return result
  }

  function nextLink(link, base, endpoint, prefix) {
    if (!link) return null
    const m = /<([^>]+)>\s*;\s*rel="next"/.exec(link)
    if (!m) return null
    let url
    try {
      url = new URL(m[1])
    } catch {
      throw new MalformedResponse(`GET ${endpoint}: malformed pagination link`, 200, '')
    }
    if (url.origin !== base.origin || url.pathname !== endpoint) throw new MalformedResponse(`GET ${endpoint}: pagination link points outside the endpoint`, 200, '')
    return url.pathname.slice(prefix.length) + url.search
  }

  return {
    request,
    paginate,
    paginateCursor,
    get: (path, options) => request('GET', path, options)
  }
}
