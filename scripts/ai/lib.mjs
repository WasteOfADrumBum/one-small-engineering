// Shared helpers for the AI engineering standards system (docs/ai-standards.md).
// Node built-ins only. Nothing here touches the file system except readJsonFile.

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve, posix, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'

export const HUB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const SOURCE_DIR = resolve(HUB_ROOT, 'ai-standards')
export const TARGET_DIR = '.ai'
export const TARGET_MANIFEST = '.ai/manifest.json'
export const PROJECT_FILE = '.ai/project.md'
export const HISTORY_DIR = '.ai/history'
export const LOCK_FILE = '.ai/.lock'
export const TMP_SUFFIX = '.ose-tmp'

export const BLOCK_NAME = 'ai-standards'
export const BLOCK_VERSION = 1
export const BLOCK_START = `<!-- one-small-engineering:${BLOCK_NAME} v${BLOCK_VERSION} -->`
export const BLOCK_END = `<!-- /one-small-engineering:${BLOCK_NAME} -->`
const START_RE = /<!-- one-small-engineering:ai-standards v\d+ -->/
const END_LITERAL = BLOCK_END

export class UsageError extends Error {}

// Line endings are normalized before hashing or comparing, so a checkout with
// core.autocrlf=true on Windows is not mistaken for a local modification.
export const normalizeEol = text => String(text).replace(/\r\n/g, '\n')
export const sha256 = text => createHash('sha256').update(normalizeEol(text), 'utf8').digest('hex')
export const sameText = (a, b) => a !== null && b !== null && a !== undefined && b !== undefined && normalizeEol(a) === normalizeEol(b)

export function readJsonFile(path) {
  const text = readFileSync(path, 'utf8')
  try {
    return JSON.parse(text)
  } catch (e) {
    throw new Error(`${path} is not valid JSON: ${e.message}`)
  }
}

export const toPosix = p => p.split('\\').join('/')

// JSON in the layout Prettier produces (2 spaces; short arrays of primitives on one line;
// objects expanded), so repositories that run `prettier --check .` accept generated files.
export function serializeJson(value, width = 80) {
  const out = (v, indent, prefixLen) => {
    if (Array.isArray(v)) {
      if (!v.length) return '[]'
      if (v.every(x => x === null || typeof x !== 'object')) {
        const inline = `[${v.map(x => JSON.stringify(x)).join(', ')}]`
        if (prefixLen + inline.length + 1 <= width) return inline
      }
      const pad = indent + '  '
      return `[\n${v.map(x => pad + out(x, pad, pad.length)).join(',\n')}\n${indent}]`
    }
    if (v && typeof v === 'object') {
      const keys = Object.keys(v)
      if (!keys.length) return '{}'
      const pad = indent + '  '
      return `{\n${keys.map(k => { const head = `${pad}${JSON.stringify(k)}: `; return head + out(v[k], pad, head.length) }).join(',\n')}\n${indent}}`
    }
    return JSON.stringify(v)
  }
  return out(value, '', 0) + '\n'
}

// ---------------------------------------------------------------------------
// Marked blocks in instruction files
// ---------------------------------------------------------------------------

// Returns { state: 'absent' | 'present' | 'malformed', block, before, after }.
// block includes both markers and no trailing newline.
export function extractBlock(text) {
  if (text === null || text === undefined) return { state: 'absent', block: null }
  const t = normalizeEol(text)
  const m = START_RE.exec(t)
  const endAt = t.indexOf(END_LITERAL)
  if (!m && endAt === -1) return { state: 'absent', block: null }
  if (!m || endAt === -1 || endAt < m.index) return { state: 'malformed', block: null }
  if (t.indexOf(END_LITERAL, endAt + END_LITERAL.length) !== -1 || START_RE.exec(t.slice(m.index + m[0].length))) {
    return { state: 'malformed', block: null, reason: 'more than one ai-standards block' }
  }
  const end = endAt + END_LITERAL.length
  return { state: 'present', block: t.slice(m.index, end), before: t.slice(0, m.index), after: t.slice(end) }
}

const eolOf = text => (String(text).includes('\r\n') ? '\r\n' : '\n')
const withEol = (text, eol) => (eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text)

// Inserts or replaces the block, leaving every byte outside it as it was (apart from
// keeping one blank line between existing text and an appended block).
export function writeBlock(existing, block) {
  const b = normalizeEol(block).replace(/\n+$/, '')
  if (existing === null || existing === undefined || normalizeEol(existing).trim() === '') return b + '\n'
  const eol = eolOf(existing)
  const found = extractBlock(existing)
  if (found.state === 'malformed') throw new Error('an unterminated or duplicated ai-standards block exists; fix it by hand')
  let out
  if (found.state === 'present') out = found.before + b + found.after
  else out = normalizeEol(existing).replace(/\n*$/, '\n\n') + b + '\n'
  return withEol(out, eol)
}

// Removes the block and the blank line that separated it. Returns the remaining text.
export function removeBlock(existing) {
  const found = extractBlock(existing)
  if (found.state !== 'present') return existing
  const eol = eolOf(existing)
  let before = found.before.replace(/\n+$/, '')
  let after = found.after.replace(/^\n+/, '')
  let out = before && after ? `${before}\n\n${after}` : before || after
  if (out && !out.endsWith('\n')) out += '\n'
  return withEol(out, eol)
}

export const wrapBlock = body => `${BLOCK_START}\n\n${normalizeEol(body).trim()}\n\n${BLOCK_END}`

// ---------------------------------------------------------------------------
// Templates and front matter
// ---------------------------------------------------------------------------

export function renderTemplate(template, vars, name = 'template') {
  const out = template.replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9]*)\s*\}\}/g, (_, key) => {
    if (!Object.hasOwn(vars, key)) throw new Error(`${name}: unknown template variable {{${key}}}`)
    return String(vars[key])
  })
  if (/\{\{|\}\}/.test(out)) throw new Error(`${name}: unresolved template braces remain after rendering`)
  return out
}

export function parseFrontMatter(text) {
  const t = normalizeEol(text)
  if (!t.startsWith('---\n')) return { data: {}, body: t }
  const end = t.indexOf('\n---\n', 4)
  if (end === -1) throw new Error('front matter is not closed with ---')
  const data = {}
  for (const line of t.slice(4, end).split('\n')) {
    if (!line.trim()) continue
    const m = /^([a-zA-Z][\w-]*):\s*(.*)$/.exec(line)
    if (!m) throw new Error(`front matter line is not "key: value": ${line}`)
    data[m[1]] = m[2].trim()
  }
  return { data, body: t.slice(end + 5).replace(/^\n+/, '') }
}

// Bullets under "## Core rules", up to the next level-2 heading.
export function coreRules(body) {
  const lines = normalizeEol(body).split('\n')
  const start = lines.findIndex(l => /^##\s+Core rules\s*$/.test(l))
  if (start === -1) return []
  const out = []
  for (const line of lines.slice(start + 1)) {
    if (/^##\s/.test(line)) break
    if (/^- /.test(line)) out.push(line.slice(2).trim())
    else if (/^\s+\S/.test(line) && out.length) out[out.length - 1] += ' ' + line.trim()
  }
  return out
}

// ---------------------------------------------------------------------------
// Versions and paths
// ---------------------------------------------------------------------------

export const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
export function compareVersions(a, b) {
  const pa = SEMVER.exec(a)
  const pb = SEMVER.exec(b)
  if (!pa || !pb) throw new Error(`not a version: ${!pa ? a : b}`)
  for (let i = 1; i <= 3; i++) if (+pa[i] !== +pb[i]) return +pa[i] < +pb[i] ? -1 : 1
  return 0
}
export function bumpVersion(v, level) {
  const p = SEMVER.exec(v)
  if (!p) throw new Error(`not a version: ${v}`)
  const [maj, min, pat] = [+p[1], +p[2], +p[3]]
  if (level === 'major') return `${maj + 1}.0.0`
  if (level === 'minor') return `${maj}.${min + 1}.0`
  if (level === 'patch') return `${maj}.${min}.${pat + 1}`
  throw new UsageError(`--level must be major, minor or patch (got ${level})`)
}

// A path typed or pasted by a person: trims whitespace, strips the quotes Windows
// Explorer's "Copy as path" adds, and resolves it against cwd for the given platform.
export function normalizeUserPath(input, { platform = process.platform, cwd = process.cwd() } = {}) {
  if (typeof input !== 'string' || !input.trim()) throw new UsageError('a path is required')
  let p = input.trim()
  if ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'"))) p = p.slice(1, -1).trim()
  const lib = platform === 'win32' ? win32 : posix
  return lib.resolve(cwd, p)
}

// Owner/name from a git remote URL (https, ssh or scp-like). Lowercased for matching.
export function repoSlug(url) {
  if (!url) return null
  const m = /github\.com[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(String(url).trim())
  return m ? `${m[1]}/${m[2]}`.toLowerCase() : null
}

export function isoNow(now = new Date()) {
  return now.toISOString().replace(/\.\d{3}Z$/, 'Z')
}
