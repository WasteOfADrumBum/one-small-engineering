// Orchestrator state (Phase 5, docs/engineering.md).
//
// engineering/state.json remembers what the last run saw, so the next run only refreshes what
// changed: the revision of every project, each project's manifest digest, when each finding was
// first and last seen, and the release state history. It holds observations only. It never holds
// a verification, an approval or a governance field; those live in the registry and in
// verification/verifications/, which the orchestrator never writes.
//
// A lock file (engineering/.lock, not committed) keeps two local runs from writing the state at
// the same time. In GitHub Actions the workflow's concurrency group does the same job.

import { readFileSync, writeFileSync, existsSync, mkdirSync, openSync, closeSync, unlinkSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'

export const STATE_SCHEMA = 1
export const STATE_PATH = 'engineering/state.json'
export const LOCK_PATH = 'engineering/.lock'
export const LOCK_STALE_MS = 3 * 3600 * 1000
const SHA = /^[0-9a-f]{40}$/
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/
const HISTORY = 10

export class StateError extends Error {}

export const emptyState = () => ({ schema: STATE_SCHEMA, lastRun: null, projects: {}, findings: {} })

// Problems with a state value, or [] when it is usable.
export function checkState(s) {
  const errs = []
  if (!s || typeof s !== 'object' || Array.isArray(s)) return ['state: not an object']
  if (s.schema !== STATE_SCHEMA) errs.push(`state: unsupported schema ${JSON.stringify(s.schema)}`)
  if (!s.projects || typeof s.projects !== 'object') errs.push('state: projects must be an object')
  if (!s.findings || typeof s.findings !== 'object') errs.push('state: findings must be an object')
  for (const [id, p] of Object.entries(s.projects || {})) {
    if (p.revision !== null && !SHA.test(p.revision || '')) errs.push(`state: ${id}.revision must be a full SHA or null`)
    if (p.observedAt && !TIME.test(p.observedAt)) errs.push(`state: ${id}.observedAt must be a UTC time`)
  }
  for (const [k, f] of Object.entries(s.findings || {})) if (!TIME.test(f.firstSeen || '') || !TIME.test(f.lastSeen || '')) errs.push(`state: finding ${k} needs firstSeen and lastSeen`)
  return errs
}

export function loadState(root) {
  const f = join(root, STATE_PATH)
  if (!existsSync(f)) return emptyState()
  let s
  try { s = JSON.parse(readFileSync(f, 'utf8')) } catch { throw new StateError(`${STATE_PATH} is not valid JSON; restore it from git (git checkout -- ${STATE_PATH}) or delete it to start fresh`) }
  const errs = checkState(s)
  if (errs.length) throw new StateError(`${STATE_PATH} is invalid: ${errs.slice(0, 3).join('; ')}`)
  return s
}

// Sorted keys so the file diff only shows real changes.
export const sortKeys = v => Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])])) : v

export function saveState(root, s) {
  const errs = checkState(s)
  if (errs.length) throw new StateError(`refusing to write an invalid state: ${errs[0]}`)
  const f = join(root, STATE_PATH)
  mkdirSync(dirname(f), { recursive: true })
  writeFileSync(f, JSON.stringify(sortKeys(s), null, 2) + '\n')
}

// Records a revision observation. Returns whether the revision changed since the last run.
export function observeRevision(s, id, { revision, ref = null, access = 'ok', accessReason = null, at }) {
  const prev = s.projects[id] || { revision: null, history: [] }
  const changed = Boolean(revision && prev.revision && prev.revision !== revision)
  const p = { ...prev, ref, access, accessReason, observedAt: at }
  if (revision) {
    if (prev.revision !== revision) { p.previousRevision = prev.revision || null; p.changedAt = at }
    p.revision = revision
  } else p.revision = prev.revision || null
  s.projects[id] = p
  return { changed, first: !prev.revision && Boolean(revision), previous: prev.revision || null }
}

// Records the derived release state; history keeps the last few transitions.
export function recordReleaseState(s, id, state, at) {
  const p = s.projects[id] || (s.projects[id] = { revision: null, history: [] })
  const history = p.history || []
  if (!history.length || history[history.length - 1].state !== state) history.push({ state, at })
  p.history = history.slice(-HISTORY)
  p.releaseState = state
  return history.length > 1 ? history[history.length - 2].state : null
}

// First and last seen for every current finding. Findings that disappeared are dropped, so a
// fixed issue that comes back is reported as new.
export function trackFindings(s, issues, at) {
  const next = {}
  const fresh = new Set()
  for (const i of issues) {
    const prev = s.findings[i.id]
    if (!prev) fresh.add(i.id)
    next[i.id] = { firstSeen: prev ? prev.firstSeen : at, lastSeen: at, project: i.project }
  }
  const resolved = Object.keys(s.findings).filter(k => !next[k]).sort()
  s.findings = next
  return { fresh, resolved }
}

// Exclusive lock. A lock older than LOCK_STALE_MS is from a crashed run and is replaced.
export function acquireLock(root, { now = Date.now(), pid = process.pid } = {}) {
  const f = join(root, LOCK_PATH)
  mkdirSync(dirname(f), { recursive: true })
  if (existsSync(f) && now - statSync(f).mtimeMs > LOCK_STALE_MS) unlinkSync(f)
  let fd
  try { fd = openSync(f, 'wx') } catch (e) {
    if (e.code === 'EEXIST') throw new StateError(`another orchestrator run holds ${LOCK_PATH}; wait for it, or delete the file if no run is active`)
    throw e
  }
  writeFileSync(fd, JSON.stringify({ pid, at: new Date(now).toISOString() }))
  closeSync(fd)
  return () => { try { unlinkSync(f) } catch {} }
}
