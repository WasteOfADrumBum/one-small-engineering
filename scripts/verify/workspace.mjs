// Getting a read-only checkout of a project at an exact commit, and reading files from it.
//
// Public repositories are fetched anonymously over HTTPS. A private repository needs a reader
// credential (withGitReader); without one the checkout is reported `unavailable` with the reason, never treated
// as empty or passing. Nothing here pushes, and the checkout's remote holds no credential.

import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, rmSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const SHA = /^[0-9a-f]{40}$/
const REPO = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)$/

export class AccessError extends Error {
  constructor(code, message) { super(message); this.code = code }
}

export function repoParts(url) {
  const m = REPO.exec(url || '')
  if (!m) throw new AccessError('bad-repository', `not a GitHub repository URL: ${JSON.stringify(url)}`)
  return { owner: m[1], repo: m[2] }
}

// Classifies git's stderr without echoing it.
export function classifyGitFailure(stderr) {
  const s = String(stderr || '')
  if (/could not read Username|Authentication failed|terminal prompts disabled|Repository not found|403/i.test(s)) return { code: 'not-visible', message: 'repository not found or not visible without a reader credential (private repositories need one)' }
  if (/Could not resolve host|Connection timed out|Failed to connect|unable to access|SSL|proxy/i.test(s)) return { code: 'network-error', message: 'network error reaching github.com' }
  if (/429|rate limit/i.test(s)) return { code: 'rate-limited', message: 'rate limited by github.com' }
  if (/not our ref|unadvertised object|couldn't find remote ref/i.test(s)) return { code: 'ref-missing', message: 'the requested ref or commit is not on the remote' }
  return { code: 'git-failed', message: 'git failed (details withheld)' }
}

// The reader credential for git, if this run may use one. A run that executes project code
// never gets it: that code is untrusted and could read its parent's environment.
export function gitReaderFrom(env, { execute = false } = {}) {
  return execute ? '' : env.READER_TOKEN || env.SYNC_READER_TOKEN || ''
}

// Wraps a runner so git can read private repositories with a read-only reader credential. The
// credential goes to git invocations only, as an HTTP header in that process's environment: never
// in a remote URL, never in .git/config, and never to any other command.
export function withGitReader(run, token) {
  if (!token) return run
  const auth = { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader', GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}` }
  return (cmd, args, opts = {}) => (cmd === 'git' ? run(cmd, args, { ...opts, env: { ...(opts.env || {}), ...auth } }) : run(cmd, args, opts))
}

// Resolves the live head of a ref without cloning: { sha } or throws AccessError.
export function resolveRef(run, repository, ref) {
  repoParts(repository)
  const res = run('git', ['ls-remote', '--', repository, ref ? `refs/heads/${ref}` : 'HEAD'], { timeoutMs: 60_000 })
  if (res.status !== 0) { const f = classifyGitFailure(res.stderr); throw new AccessError(f.code, f.message) }
  const line = res.stdout.split(/\r?\n/).find(l => l.trim())
  if (!line) throw new AccessError('ref-missing', `ref ${ref || 'HEAD'} not found`)
  const sha = line.split(/\s+/)[0]
  if (!SHA.test(sha)) throw new AccessError('malformed', 'git ls-remote returned a malformed SHA')
  return { sha }
}

// Shallow checkout of exactly `sha` into `dir`. Verifies HEAD equals `sha` afterwards.
export function checkout(run, repository, sha, dir) {
  repoParts(repository)
  if (!SHA.test(sha || '')) throw new AccessError('bad-commit', 'checkout needs a full commit SHA')
  if (existsSync(join(dir, '.git'))) {
    const head = run('git', ['rev-parse', 'HEAD'], { cwd: dir })
    if (head.status === 0 && head.stdout.trim() === sha) return { dir, reused: true }
    rmSync(dir, { recursive: true, force: true })
  }
  mkdirSync(dir, { recursive: true })
  const steps = [['init', '-q'], ['remote', 'add', 'origin', repository], ['fetch', '-q', '--depth', '1', 'origin', sha], ['checkout', '-q', '--detach', 'FETCH_HEAD']]
  for (const args of steps) {
    const res = run('git', args, { cwd: dir, timeoutMs: 600_000 })
    if (res.status !== 0) { const f = classifyGitFailure(res.stderr); throw new AccessError(f.code, f.message) }
  }
  const head = run('git', ['rev-parse', 'HEAD'], { cwd: dir })
  if (head.status !== 0 || head.stdout.trim() !== sha) throw new AccessError('commit-mismatch', `checkout is at ${head.stdout.trim().slice(0, 7) || 'unknown'}, expected ${sha.slice(0, 7)}`)
  return { dir, reused: false }
}

// A read-only view of a checkout for collectors. Paths are relative and may not escape.
export function workspaceView(dir) {
  const safe = p => {
    const full = join(dir, p)
    if (relative(dir, full).split(sep).includes('..')) throw new Error(`path escapes the checkout: ${p}`)
    return full
  }
  const exists = p => existsSync(safe(p))
  const read = p => (exists(p) ? readFileSync(safe(p), 'utf8') : null)
  const json = p => { const t = read(p); if (t === null) return null; try { return JSON.parse(t) } catch { return { __malformed: true } } }
  // Every tracked-looking file (no .git, no node_modules), sorted, capped.
  const files = (max = 20_000) => {
    const out = []
    const walk = d => {
      for (const name of readdirSync(join(dir, d)).sort()) {
        if (name === '.git' || name === 'node_modules' || name === 'dist' && d === '') continue
        const rel = d ? `${d}/${name}` : name
        const st = statSync(join(dir, rel))
        if (st.isDirectory()) walk(rel)
        else if (st.isFile()) out.push({ path: rel, size: st.size })
        if (out.length >= max) return
      }
    }
    walk('')
    return out
  }
  return { dir, exists, read, json, files }
}

// An in-memory view for tests: { 'path': 'content' }.
export function memoryView(map) {
  const files = Object.keys(map).sort()
  const read = p => (p in map ? map[p] : null)
  return {
    dir: null,
    exists: p => p in map || files.some(f => f.startsWith(`${p}/`)),
    read,
    json: p => { const t = read(p); if (t === null) return null; try { return JSON.parse(t) } catch { return { __malformed: true } } },
    files: () => files.map(path => ({ path, size: map[path].length }))
  }
}
