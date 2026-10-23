// Small GitHub REST client: retries with backoff, rate-limit awareness, size caps.
// fetch and sleep are injectable so tests never touch the network.

export class GitHubError extends Error {
  constructor(message, status, body) {
    super(message)
    this.status = status
    this.body = body
  }
}

const MAX_WAIT_MS = 60_000

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
        if (attempt < maxRetries) { await sleep(backoff(attempt)); continue }
        throw new GitHubError(`${method} ${path}: network error after ${attempt + 1} attempts (${e.message})`, 0, '')
      }
      const text = await res.text()
      if (text.length > maxBodyBytes) throw new GitHubError(`${method} ${path}: response larger than ${maxBodyBytes} bytes`, res.status, '')
      if (res.status === 404 && allow404) return null
      const rateLimited = res.status === 429 || (res.status === 403 && (res.headers.get('x-ratelimit-remaining') === '0' || /secondary rate limit/i.test(text)))
      if ((res.status >= 500 || rateLimited) && attempt < maxRetries) {
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

  // Page-number pagination; stops at a short page or `max` items.
  async function paginate(path, { max = 300, key } = {}) {
    const out = []
    const sep = path.includes('?') ? '&' : '?'
    for (let page = 1; out.length < max; page++) {
      const data = await request('GET', `${path}${sep}per_page=100&page=${page}`)
      const items = key ? data[key] : data
      out.push(...items)
      if (items.length < 100) break
    }
    return out.slice(0, max)
  }

  return {
    request,
    paginate,
    get: (path, options) => request('GET', path, options)
  }
}
