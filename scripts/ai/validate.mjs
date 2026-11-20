// Validation of the policy source (run in the hub's CI through the test suite) and of an
// installed repository (ose ai validate). Read-only: validation never modifies anything.

import { existsSync, readFileSync } from 'node:fs'
import { join, dirname, posix } from 'node:path'
import { validateAgainstSchema, findSensitive } from '../validate-registry.mjs'
import { SOURCE_DIR, TARGET_MANIFEST, PROJECT_FILE, compareVersions, extractBlock, normalizeEol, readJsonFile, sha256 } from './lib.mjs'
import { loadSource, renderBlock, renderChatgpt, renderProject, adapterById } from './source.mjs'
import { inside } from './apply.mjs'

export function validateSource(dir = SOURCE_DIR) {
  const source = loadSource(dir)
  const problems = [...source.problems]
  const warnings = []
  if (!problems.length) {
    for (const a of source.manifest.adapters) {
      try {
        const text = a.kind === 'block'
          ? renderBlock(source, a.id)
          : renderChatgpt(source, { projectName: 'Example', projectMd: renderProject(source, { projectName: 'Example', stack: [], commands: [], existingInstructions: [] }) })
        const s = findSensitive(text)
        if (s.length) problems.push(`adapter ${a.id}: rendered output contains possible sensitive data (${s.join(', ')})`)
        for (const ref of references(text)) {
          const id = /^\.ai\/shared\/([a-z0-9-]+)\.md$/.exec(ref)?.[1]
          if (id && !source.policies.some(p => p.id === id)) problems.push(`adapter ${a.id}: references ${ref}, which no policy provides`)
        }
        if (a.id === 'chatgpt' && text.length > source.manifest.limits.chatgptMaxChars) {
          warnings.push(`chatgpt output is ${text.length} characters, above limits.chatgptMaxChars (${source.manifest.limits.chatgptMaxChars}); upload it as a Project file instead of pasting`)
        }
      } catch (e) {
        problems.push(`adapter ${a.id}: ${e.message}`)
      }
    }
  }
  return { source, problems, warnings }
}

// Repository paths an instruction text points at: `.ai/...` in backticks and Markdown links.
export function references(text) {
  const refs = new Set()
  for (const m of normalizeEol(text).matchAll(/`(\.ai\/[A-Za-z0-9._/-]+)`/g)) if (!m[1].endsWith('/')) refs.add(m[1])
  for (const m of normalizeEol(text).matchAll(/\]\((\.ai\/[^)\s#]+)\)/g)) refs.add(m[1])
  return [...refs]
}

// Claude Code @imports form a graph; a cycle or a missing import is an error.
export function importCycles(root, start, read) {
  const problems = []
  const visit = (file, stack) => {
    if (stack.includes(file)) { problems.push(`circular @import: ${[...stack, file].join(' -> ')}`); return }
    const text = read(file)
    if (text === null) { if (stack.length) problems.push(`@import target missing: ${file} (from ${stack[stack.length - 1]})`); return }
    const body = normalizeEol(text).replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '')
    for (const m of body.matchAll(/(?:^|\s)@([A-Za-z0-9._/-]+\.md)\b/g)) {
      if (m[1].includes('@')) continue
      const next = posix.normalize(posix.join(posix.dirname(file), m[1]))
      if (next.startsWith('..')) continue
      visit(next, [...stack, file])
    }
  }
  visit(start, [])
  return problems
}

export function validateTarget(root, source) {
  const problems = []
  const warnings = []
  const read = rel => { const abs = inside(root, rel); return existsSync(abs) ? readFileSync(abs, 'utf8') : null }
  const raw = read(TARGET_MANIFEST)
  if (raw === null) return { status: 'fail', installed: false, problems: [`not installed: ${TARGET_MANIFEST} is missing`], warnings }
  let m
  try { m = JSON.parse(raw) } catch (e) { return { status: 'fail', installed: true, problems: [`${TARGET_MANIFEST} is not valid JSON: ${e.message}`], warnings } }
  const schema = readJsonFile(join(source.dir, 'schemas/installed-manifest.schema.json'))
  for (const e of validateAgainstSchema(m, schema)) problems.push(`${TARGET_MANIFEST} ${e}`)
  if (problems.length) return { status: 'fail', installed: true, problems, warnings }
  if (m.source.id !== source.manifest.id) problems.push(`source mismatch: installed from ${m.source.id}`)
  const cmp = compareVersions(m.policyVersion, source.manifest.policyVersion)
  if (cmp < 0) warnings.push(`policy ${m.policyVersion} is behind the source (${source.manifest.policyVersion}); run ose ai sync`)
  if (cmp > 0) problems.push(`policy ${m.policyVersion} is newer than this hub's source (${source.manifest.policyVersion}); update the hub (git pull)`)
  for (const [path, rec] of Object.entries(m.files)) {
    if (!rec || !/^[0-9a-f]{64}$/.test(rec.sha256 || '')) { problems.push(`${TARGET_MANIFEST}: bad checksum entry for ${path}`); continue }
    const text = read(path)
    if (text === null) problems.push(`missing managed file: ${path}`)
    else if (sha256(text) !== rec.sha256) problems.push(`managed file modified locally: ${path}`)
    else {
      const s = findSensitive(text)
      if (s.length) problems.push(`${path}: possible sensitive data (${s.join(', ')})`)
    }
  }
  const managedTexts = []
  for (const [path, rec] of Object.entries(m.blocks)) {
    const text = read(path)
    const found = extractBlock(text)
    if (text === null) { problems.push(`missing instruction file: ${path}`); continue }
    if (found.state !== 'present') { problems.push(`${path}: managed block ${found.state === 'malformed' ? 'is malformed' : 'is missing'}`); continue }
    if (sha256(found.block) !== rec.sha256) problems.push(`managed block modified locally: ${path}`)
    managedTexts.push([path, found.block])
  }
  for (const id of m.adapters) {
    const a = adapterById(source, id)
    if (!a) { problems.push(`unsupported adapter recorded: ${id}`); continue }
    if (a.kind === 'block' && !m.blocks[a.path] && read(a.path) !== null) problems.push(`${a.path}: adapter ${id} is selected but its block is not recorded`)
    if (a.kind === 'file' && !m.files[a.path]) problems.push(`${a.path}: adapter ${id} output is not recorded`)
  }
  if (read(PROJECT_FILE) === null) problems.push(`missing ${PROJECT_FILE} (project rules)`)
  for (const path of Object.keys(m.files)) { const t = read(path); if (t !== null) managedTexts.push([path, t]) }
  for (const [path, text] of managedTexts) {
    for (const ref of references(text)) if (read(ref) === null) problems.push(`${path}: broken reference to ${ref}`)
  }
  if (read('CLAUDE.md') !== null) problems.push(...importCycles(root, 'CLAUDE.md', read))
  const status = problems.length ? 'fail' : warnings.length ? 'warn' : 'pass'
  return { status, installed: true, policyVersion: m.policyVersion, adapters: m.adapters, problems, warnings }
}
