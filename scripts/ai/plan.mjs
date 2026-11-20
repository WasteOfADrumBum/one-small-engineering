// Pure planning: given the source, the current target files and options, decide every
// file operation. Nothing here reads or writes the file system, so every safety rule
// (never overwrite unowned or edited content, no downgrade, idempotency) is unit-testable.

import {
  TARGET_DIR, TARGET_MANIFEST, PROJECT_FILE, compareVersions, extractBlock, isoNow, normalizeEol,
  removeBlock, sameText, serializeJson, sha256, writeBlock
} from './lib.mjs'
import { renderBlock, renderChatgpt, renderGitignore, renderProject, renderSharedFile, resolveAdapters, adapterById } from './source.mjs'

export const GITIGNORE_PATH = `${TARGET_DIR}/.gitignore`
const OTHER_BLOCKS = [
  /<!-- one-small-engineering:continuity v\d+ -->[\s\S]*?<!-- \/one-small-engineering:continuity -->/g,
  /<!-- modspack:start[^>]*-->[\s\S]*?<!-- modspack:end[^>]*-->/g
]

// Text a person wrote in an instruction file: everything outside managed blocks.
export function projectText(text) {
  if (text === null || text === undefined) return ''
  let t = normalizeEol(text)
  const own = extractBlock(t)
  if (own.state === 'present') t = own.before + own.after
  for (const re of OTHER_BLOCKS) t = t.replace(re, '')
  return t.trim()
}

// Every repository-relative path planSync may need to read.
export function pathsToRead(source, oldManifest) {
  const set = new Set([TARGET_MANIFEST, PROJECT_FILE, GITIGNORE_PATH])
  for (const p of source.policies) set.add(p.targetPath)
  for (const a of source.manifest.adapters) set.add(a.path)
  if (oldManifest) {
    for (const p of Object.keys(oldManifest.files || {})) set.add(p)
    for (const p of Object.keys(oldManifest.blocks || {})) set.add(p)
  }
  return [...set]
}

function wholeFileAction({ path, desired, current, recorded, overwrite, kind = 'file' }) {
  const base = { path, kind, original: current, part: { before: current, after: desired } }
  if (current === null) {
    return { ...base, op: 'create', content: desired, reason: recorded ? 'managed file was missing; restored' : 'new managed file' }
  }
  if (sameText(current, desired)) return { ...base, op: 'unchanged', content: null, reason: recorded ? 'up to date' : 'identical content adopted' }
  if (recorded && sha256(current) === recorded) return { ...base, op: 'update', content: desired, reason: 'managed file updated' }
  const why = recorded ? 'modified locally since the last sync' : 'exists but was not written by ose ai'
  if (overwrite.has(path)) return { ...base, op: 'update', content: desired, reason: `${why}; overwritten on request (previous content kept in history)` }
  return { ...base, op: 'conflict', content: null, reason: why }
}

function blockAction({ path, desiredBlock, current, recorded, createIfMissing, overwrite }) {
  const found = extractBlock(current)
  const base = { path, kind: 'block', original: current }
  if (current === null) {
    if (!createIfMissing) return { ...base, op: 'skip', content: null, reason: 'file not present; this adapter only updates an existing file', part: null }
    return { ...base, op: 'create', content: writeBlock(null, desiredBlock), createdFile: true, reason: 'new instruction file with the managed block', part: { before: null, after: desiredBlock } }
  }
  if (found.state === 'malformed') {
    return { ...base, op: 'conflict', content: null, reason: `malformed ai-standards block (${found.reason || 'unterminated'}); fix the markers by hand`, part: null }
  }
  if (found.state === 'absent') {
    if (recorded && !overwrite.has(path)) {
      return { ...base, op: 'conflict', content: null, reason: 'the managed block was removed locally; re-add it with --overwrite', part: null }
    }
    return { ...base, op: 'update', content: writeBlock(current, desiredBlock), createdFile: false, reason: 'managed block appended; existing text untouched', part: { before: null, after: desiredBlock } }
  }
  if (sameText(found.block, desiredBlock)) return { ...base, op: 'unchanged', content: null, reason: recorded ? 'up to date' : 'identical block adopted', part: { before: found.block, after: desiredBlock } }
  const clean = recorded && sha256(found.block) === recorded
  if (clean || overwrite.has(path)) {
    const reason = clean ? 'managed block updated; text outside it untouched' : 'block modified locally; overwritten on request (previous block kept in history)'
    return { ...base, op: 'update', content: writeBlock(current, desiredBlock), createdFile: false, reason, part: { before: found.block, after: desiredBlock } }
  }
  return { ...base, op: 'conflict', content: null, reason: recorded ? 'managed block modified locally since the last sync' : 'an ai-standards block exists that ose ai did not record', part: null }
}

function removalAction({ path, kind, current, recorded, overwrite }) {
  const base = { path, kind, original: current }
  if (kind === 'block') {
    const found = extractBlock(current)
    if (current === null || found.state === 'absent') return null
    if (found.state === 'malformed') return { ...base, op: 'conflict', content: null, reason: 'malformed block in a file whose adapter was removed', part: null }
    if (sha256(found.block) !== recorded && !overwrite.has(path)) return { ...base, op: 'conflict', content: null, reason: 'adapter removed, but its block was modified locally', part: null }
    const rest = removeBlock(current)
    const empty = !rest || !rest.trim()
    return { ...base, op: empty ? 'remove' : 'update', content: empty ? null : rest, reason: 'adapter no longer selected; block removed', part: { before: found.block, after: null }, removedFile: empty }
  }
  if (current === null) return null
  if (sha256(current) !== recorded && !overwrite.has(path)) return { ...base, op: 'conflict', content: null, reason: 'no longer part of the policy set, but modified locally; kept', part: null }
  return { ...base, op: 'remove', content: null, reason: 'no longer part of the policy set', part: { before: current, after: null } }
}

// target: { name, files: { [path]: string | null }, packageJson, lockfiles }
// options: { adapters, overwrite, allowDowngrade, now }
export function planSync(source, target, options = {}) {
  const files = target.files
  const read = p => (Object.hasOwn(files, p) ? files[p] : null)
  const overwrite = new Set((options.overwrite || []).map(p => p.split('\\').join('/')))
  const m = source.manifest
  let old = null
  const rawManifest = read(TARGET_MANIFEST)
  if (rawManifest !== null) {
    try { old = JSON.parse(rawManifest) } catch (e) { throw new Error(`${TARGET_MANIFEST} is not valid JSON (${e.message}); fix or remove it by hand`) }
    if (!old || !old.source || old.source.id !== m.id) {
      throw new Error(`${TARGET_MANIFEST} records source "${old && old.source ? old.source.id : 'unknown'}", not "${m.id}"; refusing to manage files from a different source`)
    }
    if (compareVersions(m.policyVersion, old.policyVersion) < 0 && !options.allowDowngrade) {
      throw new Error(`source policy ${m.policyVersion} is older than the installed ${old.policyVersion}; use ose ai rollback, or pass --allow-downgrade`)
    }
  }
  const adapters = resolveAdapters(source, options.adapters && options.adapters.length ? options.adapters : old ? old.adapters : null)
  const recordedFiles = (old && old.files) || {}
  const recordedBlocks = (old && old.blocks) || {}
  const actions = []

  // .ai/project.md: project-owned. Created once, never changed.
  let projectMd = read(PROJECT_FILE)
  if (projectMd === null) {
    const instructionFiles = source.manifest.adapters.filter(a => a.kind === 'block' && projectText(read(a.path))).map(a => a.path)
    const ctx = { name: target.name, ...target.detected, existingInstructions: instructionFiles }
    projectMd = renderProject(source, { projectName: ctx.projectName || target.name, stack: ctx.stack || [], commands: ctx.commands || [], existingInstructions: instructionFiles })
    actions.push({ path: PROJECT_FILE, kind: 'seed', op: 'create', content: projectMd, original: null, reason: 'project rules file created (project-owned from now on)', part: { before: null, after: projectMd } })
  } else {
    actions.push({ path: PROJECT_FILE, kind: 'seed', op: 'unchanged', content: null, original: projectMd, reason: 'project-owned; never modified by sync', part: null })
  }

  const desiredFiles = {}
  for (const p of source.policies) desiredFiles[p.targetPath] = renderSharedFile(source, p)
  desiredFiles[GITIGNORE_PATH] = renderGitignore()
  const projectName = /^# Project rules: (.+)$/m.exec(normalizeEol(projectMd))?.[1]?.trim() || target.name
  if (adapters.includes('chatgpt')) desiredFiles[adapterById(source, 'chatgpt').path] = renderChatgpt(source, { projectName, projectMd })

  for (const [path, desired] of Object.entries(desiredFiles)) {
    actions.push(wholeFileAction({ path, desired, current: read(path), recorded: recordedFiles[path]?.sha256, overwrite }))
  }
  const desiredBlocks = {}
  for (const id of adapters) {
    const a = adapterById(source, id)
    if (a.kind !== 'block') continue
    desiredBlocks[a.path] = true
    actions.push(blockAction({ path: a.path, desiredBlock: renderBlock(source, id), current: read(a.path), recorded: recordedBlocks[a.path]?.sha256, createIfMissing: a.createIfMissing, overwrite }))
  }
  // Anything recorded before that is no longer wanted.
  for (const [path, rec] of Object.entries(recordedFiles)) {
    if (desiredFiles[path] !== undefined) continue
    const act = removalAction({ path, kind: 'file', current: read(path), recorded: rec.sha256, overwrite })
    if (act) actions.push(act)
  }
  for (const [path, rec] of Object.entries(recordedBlocks)) {
    if (desiredBlocks[path]) continue
    const act = removalAction({ path, kind: 'block', current: read(path), recorded: rec.sha256, overwrite })
    if (act) actions.push(act)
  }

  const conflicts = actions.filter(a => a.op === 'conflict')
  const changes = actions.filter(a => ['create', 'update', 'remove'].includes(a.op))

  // New manifest: checksums of what will be on disk after this run.
  const newFiles = {}
  const newBlocks = {}
  for (const a of actions) {
    if (a.kind === 'file' && a.op !== 'remove' && a.op !== 'conflict') newFiles[a.path] = { sha256: sha256(a.part.after) }
    if (a.kind === 'file' && a.op === 'conflict' && recordedFiles[a.path]) newFiles[a.path] = recordedFiles[a.path]
    if (a.kind === 'block' && ['create', 'update', 'unchanged'].includes(a.op) && a.part && a.part.after) {
      newBlocks[a.path] = { sha256: sha256(a.part.after), createdFile: a.op === 'create' ? true : Boolean(recordedBlocks[a.path]?.createdFile) }
    }
  }
  const now = isoNow(options.now)
  const manifest = {
    manifestVersion: 1,
    source: { id: m.id, repository: m.repository },
    policyVersion: m.policyVersion,
    adapters,
    projectFile: PROJECT_FILE,
    files: sortKeys(newFiles),
    blocks: sortKeys(newBlocks),
    installedAt: old ? old.installedAt : now,
    updatedAt: now
  }
  const manifestSame = old && JSON.stringify({ ...old, installedAt: 0, updatedAt: 0 }) === JSON.stringify({ ...manifest, installedAt: 0, updatedAt: 0 })
  if (manifestSame) manifest.updatedAt = old.updatedAt
  const manifestText = serializeJson(manifest)
  const manifestAction = changes.length || !manifestSame
    ? { path: TARGET_MANIFEST, kind: 'manifest', op: old ? 'update' : 'create', content: manifestText, original: rawManifest, reason: old ? 'installed state updated' : 'installed state recorded', part: { before: rawManifest, after: manifestText } }
    : { path: TARGET_MANIFEST, kind: 'manifest', op: 'unchanged', content: null, original: rawManifest, reason: 'up to date', part: null }

  return {
    fromVersion: old ? old.policyVersion : null,
    toVersion: m.policyVersion,
    installed: Boolean(old),
    adapters,
    actions: [...actions, manifestAction],
    conflicts,
    changed: conflicts.length === 0 && (changes.length > 0 || manifestAction.op !== 'unchanged'),
    manifest
  }
}

function sortKeys(obj) {
  return Object.fromEntries(Object.keys(obj).sort().map(k => [k, obj[k]]))
}

// Resolution text shown for each conflict.
export function resolution(action, targetLabel) {
  if (action.reason.startsWith('malformed')) return `Fix the <!-- one-small-engineering:ai-standards --> markers in ${action.path} by hand, then rerun.`
  return `Move any local edits you want to keep into ${PROJECT_FILE}, then run: ose ai sync --target ${targetLabel} --overwrite ${action.path}`
}
