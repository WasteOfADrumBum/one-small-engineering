// Shared constants and helpers for registry sync. Node built-ins only.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { findSensitive, redactSensitive, SYNC_RECORDER } from '../validate-registry.mjs'

export { SYNC_RECORDER }
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const OWNER = 'WasteOfADrumBum'
export const HUB_REPO = 'one-small-engineering'
export const HUB_DEFAULT_BRANCH = 'main'
export const REGISTRY_PATH = 'projects/registry.json'
export const CONFIG_PATH = '.github/one-small-engineering.json'
export const TEMPLATE_WORKFLOW_PATH = '.github/workflows/one-small-report.yml'
export const TEMPLATE_VERSION = 1
export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const SHA = /^[0-9a-f]{40}$/
export const MAX_CONFIG_BYTES = 16 * 1024
export const MAX_TITLE = 200

export const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  workflows: [],
  includeDraftPullRequests: true,
  releaseTagPattern: '^v(\\d+\\.\\d+\\.\\d+)$',
  evidenceLabel: 'release-evidence',
  materialPaths: [],
  lookbackDays: 14
})

export function readJson(relPath) {
  return JSON.parse(readFileSync(resolve(ROOT, relPath), 'utf8'))
}

// The registry is stored exactly as JSON.stringify(..., 2) writes it, so automated diffs stay minimal.
export function serializeRegistry(registry) {
  return JSON.stringify(registry, null, 2) + '\n'
}

export function slugify(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'x'
}

export function repoFromUrl(url) {
  const m = /^https:\/\/github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/.exec(url)
  if (!m) throw new Error(`not a GitHub repository URL: ${url}`)
  return { owner: m[1], name: m[2] }
}

export function isoSeconds(date) {
  return new Date(date).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

// External text (PR titles, workflow names) is data: strip control characters, collapse
// whitespace, cap the length, and withhold it entirely if it looks sensitive.
export function cleanText(value, max = MAX_TITLE) {
  let s = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  if (s.length > max) s = s.slice(0, max - 1) + '…'
  if (!s) return '(untitled)'
  if (findSensitive(s).length) return '[withheld: possible sensitive data]'
  return s
}

// Every string that leaves the process (console, job summary, workflow annotations, issue
// and PR bodies, the status issue's hidden state) passes through here first.
export function safeOutput(text) {
  return redactSensitive(text)
}

// One workflow-command-safe line: redacted, newlines folded (so external text cannot start
// its own "::" command), and % CR LF escaped as GitHub Actions expects.
export function annotation(text) {
  return safeOutput(text).replace(/\r?\n/g, ' ').replace(/%/g, '%25').replace(/\r/g, '%0D')
}

// Schema errors about external data, without the data: a rejected value is named by its
// path only, then anything left that looks sensitive (a key name, say) is redacted.
export function withholdValues(message) {
  return safeOutput(String(message).replace(/: (?:"(?:[^"\\]|\\.)*"|-?\d[\d.eE+-]*|true|false|null) (does not match|is not one of|is not an ISO|is not a valid URL)/, ': (value withheld) $1'))
}

export function parseSemver(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(v || '')
  return m ? { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] || null } : null
}

export function compareSemver(a, b) {
  const x = parseSemver(a)
  const y = parseSemver(b)
  if (!x || !y) throw new Error(`cannot compare versions ${a} and ${b}`)
  for (const k of ['major', 'minor', 'patch']) if (x[k] !== y[k]) return x[k] - y[k]
  if (x.pre === y.pre) return 0
  if (!x.pre) return 1
  if (!y.pre) return -1
  return x.pre < y.pre ? -1 : 1
}

// Minimal glob: ** matches across directories, * within one segment, ? one character.
export function globToRegExp(glob) {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*' && glob[i + 1] === '*') {
      re += '.*'
      i++
      if (glob[i + 1] === '/') i++
    } else if (c === '*') re += '[^/]*'
    else if (c === '?') re += '[^/]'
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`)
}

export function effectiveConfig(fileConfig) {
  const r = (fileConfig && fileConfig.reporting) || {}
  const c = { ...DEFAULT_CONFIG }
  for (const k of Object.keys(DEFAULT_CONFIG)) if (r[k] !== undefined) c[k] = r[k]
  return c
}

export function workflowFile(path) {
  return String(path || '').split('/').pop()
}

export function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}
