#!/usr/bin/env node
// Field-ownership guard for automated registry changes.
//
// Runs twice: inside the sync job before anything is pushed, and in Validate registry
// on every sync/* branch (so a hand-edited or forged sync branch is caught too).
// Fails if the change touches any file other than projects/registry.json, any project
// other than the branch's project, or any field automation does not own.
//
// CLI: node scripts/sync/guard.mjs --base origin/main --branch sync/<project-id>

import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { readJson, deepEqual, compareSemver, REGISTRY_PATH, ROOT, safeOutput } from './lib.mjs'

const ownership = readJson('sync/field-ownership.json')
const BRANCH = new RegExp(ownership.branchPattern)
const owned = ownership.registry.project

export function projectIdFromBranch(branch) {
  if (!BRANCH.test(branch || '')) throw new Error(`"${branch}" is not a sync branch (expected ${ownership.branchPattern})`)
  return branch.slice('sync/'.length)
}

export function guardPaths(changedFiles) {
  const allowed = new Set(ownership.allowedPaths)
  return changedFiles.filter(f => !allowed.has(f)).map(f => `${f}: automated sync may only change ${ownership.allowedPaths.join(', ')}`)
}

export function guardRegistryChange(base, head, projectId) {
  const errors = []
  const err = (path, msg) => errors.push(`${path}: ${msg}`)

  const topKeys = new Set([...Object.keys(base), ...Object.keys(head)])
  for (const k of topKeys) {
    if (k === 'projects' || ownership.registry.topLevel.includes(k)) continue
    if (!deepEqual(base[k], head[k])) err(`$.${k}`, 'is manual and cannot be changed by sync')
  }
  if (head.lastUpdatedAt < base.lastUpdatedAt) err('$.lastUpdatedAt', 'cannot move backwards')

  if (!deepEqual(base.projects.map(p => p.id), head.projects.map(p => p.id))) {
    err('$.projects', 'sync cannot add, remove or reorder projects')
    return errors
  }
  head.projects.forEach((hp, i) => {
    const bp = base.projects[i]
    const at = `$.projects[${i}] (${hp.id})`
    if (hp.id !== projectId) {
      if (!deepEqual(bp, hp)) err(at, `only ${projectId} may change on sync/${projectId}`)
      return
    }
    if (!bp.sync || !bp.sync.enabled) err(`${at}.sync`, 'sync is not enabled for this project on main')

    const allKeys = new Set([...Object.keys(bp), ...Object.keys(hp)])
    for (const k of allKeys) {
      if (owned.replace.includes(k) || ['evidence', 'release', 'sync'].includes(k)) continue
      if (!deepEqual(bp[k], hp[k])) err(`${at}.${k}`, 'is manual and cannot be changed by sync')
    }

    // release: only currentVersion and its source, forward only, backed by a sync release record.
    const rKeys = new Set([...Object.keys(bp.release), ...Object.keys(hp.release)])
    for (const k of rKeys) {
      if (owned.release.includes(k)) continue
      if (!deepEqual(bp.release[k], hp.release[k])) err(`${at}.release.${k}`, 'is manual and cannot be changed by sync')
    }
    if (hp.release.currentVersion !== bp.release.currentVersion) {
      if (!hp.release.currentVersion) err(`${at}.release.currentVersion`, 'sync cannot clear currentVersion')
      else if (bp.release.currentVersion && compareSemver(hp.release.currentVersion, bp.release.currentVersion) <= 0) err(`${at}.release.currentVersion`, 'sync can only move currentVersion forward')
      const backing = hp.evidence.find(e => e.origin === 'sync' && e.type === 'release' && hp.release.currentVersionSource && hp.release.currentVersionSource.includes(`(evidence ${e.id})`))
      if (!backing) err(`${at}.release.currentVersion`, 'a sync change to currentVersion must cite a sync release evidence record')
    } else if (hp.release.currentVersionSource !== bp.release.currentVersionSource) {
      err(`${at}.release.currentVersionSource`, 'cannot change unless currentVersion changes')
    }

    // sync block: identity and mode stay manual.
    if (bp.sync && hp.sync) {
      for (const k of new Set([...Object.keys(bp.sync), ...Object.keys(hp.sync)])) {
        if (owned.sync.includes(k)) continue
        if (!deepEqual(bp.sync[k], hp.sync[k])) err(`${at}.sync.${k}`, 'is manual and cannot be changed by sync')
      }
    } else if (!deepEqual(bp.sync, hp.sync)) err(`${at}.sync`, 'sync cannot add or remove the sync block')

    // evidence: manual records identical and in the same order; only sync records come and go.
    const manual = list => list.filter(e => e.origin !== 'sync')
    if (!deepEqual(manual(bp.evidence), manual(hp.evidence))) err(`${at}.evidence`, 'manual evidence records cannot be added, changed, removed or reordered by sync')
    const baseSync = new Map(bp.evidence.filter(e => e.origin === 'sync').map(e => [e.id, e]))
    const headSync = new Map(hp.evidence.filter(e => e.origin === 'sync').map(e => [e.id, e]))
    for (const [id, e] of headSync) {
      if (baseSync.has(id) && !deepEqual(baseSync.get(id), e)) err(`${at}.evidence (${id})`, 'existing automated records are immutable; supersede them with a new record')
      if (!['informational', 'builder_reported'].includes(e.result)) err(`${at}.evidence (${id})`, `automated records cannot have result ${e.result}`)
    }
    const cited = new Set([
      ...hp.releaseGates.flatMap(g => g.evidenceRefs),
      ...hp.release.blockers.flatMap(b => b.evidenceRefs),
      ...hp.approval.evidenceRefs,
      ...hp.modsPack.evidenceRefs
    ])
    for (const id of baseSync.keys()) if (!headSync.has(id) && cited.has(id)) err(`${at}.evidence (${id})`, 'a cited record cannot be removed')
  })
  return errors
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

function main(argv) {
  const opt = (name, fallback) => {
    const i = argv.indexOf(name)
    return i === -1 ? fallback : argv[i + 1]
  }
  const baseRef = opt('--base', 'origin/main')
  const branch = opt('--branch', process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || '')
  if (!branch.startsWith('sync/')) {
    console.log(`sync-guard: ${branch || 'this ref'} is not a sync branch; nothing to check`)
    return 0
  }
  let projectId
  try {
    projectId = projectIdFromBranch(branch)
  } catch (e) {
    console.error(`sync-guard: ${e.message}`)
    return 1
  }
  const mergeBase = git(['merge-base', baseRef, 'HEAD']).trim()
  const changed = git(['diff', '--name-only', mergeBase, 'HEAD']).split('\n').filter(Boolean)
  const errors = guardPaths(changed)
  if (changed.includes(REGISTRY_PATH)) {
    const base = JSON.parse(git(['show', `${mergeBase}:${REGISTRY_PATH}`]))
    const head = JSON.parse(git(['show', `HEAD:${REGISTRY_PATH}`]))
    errors.push(...guardRegistryChange(base, head, projectId))
  }
  if (errors.length) {
    console.error(`sync-guard: ${errors.length} problem(s) on ${branch}`)
    for (const e of errors) console.error(`  - ${safeOutput(e)}`)
    return 1
  }
  console.log(`sync-guard: OK (${branch} changes only automation-owned fields of ${projectId})`)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2))
}
