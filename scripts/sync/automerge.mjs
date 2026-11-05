#!/usr/bin/env node
// Safe auto-merge for registry sync PRs (Phase 6, stage 1).
//
// Trust model: this runs from main with a token that can merge, so it never checks out,
// installs or executes anything from a PR. The PR is data: its metadata, file list and the
// two registry versions are fetched through the API and judged by the same guard and
// validator the sync writer used. A PR merges only if every check below holds; otherwise
// it is left alone with a reason. Governance fields (approval, verification, ownership,
// release scope, blockers, security exceptions) cannot change in a sync PR because the
// field-ownership guard rejects them, so they cannot be merged by this script either.
//
// CLI: node scripts/sync/automerge.mjs [--dry-run] [--pr <number>]
// Env: GITHUB_TOKEN, AUTOMERGE_PAUSED (=true stops all merges), GITHUB_STEP_SUMMARY.

import { readFileSync, appendFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createClient, GitHubError, expectArray, expectObject } from './github.mjs'
import { guardPaths, guardRegistryChange, projectIdFromBranch } from './guard.mjs'
import { BOT_AUTHOR } from './write.mjs'
import { validateRegistry, parseDefinitionOfDone } from '../validate-registry.mjs'
import { ROOT, OWNER, HUB_REPO, HUB_DEFAULT_BRANCH, REGISTRY_PATH, SHA, readJson, safeOutput, cleanText } from './lib.mjs'

const HUB = `/repos/${OWNER}/${HUB_REPO}`
const OK_CONCLUSIONS = new Set(['success', 'neutral', 'skipped'])
const MAX_REGISTRY_BYTES = 4_000_000

export class AutomergeRefused extends Error {}

// Everything this script may write. Anything else throws, so a bug cannot reach main by another route.
export function restrictAutomergeWrites(client) {
  const rules = [
    ['POST', /^\/graphql$/, b => typeof b.query === 'string' && /^\s*mutation\s*\(\$id: ID!\)\s*\{\s*markPullRequestReadyForReview\(input: \{pullRequestId: \$id\}\)/.test(b.query)],
    ['PUT', new RegExp(`^${HUB}/pulls/\\d+/merge$`), b => SHA.test(b.sha || '') && ['squash', 'merge', 'rebase'].includes(b.merge_method)],
    ['POST', new RegExp(`^${HUB}/issues/\\d+/comments$`), b => typeof b.body === 'string'],
    ['POST', new RegExp(`^${HUB}/actions/workflows/registry-sync\\.yml/dispatches$`), b => b.ref === HUB_DEFAULT_BRANCH && b.inputs && b.inputs.dry_run === 'false']
  ]
  const request = (method, path, options = {}) => {
    if (method !== 'GET') {
      const bare = path.split('?')[0]
      const rule = rules.find(([m, re]) => m === method && re.test(bare))
      if (!rule) throw new AutomergeRefused(`refused ${method} ${bare}: not an allowed auto-merge write`)
      if (!rule[2](options.body || {})) throw new AutomergeRefused(`refused ${method} ${bare}: request body is outside what auto-merge may send`)
    }
    return client.request(method, path, options)
  }
  return { request, get: (p, o) => request('GET', p, o), paginate: client.paginate }
}

export function loadPolicy() {
  const p = readJson('sync/automerge.json')
  if (p.version !== 1) throw new Error(`unsupported sync/automerge.json version ${p.version}`)
  return p
}

function validator() {
  const schema = readJson('projects/registry.schema.json')
  const dod = parseDefinitionOfDone(readFileSync(resolve(ROOT, 'standards/definition-of-done.md'), 'utf8'))
  return registry => validateRegistry(registry, schema, { dod })
}

async function registryAt(client, sha) {
  const file = expectObject(await client.get(`${HUB}/contents/${REGISTRY_PATH}?ref=${sha}`), 'registry file', ['content', 'size'])
  if (file.size > MAX_REGISTRY_BYTES) throw new AutomergeRefused(`registry at ${sha.slice(0, 7)} is larger than ${MAX_REGISTRY_BYTES} bytes`)
  try {
    return JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'))
  } catch {
    throw new AutomergeRefused(`registry at ${sha.slice(0, 7)} is not valid JSON`)
  }
}

// Decide one PR. Returns { decision: 'merge' | 'wait' | 'skip' | 'reject', reasons: [...] }.
//   wait   - may become eligible without anyone acting (checks pending, branch stale)
//   skip   - not for automation (hold label, not a sync PR); leave it alone
//   reject - looked like a sync PR but failed a safety check; a human should look
export async function evaluate({ client, pr: listed, mainSha, policy, validate }) {
  const no = (decision, ...reasons) => ({ decision, reasons })
  // The list endpoint omits fields the checks need (commit count, mergeability); read the PR itself.
  const pr = expectObject(await client.get(`${HUB}/pulls/${listed.number}`), 'pull request', ['number', 'head', 'base', 'state'])
  const branch = pr.head && pr.head.ref
  let projectId
  try {
    projectId = projectIdFromBranch(branch)
  } catch {
    return no('skip', 'not a sync/* branch')
  }
  if (pr.state !== 'open') return no('skip', 'PR is not open')
  if (pr.base.ref !== HUB_DEFAULT_BRANCH) return no('skip', `base is ${pr.base.ref}, not ${HUB_DEFAULT_BRANCH}`)
  if (!pr.head.repo || pr.head.repo.full_name !== `${OWNER}/${HUB_REPO}`) return no('reject', 'head is not in this repository (fork)')
  if (!pr.user || pr.user.type !== 'Bot' || !policy.trustedAuthors.includes(pr.user.login)) return no('reject', `PR author ${cleanText(pr.user && pr.user.login, 60)} is not a trusted sync author`)
  if ((pr.labels || []).some(l => l.name === policy.holdLabel)) return no('skip', `labelled ${policy.holdLabel}`)
  if (!SHA.test(pr.head.sha || '')) return no('reject', 'head SHA is malformed')
  const head = pr.head.sha

  // Paginate and fail closed: a requested change on a later page must never be missed.
  const reviews = await client.paginate(`${HUB}/pulls/${pr.number}/reviews`, { max: 300 })
  if (reviews.truncated) return no('wait', 'review list is incomplete')
  if (reviews.some(r => r.state === 'CHANGES_REQUESTED')) return no('skip', 'a reviewer requested changes')

  const commit = expectObject(await client.get(`${HUB}/commits/${head}`), 'head commit', ['commit', 'parents'])
  if (pr.commits !== 1 || commit.parents.length !== 1) return no('reject', 'sync PR must be exactly one commit on one parent')
  if (!commit.commit.author || commit.commit.author.name !== BOT_AUTHOR.name) return no('reject', 'head commit was not authored by the sync process')
  if (commit.parents[0].sha !== mainSha) return no('wait', `branch is based on ${commit.parents[0].sha.slice(0, 7)} but main is ${mainSha.slice(0, 7)}; sync must rebuild it`)

  const files = await client.paginate(`${HUB}/pulls/${pr.number}/files`, { max: 100 })
  if (files.truncated) return no('reject', 'file list is incomplete')
  const bad = guardPaths(files.map(f => f.filename))
  if (bad.length) return no('reject', ...bad)
  if (files.length !== 1 || files[0].status !== 'modified') return no('reject', 'expected exactly one modified file')

  const [base, next] = [await registryAt(client, mainSha), await registryAt(client, head)]
  const problems = [...guardRegistryChange(base, next, projectId), ...validate(next)]
  if (problems.length) return no('reject', ...problems.slice(0, 5).map(p => cleanText(p, 200)))

  // Every attempt of every check on this exact head (filter=all), newest by id per name. A rerun
  // gets a new, larger id, so an old success can never mask a newer pending or failed attempt.
  const runs = await client.paginate(`${HUB}/commits/${head}/check-runs?filter=all`, { max: 300, key: 'check_runs' })
  if (runs.truncated) return no('wait', 'check run list is incomplete')
  const sourceOk = await trustedSource({ client, head, source: policy.requiredCheckSource })
  if (sourceOk.wait) return no('wait', sourceOk.wait)
  const latest = new Map()
  const latestTrusted = new Map()
  for (const r of runs) {
    if (!latest.has(r.name) || latest.get(r.name).id < r.id) latest.set(r.name, r)
    if (sourceOk.trusted(r) && (!latestTrusted.has(r.name) || latestTrusted.get(r.name).id < r.id)) latestTrusted.set(r.name, r)
  }
  for (const name of policy.requiredChecks) {
    // A required result counts only from the trusted workflow, for this head. A same-named check
    // from another app or workflow is ignored here (it cannot satisfy the requirement) and is still
    // held to the "nothing failed or pending" rule below (so it can only block, never admit).
    const r = latestTrusted.get(name)
    if (!r) return no('wait', latest.has(name) ? `required check "${name}" has not reported from the trusted workflow for ${head.slice(0, 7)} (a same-named check from another source is ignored)` : `required check "${name}" has not reported for ${head.slice(0, 7)}`)
    if (r.status !== 'completed') return no('wait', `required check "${name}" is ${r.status}`)
    if (r.conclusion !== 'success') return no('reject', `required check "${name}" concluded ${r.conclusion}`)
  }
  for (const r of latest.values()) {
    if (r.status !== 'completed') return no('wait', `check "${cleanText(r.name, 60)}" is ${r.status}`)
    if (!OK_CONCLUSIONS.has(r.conclusion)) return no('reject', `check "${cleanText(r.name, 60)}" concluded ${r.conclusion}`)
  }
  return { decision: 'merge', reasons: ['all safety checks passed'], projectId, head: pr.head, mainSha }
}

// Which check runs may satisfy a required check: those created by the trusted app (GitHub Actions)
// for this exact head, inside a check suite that belongs to a run of the trusted workflow file.
// Pending workflow runs without check runs are not waited on: GitHub creates zero-job
// pull_request runs for PRs opened with GITHUB_TOKEN that never start and only conclude when
// the PR closes (docs/ci-cd.md#zero-job-runs), so waiting on them would deadlock.
export async function trustedSource({ client, head, source }) {
  if (!source) return { trusted: () => true }
  if (!Number.isInteger(source.appId) || typeof source.workflowPath !== 'string') throw new Error('sync/automerge.json requiredCheckSource needs appId and workflowPath')
  const list = await client.paginate(`${HUB}/actions/runs?head_sha=${head}`, { max: 200, key: 'workflow_runs' })
  if (list.truncated) return { wait: 'workflow run list is incomplete' }
  const suites = new Set(list.filter(w => w && w.path === source.workflowPath && w.head_sha === head && Number.isInteger(w.check_suite_id)).map(w => w.check_suite_id))
  return {
    trusted: r => Boolean(r && r.app && r.app.id === source.appId && r.head_sha === head && r.check_suite && suites.has(r.check_suite.id))
  }
}

async function currentMain(client) {
  const ref = expectObject(await client.get(`${HUB}/git/ref/heads/${HUB_DEFAULT_BRANCH}`), 'main ref', ['object'])
  return ref.object.sha
}

async function merge({ client, pr, policy, mainSha }) {
  // Re-read the PR immediately before acting: head, state and draft status may have moved.
  // Every field used below must be present, so a partial response fails here, before any write.
  const fresh = expectObject(await client.get(`${HUB}/pulls/${pr.number}`), 'pull request', ['head', 'state', 'draft', 'node_id', 'title'])
  if (fresh.state !== 'open' || fresh.head.sha !== pr.head.sha) return { merged: false, why: 'head changed or PR closed after evaluation; will be re-evaluated' }
  // Main must still be the commit the head was validated on top of, so the squash result equals
  // the validated tree. A move between this read and the merge call is the residual race that only
  // platform branch protection could close (unavailable on this plan; docs/ci-cd.md#merge-race).
  if (mainSha && (await currentMain(client)) !== mainSha) return { merged: false, why: 'main moved after evaluation; will be re-evaluated' }
  if (fresh.draft) {
    await client.request('POST', '/graphql', { body: { query: 'mutation($id: ID!) { markPullRequestReadyForReview(input: {pullRequestId: $id}) { pullRequest { number } } }', variables: { id: fresh.node_id } } })
  }
  try {
    const title = `${cleanText(fresh.title, 150)} (#${pr.number})`
    const res = await client.request('PUT', `${HUB}/pulls/${pr.number}/merge`, { body: { sha: pr.head.sha, merge_method: policy.mergeMethod, commit_title: title, commit_message: 'Merged automatically by the registry auto-merge (sync/automerge.json) after the field-ownership guard, schema validation and required checks passed.' } })
    return { merged: true, sha: res && res.sha }
  } catch (e) {
    if (e instanceof GitHubError && (e.status === 405 || e.status === 409 || e.status === 422)) return { merged: false, why: `GitHub refused the merge (HTTP ${e.status}); conflict, stale head or branch rule` }
    throw e
  }
}

// mergeBudget caps merges in this call; main() passes what is left of policy.maxMergesPerRun so
// retries within one invocation never exceed the per-invocation limit.
export async function run({ client: raw, policy, validate, dryRun = false, only = null, paused = false, healStale = false, mergeBudget = policy.maxMergesPerRun, log = () => {} }) {
  const client = restrictAutomergeWrites(raw)
  const results = []
  if (!policy.enabled || paused) {
    log(`auto-merge ${paused ? 'paused (AUTOMERGE_PAUSED=true)' : 'disabled in sync/automerge.json'}; no PR will be merged`)
    dryRun = true
  }
  const listed = await client.paginate(`${HUB}/pulls?state=open&base=${HUB_DEFAULT_BRANCH}`, { max: 100 })
  const prs = listed.filter(p => p.head && /^sync\//.test(p.head.ref) && (only === null || p.number === only)).sort((a, b) => a.number - b.number)
  let merges = 0
  let stale = 0
  for (const pr of prs) {
    const entry = { number: pr.number, branch: pr.head.ref, decision: null, reasons: [] }
    results.push(entry)
    try {
      const mainSha = await currentMain(client)
      const ev = await evaluate({ client, pr, mainSha, policy, validate })
      Object.assign(entry, ev)
      if (ev.head) pr.head = ev.head
      if (ev.decision === 'wait' && /sync must rebuild/.test(ev.reasons[0])) stale++
      if (ev.decision !== 'merge') continue
      if (dryRun) { entry.decision = 'would-merge'; continue }
      if (merges >= Math.min(mergeBudget, policy.maxMergesPerRun)) { entry.decision = 'wait'; entry.reasons = ['per-run merge limit reached']; continue }
      const m = await merge({ client, pr, policy, mainSha: ev.mainSha })
      if (!m.merged) { entry.decision = 'wait'; entry.reasons = [m.why]; continue }
      merges++
      entry.decision = 'merged'
      entry.mergeSha = m.sha
      // The merge already happened: a failed audit comment is reported as a warning, never as an
      // error on a PR that merged (the merge commit on main is the durable record).
      try {
        await client.request('POST', `${HUB}/issues/${pr.number}/comments`, { body: { body: `Merged automatically as ${m.sha}. Head ${pr.head.sha.slice(0, 7)} touched only automation-owned fields of ${ev.projectId}; guard, schema validation and required checks passed.\n\n---\n_Generated by One Small Engineering Sync_` } })
      } catch (e) {
        entry.warnings = [`merged, but the audit comment could not be posted: ${cleanText(e.message, 160)}`]
      }
    } catch (e) {
      entry.decision = 'error'
      entry.reasons = [cleanText(e.message, 200)]
    }
  }
  // Merging moved main, so remaining sync PRs are stale. Ask sync to rebuild them from main.
  let reconcile = null
  const remaining = results.filter(r => r.decision === 'wait' && /sync must rebuild|re-evaluated/.test(r.reasons[0] || '')).length
  // healStale (scheduled runs only) also rebuilds stale PRs when nothing merged in this run, e.g. after
  // concurrent runs merged them; event-chained runs never do, so sync and auto-merge cannot ping-pong.
  if (!dryRun && policy.reconcileAfterMerge && (merges > 0 || healStale) && (stale > 0 || remaining > 0)) {
    try {
      await client.request('POST', `${HUB}/actions/workflows/registry-sync.yml/dispatches`, { body: { ref: HUB_DEFAULT_BRANCH, inputs: { dry_run: 'false' } } })
      reconcile = 'registry sync dispatched to rebuild remaining sync PRs from the new main'
    } catch (e) {
      reconcile = `could not dispatch registry sync (${cleanText(e.message, 120)}); the next scheduled run rebuilds them`
    }
  }
  return { results, merges, reconcile, dryRun }
}

export function render({ results, merges, reconcile, dryRun }) {
  const lines = ['## Registry auto-merge', '', `${dryRun ? 'Dry run. ' : ''}${merges} merged, ${results.length} sync PR(s) examined.`, '']
  if (results.length) {
    lines.push('| PR | Branch | Decision | Reason |', '| --- | --- | --- | --- |')
    for (const r of results) lines.push(`| #${r.number} | \`${cleanText(r.branch, 60)}\` | ${r.decision} | ${r.reasons.map(x => cleanText(x, 160)).join('; ')} |`)
  }
  if (reconcile) lines.push('', reconcile)
  return lines.join('\n') + '\n'
}

async function main(argv) {
  const dryRun = argv.includes('--dry-run')
  const i = argv.indexOf('--pr')
  const only = i === -1 ? null : Number(argv[i + 1])
  if (only !== null && !Number.isInteger(only)) throw new Error('--pr needs a number')
  const token = process.env.GITHUB_TOKEN
  if (!token) throw new Error('auto-merge needs GITHUB_TOKEN')
  const client = createClient({ token })
  // Policy and schema are read once per invocation; the merge limit applies to the whole invocation.
  const policy = loadPolicy()
  const validate = validator()
  const go = merged => run({ client, policy, validate, dryRun, only, paused: process.env.AUTOMERGE_PAUSED === 'true', healStale: process.env.AUTOMERGE_HEAL === 'true', mergeBudget: policy.maxMergesPerRun - merged, log: t => console.log(safeOutput(t)) })
  // A sync PR's validation may still be running when this is dispatched; wait for it (bounded).
  const waitingOnChecks = o => o.results.some(r => r.decision === 'wait' && /has not reported|is (queued|in_progress)/.test(r.reasons[0] || ''))
  let out = await go(0)
  for (let i = 0; i < 12 && !dryRun && waitingOnChecks(out) && out.merges < policy.maxMergesPerRun; i++) {
    await new Promise(r => setTimeout(r, 30_000))
    const next = await go(out.merges)
    next.merges += out.merges
    out = next
  }
  const md = render(out)
  console.log(safeOutput(md))
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md)
  return out.results.some(r => r.decision === 'error') ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code }, e => { console.error(`::error title=Auto-merge failed::${safeOutput(e.message)}`); process.exitCode = 1 })
}
