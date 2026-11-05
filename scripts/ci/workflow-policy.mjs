#!/usr/bin/env node
// Repository security policy checks (docs/ci-cd.md#security-validation). Deterministic and
// offline. Complements actionlint and zizmor with rules specific to this hub:
//
//   workflows  every action pinned to a full commit SHA; explicit permissions on the workflow and on
//              every job; a timeout on every job; checkout never persists credentials; no ${{ }}
//              expression inside a run script (values go through env:); no pull_request_target or
//              workflow_run; a workflow a pull request can trigger holds no write permission and no
//              secret; a job that runs project code (--execute) sets up the sandbox user first
//   package    no dependencies and no install-time lifecycle scripts (the hub runs on Node built-ins;
//              adding one is a reviewed decision that also adds a lockfile and dependency review)
//   scripts    no eval, new Function, shell execution or vm; only reviewed modules send GitHub
//              writes, each behind its own endpoint allowlist
//
// CLI: node scripts/ci/workflow-policy.mjs   (exit 1 and one line per problem)

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const PR_TRIGGERS = ['pull_request', 'merge_group']
const FORBIDDEN_TRIGGERS = ['pull_request_target', 'workflow_run']

// Modules allowed to send GitHub write requests, and the guard each one relies on.
export const WRITE_MODULES = {
  'scripts/sync/write.mjs': 'restrictWrites: sync/* branches, draft PRs into main, the status issue, Validate registry dispatch',
  'scripts/sync/automerge.mjs': 'restrictAutomergeWrites: mark ready, merge on exact head, comment, Registry sync dispatch',
  'scripts/verify/remediation.mjs': 'ALLOWED endpoint list: one draft PR on a new branch; manual, gated workflow only',
  'scripts/state/push.mjs': 'fast-forward-only checkpoint commit on a project branch; run by agents, never by a hub workflow'
}

function topLevelBlock(text, key) {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex(l => new RegExp(`^${key}:`).test(l))
  if (start === -1) return null
  const out = [lines[start]]
  for (const l of lines.slice(start + 1)) { if (/^\S/.test(l)) break; out.push(l) }
  return out
}

export function triggers(text) {
  const block = topLevelBlock(text, 'on')
  if (!block) return []
  const inline = /^on:\s*\[?([^\]]+)\]?\s*$/.exec(block[0])
  if (inline && inline[1].trim()) return inline[1].split(',').map(s => s.trim())
  return block.slice(1).map(l => /^ {2}([a-z_]+):/.exec(l)).filter(Boolean).map(m => m[1])
}

export function jobs(text) {
  const block = topLevelBlock(text, 'jobs')
  if (!block) return []
  const out = []
  for (const l of block.slice(1)) {
    const m = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(l)
    if (m) out.push({ id: m[1], lines: [] })
    else if (out.length) out[out.length - 1].lines.push(l)
  }
  return out.map(j => ({ ...j, text: j.lines.join('\n') }))
}

// The bodies of run: steps (block scalars and one-liners).
export function runScripts(text) {
  const lines = text.split(/\r?\n/)
  const out = []
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(?:- )?run:\s*(.*)$/.exec(lines[i])
    if (!m) continue
    if (/^[|>][-+]?\s*$/.test(m[2])) {
      const indent = m[1].length
      const body = []
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim() && lines[j].search(/\S/) <= indent) break
        body.push(lines[j])
      }
      out.push({ line: i + 1, body: body.join('\n') })
    } else out.push({ line: i + 1, body: m[2] })
  }
  return out
}

export function checkWorkflow(name, text) {
  const p = []
  const on = triggers(text)
  for (const t of on) if (FORBIDDEN_TRIGGERS.includes(t)) p.push(`${name}: trigger ${t} is not allowed (it runs with base-branch privileges on untrusted input)`)
  if (!topLevelBlock(text, 'permissions')) p.push(`${name}: no workflow-level permissions (use permissions: {} or contents: read)`)
  for (const m of text.matchAll(/^\s*(?:- )?uses:\s*([^\s#]+)/gm)) {
    const ref = m[1]
    if (ref.startsWith('./')) continue
    if (!/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/.test(ref)) p.push(`${name}: ${ref} is not pinned to a full commit SHA`)
  }
  const prTriggered = on.some(t => PR_TRIGGERS.includes(t))
  if (/^permissions:\s*write-all/m.test(text)) p.push(`${name}: permissions: write-all`)
  if (prTriggered && /\bsecrets\s*[.[]/.test(text)) p.push(`${name}: a workflow that pull requests can trigger must not reference secrets`)
  for (const j of jobs(text)) {
    if (!/^ {4}permissions:/m.test(j.text)) p.push(`${name}: job ${j.id} has no job-level permissions`)
    if (!/^ {4}timeout-minutes:\s*\d+/m.test(j.text)) p.push(`${name}: job ${j.id} has no timeout-minutes`)
    if (/^ {4}permissions:\s*write-all/m.test(j.text)) p.push(`${name}: job ${j.id} has permissions: write-all`)
    if ((/^ {6}[a-z-]+:\s*write\b/m.test(j.text) || /^ {4}permissions:\s*write-all/m.test(j.text)) && prTriggered) p.push(`${name}: job ${j.id} holds a write permission in a workflow that pull requests can trigger`)
    const exec = j.text.search(/(--execute|VERIFY_EXECUTE|ENGINEERING_EXECUTE)/)
    if (exec !== -1 && !(j.text.indexOf('sandbox-setup.sh') !== -1 && j.text.indexOf('sandbox-setup.sh') < exec)) p.push(`${name}: job ${j.id} runs project code without the sandbox user (scripts/ci/sandbox-setup.sh)`)
    const steps = j.text.split(/\n(?= {6}- )/)
    for (const s of steps) if (/uses:\s*actions\/checkout@/.test(s) && !/persist-credentials:\s*false/.test(s)) p.push(`${name}: job ${j.id} checks out with persisted credentials (set persist-credentials: false)`)
  }
  for (const r of runScripts(text)) if (/\$\{\{/.test(r.body)) p.push(`${name}:${r.line}: a run script contains a \${{ }} expression; pass the value through env: instead`)
  return p
}

export function checkPackage(pkg) {
  const p = []
  for (const k of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'bundledDependencies']) if (pkg[k] && Object.keys(pkg[k]).length) p.push(`package.json: ${k} added; the hub has no dependencies by design. Adding one needs a lockfile, npm ci --ignore-scripts and a dependency review step in validate.yml (docs/ci-cd.md#dependencies)`)
  for (const k of ['preinstall', 'install', 'postinstall', 'prepare', 'prepack', 'postpack']) if (pkg.scripts && pkg.scripts[k]) p.push(`package.json: lifecycle script "${k}" runs code at install time`)
  return p
}

const DANGEROUS = [
  [/\beval\s*\(/, 'eval'],
  [/\bnew\s+Function\s*\(/, 'new Function'],
  [/\bshell\s*:\s*true\b/, 'shell: true'],
  [/\b(?:execSync|exec)\s*\(\s*[`'"]/, 'shell command string (child_process exec)'],
  [/from\s+['"]node:vm['"]|require\(['"](?:node:)?vm['"]\)/, 'node:vm']
]
const WRITE_CALL = /\.request\(\s*['"](?:POST|PUT|PATCH|DELETE)['"]/

export function checkScript(rel, src) {
  const p = []
  // Comments may name the patterns they forbid: block comments and full-line // comments are ignored
  // (a trailing // comment on a code line is still scanned, which can only add a false positive).
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split(/\r?\n/).map(l => l.replace(/^\s*\/\/.*$/, '')).join('\n')
  for (const [re, what] of DANGEROUS) if (re.test(code)) p.push(`${rel}: uses ${what}`)
  if (WRITE_CALL.test(code) && !WRITE_MODULES[rel]) p.push(`${rel}: sends a GitHub write request but is not a reviewed write module (scripts/ci/workflow-policy.mjs WRITE_MODULES)`)
  return p
}

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

export function checkRepository(root = ROOT) {
  const problems = []
  const wfDir = join(root, '.github/workflows')
  for (const f of readdirSync(wfDir).filter(f => /\.ya?ml$/.test(f)).sort()) problems.push(...checkWorkflow(`.github/workflows/${f}`, readFileSync(join(wfDir, f), 'utf8')))
  problems.push(...checkPackage(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))))
  for (const full of walk(join(root, 'scripts')).filter(f => f.endsWith('.mjs') && !f.endsWith('.test.mjs'))) {
    const rel = relative(root, full).split('\\').join('/')
    if (rel === 'scripts/ci/workflow-policy.mjs') continue
    problems.push(...checkScript(rel, readFileSync(full, 'utf8')))
  }
  return problems
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const problems = checkRepository()
  for (const p of problems) console.log(`::error title=repository policy::${p}`)
  console.log(problems.length ? `policy: ${problems.length} problem(s)` : 'policy: workflows, package manifest and scripts pass')
  process.exitCode = problems.length ? 1 : 0
}
