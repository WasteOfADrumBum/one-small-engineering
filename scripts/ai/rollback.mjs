// Rollback: restores the managed state recorded by the most recent sync snapshot.
// It changes a file only while that file still holds exactly what the sync wrote, so edits
// made after the sync are never overwritten. Any mismatch aborts the whole rollback.

import { HISTORY_DIR, TARGET_MANIFEST, extractBlock, normalizeEol, removeBlock, sameText, writeBlock } from './lib.mjs'
import { acquireLock, inside, listSnapshots, nodeIo, pruneEmptyDirs, transact } from './apply.mjs'

const readOrNull = (io, abs) => (io.exists(abs) && !io.isDir(abs) ? io.readFile(abs) : null)
const eqOrNull = (a, b) => (a === null || a === undefined ? b === null || b === undefined : sameText(a, b))

export function planRollback(root, io = nodeIo) {
  const snaps = listSnapshots(root, io)
  if (!snaps.length) {
    return { snapshot: null, ops: [], conflicts: [], kept: [], message: `no rollback history in ${HISTORY_DIR}/. If the change came from a merged pull request, revert that pull request instead.` }
  }
  const file = snaps[snaps.length - 1]
  const snapPath = `${HISTORY_DIR}/${file}`
  let snap
  try { snap = JSON.parse(io.readFile(inside(root, snapPath))) } catch (e) { throw new Error(`${snapPath} is not valid JSON: ${e.message}`) }
  const ops = []
  const conflicts = []
  const kept = []
  for (const e of snap.entries) {
    const current = readOrNull(io, inside(root, e.path))
    if (e.kind === 'seed') {
      if (eqOrNull(e.after, current)) ops.push({ path: e.path, content: e.before ?? null })
      else kept.push({ path: e.path, reason: 'project-owned file was edited after install; kept as is' })
      continue
    }
    if (e.kind === 'block') {
      const found = extractBlock(current)
      const currentBlock = found.state === 'present' ? found.block : null
      if (found.state === 'malformed' || !eqOrNull(e.after, currentBlock)) {
        conflicts.push({ path: e.path, reason: 'the managed block changed after that sync' })
        continue
      }
      let next
      if (e.before === null || e.before === undefined) {
        next = current === null ? null : removeBlock(current)
        if (e.createdFile && (!next || !normalizeEol(next).trim())) next = null
      } else next = writeBlock(current, e.before)
      ops.push({ path: e.path, content: next })
      continue
    }
    if (!eqOrNull(e.after, current)) { conflicts.push({ path: e.path, reason: 'file changed after that sync' }); continue }
    ops.push({ path: e.path, content: e.before ?? null })
  }
  const currentManifest = readOrNull(io, inside(root, TARGET_MANIFEST))
  if (!eqOrNull(snap.manifestAfter, currentManifest)) conflicts.push({ path: TARGET_MANIFEST, reason: 'installed manifest changed after that sync' })
  ops.push({ path: TARGET_MANIFEST, content: snap.manifestBefore ?? null })
  ops.push({ path: snapPath, content: null })
  return { snapshot: snap.id, fromVersion: snap.toVersion, toVersion: snap.fromVersion, ops, conflicts, kept }
}

export function applyRollback(root, plan, io = nodeIo) {
  if (!plan.snapshot) return { written: 0 }
  if (plan.conflicts.length) throw new Error('refusing to roll back: files changed after the sync')
  const release = acquireLock(root, io)
  let written
  try {
    written = transact(root, plan.ops, io)
  } finally {
    release()
  }
  pruneEmptyDirs(root, plan.ops.filter(o => o.content === null).map(o => o.path), io)
  return { written }
}
