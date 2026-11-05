#!/usr/bin/env node
// Automated verification (Phase 4, docs/verification.md).
//
//   node scripts/verify/cli.mjs run      [--project <id>]... [--collector <name>]... [--execute]
//                                        [--no-network] [--full] [--work <dir>] [--invoked-by <text>]
//        collect evidence, update verification/evidence/, then regenerate reports/verification/
//   node scripts/verify/cli.mjs report   regenerate reports/verification/ from committed files (offline)
//   node scripts/verify/cli.mjs check    are the committed verification reports current? (offline)
//   node scripts/verify/cli.mjs freshness [--strict]   list stale or expired evidence for the evaluated commits
//   node scripts/verify/cli.mjs record   --project <id> --gate <gate> --verifier <name> --kind human|ai
//                                        [--tool <tool>] --method <m> --result pass|fail --evidence <id>...
//                                        --attestation <github url> --notes <text>
//        a verifier records their own verification (refused in CI: automation never verifies)
//   node scripts/verify/cli.mjs remediate --plan <file> --confirm --repository <url>
//        open one draft remediation PR (needs REMEDIATION_TOKEN; refused on scheduled runs)
//
// Common options: --as-of <UTC time> (default now; check uses the recorded time).
// Exit codes: 0 done, 1 invalid input, stale reports or refused action, 2 usage error.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, mkdtempSync } from 'node:fs'
import { resolve, dirname, join, relative } from 'node:path'
import { tmpdir, platform } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { validateText, parseDefinitionOfDone, redactSensitive } from '../validate-registry.mjs'
import { createClient } from '../sync/github.mjs'
import { createRunner } from './exec.mjs'
import { withGitReader, gitReaderFrom } from './workspace.mjs'
import { loadLedger, sha256, iso, checkEvidence, staleness } from './evidence.mjs'
import { loadVerifications, judgeVerification, verificationId, METHODS } from './verification.mjs'
import { collect, requestsFor, applicableGates } from './orchestrator.mjs'
import { verificationAssessment } from './overlay.mjs'
import { renderVerificationDashboard, renderVerificationProject, renderIssueReports, dashboardJson, toJson } from './render.mjs'
import { openDraftPR, checkPlan } from './remediation.mjs'
import { COLLECTOR_NAMES } from './collectors.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const COMMANDS = new Set(['run', 'report', 'check', 'freshness', 'record', 'remediate'])
const lf = t => String(t).replace(/\r\n?/g, '\n')
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/

export class UsageError extends Error {}

export function parseArgs(argv) {
  const [command, ...rest] = argv
  if (!COMMANDS.has(command)) throw new UsageError(`unknown command ${JSON.stringify(command || '')}; use ${[...COMMANDS].join(', ')}`)
  const o = { command, projects: [], collectors: [], execute: false, network: true, incremental: true, asOf: null, work: null, invokedBy: null, strict: false, evidence: [], confirm: false, out: 'reports/verification' }
  const multi = { '--project': 'projects', '--collector': 'collectors', '--evidence': 'evidence' }
  const single = { '--as-of': 'asOf', '--work': 'work', '--invoked-by': 'invokedBy', '--gate': 'gate', '--verifier': 'verifier', '--kind': 'kind', '--tool': 'tool', '--method': 'method', '--result': 'result', '--attestation': 'attestation', '--notes': 'notes', '--plan': 'plan', '--repository': 'repository', '--out': 'out', '--verified-at': 'verifiedAt' }
  const flags = { '--execute': ['execute', true], '--no-network': ['network', false], '--full': ['incremental', false], '--strict': ['strict', true], '--confirm': ['confirm', true] }
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    const value = () => { const v = rest[++i]; if (v === undefined || v.startsWith('--')) throw new UsageError(`${a} needs a value`); return v }
    if (multi[a]) o[multi[a]].push(value())
    else if (single[a]) o[single[a]] = value()
    else if (flags[a]) o[flags[a][0]] = flags[a][1]
    else throw new UsageError(`unknown option ${a}`)
  }
  if (o.asOf && !TIME.test(o.asOf)) throw new UsageError('--as-of must be a UTC time like 2026-10-27T02:00:00Z')
  for (const c of o.collectors) if (!COLLECTOR_NAMES.includes(c)) throw new UsageError(`unknown collector ${c}; use ${COLLECTOR_NAMES.join(', ')}`)
  if (command === 'record') {
    for (const k of ['projects', 'gate', 'verifier', 'kind', 'method', 'result', 'attestation', 'notes']) if (k === 'projects' ? o.projects.length !== 1 : !o[k]) throw new UsageError(`record needs --${k === 'projects' ? 'project' : k}`)
    if (!METHODS.includes(o.method)) throw new UsageError(`--method must be one of ${METHODS.join(', ')}`)
  }
  if (command === 'remediate' && (!o.plan || !o.repository)) throw new UsageError('remediate needs --plan and --repository')
  return o
}

// Everything committed that the reports are computed from.
export function loadState(root = ROOT) {
  const read = p => readFileSync(join(root, p), 'utf8')
  const registryText = read('projects/registry.json')
  const schema = JSON.parse(read('projects/registry.schema.json'))
  const dodText = lf(read('standards/definition-of-done.md'))
  const policyText = lf(read('verification/policy.json'))
  const profilesText = lf(read('verification/projects.json'))
  const policy = JSON.parse(policyText)
  const profiles = JSON.parse(profilesText)
  const registry = JSON.parse(registryText)
  const problems = []
  const ledgers = new Map()
  const verifications = new Map()
  for (const p of registry.projects.filter(p => p.tier !== 'legacy')) {
    const ev = join(root, 'verification/evidence', `${p.id}.json`)
    if (existsSync(ev)) { const l = loadLedger(JSON.parse(readFileSync(ev, 'utf8')), p.id); ledgers.set(p.id, l.evidence); problems.push(...l.problems) } else ledgers.set(p.id, [])
    const vf = join(root, 'verification/verifications', `${p.id}.json`)
    if (existsSync(vf)) { const l = loadVerifications(JSON.parse(readFileSync(vf, 'utf8')), p.id); verifications.set(p.id, l.verifications); problems.push(...l.problems) } else verifications.set(p.id, [])
  }
  const runsPath = join(root, 'verification/runs/latest.json')
  const runs = existsSync(runsPath) ? JSON.parse(readFileSync(runsPath, 'utf8')) : { runs: [] }
  return { registryText, registry, schema, dodText, policy, profiles, policyHash: sha256(policyText + '\n' + profilesText), ledgers, verifications, runs, problems }
}

export function checkPolicy(policy, registry) {
  const errs = []
  const gates = new Set(Object.values(registry.gateCatalog).flat())
  for (const g of gates) if (!policy.gates[g]) errs.push(`policy.json has no entry for gate ${g}`)
  for (const [g, v] of Object.entries(policy.gates)) {
    if (!gates.has(g)) errs.push(`policy.json gate ${g} is not in the gate catalog`)
    if (!['full', 'partial', 'none'].includes(v.automation)) errs.push(`policy.json gate ${g}: automation must be full, partial or none`)
    for (const c of [...(v.collectors || []), ...(v.supporting || [])]) if (!COLLECTOR_NAMES.includes(c)) errs.push(`policy.json gate ${g}: unknown collector ${c}`)
    if (v.automation === 'none' && (v.collectors || []).length) errs.push(`policy.json gate ${g}: a non-automatable gate lists collectors`)
  }
  for (const g of policy.humanOnlyGates || []) if (!gates.has(g)) errs.push(`policy.json humanOnlyGates: unknown gate ${g}`)
  for (const a of (policy.aiVerifiers && policy.aiVerifiers.allowed) || []) if (!a.project || !a.tool || !a.identity) errs.push('policy.json aiVerifiers.allowed entries need project, tool and identity')
  return errs
}

// Targets from the latest run; projects not in it fall back to the candidate or snapshot.
export function targetsFrom(state) {
  const t = new Map()
  for (const p of state.registry.projects.filter(p => p.tier !== 'legacy')) {
    const r = (state.runs.runs || []).find(x => x.project === p.id)
    if (r && r.target) t.set(p.id, r.target)
    else if (p.release.candidate) t.set(p.id, { sha: p.release.candidate.headSha, source: `release candidate (PR #${p.release.candidate.pullRequest}, ${p.release.candidate.ref})`, liveSha: null, drift: null })
    else t.set(p.id, { sha: p.repositorySnapshot.headSha, source: 'registry snapshot (no collection run)', liveSha: null, drift: null })
  }
  return t
}

// Every report file, as { relative path: content }. Pure given the state and asOf.
export function generateReports(state, asOf, command = 'npm run verify:report') {
  const errors = validateText(state.registryText, state.schema, { dod: parseDefinitionOfDone(state.dodText), now: new Date(asOf) })
  if (errors.length) throw new UsageError(`the registry is invalid; fix it first: ${errors[0]}`)
  const policyErrors = checkPolicy(state.policy, state.registry)
  if (policyErrors.length) throw new UsageError(policyErrors[0])
  if (state.problems.length) throw new UsageError(`verification files are invalid: ${state.problems.slice(0, 3).join('; ')}`)
  const targets = targetsFrom(state)
  const at = new Date(asOf)
  const remediation = new Map(Object.entries(state.runs.remediation || {}))
  const a = verificationAssessment({ registry: state.registry, schema: state.schema, dodText: state.dodText, asOf: at, policy: state.policy, ledgers: state.ledgers, verifications: state.verifications, targets, remediation })
  const requests = requestsFor({ registry: state.registry, policy: state.policy, ledgers: state.ledgers, targets, asOf: at, assessment: a })
  const runs = (state.runs.runs || []).map(r => ({ project: r.project, access: r.access, accessReason: r.accessReason, collected: r.collectors.filter(c => !c.reused).length, reused: r.collectors.filter(c => c.reused).length, executor: `${state.runs.executor || 'unknown'}${state.runs.runUrl ? ` (${state.runs.runUrl})` : ''}, ${state.runs.collectedAt || ''}` }))
  const meta = { command, asOf, registryHash: sha256(lf(state.registryText)), policyHash: state.policyHash, policyVersion: state.policy.policyVersion, runs, requests }
  const files = { 'dashboard.md': renderVerificationDashboard(a, meta), 'dashboard.json': toJson(dashboardJson(a, meta)) }
  for (const p of a.projects) {
    files[`projects/${p.id}.md`] = renderVerificationProject(p, meta)
    files[`projects/${p.id}.json`] = toJson({ kind: 'one-small-engineering/verification-project', asOf, ...p, verificationRequests: requests[p.id] })
    if (p.findings.length) files[`remediation/${p.id}.md`] = renderIssueReports(p, meta)
  }
  return { assessment: a, files, requests }
}

function writeFiles(dir, files) {
  for (const [k, v] of Object.entries(files)) { const f = join(dir, k); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, v) }
}

// GitHub API clients for collectors. A private project is read with the read-only reader
// credential (the hub's job token cannot see it); every other project with the job token. The
// reader is withheld from runs that execute project code, as for git (gitReaderFrom).
export function apiClients(env, { network = true, execute = false, fetchImpl = globalThis.fetch } = {}) {
  if (!network) return { github: null, githubFor: () => null }
  const mk = token => createClient({ token: token || undefined, fetchImpl, maxRetries: 2, baseDelayMs: 1000 })
  const github = mk(env.GITHUB_TOKEN)
  const reader = gitReaderFrom(env, { execute })
  const privateGithub = reader ? mk(reader) : null
  return { github, githubFor: p => (p.visibility === 'private' && privateGithub) || github }
}

function provenance(o, env) {
  const gha = env.GITHUB_ACTIONS === 'true'
  const runner = createRunner()
  const npm = runner('npm', ['--version'], { timeoutMs: 30_000 })
  return {
    executor: gha ? 'github-actions' : 'local',
    runUrl: gha && env.GITHUB_RUN_ID ? `${env.GITHUB_SERVER_URL || 'https://github.com'}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}${env.GITHUB_RUN_ATTEMPT ? `/attempts/${env.GITHUB_RUN_ATTEMPT}` : ''}` : null,
    invokedBy: gha ? `GitHub Actions ${env.GITHUB_WORKFLOW || ''} (${env.GITHUB_EVENT_NAME || 'unknown event'})`.trim() : (o.invokedBy || 'local run'),
    toolchain: { node: process.versions.node, npm: npm.status === 0 ? npm.stdout.trim() : 'unknown', os: platform() }
  }
}

function toolInstaller(run, root) {
  return tools => {
    // In the sandbox the tools live in the work root, which project commands may write to.
    const dir = join(process.env.ONE_SMALL_SANDBOX_USER && process.env.ONE_SMALL_WORK ? process.env.ONE_SMALL_WORK : root, '.tools')
    mkdirSync(dir, { recursive: true })
    const available = {}
    for (const t of tools) {
      const res = run('npm', ['install', '--prefix', dir, '--no-audit', '--no-fund', `${t.package}@${t.version}`], { cwd: dir, timeoutMs: 600_000 })
      if (res.status === 0 && existsSync(join(dir, 'node_modules', '.bin', t.bin))) available[t.bin] = `${t.package}@${t.version}`
    }
    const sepChar = platform() === 'win32' ? ';' : ':'
    return { available, env: { PATH: `${join(dir, 'node_modules', '.bin')}${sepChar}${process.env.PATH || ''}` } }
  }
}

export async function main(argv, { now = () => new Date(), log = console.log, error = console.error, env = process.env, root = ROOT, fetchImpl = globalThis.fetch } = {}) {
  let o
  try { o = parseArgs(argv) } catch (e) { if (e instanceof UsageError) { error(`verify: ${e.message}`); return 2 } throw e }
  const outDir = resolve(root, o.out)
  try {
    let state = loadState(root)
    if (o.command === 'run') {
      const ids = o.projects.length ? o.projects : null
      for (const id of ids || []) if (!state.registry.projects.some(p => p.id === id && p.tier !== 'legacy')) throw new UsageError(`no active project "${id}"`)
      const run = withGitReader(createRunner(), gitReaderFrom(env, { execute: o.execute }))
      const workRoot = o.work ? resolve(o.work) : mkdtempSync(join(tmpdir(), 'ose-verify-'))
      const { github, githubFor } = apiClients(env, { network: o.network, execute: o.execute, fetchImpl })
      const result = await collect({
        registry: state.registry, policy: state.policy, policyHash: state.policyHash, profiles: state.profiles, ledgers: state.ledgers,
        projectIds: ids, onlyCollectors: o.collectors.length ? o.collectors : null, incremental: o.incremental,
        deps: { run, github, githubFor, fetch: o.network ? fetchImpl : null, now, workRoot, execute: o.execute, provenance: provenance(o, env), installTools: toolInstaller(run, workRoot) }
      })
      for (const [id, evidence] of result.ledgers) {
        if (ids && !ids.includes(id)) continue
        const f = join(root, 'verification/evidence', `${id}.json`)
        mkdirSync(dirname(f), { recursive: true })
        writeFileSync(f, JSON.stringify({ project: id, evidence }, null, 2) + '\n')
      }
      const prov = provenance(o, env)
      const previous = state.runs.runs || []
      const runs = [...previous.filter(r => !result.log.some(x => x.project === r.project)), ...result.log].sort((a, b) => a.project.localeCompare(b.project))
      const runsPath = join(root, 'verification/runs/latest.json')
      mkdirSync(dirname(runsPath), { recursive: true })
      writeFileSync(runsPath, JSON.stringify(redactJsonish({ collectedAt: result.collectedAt, executor: prov.executor, runUrl: prov.runUrl, invokedBy: prov.invokedBy, execute: o.execute, remediation: state.runs.remediation || {}, runs }), null, 2) + '\n')
      for (const r of result.log) log(`verify: ${r.project} at ${(r.target.sha || 'unknown').slice(0, 7)}: ${r.access === 'ok' ? '' : `${r.access} (${r.accessReason}); `}${r.collectors.map(c => `${c.name} ${c.result}${c.reused ? ' (reused)' : ''}`).join(', ')}`)
      state = loadState(root)
    }
    if (['run', 'report', 'check'].includes(o.command)) {
      let asOf = o.asOf
      if (!asOf && o.command === 'check') {
        const p = join(outDir, 'dashboard.json')
        if (!existsSync(p)) { error('verify: no reports to check; run npm run verify:report'); return 1 }
        asOf = JSON.parse(readFileSync(p, 'utf8')).asOf
      }
      asOf = asOf || iso(now())
      const { files, assessment } = generateReports(state, asOf, 'npm run verify:report')
      if (o.command === 'check') {
        const want = new Set(Object.keys(files))
        const present = existsSync(outDir) ? listFiles(outDir) : []
        const stale = [...Object.entries(files).filter(([k, v]) => { const f = join(outDir, k); return !existsSync(f) || lf(readFileSync(f, 'utf8')) !== v }).map(([k]) => k), ...present.filter(k => !want.has(k))]
        if (stale.length) { error(`verify: ${stale.length} verification report file(s) differ as of ${asOf}: ${stale.slice(0, 8).join(', ')}. Run npm run verify:report -- --as-of ${asOf}.`); return 1 }
        log(`verify: verification reports are current as of ${asOf}`)
        return 0
      }
      writeFiles(outDir, files)
      for (const p of assessment.projects) log(`verify: ${p.id}: ${p.readiness.percentage}% (${p.readiness.verifiedGates}/${p.readiness.applicableGates} verified), ${Object.entries(p.gateStates).filter(([, n]) => n).map(([s, n]) => `${n} ${s}`).join(', ')}`)
      log(`verify: wrote ${Object.keys(files).length} file(s) to ${relative(root, outDir)} as of ${asOf}`)
      return 0
    }
    if (o.command === 'freshness') {
      const asOf = new Date(o.asOf || iso(now()))
      const targets = targetsFrom(state)
      let problems = 0
      for (const [id, evidence] of state.ledgers) {
        const t = targets.get(id)
        const latest = new Map()
        for (const e of [...evidence].sort((a, b) => b.executedAt.localeCompare(a.executedAt))) if (!latest.has(e.collector.name)) latest.set(e.collector.name, e)
        const p = state.registry.projects.find(x => x.id === id)
        const needed = new Set(applicableGates(state.registry, p).flatMap(g => (state.policy.gates[g] || {}).collectors || []))
        for (const c of [...needed].sort()) {
          const e = latest.get(c)
          const why = !e ? 'no evidence' : staleness(e, { commitSha: t.sha, asOf })
          if (why) { problems++; log(`verify: ${id} ${c}: ${why}`) }
        }
      }
      log(`verify: ${problems} missing or stale evidence item(s) as of ${iso(asOf)}`)
      return o.strict && problems ? 1 : 0
    }
    if (o.command === 'record') {
      // Automation never records verification: refuse in CI and for the collector identity.
      if (env.GITHUB_ACTIONS === 'true' || env.CI === 'true') { error('verify: record is refused in CI; a verifier records their own verification'); return 1 }
      const id = o.projects[0]
      const p = state.registry.projects.find(x => x.id === id && x.tier !== 'legacy')
      if (!p) throw new UsageError(`no active project "${id}"`)
      const ledger = state.ledgers.get(id) || []
      const evidence = o.evidence.map(eid => { const e = ledger.find(x => x.id === eid); if (!e) throw new UsageError(`evidence ${eid} is not in the ${id} ledger`); return { id: e.id, digest: e.digest } })
      const target = targetsFrom(state).get(id)
      const v = { schema: 1, id: null, project: id, gate: o.gate, commitSha: target.sha, evidence, verifier: { name: o.verifier, kind: o.kind, ...(o.tool ? { tool: o.tool } : {}) }, method: o.method, result: o.result, verifiedAt: o.verifiedAt || iso(now()), attestation: o.attestation, notes: o.notes }
      v.id = verificationId(v)
      const j = judgeVerification(v, { project: p, policy: state.policy, evidence: ledger, targetSha: target.sha, asOf: now(), gateCatalog: state.registry.gateCatalog[p.tier] })
      if (!j.valid) { error(`verify: this verification would not count:\n${j.reasons.map(r => `  - ${r}`).join('\n')}`); return 1 }
      const f = join(root, 'verification/verifications', `${id}.json`)
      const existing = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : { project: id, verifications: [] }
      if (existing.verifications.some(x => x.id === v.id)) { log(`verify: ${v.id} is already recorded`); return 0 }
      existing.verifications.push(v)
      mkdirSync(dirname(f), { recursive: true })
      writeFileSync(f, JSON.stringify(existing, null, 2) + '\n')
      log(`verify: recorded ${v.id}; open a PR with this file for Joshua Small's review, then regenerate reports`)
      return 0
    }
    if (o.command === 'remediate') {
      const plan = JSON.parse(readFileSync(resolve(o.plan), 'utf8'))
      const scheduled = env.GITHUB_EVENT_NAME === 'schedule'
      const refusals = checkPlan(plan, state.policy)
      if (refusals.length) { error(`verify: plan refused:\n${refusals.map(r => `  - ${r}`).join('\n')}`); return 1 }
      if (!o.confirm || scheduled || env.REMEDIATION_WRITE_ENABLED !== 'true') { log('verify: plan is valid; nothing written (needs --confirm, REMEDIATION_WRITE_ENABLED=true and a non-scheduled run)'); return o.confirm ? 1 : 0 }
      if (!env.REMEDIATION_TOKEN) { error('verify: REMEDIATION_TOKEN is not set'); return 1 }
      const client = createClient({ token: env.REMEDIATION_TOKEN, fetchImpl })
      const res = await openDraftPR(client, plan, state.policy, { repository: o.repository, confirmed: true, scheduled })
      if (!res.created) { error(`verify: not created:\n${res.refused.map(r => `  - ${r}`).join('\n')}`); return 1 }
      log(`verify: draft PR ${res.pullRequest ? res.pullRequest.url : '(unknown)'} on ${res.branch}`)
      return 0
    }
  } catch (e) {
    if (e instanceof UsageError) { error(redactSensitive(`verify: ${e.message}`)); return e.message.startsWith('no active project') ? 2 : 1 }
    if (e && (e.code === 'ENOENT' || e instanceof SyntaxError)) { error(redactSensitive(`verify: ${e.message}`)); return 1 }
    throw e
  }
  return 0
}

function listFiles(dir, base = '') {
  const out = []
  for (const name of readdirSync(join(dir, base))) {
    const rel = base ? `${base}/${name}` : name
    try { readdirSync(join(dir, rel)); out.push(...listFiles(dir, rel)) } catch { out.push(rel) }
  }
  return out
}

function redactJsonish(v) {
  if (typeof v === 'string') return redactSensitive(v)
  if (Array.isArray(v)) return v.map(redactJsonish)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, redactJsonish(x)]))
  return v
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code })
}
