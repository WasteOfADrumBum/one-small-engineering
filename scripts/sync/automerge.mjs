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
export async function evaluate({ client, pr, mainSha, policy, validate }) {
  const no = (decision, ...reasons) => ({ decision, reasons })
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

  const reviews = expectArray(await client.get(`${HUB}/pulls/${pr.number}/reviews?per_page=100`), 'reviews')
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

  const runs = await client.paginate(`${HUB}/commits/${head}/check-runs`, { max: 100, key: 'check_runs' })
  if (runs.truncated) return no('wait', 'check run list is incomplete')
  const latest = new Map()
  for (const r of runs) if (!latest.has(r.name) || latest.get(r.name).id < r.id) latest.set(r.name, r)
  for (const name of policy.requiredChecks) {
    const r = latest.get(name)
    if (!r) return no('wait', `required check "${name}" has not reported for ${head.slice(0, 7)}`)
    if (r.status !== 'completed') return no('wait', `required check "${name}" is ${r.status}`)
    if (r.conclusion !== 'success') return no('reject', `required check "${name}" concluded ${r.conclusion}`)
  }
  for (const r of latest.values()) {
    if (r.status !== 'completed') return no('wait', `check "${cleanText(r.name, 60)}" is ${r.status}`)
    if (!OK_CONCLUSIONS.has(r.conclusion)) return no('reject', `check "${cleanText(r.name, 60)}" concluded ${r.conclusion}`)
  }
  return { decision: 'merge', reasons: ['all safety checks passed'], projectId }
}

async function currentMain(client) {
  const ref = expectObject(await client.get(`${HUB}/git/ref/heads/${HUB_DEFAULT_BRANCH}`), 'main ref', ['object'])
  return ref.object.sha
}

async function merge({ client, pr, policy }) {
  // Re-read the PR immediately before acting: head, state and draft status may have moved.
  const fresh = expectObject(await client.get(`${HUB}/pulls/${pr.number}`), 'pull request', ['head', 'state'])
  if (fresh.state !== 'open' || fresh.head.sha !== pr.head.sha) return { merged: false, why: 'head changed or PR closed after evaluation; will be re-evaluated' }
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

export async function run({ client: raw, policy, validate, dryRun = false, only = null, paused = false, log = () => {} }) {
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
      if (ev.decision === 'wait' && /sync must rebuild/.test(ev.reasons[0])) stale++
      if (ev.decision !== 'merge') continue
      if (dryRun) { entry.decision = 'would-merge'; continue }
      if (merges >= policy.maxMergesPerRun) { entry.decision = 'wait'; entry.reasons = ['per-run merge limit reached']; continue }
      const m = await merge({ client, pr, policy })
      if (!m.merged) { entry.decision = 'wait'; entry.reasons = [m.why]; continue }
      merges++
      entry.decision = 'merged'
      entry.mergeSha = m.sha
      await client.request('POST', `${HUB}/issues/${pr.number}/comments`, { body: { body: `Merged automatically as ${m.sha}. Head ${pr.head.sha.slice(0, 7)} touched only automation-owned fields of ${ev.projectId}; guard, schema validation and required checks passed.\n\n---\n_Generated by One Small Engineering Sync_` } })
    } catch (e) {
      entry.decision = 'error'
      entry.reasons = [cleanText(e.message, 200)]
    }
  }
  // Merging moved main, so remaining sync PRs are stale. Ask sync to rebuild them from main.
  let reconcile = null
  const remaining = results.filter(r => r.decision === 'wait' && /sync must rebuild|re-evaluated/.test(r.reasons[0] || '')).length
  if (!dryRun && policy.reconcileAfterMerge && merges > 0 && (stale > 0 || remaining > 0)) {
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
  const out = await run({ client: createClient({ token }), policy: loadPolicy(), validate: validator(), dryRun, only, paused: process.env.AUTOMERGE_PAUSED === 'true', log: t => console.log(safeOutput(t)) })
  const md = render(out)
  console.log(safeOutput(md))
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md)
  return out.results.some(r => r.decision === 'error') ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code }, e => { console.error(`::error title=Auto-merge failed::${safeOutput(e.message)}`); process.exitCode = 1 })
}
