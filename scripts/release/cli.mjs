#!/usr/bin/env node
// Release readiness, release preparation and the project completion dashboard.
//
//   node scripts/release/cli.mjs assess   [--project <id>] [--json]     print readiness
//   node scripts/release/cli.mjs dashboard                               write reports/dashboard.*
//   node scripts/release/cli.mjs prepare  --project <id>                 write reports/releases/<id>/<target>/*
//   node scripts/release/cli.mjs reports                                 all of the above for every project
//   node scripts/release/cli.mjs check                                   are the committed reports current?
//
// Options: --as-of <ISO time> (default: now; check uses the time recorded in the reports),
//          --stale-days <n> (default 30), --out <dir> (default reports).
//
// Read-only towards everything except --out: no network, no GitHub writes, and the registry is
// never modified. The registry must pass validation first; an invalid or unreadable registry
// produces no report (exit 1). Exit 2 is a usage error.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, dirname, join, relative, isAbsolute } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { validateText, parseDefinitionOfDone, redactSensitive } from '../validate-registry.mjs'
import { assessRegistry, ENGINE_VERSION, DEFAULT_STALE_DAYS, ReadinessInputError } from './engine.mjs'
import { renderDashboard, dashboardJson, renderProjectReport, projectJson, toJson } from './render.mjs'
import { prepareRelease } from './prepare.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const COMMANDS = new Set(['assess', 'dashboard', 'prepare', 'reports', 'check'])

export class UsageError extends Error {}

const lf = text => String(text).replace(/\r\n?/g, '\n')
export const sha256 = text => createHash('sha256').update(lf(text)).digest('hex')
const iso = d => d.toISOString().replace(/\.\d{3}Z$/, 'Z')

export function parseArgs(argv) {
  const [command, ...rest] = argv
  if (!COMMANDS.has(command)) throw new UsageError(`unknown command ${JSON.stringify(command || '')}; use ${[...COMMANDS].join(', ')}`)
  const opts = { command, project: null, asOf: null, staleDays: DEFAULT_STALE_DAYS, out: 'reports', json: false }
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    const value = () => {
      const v = rest[++i]
      if (v === undefined || v.startsWith('--')) throw new UsageError(`${a} needs a value`)
      return v
    }
    if (a === '--project') opts.project = value()
    else if (a === '--as-of') {
      const v = value()
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(v) || Number.isNaN(new Date(v).getTime())) throw new UsageError('--as-of must be a UTC time like 2026-10-26T02:00:00Z')
      opts.asOf = v
    } else if (a === '--stale-days') {
      const v = value()
      if (!/^[1-9]\d{0,3}$/.test(v)) throw new UsageError('--stale-days must be a whole number from 1 to 9999')
      opts.staleDays = Number(v)
    } else if (a === '--out') opts.out = value()
    else if (a === '--json') opts.json = true
    else throw new UsageError(`unknown option ${a}`)
  }
  if (command === 'prepare' && !opts.project) throw new UsageError('prepare needs --project <id>')
  return opts
}

// Changelog snapshots named in release/inputs.json, checked against their recorded sha256.
export function loadInputs(inputsText, readFile) {
  const out = new Map()
  if (!inputsText) return out
  let inputs
  try { inputs = JSON.parse(inputsText) } catch { throw new ReadinessInputError('release/inputs.json is not valid JSON') }
  for (const [id, c] of Object.entries((inputs && inputs.changelogs) || {})) {
    if (!c || typeof c.path !== 'string' || !/^[0-9a-f]{40}$/.test(c.commitSha || '') || !/^[0-9a-f]{64}$/.test(c.sha256 || '')) throw new ReadinessInputError(`release/inputs.json: changelog for ${id} needs path, commitSha and sha256`)
    if (isAbsolute(c.path) || c.path.split(/[\\/]/).includes('..')) throw new ReadinessInputError(`release/inputs.json: changelog path for ${id} must stay inside the repository`)
    const text = readFile(c.path)
    if (sha256(text) !== c.sha256) throw new ReadinessInputError(`release/inputs.json: ${c.path} does not match its recorded sha256; re-copy it from ${c.commitSha.slice(0, 7)} and update the hash`)
    out.set(id, { text, source: { path: c.path, url: c.url || null, commitSha: c.commitSha } })
  }
  return out
}

// Everything the reports command writes, as { relative path: content }. Pure.
export function generate({ registryText, schema, dodText, inputs = new Map(), asOf, staleDays = DEFAULT_STALE_DAYS, command = 'npm run release:reports', only = null, parts = ['dashboard', 'projects', 'releases'] }) {
  const errors = validateText(registryText, schema, { dod: parseDefinitionOfDone(lf(dodText)), now: new Date(asOf) })
  if (errors.length) throw new ReadinessInputError(`the registry is invalid; fix it first (npm run validate): ${errors.slice(0, 3).join('; ')}`)
  const registry = JSON.parse(registryText)
  if (only && !registry.projects.some(p => p.id === only)) throw new UsageError(`no project "${only}" in the registry`)
  const assessment = assessRegistry(registry, { dodText, asOf: new Date(asOf), staleDays })
  const meta = { command, asOf: assessment.asOf, staleDays, engineVersion: ENGINE_VERSION, registryHash: sha256(registryText) }
  const files = {}
  if (parts.includes('dashboard')) {
    files['dashboard.md'] = renderDashboard(assessment, meta)
    files['dashboard.json'] = toJson(dashboardJson(assessment, meta))
  }
  for (const p of assessment.projects) {
    if (only && p.id !== only) continue
    if (parts.includes('projects')) {
      files[`projects/${p.id}.md`] = renderProjectReport(p, meta)
      files[`projects/${p.id}.json`] = toJson(projectJson(p, meta))
    }
    if (parts.includes('releases') && (p.facts.targetVersion || only)) {
      const c = inputs.get(p.id)
      const prep = prepareRelease(p, meta, c ? { changelogText: c.text, changelogSource: c.source } : {})
      for (const [name, content] of Object.entries(prep.files)) files[`releases/${p.id}/${p.facts.targetVersion || 'unscoped'}/${name}`] = content
    }
  }
  return { assessment, meta, files }
}

function readInputs() {
  const path = resolve(ROOT, 'release/inputs.json')
  return loadInputs(existsSync(path) ? readFileSync(path, 'utf8') : null, p => readFileSync(resolve(ROOT, p), 'utf8'))
}

export function main(argv, { now = new Date(), log = console.log, error = console.error } = {}) {
  let opts
  try { opts = parseArgs(argv) } catch (e) {
    if (e instanceof UsageError) { error(`release: ${e.message}`); return 2 }
    throw e
  }
  const outDir = resolve(ROOT, opts.out)
  try {
    const registryText = readFileSync(resolve(ROOT, 'projects/registry.json'), 'utf8')
    const schema = JSON.parse(readFileSync(resolve(ROOT, 'projects/registry.schema.json'), 'utf8'))
    const dodText = readFileSync(resolve(ROOT, 'standards/definition-of-done.md'), 'utf8')
    let asOf = opts.asOf
    if (!asOf && opts.command === 'check') {
      const recorded = join(outDir, 'dashboard.json')
      if (!existsSync(recorded)) { error(`release: no ${relative(ROOT, recorded)} to check; run npm run release:reports`); return 1 }
      asOf = JSON.parse(readFileSync(recorded, 'utf8')).asOf
    }
    asOf = asOf || iso(now)
    const parts = { assess: ['projects'], dashboard: ['dashboard'], prepare: ['releases'], reports: ['dashboard', 'projects', 'releases'], check: ['dashboard', 'projects', 'releases'] }[opts.command]
    const command = opts.command === 'check' ? 'npm run release:reports' : `npm run release:${opts.command}`
    const { assessment, meta, files } = generate({ registryText, schema, dodText, inputs: readInputs(), asOf, staleDays: opts.staleDays, command, only: opts.project, parts })

    if (opts.command === 'assess') {
      if (opts.json) log(toJson({ kind: 'one-small-engineering/readiness', ...meta, projects: assessment.projects.filter(p => !opts.project || p.id === opts.project) }).trimEnd())
      else log(Object.entries(files).filter(([k]) => k.endsWith('.md')).map(([, v]) => v).join('\n'))
      return 0
    }
    if (opts.command === 'check') {
      const stale = Object.entries(files).filter(([k, v]) => { const f = join(outDir, k); return !existsSync(f) || lf(readFileSync(f, 'utf8')) !== v }).map(([k]) => k)
      if (stale.length) {
        error(`release: ${stale.length} report file(s) differ from the registry as of ${asOf}: ${stale.join(', ')}. Run npm run release:reports.`)
        return 1
      }
      log(`release: reports are current for the registry as of ${asOf}`)
      return 0
    }
    for (const [k, v] of Object.entries(files)) {
      const f = join(outDir, k)
      mkdirSync(dirname(f), { recursive: true })
      writeFileSync(f, v)
    }
    log(`release: wrote ${Object.keys(files).length} file(s) to ${relative(ROOT, outDir) || '.'} as of ${asOf}`)
    return 0
  } catch (e) {
    if (e instanceof UsageError) { error(`release: ${e.message}`); return 2 }
    if (e instanceof ReadinessInputError || e.code === 'ENOENT' || e instanceof SyntaxError) { error(redactSensitive(`release: ${e.message}`)); return 1 }
    throw e
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2))
}
