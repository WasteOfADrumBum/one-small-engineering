#!/usr/bin/env node
// One Small Engineering orchestrator (Phase 5, docs/engineering.md). One entry point over the
// registry sync (Phase 2), release readiness (Phase 3) and verification (Phase 4) systems.
//
//   node scripts/engineering/cli.mjs check    [--project <id>]... [--execute] [--no-collect]
//                                             [--no-network] [--no-api] [--full] [--work <dir>]
//                                             [--invoked-by <text>] [--dry-run]
//        OBSERVE. Live revisions, incremental evidence collection, manifests, registry-sync drift,
//        remediation PR status; then evaluate, prioritize and write reports/engineering/ and
//        engineering/state.json. Reads GitHub; never writes to it.
//   node scripts/engineering/cli.mjs report   [--as-of <UTC>] [--check]
//        Regenerate (or, with --check, verify) reports/engineering/ from committed files. Offline.
//   node scripts/engineering/cli.mjs prepare  [--project <id>]... [--execute] [--out <dir>]
//        PREPARE. Candidate fixes for deterministic issues as reviewed-before-use proposal files
//        (default out/engineering/proposals/). Writes nothing to GitHub. Refused on schedules.
//   node scripts/engineering/cli.mjs execute  --proposal <file> --digest <sha256> --confirm
//        EXECUTE. Opens one draft PR from one reviewed proposal. Needs REMEDIATION_WRITE_ENABLED=true
//        and REMEDIATION_TOKEN; refused on scheduled and pull_request runs. Never merges.
//
// Exit codes: 0 done, 1 refused, invalid input or stale reports, 2 usage error.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, mkdtempSync, appendFileSync } from 'node:fs'
import { resolve, dirname, join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { redactSensitive } from '../validate-registry.mjs'
import { createClient } from '../sync/github.mjs'
import { createRunner } from '../verify/exec.mjs'
import { iso } from '../verify/evidence.mjs'
import { checkout, workspaceView, AccessError, withGitReader, gitReaderFrom } from '../verify/workspace.mjs'
import { loadState as loadVerifyState, generateReports as verifyReports, main as verifyMain } from '../verify/cli.mjs'
import { loadState, saveState, acquireLock, trackFindings, recordReleaseState, StateError, sortKeys } from './state.mjs'
import { readManifest } from './manifest.mjs'
import { observeRevisions, refreshPlan, syncDrift, pullRequestStatus, readOnlyClient } from './monitor.mjs'
import { evaluate } from './evaluate.mjs'
import { renderAll } from './render.mjs'
import { selectForPrepare, prepareOne, writeProposal, executeProposal, readProposal } from './prepare.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const OUT = 'reports/engineering'
const PRS_PATH = 'engineering/remediation-prs.json'
const COMMANDS = new Set(['check', 'report', 'prepare', 'execute'])
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/
const lf = t => String(t).replace(/\r\n?/g, '\n')

export class UsageError extends Error {}

export function parseArgs(argv) {
  const [command, ...rest] = argv
  if (!COMMANDS.has(command)) throw new UsageError(`unknown command ${JSON.stringify(command || '')}; use ${[...COMMANDS].join(', ')}`)
  const o = { command, projects: [], execute: false, collect: true, network: true, api: true, full: false, dryRun: false, check: false, confirm: false, asOf: null, work: null, invokedBy: null, out: null, proposal: null, digest: null }
  const single = { '--as-of': 'asOf', '--work': 'work', '--invoked-by': 'invokedBy', '--out': 'out', '--proposal': 'proposal', '--digest': 'digest' }
  const flags = { '--execute': ['execute', true], '--no-collect': ['collect', false], '--no-network': ['network', false], '--no-api': ['api', false], '--full': ['full', true], '--dry-run': ['dryRun', true], '--check': ['check', true], '--confirm': ['confirm', true] }
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    const value = () => { const v = rest[++i]; if (v === undefined || v.startsWith('--')) throw new UsageError(`${a} needs a value`); return v }
    if (a === '--project') o.projects.push(value())
    else if (single[a]) o[single[a]] = value()
    else if (flags[a]) o[flags[a][0]] = flags[a][1]
    else throw new UsageError(`unknown option ${a}`)
  }
  if (o.asOf && !TIME.test(o.asOf)) throw new UsageError('--as-of must be a UTC time like 2026-10-27T06:00:00Z')
  if (o.command === 'execute' && (!o.proposal || !o.digest)) throw new UsageError('execute needs --proposal and --digest (the digest you reviewed)')
  if (o.digest && !/^[0-9a-f]{64}$/.test(o.digest)) throw new UsageError('--digest must be a sha256 hex digest')
  return o
}

// The committed remediation PR list, merged with the last observed status of each PR.
export function loadPullRequests(root, estate) {
  const f = join(root, PRS_PATH)
  const list = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')).pullRequests || [] : []
  const seen = new Map((estate.pullRequests || []).map(p => [p.url, p]))
  return list.map(p => ({ ...p, ...(seen.has(p.url) ? { status: seen.get(p.url).status, reviewed: seen.get(p.url).reviewed ?? null, observedAt: seen.get(p.url).observedAt || null } : { status: p.status || 'unknown', reviewed: null }) })).sort((a, b) => a.url.localeCompare(b.url))
}

export function reportFiles(root, asOf, command) {
  const vstate = loadVerifyState(root)
  const estate = loadState(root)
  const prs = loadPullRequests(root, estate)
  const result = evaluate({ vstate, estate, prs, asOf })
  return { result, files: renderAll(result, { command, asOf, run: estate.lastRun }) }
}

function writeFiles(dir, files) {
  for (const [k, v] of Object.entries(files)) { const f = join(dir, k); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, v) }
}

function listFiles(dir, base = '') {
  const out = []
  for (const name of readdirSync(join(dir, base))) {
    const rel = base ? `${base}/${name}` : name
    try { readdirSync(join(dir, rel)); out.push(...listFiles(dir, rel)) } catch { out.push(rel) }
  }
  return out
}

function provenance(o, env) {
  const gha = env.GITHUB_ACTIONS === 'true'
  return {
    executor: gha ? 'github-actions' : 'local',
    runUrl: gha && env.GITHUB_RUN_ID ? `${env.GITHUB_SERVER_URL || 'https://github.com'}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : null,
    invokedBy: gha ? `GitHub Actions ${env.GITHUB_WORKFLOW || ''} (${env.GITHUB_EVENT_NAME || 'unknown event'})`.trim() : (o.invokedBy || 'local run')
  }
}

// OBSERVE: everything read-only, then evaluate and report.
async function check(o, { root, env, now, log, fetchImpl }) {
  if (o.execute && env.GITHUB_EVENT_NAME === 'schedule') throw new UsageError('scheduled runs never execute project code; --execute is for manual runs')
  const unlock = acquireLock(root)
  try {
    let at = o.asOf || iso(now())
    const estate = loadState(root)
    let vstate = loadVerifyState(root)
    const only = o.projects.length ? o.projects : null
    for (const id of only || []) if (!vstate.registry.projects.some(p => p.id === id && p.tier !== 'legacy')) throw new UsageError(`no active project "${id}"`)
    const run = withGitReader(createRunner(), gitReaderFrom(env, { execute: o.execute }))
    const work = o.work ? resolve(o.work) : mkdtempSync(join(tmpdir(), 'ose-engineering-'))
    const prov = provenance(o, env)
    const summary = { changed: [], collected: {}, skipped: [], manifests: [], api: 'not used' }

    // 1. Sync: live revisions.
    let revisions = new Map()
    if (o.network) {
      const obs = observeRevisions({ registry: vstate.registry, state: estate, run, at, only })
      summary.changed = [...obs.changed.entries()].map(([id, c]) => `${id} ${String(c.from).slice(0, 7)} -> ${c.to.slice(0, 7)}`)
      for (const [id, a] of obs.access) if (a.access !== 'ok') log(`engineering: ${id}: ${a.access} (${a.reason})`)
    }
    for (const [id, s] of Object.entries(estate.projects)) if (s.revision) revisions.set(id, s.revision)

    // 2. Collect: only collectors without current evidence for the evaluated revision.
    if (o.collect && o.network) {
      const plan = refreshPlan({ registry: vstate.registry, policy: vstate.policy, policyHash: vstate.policyHash, ledgers: vstate.ledgers, revisions, asOf: new Date(at), execute: o.execute, only, full: o.full })
      for (const p of vstate.registry.projects.filter(p => p.tier !== 'legacy' && (!only || only.includes(p.id)))) if (!plan.has(p.id)) summary.skipped.push(p.id)
      for (const [id, collectors] of plan) {
        const args = ['run', '--project', id, '--work', work, '--as-of', at, '--invoked-by', `${prov.invokedBy} via engineering:check`, ...collectors.flatMap(c => ['--collector', c]), ...(o.execute ? ['--execute'] : [])]
        const code = await verifyMain(args, { root, env, now, log: line => { if (/^verify: \S+ at /.test(line)) log(line) }, error: log, fetchImpl })
        summary.collected[id] = code === 0 ? collectors : [`failed (exit ${code})`]
      }
      vstate = loadVerifyState(root)
    }

    // 3. Manifests for dependency analysis, once per revision.
    if (o.network) {
      for (const p of vstate.registry.projects.filter(p => p.tier !== 'legacy' && (!only || only.includes(p.id)))) {
        const s = estate.projects[p.id]
        const sha = p.release.candidate ? p.release.candidate.headSha : s && s.revision
        if (!sha || !s || s.access !== 'ok' || (s.manifest && s.manifest.commitSha === sha)) continue
        try {
          const dir = join(work, p.id)
          checkout(run, p.repository, sha, dir)
          s.manifest = readManifest(workspaceView(dir), sha)
          summary.manifests.push(p.id)
        } catch (e) { log(`engineering: ${p.id}: manifest not read (${e instanceof AccessError ? e.message : 'checkout failed'})`) }
      }
    }

    // 4. Registry-sync drift and remediation PR status (GitHub API, GET only).
    if (o.network && o.api) {
      const mk = token => readOnlyClient(createClient({ token: token || undefined, fetchImpl, maxRetries: 2, baseDelayMs: 1000 }))
      const reader = env.READER_TOKEN || env.SYNC_READER_TOKEN || ''
      estate.sync = await syncDrift({ registry: vstate.registry, clients: { publicReader: mk(reader || env.GITHUB_TOKEN), privateReader: reader ? mk(reader) : null }, now: new Date(at) })
      const base = loadPullRequests(root, { pullRequests: [] })
      estate.pullRequests = (await pullRequestStatus({ client: mk(env.GITHUB_TOKEN), prs: base, now: at })).map(({ url, status, reviewed, observedAt, reason }) => ({ url, status, reviewed: reviewed ?? null, observedAt: observedAt || null, reason: reason || null }))
      const reachable = estate.pullRequests.some(p => !p.reason) || Object.values(estate.sync).some(s => s.status !== 'unavailable')
      summary.api = reachable ? 'reachable' : 'unavailable (statuses kept from the last run that could read them)'
    }

    // 5-7. Evaluate, prioritize, record findings and release-state history, report. Evaluation
    // happens as of the end of collection, so evidence collected during this run is current.
    const startedAt = at
    at = o.asOf || iso(now())
    estate.lastRun = { at, startedAt, mode: 'observe', executor: prov.executor, runUrl: prov.runUrl, invokedBy: prov.invokedBy, execute: o.execute, changed: summary.changed, collected: Object.keys(summary.collected).sort(), skipped: summary.skipped.sort(), api: summary.api }
    let prs = loadPullRequests(root, estate)
    let result = evaluate({ vstate, estate, prs, asOf: at })
    const { fresh, resolved } = trackFindings(estate, result.queue, at)
    for (const p of result.projects) recordReleaseState(estate, p.id, p.release.state, at)
    // Render from the state exactly as it is saved (sorted keys), so `report` reproduces it.
    const saved = sortKeys(estate)
    result = evaluate({ vstate, estate: saved, prs, asOf: at })
    const files = renderAll(result, { command: `npm run engineering:report -- --as-of ${at}`, asOf: at, run: saved.lastRun })
    if (!o.dryRun) {
      saveState(root, estate)
      writeFiles(join(root, OUT), files)
      writeFiles(join(root, 'reports/verification'), verifyReports(vstate, at).files)
    }
    const ov = result.overview
    log(`engineering: observe run as of ${at}: ${ov.activeProjects} projects, ${summary.changed.length} revision change(s), collected ${Object.values(summary.collected).flat().length} collector result(s) in ${Object.keys(summary.collected).length} project(s), ${summary.skipped.length} project(s) already current, manifests read ${summary.manifests.length}, GitHub API ${summary.api}`)
    log(`engineering: ${result.queue.length} issue(s) (${fresh.size} new, ${resolved.length} resolved); ${ov.blocked} blocked, ${ov.readyForRelease} ready for release; coverage ${ov.verificationCoverage.verified}/${ov.verificationCoverage.applicable}`)
    for (const p of result.projects) log(`engineering: ${p.id}: ${p.release.text}; ${p.readiness.verifiedGates}/${p.readiness.applicableGates} verified; next: ${p.nextAction}`)
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, files['dashboard.md'].split('\n## Detail')[0] + '\n')
    return 0
  } finally { unlock() }
}

export async function main(argv, { now = () => new Date(), log = console.log, error = console.error, env = process.env, root = ROOT, fetchImpl = globalThis.fetch } = {}) {
  let o
  try { o = parseArgs(argv) } catch (e) { if (e instanceof UsageError) { error(`engineering: ${e.message}`); return 2 } throw e }
  try {
    if (o.command === 'check') return await check(o, { root, env, now, log, fetchImpl })
    if (o.command === 'report') {
      const estate = loadState(root)
      const outDir = join(root, OUT)
      let asOf = o.asOf
      if (!asOf && o.check && existsSync(join(outDir, 'dashboard.json'))) asOf = JSON.parse(readFileSync(join(outDir, 'dashboard.json'), 'utf8')).asOf
      asOf = asOf || (estate.lastRun && estate.lastRun.at) || iso(now())
      const { files } = reportFiles(root, asOf, `npm run engineering:report -- --as-of ${asOf}`)
      if (o.check) {
        const present = existsSync(outDir) ? listFiles(outDir) : []
        const stale = [...Object.entries(files).filter(([k, v]) => { const f = join(outDir, k); return !existsSync(f) || lf(readFileSync(f, 'utf8')) !== v }).map(([k]) => k), ...present.filter(k => !(k in files))]
        if (stale.length) { error(`engineering: ${stale.length} report file(s) differ as of ${asOf}: ${stale.join(', ')}. Run npm run engineering:report -- --as-of ${asOf}.`); return 1 }
        log(`engineering: reports are current as of ${asOf}`)
        return 0
      }
      writeFiles(outDir, files)
      log(`engineering: wrote ${Object.keys(files).length} file(s) to ${OUT} as of ${asOf}`)
      return 0
    }
    if (o.command === 'prepare') {
      if (env.GITHUB_EVENT_NAME === 'schedule') { error('engineering: prepare is refused on scheduled runs (scheduled runs only observe)'); return 1 }
      const estate = loadState(root)
      const asOf = o.asOf || (estate.lastRun && estate.lastRun.at) || iso(now())
      const vstate = loadVerifyState(root)
      const { result } = reportFiles(root, asOf, 'npm run engineering:prepare')
      const sel = selectForPrepare(result.queue, { protectedRepositories: (vstate.policy.remediation || {}).protectedRepositories || [], only: o.projects.length ? o.projects : null })
      const outDir = resolve(root, o.out || 'out/engineering/proposals')
      const work = o.work ? resolve(o.work) : mkdtempSync(join(tmpdir(), 'ose-prepare-'))
      const lines = ['# Prepared remediation proposals', '', `As of ${asOf}. Nothing was written to GitHub. Review a proposal, then pass its digest to the remediation workflow.`, '']
      for (const s of sel.skipped) { log(`engineering: skip ${s.id}: ${s.reason}`); lines.push(`- Skipped \`${s.id}\`: ${s.reason}`) }
      for (const i of sel.candidates) {
        const p = vstate.registry.projects.find(x => x.id === i.project)
        const r = prepareOne(i, p, { run: createRunner(), workRoot: work, execute: o.execute, now: () => iso(now()), policy: vstate.policy, profiles: vstate.profiles })
        if (!r.prepared) { log(`engineering: not prepared ${i.id}: ${r.reason}`); lines.push(`- Not prepared \`${i.id}\`: ${r.reason} (left as an issue report)`); continue }
        const f = writeProposal(outDir, r.proposal)
        log(`engineering: prepared ${i.id}: ${relative(root, f)} digest ${r.proposal.digest}`)
        lines.push(`- Prepared \`${i.id}\`: \`${relative(root, f)}\`, ${r.proposal.files.length} file(s), branch \`${r.proposal.branch}\`, digest \`${r.proposal.digest}\``)
      }
      if (!sel.candidates.length) lines.push('', 'No issue has a deterministic fix that is not already covered by a remediation PR.')
      mkdirSync(outDir, { recursive: true })
      writeFileSync(join(outDir, 'README.md'), redactSensitive(lines.join('\n') + '\n'))
      if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, redactSensitive(lines.join('\n') + '\n'))
      return 0
    }
    if (o.command === 'execute') {
      const proposal = readProposal(resolve(o.proposal))
      const estate = loadState(root)
      const asOf = (estate.lastRun && estate.lastRun.at) || iso(now())
      const { result } = reportFiles(root, asOf, 'npm run engineering:execute')
      const vstate = loadVerifyState(root)
      const issue = result.queue.find(i => i.id === proposal.issueId)
      const coveredBy = issue ? issue.relatedPRs.filter(p => ['open', 'draft', 'unknown'].includes(p.status)).map(p => p.url) : []
      const client = env.REMEDIATION_TOKEN ? createClient({ token: env.REMEDIATION_TOKEN, fetchImpl }) : null
      const res = await executeProposal({ proposal, reviewedDigest: o.digest, env, confirm: o.confirm, policy: vstate.policy, coveredBy, client })
      if (!res.created) { error(`engineering: not executed:\n${res.refused.map(r => `  - ${r}`).join('\n')}`); return 1 }
      log(`engineering: draft PR ${res.pullRequest ? res.pullRequest.url : '(unknown)'} on ${res.branch}. Add it to ${PRS_PATH} in a hub PR so later runs track it.`)
      return 0
    }
  } catch (e) {
    if (e instanceof UsageError) { error(redactSensitive(`engineering: ${e.message}`)); return e.message.startsWith('no active project') ? 2 : 1 }
    if (e instanceof StateError || (e && (e.code === 'ENOENT' || e instanceof SyntaxError))) { error(redactSensitive(`engineering: ${e.message}`)); return 1 }
    throw e
  }
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code })
}
