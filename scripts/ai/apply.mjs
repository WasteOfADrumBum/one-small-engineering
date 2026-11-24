// File system side: reading a target repository, and applying a plan as one transaction.
// Every write goes to a temporary file that is renamed into place; if any step fails,
// everything already applied is restored from the originals held in memory, so a failed
// run never leaves a half-updated policy set. A lock file stops two runs at once.

import * as fs from 'node:fs'
import { dirname, join, resolve, relative, sep } from 'node:path'
import { HISTORY_DIR, LOCK_FILE, TARGET_MANIFEST, TMP_SUFFIX, isoNow, serializeJson, toPosix } from './lib.mjs'
import { detectProject } from './source.mjs'
import { pathsToRead } from './plan.mjs'

export const nodeIo = {
  readFile: p => fs.readFileSync(p, 'utf8'),
  writeFile: (p, data, opts) => fs.writeFileSync(p, data, opts),
  rename: (a, b) => fs.renameSync(a, b),
  unlink: p => fs.unlinkSync(p),
  exists: p => fs.existsSync(p),
  mkdir: p => fs.mkdirSync(p, { recursive: true }),
  readdir: p => fs.readdirSync(p),
  rmdir: p => fs.rmdirSync(p),
  isDir: p => { try { return fs.statSync(p).isDirectory() } catch { return false } }
}

// Resolves a repository-relative path and refuses anything that escapes the repository.
export function inside(root, rel) {
  const abs = resolve(root, rel)
  const r = relative(root, abs)
  if (!r || r.startsWith('..') || resolve(root, r) !== abs || r.split(sep).includes('..')) throw new Error(`path escapes the repository: ${rel}`)
  return abs
}

function readOrNull(io, abs) {
  if (!io.exists(abs) || io.isDir(abs)) return null
  return io.readFile(abs)
}

export function readTarget(root, source, io = nodeIo) {
  if (!io.exists(root) || !io.isDir(root)) throw new Error(`target is not a directory: ${root}`)
  const manifestText = readOrNull(io, inside(root, TARGET_MANIFEST))
  let old = null
  if (manifestText !== null) { try { old = JSON.parse(manifestText) } catch { old = null } }
  const files = {}
  for (const rel of pathsToRead(source, old)) files[rel] = readOrNull(io, inside(root, rel))
  let packageJson = null
  const pkgText = readOrNull(io, join(root, 'package.json'))
  if (pkgText) { try { packageJson = JSON.parse(pkgText) } catch { packageJson = null } }
  const lockfiles = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'].filter(f => io.exists(join(root, f)))
  const name = root.split(/[\\/]/).filter(Boolean).pop()
  return { root, name, files, packageJson, lockfiles, detected: detectProject({ name: null, packageJson, lockfiles }) }
}

export function isSourceRepository(root, source, io = nodeIo) {
  const p = join(root, 'ai-standards', 'manifest.json')
  if (!io.exists(p)) return false
  try { return JSON.parse(io.readFile(p)).id === source.manifest.id } catch { return false }
}

export function acquireLock(root, io = nodeIo) {
  const abs = inside(root, LOCK_FILE)
  io.mkdir(dirname(abs))
  try {
    io.writeFile(abs, `${process.pid} ${isoNow()}\n`, { flag: 'wx' })
  } catch (e) {
    if (e.code === 'EEXIST') throw new Error(`another ose ai run holds ${LOCK_FILE} in ${root}. If no run is active, delete that file and retry.`)
    throw e
  }
  return () => { try { io.unlink(abs) } catch { /* already gone */ } }
}

// ops: [{ path, content: string | null }]  (null = delete). Applied in order, all or nothing.
export function transact(root, ops, io = nodeIo) {
  const done = []
  try {
    for (const op of ops) {
      const abs = inside(root, op.path)
      const original = readOrNull(io, abs)
      if (op.content === null) {
        if (original !== null) io.unlink(abs)
      } else {
        io.mkdir(dirname(abs))
        const tmp = abs + TMP_SUFFIX
        io.writeFile(tmp, op.content)
        io.rename(tmp, abs)
      }
      done.push({ abs, original })
    }
  } catch (err) {
    const restoreErrors = []
    for (const { abs, original } of done.reverse()) {
      try {
        if (original === null) { if (io.exists(abs)) io.unlink(abs) } else io.writeFile(abs, original)
      } catch (e) { restoreErrors.push(`${abs}: ${e.message}`) }
    }
    for (const op of ops) { const t = resolve(root, op.path) + TMP_SUFFIX; try { if (io.exists(t)) io.unlink(t) } catch { /* best effort */ } }
    err.message = `update failed and was rolled back (${done.length} applied step(s) restored): ${err.message}`
    if (restoreErrors.length) err.message += `; could not restore: ${restoreErrors.join('; ')}`
    throw err
  }
  return done.length
}

// Removes now-empty parent directories of deleted files, up to (not including) the root.
export function pruneEmptyDirs(root, paths, io = nodeIo) {
  for (const rel of paths) {
    let dir = dirname(resolve(root, rel))
    while (dir.startsWith(resolve(root)) && dir !== resolve(root)) {
      try { if (io.readdir(dir).length) break; io.rmdir(dir) } catch { break }
      dir = dirname(dir)
    }
  }
}

export function snapshotId(now = new Date(), existing = []) {
  const base = isoNow(now).replace(/[-:]/g, '').replace('T', '-').replace('Z', '')
  let id = base
  for (let i = 2; existing.includes(`${id}.json`); i++) id = `${base}-${i}`
  return id
}

export function listSnapshots(root, io = nodeIo) {
  const dir = inside(root, HISTORY_DIR)
  if (!io.exists(dir)) return []
  const key = f => { const m = /^(\d{8}-\d{6})(?:-(\d+))?\.json$/.exec(f); return [m[1], m[2] ? +m[2] : 1] }
  return io.readdir(dir).filter(f => /^\d{8}-\d{6}(-\d+)?\.json$/.test(f)).sort((a, b) => {
    const [ka, kb] = [key(a), key(b)]
    return ka[0] === kb[0] ? ka[1] - kb[1] : ka[0] < kb[0] ? -1 : 1
  })
}

// Applies a sync plan: changed files, a history snapshot (for rollback), then the manifest.
export function applyPlan(root, plan, { io = nodeIo, now = new Date(), keep = 5 } = {}) {
  if (plan.conflicts.length) throw new Error('refusing to apply a plan with conflicts')
  if (!plan.changed) return { written: 0, snapshot: null }
  const release = acquireLock(root, io)
  try {
    const changes = plan.actions.filter(a => ['create', 'update', 'remove'].includes(a.op) && a.kind !== 'manifest')
    const manifestAction = plan.actions.find(a => a.kind === 'manifest')
    const existing = listSnapshots(root, io)
    const id = snapshotId(now, existing)
    const snapshot = {
      snapshotVersion: 1,
      id,
      createdAt: isoNow(now),
      fromVersion: plan.fromVersion,
      toVersion: plan.toVersion,
      manifestBefore: manifestAction.original,
      manifestAfter: manifestAction.content ?? manifestAction.original,
      entries: changes.map(a => ({ path: a.path, kind: a.kind, before: a.part ? a.part.before : a.original, after: a.part ? a.part.after : null, createdFile: Boolean(a.createdFile), removedFile: Boolean(a.removedFile) }))
    }
    const ops = changes.map(a => ({ path: a.path, content: a.content }))
    ops.push({ path: `${HISTORY_DIR}/${id}.json`, content: serializeJson(snapshot) })
    if (manifestAction.op !== 'unchanged') ops.push({ path: TARGET_MANIFEST, content: manifestAction.content })
    const written = transact(root, ops, io)
    pruneEmptyDirs(root, changes.filter(a => a.op === 'remove').map(a => a.path), io)
    pruneHistory(root, keep, io)
    return { written, snapshot: id }
  } finally {
    release()
  }
}

export function pruneHistory(root, keep, io = nodeIo) {
  const all = listSnapshots(root, io)
  for (const f of all.slice(0, Math.max(0, all.length - keep))) {
    try { io.unlink(inside(root, `${HISTORY_DIR}/${f}`)) } catch { /* best effort */ }
  }
}

export const rel = (root, abs) => toPosix(relative(root, abs))
