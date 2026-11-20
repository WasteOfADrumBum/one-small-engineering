#!/usr/bin/env node
// ose ai: install, sync, check and roll back the shared AI engineering standards.
// Usage: node scripts/ose.mjs ai <command> [options]   (or `ose ai ...` after npm link)
// Docs: docs/ai-standards.md. Exit codes: 0 ok, 1 conflicts or failed checks, 2 usage error.

import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { SOURCE_DIR, TMP_SUFFIX, UsageError, bumpVersion, normalizeUserPath, readJsonFile, repoSlug, serializeJson, sha256, normalizeEol } from './lib.mjs'
import { requireValidSource, loadSource, renderBlock, renderChatgpt, adapterById } from './source.mjs'
import { planSync, resolution } from './plan.mjs'
import { applyPlan, readTarget, isSourceRepository } from './apply.mjs'
import { planRollback, applyRollback } from './rollback.mjs'
import { discoverRepos, readRemote } from './discover.mjs'
import { loadRegistry, saveRegistry, resolveWorkspace, entryById, entryBySlug, locate, newEntry, recordInstallation } from './registry.mjs'
import { validateSource, validateTarget } from './validate.mjs'

const HELP = `ose ai: shared AI engineering standards from One Small Engineering

Commands
  discover   [--workspace <dir>]                 list git repositories and their eligibility
  register   --target <dir> [--id <id>] [--adapters a,b]   add a repository to the registry
  unregister --id <id>                           remove a registry entry (files are untouched)
  install    --target <dir|id> [--adapters a,b] [--dry-run] [--no-register]
  sync       --target <dir|id> | --all  [--dry-run] [--overwrite <path>]... [--allow-downgrade]
  status     [--target <dir|id> | --all]         applied policy version per repository (live)
  validate   [--source] [--target <dir|id> | --all]
  rollback   --target <dir|id> [--dry-run]       undo the most recent sync of a repository
  render     --adapter <id> [--target <dir|id>]  print generated instructions (ChatGPT, global files)
  bump       --level <patch|minor|major> [--dry-run]   maintainers: new policy version + checksums

Common options
  --workspace <dir>  workspace root (default: OSE_WORKSPACE, else the folder that contains this hub)
  --json             machine-readable output
Adapters: claude (CLAUDE.md), codex (AGENTS.md), copilot (.github/copilot-instructions.md),
          gemini (GEMINI.md, only if present), chatgpt (.ai/chatgpt-project-instructions.md)`

const BOOLEAN = new Set(['all', 'dry-run', 'json', 'source', 'allow-downgrade', 'no-register', 'help'])
const REPEAT = new Set(['overwrite'])

export function parseArgs(argv) {
  const out = { _: [], overwrite: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) { out._.push(a); continue }
    let [key, val] = a.slice(2).split(/=(.*)/s, 2)
    if (BOOLEAN.has(key)) { if (val !== undefined) throw new UsageError(`--${key} takes no value`); out[key] = true; continue }
    if (val === undefined) {
      val = argv[++i]
      if (val === undefined || val.startsWith('--')) throw new UsageError(`--${key} needs a value`)
    }
    if (REPEAT.has(key)) out[key].push(val)
    else if (Object.hasOwn(out, key)) throw new UsageError(`--${key} given twice`)
    else out[key] = val
  }
  return out
}

const KNOWN = {
  discover: ['workspace', 'json'], register: ['target', 'id', 'name', 'adapters', 'workspace', 'json'], unregister: ['id', 'json'],
  install: ['target', 'adapters', 'dry-run', 'no-register', 'workspace', 'json', 'overwrite'],
  sync: ['target', 'all', 'dry-run', 'overwrite', 'allow-downgrade', 'adapters', 'workspace', 'json'],
  status: ['target', 'all', 'workspace', 'json'], validate: ['source', 'target', 'all', 'workspace', 'json'],
  rollback: ['target', 'dry-run', 'workspace', 'json'], render: ['adapter', 'target', 'workspace'], bump: ['level', 'dry-run', 'json']
}

function makeCtx(args, env) {
  const ctx = { args, env, out: [], json: Boolean(args.json), sourceDir: env.OSE_SOURCE_DIR || SOURCE_DIR }
  ctx.workspace = resolveWorkspace({ flag: args.workspace, env })
  ctx.registry = loadRegistry(env.OSE_REGISTRY || join(ctx.sourceDir, 'registry.json'))
  let discovered = null
  ctx.discovered = () => discovered || (discovered = discoverRepos(ctx.workspace, ctx.registry.data.discovery))
  ctx.print = line => ctx.out.push(line)
  return ctx
}

// --target accepts a folder (relative or absolute, quoted Windows paths included) or a registry id.
function resolveTarget(ctx, value) {
  if (!value) throw new UsageError('--target is required')
  const asPath = normalizeUserPath(value)
  if (existsSync(asPath)) return { root: asPath, entry: entryBySlug(ctx.registry, repoSlug(readRemote(asPath))) }
  const entry = entryById(ctx.registry, value)
  if (entry) {
    const root = locate(entry, ctx.discovered(), ctx.workspace)
    if (!root || !existsSync(root)) throw new Error(`registered repository ${entry.id} (${entry.repository}) was not found under ${ctx.workspace}`)
    return { root, entry }
  }
  throw new UsageError(`--target ${value}: no such folder and no registry id`)
}

const adaptersArg = v => (v ? v.split(',').map(s => s.trim()).filter(Boolean) : null)
const SYMBOL = { create: '+', update: '~', remove: '-', unchanged: '=', conflict: '!', skip: '.' }

function describePlan(ctx, label, plan, dryRun) {
  ctx.print(`${label}: policy ${plan.fromVersion ?? 'none'} -> ${plan.toVersion}${dryRun ? ' (dry run, nothing written)' : ''}`)
  for (const a of plan.actions) if (a.op !== 'unchanged') ctx.print(`  ${SYMBOL[a.op]} ${a.op.padEnd(9)} ${a.path}  (${a.reason})`)
  if (!plan.changed && !plan.conflicts.length) ctx.print('  up to date; nothing to change')
  for (const c of plan.conflicts) ctx.print(`  resolve: ${resolution(c, label)}`)
}

function runSyncOne(ctx, source, { root, entry }, mode) {
  const label = entry ? entry.id : root
  if (isSourceRepository(root, source)) {
    return { label, status: 'skipped', message: 'this is the policy source (One Small Engineering); it uses ai-standards/ directly and is never installed into' }
  }
  const target = readTarget(root, source)
  if (entry && entry.name) target.detected.projectName = entry.name
  const installed = target.files['.ai/manifest.json'] !== null
  if (mode === 'sync' && !installed) return { label, status: 'not-installed', message: `not installed; run: ose ai install --target ${label}` }
  const adapters = adaptersArg(ctx.args.adapters) || (!installed && entry ? entry.adapters : null)
  const plan = planSync(source, target, { adapters, overwrite: ctx.args.overwrite, allowDowngrade: ctx.args['allow-downgrade'] })
  const dry = Boolean(ctx.args['dry-run'])
  const result = { label, root, fromVersion: plan.fromVersion, toVersion: plan.toVersion, actions: plan.actions.map(({ path, op, reason }) => ({ path, op, reason })), conflicts: plan.conflicts.map(c => ({ path: c.path, reason: c.reason, resolve: resolution(c, label) })) }
  if (!ctx.json) describePlan(ctx, label, plan, dry)
  if (plan.conflicts.length) return { ...result, status: 'conflict' }
  if (dry) return { ...result, status: plan.changed ? 'would-change' : 'up-to-date' }
  const applied = applyPlan(root, plan, { keep: source.manifest.history.keep })
  const check = validateTarget(root, source)
  if (!ctx.json) {
    if (applied.written) ctx.print(`  applied ${applied.written} write(s); rollback point ${applied.snapshot}`)
    ctx.print(`  validate: ${check.status}${check.problems.length ? ` (${check.problems.join('; ')})` : ''}`)
  }
  return { ...result, status: applied.written ? 'changed' : 'up-to-date', snapshot: applied.snapshot, validation: check.status, problems: check.problems }
}

function record(ctx, entry, res, source) {
  if (!entry || ctx.args['dry-run']) return false
  const status = res.status === 'conflict' ? 'conflict' : res.status === 'error' ? 'error' : ['changed', 'up-to-date'].includes(res.status) ? 'installed' : null
  if (!status) return false
  return recordInstallation(entry, {
    status,
    policyVersion: status === 'installed' ? source.manifest.policyVersion : undefined,
    synced: res.status === 'changed',
    validation: res.validation
  })
}

function registerEntry(ctx, root, { id, name, adapters }) {
  const slug = repoSlug(readRemote(root))
  if (!slug) throw new Error(`${root} has no GitHub remote; the registry matches repositories by remote. Add one, or skip registration with --no-register.`)
  const existing = entryBySlug(ctx.registry, slug)
  if (existing) return { entry: existing, added: false }
  const remote = readRemote(root)
  const repoName = /github\.com[:/]+([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/i.exec(remote)[1]
  const newId = id || repoName.split('/')[1].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  if (entryById(ctx.registry, newId)) throw new UsageError(`registry id ${newId} is taken; pass --id`)
  const entry = newEntry({ id: newId, name: name || undefined, repository: repoName, adapters: adapters || loadSource(ctx.sourceDir).manifest.defaultAdapters })
  if (!entry.name) delete entry.name
  ctx.registry.data.repositories.push(entry)
  ctx.registry.data.repositories.sort((a, b) => a.id.localeCompare(b.id))
  return { entry, added: true }
}

const commands = {
  discover(ctx) {
    const source = loadSource(ctx.sourceDir)
    const rows = ctx.discovered().map(d => {
      const entry = entryBySlug(ctx.registry, d.slug)
      const isSource = isSourceRepository(d.path, source)
      const instr = ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md', '.github/copilot-instructions.md'].filter(f => existsSync(join(d.path, f)))
      const installed = existsSync(join(d.path, '.ai/manifest.json'))
      const eligibility = isSource ? 'source (never installed into)' : !d.slug ? 'not eligible: no GitHub remote' : entry ? (entry.enabled ? 'registered' : 'registered, disabled') : 'candidate (not registered; nothing is changed until you register it)'
      return { path: d.path, repository: d.slug, registryId: entry ? entry.id : null, installed, instructionFiles: instr, eligibility }
    })
    if (ctx.json) return { result: rows }
    ctx.print(`workspace: ${ctx.workspace}`)
    for (const r of rows) ctx.print(`- ${r.path}\n    ${r.repository || 'no remote'} | ${r.eligibility}${r.installed ? ' | installed' : ''} | instructions: ${r.instructionFiles.join(', ') || 'none'}`)
    const missing = ctx.registry.data.repositories.filter(e => e.enabled && !rows.some(r => r.registryId === e.id) && !e.path)
    for (const e of missing) ctx.print(`- registered but not found here: ${e.id} (${e.repository})`)
    return { result: rows }
  },

  register(ctx) {
    const root = normalizeUserPath(ctx.args.target || '')
    if (!existsSync(root)) throw new UsageError(`--target ${ctx.args.target}: not a folder`)
    const { entry, added } = registerEntry(ctx, root, { id: ctx.args.id, name: ctx.args.name, adapters: adaptersArg(ctx.args.adapters) })
    if (added) saveRegistry(ctx.registry)
    ctx.print(added ? `registered ${entry.id} (${entry.repository})` : `already registered as ${entry.id}`)
    return { result: { id: entry.id, added } }
  },

  unregister(ctx) {
    const i = ctx.registry.data.repositories.findIndex(r => r.id === ctx.args.id)
    if (i === -1) throw new UsageError(`no registry entry ${ctx.args.id}`)
    ctx.registry.data.repositories.splice(i, 1)
    saveRegistry(ctx.registry)
    ctx.print(`unregistered ${ctx.args.id}; files in the repository were not touched`)
    return { result: { id: ctx.args.id } }
  },

  install(ctx) {
    const source = requireValidSource(ctx.sourceDir)
    const t = resolveTarget(ctx, ctx.args.target)
    if (!t.entry && !ctx.args['no-register'] && !ctx.args['dry-run'] && !isSourceRepository(t.root, source)) {
      const reg = registerEntry(ctx, t.root, { adapters: adaptersArg(ctx.args.adapters) })
      t.entry = reg.entry
      if (reg.added) ctx.print(`registered ${reg.entry.id} (${reg.entry.repository})`)
    }
    const res = runSyncOne(ctx, source, t, 'install')
    if (res.message) ctx.print(`${res.label}: ${res.message}`)
    if (record(ctx, t.entry, res, source) || (t.entry && !ctx.args['dry-run'])) saveRegistry(ctx.registry)
    return { result: res, code: ['conflict', 'error'].includes(res.status) || res.validation === 'fail' ? 1 : 0 }
  },

  sync(ctx) {
    const source = requireValidSource(ctx.sourceDir)
    if (!ctx.args.all && !ctx.args.target) throw new UsageError('sync needs --target <dir|id> or --all')
    if (ctx.args.all && ctx.args.target) throw new UsageError('use --target or --all, not both')
    if (ctx.args.all && ctx.args.overwrite.length) throw new UsageError('--overwrite only works with a single --target')
    const targets = []
    if (ctx.args.all) {
      for (const entry of ctx.registry.data.repositories.filter(e => e.enabled)) {
        const root = locate(entry, ctx.discovered(), ctx.workspace)
        targets.push(root && existsSync(root) ? { root, entry } : { missing: true, entry })
      }
    } else targets.push(resolveTarget(ctx, ctx.args.target))
    const results = []
    for (const t of targets) {
      if (t.missing) { const r = { label: t.entry.id, status: 'not-found', message: `not found under ${ctx.workspace}` }; ctx.print(`${r.label}: ${r.message}`); results.push(r); continue }
      let res
      try { res = runSyncOne(ctx, source, t, 'sync') } catch (e) { res = { label: t.entry ? t.entry.id : t.root, status: 'error', message: e.message } }
      if (res.message) ctx.print(`${res.label}: ${res.message}`)
      record(ctx, t.entry, res, source)
      results.push(res)
    }
    if (!ctx.args['dry-run']) saveRegistry(ctx.registry)
    const bad = results.filter(r => ['conflict', 'error'].includes(r.status) || r.validation === 'fail')
    if (!ctx.json && targets.length > 1) {
      const count = s => results.filter(r => r.status === s).length
      ctx.print(`summary: ${count('changed') + count('would-change')} changed, ${count('up-to-date')} up to date, ${count('conflict')} conflict, ${count('error')} error, ${count('not-found') + count('not-installed')} skipped`)
    }
    return { result: results, code: bad.length ? 1 : 0 }
  },

  status(ctx) {
    const source = loadSource(ctx.sourceDir)
    const rows = []
    const one = (label, root, entry) => {
      if (!root || !existsSync(root)) return rows.push({ id: label, repository: entry?.repository, state: 'not found locally' })
      const v = validateTarget(root, source)
      rows.push({ id: label, repository: entry?.repository, path: root, state: v.installed ? 'installed' : 'not installed', policyVersion: v.policyVersion || null, current: v.policyVersion === source.manifest.policyVersion, validation: v.installed ? v.status : 'n/a', problems: v.problems, warnings: v.warnings })
    }
    if (ctx.args.target) { const t = resolveTarget(ctx, ctx.args.target); one(t.entry ? t.entry.id : t.root, t.root, t.entry) } else {
      for (const e of ctx.registry.data.repositories) one(e.id, locate(e, ctx.discovered(), ctx.workspace), e)
    }
    if (ctx.json) return { result: { sourceVersion: source.manifest.policyVersion, repositories: rows } }
    ctx.print(`source policy ${source.manifest.policyVersion}  (workspace ${ctx.workspace})`)
    for (const r of rows) {
      ctx.print(`- ${r.id}: ${r.state}${r.policyVersion ? ` ${r.policyVersion}${r.current ? '' : ' (update available)'}` : ''}${r.validation && r.validation !== 'n/a' ? ` | ${r.validation}` : ''}`)
      for (const p of r.problems || []) if (r.state === 'installed') ctx.print(`    ! ${p}`)
    }
    return { result: rows }
  },

  validate(ctx) {
    const results = []
    let code = 0
    if (ctx.args.source || (!ctx.args.target && !ctx.args.all)) {
      const v = validateSource(ctx.sourceDir)
      results.push({ target: 'source', status: v.problems.length ? 'fail' : v.warnings.length ? 'warn' : 'pass', problems: v.problems, warnings: v.warnings })
      if (v.problems.length) code = 1
    }
    if (ctx.args.target || ctx.args.all) {
      const source = requireValidSource(ctx.sourceDir)
      const targets = ctx.args.target ? [resolveTarget(ctx, ctx.args.target)] : ctx.registry.data.repositories.filter(e => e.enabled).map(e => ({ root: locate(e, ctx.discovered(), ctx.workspace), entry: e }))
      for (const t of targets) {
        const label = t.entry ? t.entry.id : t.root
        if (!t.root || !existsSync(t.root)) { results.push({ target: label, status: 'not-found', problems: [`not found under ${ctx.workspace}`], warnings: [] }); continue }
        const v = validateTarget(t.root, source)
        results.push({ target: label, status: v.status, problems: v.problems, warnings: v.warnings })
        if (v.status === 'fail') code = 1
        if (t.entry) recordInstallation(t.entry, { validation: v.status })
      }
      saveRegistry(ctx.registry)
    }
    if (!ctx.json) for (const r of results) {
      ctx.print(`${r.target}: ${r.status}`)
      for (const p of r.problems) ctx.print(`  ! ${p}`)
      for (const w of r.warnings) ctx.print(`  ~ ${w}`)
    }
    return { result: results, code }
  },

  rollback(ctx) {
    const t = resolveTarget(ctx, ctx.args.target)
    const label = t.entry ? t.entry.id : t.root
    const plan = planRollback(t.root)
    if (!plan.snapshot) { ctx.print(`${label}: ${plan.message}`); return { result: { status: 'nothing-to-roll-back' }, code: 1 } }
    ctx.print(`${label}: roll back ${plan.fromVersion} -> ${plan.toVersion ?? 'not installed'} (snapshot ${plan.snapshot})${ctx.args['dry-run'] ? ' (dry run, nothing written)' : ''}`)
    for (const o of plan.ops) ctx.print(`  ${o.content === null ? '- remove ' : '~ restore'} ${o.path}`)
    for (const k of plan.kept) ctx.print(`  = keep    ${k.path}  (${k.reason})`)
    for (const c of plan.conflicts) ctx.print(`  ! conflict ${c.path}  (${c.reason}); nothing was rolled back`)
    if (plan.conflicts.length) return { result: { status: 'conflict', conflicts: plan.conflicts }, code: 1 }
    if (ctx.args['dry-run']) return { result: { status: 'would-roll-back', ops: plan.ops.map(o => o.path) } }
    const r = applyRollback(t.root, plan)
    if (t.entry) {
      const manifest = existsSync(join(t.root, '.ai/manifest.json')) ? readJsonFile(join(t.root, '.ai/manifest.json')) : null
      recordInstallation(t.entry, { status: manifest ? 'installed' : 'not-installed', policyVersion: manifest ? manifest.policyVersion : null, synced: true, validation: manifest ? validateTarget(t.root, requireValidSource(ctx.sourceDir)).status : 'unknown' })
      saveRegistry(ctx.registry)
    }
    ctx.print(`  rolled back (${r.written} step(s))`)
    return { result: { status: 'rolled-back', snapshot: plan.snapshot } }
  },

  render(ctx) {
    const source = requireValidSource(ctx.sourceDir)
    const a = adapterById(source, ctx.args.adapter)
    if (!a) throw new UsageError(`unsupported adapter ${ctx.args.adapter}; use one of ${source.manifest.adapters.map(x => x.id).join(', ')}`)
    let text
    if (a.kind === 'block') text = renderBlock(source, a.id) + '\n'
    else {
      let projectMd = null
      let projectName = 'All projects'
      if (ctx.args.target) {
        const t = resolveTarget(ctx, ctx.args.target)
        const p = join(t.root, '.ai/project.md')
        projectMd = existsSync(p) ? readFileSync(p, 'utf8') : null
        projectName = /^# Project rules: (.+)$/m.exec(normalizeEol(projectMd || ''))?.[1] || t.root.split(/[\\/]/).pop()
      }
      text = renderChatgpt(source, { projectName, projectMd })
    }
    ctx.print(text.replace(/\n$/, ''))
    return { result: { adapter: a.id, characters: text.length } }
  },

  bump(ctx) {
    const level = ctx.args.level
    if (!level) throw new UsageError('bump needs --level patch|minor|major')
    const file = join(ctx.sourceDir, 'manifest.json')
    const manifest = readJsonFile(file)
    const next = bumpVersion(manifest.policyVersion, level)
    const changed = []
    for (const list of [manifest.policies, manifest.templates]) for (const e of list) {
      const p = resolve(ctx.sourceDir, e.file)
      if (!existsSync(p)) throw new Error(`missing ${e.file}`)
      const h = sha256(readFileSync(p, 'utf8'))
      if (h !== e.sha256) { changed.push(e.file); e.sha256 = h }
    }
    manifest.policyVersion = next
    ctx.print(`policy ${next}${changed.length ? `; checksums updated for ${changed.join(', ')}` : '; no content changed'}${ctx.args['dry-run'] ? ' (dry run)' : ''}`)
    if (!ctx.args['dry-run']) {
      writeFileSync(file + TMP_SUFFIX, serializeJson(manifest))
      renameSync(file + TMP_SUFFIX, file)
      ctx.print('next: add an entry to ai-standards/CHANGELOG.md, run npm run check, open a PR; after merge run ose ai sync --all')
    }
    return { result: { policyVersion: next, changed } }
  }
}

export function run(argv, env = process.env) {
  let args
  try {
    args = parseArgs(argv)
    const [scope, cmd] = args._
    if (args.help || !scope || scope === 'help') return { code: 0, stdout: HELP }
    if (scope !== 'ai') throw new UsageError(`unknown command group "${scope}"; try: ose ai help`)
    if (!cmd || cmd === 'help') return { code: 0, stdout: HELP }
    if (!commands[cmd]) throw new UsageError(`unknown command "ai ${cmd}"`)
    for (const k of Object.keys(args)) if (k !== '_' && !(k === 'overwrite' && !args.overwrite.length) && !KNOWN[cmd].includes(k)) throw new UsageError(`--${k} is not an option of ai ${cmd}`)
    if (args._.length > 2) throw new UsageError(`unexpected argument "${args._[2]}"`)
    const ctx = makeCtx(args, env)
    const { result, code = 0 } = commands[cmd](ctx)
    return { code, stdout: ctx.json ? JSON.stringify(result, null, 2) : ctx.out.join('\n'), result }
  } catch (e) {
    if (e instanceof UsageError) return { code: 2, stderr: `error: ${e.message}\n\n${HELP}` }
    return { code: 1, stderr: `error: ${e.message}` }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const r = run(process.argv.slice(2))
  if (r.stdout) console.log(r.stdout)
  if (r.stderr) console.error(r.stderr)
  process.exitCode = r.code
}
