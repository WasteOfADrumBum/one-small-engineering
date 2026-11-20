// The managed-repository registry (ai-standards/registry.json) and workspace resolution.

import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { dirname, join, resolve, isAbsolute } from 'node:path'
import { validateAgainstSchema } from '../validate-registry.mjs'
import { HUB_ROOT, SOURCE_DIR, normalizeUserPath, readJsonFile, repoSlug, serializeJson, isoNow, TMP_SUFFIX } from './lib.mjs'

export const REGISTRY_FILE = join(SOURCE_DIR, 'registry.json')
const SCHEMA_FILE = join(SOURCE_DIR, 'schemas/registry.schema.json')

export function emptyRegistry() {
  return { $schema: './schemas/registry.schema.json', registryVersion: 1, discovery: { maxDepth: 3, exclude: [] }, repositories: [] }
}

export function validateRegistryData(data, schema = readJsonFile(SCHEMA_FILE)) {
  const problems = validateAgainstSchema(data, schema).map(e => `registry ${e}`)
  if (!problems.length) {
    const ids = new Set()
    const repos = new Set()
    for (const r of data.repositories) {
      if (ids.has(r.id)) problems.push(`registry: duplicate id ${r.id}`)
      if (repos.has(r.repository.toLowerCase())) problems.push(`registry: duplicate repository ${r.repository}`)
      ids.add(r.id)
      repos.add(r.repository.toLowerCase())
    }
  }
  return problems
}

export function loadRegistry(file = REGISTRY_FILE) {
  if (!existsSync(file)) return { file, data: emptyRegistry(), exists: false }
  const data = readJsonFile(file)
  const problems = validateRegistryData(data)
  if (problems.length) throw new Error(`${file} is invalid:\n  - ${problems.join('\n  - ')}`)
  return { file, data, exists: true }
}

export function saveRegistry(reg) {
  const text = serializeJson(reg.data)
  if (existsSync(reg.file) && readFileSync(reg.file, 'utf8') === text) return false
  const tmp = reg.file + TMP_SUFFIX
  writeFileSync(tmp, text)
  renameSync(tmp, reg.file)
  return true
}

// Workspace: --workspace, then OSE_WORKSPACE, then the folder that contains the hub.
export function resolveWorkspace({ flag, env = process.env, hubRoot = HUB_ROOT, platform = process.platform, cwd = process.cwd() } = {}) {
  if (flag) return normalizeUserPath(flag, { platform, cwd })
  if (env.OSE_WORKSPACE && env.OSE_WORKSPACE.trim()) return normalizeUserPath(env.OSE_WORKSPACE, { platform, cwd })
  return dirname(hubRoot)
}

export const entryById = (reg, id) => reg.data.repositories.find(r => r.id === id)
export const entryBySlug = (reg, slug) => (slug ? reg.data.repositories.find(r => r.repository.toLowerCase() === slug) : undefined)

// Local folder for an entry: its explicit path, else the discovered repo with the same remote.
export function locate(entry, discovered, workspace) {
  if (entry.path) return isAbsolute(entry.path) ? resolve(entry.path) : resolve(workspace, entry.path)
  const hit = discovered.find(d => d.slug === entry.repository.toLowerCase())
  return hit ? hit.path : null
}

export function newEntry({ id, name, repository, adapters, path = null }) {
  return {
    id, name, repository, path, enabled: true, adapters,
    installation: { status: 'not-installed', policyVersion: null, lastSyncAt: null, validation: 'unknown', validatedAt: null }
  }
}

// Records a result; returns true only when something actually changed (keeps re-runs idempotent).
export function recordInstallation(entry, patch, now = new Date()) {
  const next = { ...entry.installation }
  if (patch.status) next.status = patch.status
  if (patch.policyVersion !== undefined) next.policyVersion = patch.policyVersion
  if (patch.synced) next.lastSyncAt = isoNow(now)
  if (patch.validation && patch.validation !== next.validation) { next.validation = patch.validation; next.validatedAt = isoNow(now) }
  if (patch.validation && !next.validatedAt) next.validatedAt = isoNow(now)
  const changed = JSON.stringify(next) !== JSON.stringify(entry.installation)
  if (changed) entry.installation = next
  return changed
}

export const slugOf = repoSlug
