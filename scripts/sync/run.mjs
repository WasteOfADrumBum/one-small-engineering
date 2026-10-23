#!/usr/bin/env node
// Registry sync entry point.
//
//   node scripts/sync/run.mjs collect [--project <id>] [--out <file>]
//       Read-only. Collects observations for every sync-enabled project.
//   node scripts/sync/run.mjs write --in <file> --mode dry-run|write
//       Plans, guards, validates and (in write mode) opens or refreshes draft sync PRs.
//   node scripts/sync/run.mjs preview [--project <id>]
//       Local, read-only: collect + plan, prints the report, writes out/sync/. Never writes to GitHub.
//
// Triggers (schedule, manual, and later an event such as repository_dispatch) all end
// here with an optional project filter. The run is level-triggered: it reconciles
// current GitHub state, so a missed or duplicated trigger changes nothing.

import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { validateRegistry, parseDefinitionOfDone } from '../validate-registry.mjs'
import { createClient } from './github.mjs'
import { collect, SyncError } from './collect.mjs'
import { plan } from './plan.mjs'
import { writeSync, closeStale, listSyncPrs, upsertStatusIssue, readStatusIssueBody, checkProposal, WriteRefused } from './write.mjs'
import { renderStatus, renderPrBody, parseState } from './status.mjs'
import { ROOT, REGISTRY_PATH, SLUG, OWNER, HUB_REPO, readJson, serializeRegistry, isoSeconds } from './lib.mjs'

function loadRegistry() {
  return JSON.parse(readFileSync(resolve(ROOT, REGISTRY_PATH), 'utf8'))
}

function validator() {
  const schema = readJson('projects/registry.schema.json')
  const dod = parseDefinitionOfDone(readFileSync(resolve(ROOT, 'standards/definition-of-done.md'), 'utf8'))
  return registry => validateRegistry(registry, schema, { dod })
}

export function selectProjects(registry, only) {
  if (only && !SLUG.test(only)) throw new Error(`invalid --project value "${only}"`)
  const enabled = registry.projects.filter(p => p.sync && p.sync.enabled)
  if (!only) return enabled
  const p = enabled.find(x => x.id === only)
  if (!p) throw new Error(`project "${only}" is not sync-enabled in the registry`)
  return [p]
}

// Reads every selected project. Errors are per project and never stop the others.
export async function collectAll({ registry, only, clients, now = new Date() }) {
  const out = []
  for (const project of selectProjects(registry, only)) {
    const isPrivate = project.visibility !== 'public'
    const client = isPrivate ? clients.privateReader : clients.publicReader
    try {
      if (!client) throw new SyncError('needs-reader-token', 'private repository: the read-only reader credential is not configured')
      out.push({ projectId: project.id, ok: true, observation: await collect({ project, client, now }) })
    } catch (e) {
      out.push({ projectId: project.id, ok: false, error: { code: e.code || 'collect-failed', message: e.message } })
    }
  }
  return out
}

// Plans every collected project and, in write mode, writes. Returns per-project results.
export async function processAll({ registry, collected, mode, hubClient, mainSha, validate, outDir }) {
  const results = []
  for (const item of collected) {
    const r = { projectId: item.projectId, outcome: 'unchanged', changes: [], suggestions: [], notes: [], errors: [], pr: null, prAction: null }
    results.push(r)
    if (!item.ok) {
      r.outcome = 'error'
      r.errors.push(`${item.error.code}: ${item.error.message}`)
      continue
    }
    try {
      const planned = plan(registry, item.observation)
      Object.assign(r, { changes: planned.changes, suggestions: planned.suggestions, notes: planned.notes })
      if (planned.notes.some(n => n.startsWith('Paused'))) r.outcome = 'paused'
      if (!planned.changed) {
        if (mode === 'write' && r.outcome !== 'paused') {
          const closed = await closeStale({ client: hubClient, projectId: item.projectId })
          if (closed.action === 'closed') { r.pr = closed.pr; r.prAction = 'closed as redundant' }
        }
        continue
      }
      r.outcome = 'changed'
      const title = `sync(${item.projectId}): registry update from ${item.observation.head.sha.slice(0, 7)}`
      const body = renderPrBody({ projectId: item.projectId, result: planned, observation: item.observation, registryUrl: `https://github.com/${OWNER}/${HUB_REPO}/blob/main/${REGISTRY_PATH}` })
      if (mode !== 'write') {
        checkProposal({ baseRegistry: registry, nextRegistry: planned.registry, projectId: item.projectId, validate })
        if (outDir) {
          mkdirSync(outDir, { recursive: true })
          writeFileSync(resolve(outDir, `${item.projectId}.registry.json`), serializeRegistry(planned.registry))
          writeFileSync(resolve(outDir, `${item.projectId}.pr.md`), `# ${title}\n\n${body}`)
          writeFileSync(resolve(outDir, `${item.projectId}.observation.json`), JSON.stringify(item.observation, null, 2) + '\n')
        }
        r.notes.push('Dry run: no branch or PR was written.')
        continue
      }
      const w = await writeSync({ client: hubClient, projectId: item.projectId, baseRegistry: registry, nextRegistry: planned.registry, mainSha, title, body, validate })
      r.pr = w.pr || null
      r.prAction = w.action
      if (w.action === 'skipped' || w.action === 'declined') r.notes.push(w.reason)
    } catch (e) {
      r.outcome = 'error'
      r.errors.push(`${e instanceof WriteRefused ? 'refused' : e.code || 'plan-failed'}: ${e.message}`)
    }
  }
  return results
}

function opt(argv, name, fallback) {
  const i = argv.indexOf(name)
  return i === -1 ? fallback : argv[i + 1]
}

function encode(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64')
}

async function main(argv) {
  const cmd = argv[0]
  const only = opt(argv, '--project', process.env.SYNC_PROJECT || '') || null
  const registry = loadRegistry()
  const token = process.env.GITHUB_TOKEN || ''
  const readerToken = process.env.READER_TOKEN || ''
  const publicReader = createClient({ token: readerToken || token })
  const privateReader = readerToken ? createClient({ token: readerToken }) : null

  if (cmd === 'collect') {
    const collected = await collectAll({ registry, only, clients: { publicReader, privateReader } })
    const outFile = opt(argv, '--out', null)
    if (outFile) {
      mkdirSync(dirname(resolve(outFile)), { recursive: true })
      writeFileSync(resolve(outFile), JSON.stringify(collected, null, 2) + '\n')
    }
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `observations=${encode(collected)}\n`)
    for (const c of collected) console.log(`collect ${c.projectId}: ${c.ok ? `ok at ${c.observation.head.sha.slice(0, 7)}` : `error ${c.error.code}: ${c.error.message}`}`)
    return 0
  }

  if (cmd === 'write' || cmd === 'preview') {
    let collected
    if (cmd === 'preview') collected = await collectAll({ registry, only, clients: { publicReader, privateReader } })
    else {
      const inFile = opt(argv, '--in', null)
      const raw = inFile ? readFileSync(resolve(inFile), 'utf8') : Buffer.from(process.env.SYNC_OBSERVATIONS || '', 'base64').toString('utf8')
      collected = JSON.parse(raw || '[]')
      if (!Array.isArray(collected)) throw new Error('observations must be an array')
    }
    const mode = cmd === 'preview' ? 'dry-run' : opt(argv, '--mode', 'dry-run')
    if (!['dry-run', 'write'].includes(mode)) throw new Error(`unknown mode ${mode}`)
    const hubClient = mode === 'write' || process.env.SYNC_STATUS_ISSUE === 'true' ? createClient({ token }) : null
    if (mode === 'write' && !token) throw new Error('write mode needs GITHUB_TOKEN')
    const mainSha = process.env.GITHUB_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()
    const outDir = resolve(ROOT, opt(argv, '--out-dir', 'out/sync'))
    const results = await processAll({ registry, collected, mode, hubClient, mainSha, validate: validator(), outDir })

    const runAt = isoSeconds(new Date())
    const trigger = process.env.GITHUB_EVENT_NAME || (cmd === 'preview' ? 'local preview' : 'manual')
    const runUrl = process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null
    let previous = { projects: {} }
    let openSyncPrs = []
    if (hubClient) {
      previous = parseState(await readStatusIssueBody(hubClient))
      openSyncPrs = await listSyncPrs(hubClient)
    }
    const { markdown } = renderStatus({ runAt, trigger, mode, results, previous, openSyncPrs, runUrl })
    mkdirSync(outDir, { recursive: true })
    writeFileSync(resolve(outDir, 'STATUS.md'), markdown)
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown)
    if (hubClient) {
      const issue = await upsertStatusIssue({ client: hubClient, body: markdown })
      console.log(`status issue ${issue.action}: ${issue.url}`)
    }
    if (cmd === 'preview') console.log(markdown)
    for (const r of results) console.log(`sync ${r.projectId}: ${r.outcome}${r.prAction ? ` (${r.prAction})` : ''}${r.errors.length ? ` - ${r.errors.join('; ')}` : ''}`)
    return results.some(r => r.outcome === 'error') ? 1 : 0
  }

  console.error('usage: run.mjs collect|write|preview [--project <id>] [--out <file>] [--in <file>] [--mode dry-run|write]')
  return 2
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code }, e => { console.error(`registry-sync: ${e.message}`); process.exitCode = 1 })
}
