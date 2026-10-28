// Remediation preparation and execution (Phase 5, docs/engineering.md).
//
// prepare: for each queue issue with a deterministic fix (today: a lockfile-only dependency
//   update, `npm audit fix --package-lock-only --ignore-scripts`, never --force) that no open
//   remediation PR already covers, check out the exact revision in an isolated directory, apply
//   the fix, re-audit, optionally run the project's own build and tests, and write a proposal:
//   the plan (files, branch, PR body with evidence, gates, validation and rollback) plus its
//   sha256. Nothing is written to GitHub. A fix that does not resolve the issue, touches files it
//   should not or fails the project's tests becomes an issue report instead.
//
// execute: opens ONE draft PR from ONE proposal, and only when every gate holds: the action is on
//   the allowlist, the proposal's digest equals the digest the owner reviewed, writes are enabled
//   (REMEDIATION_WRITE_ENABLED=true), a scoped REMEDIATION_TOKEN exists, --confirm is given, the
//   run is neither scheduled nor a pull_request run, the repository is not protected, and no
//   remediation PR already covers the issue. The Phase 4 client then refuses merges, approvals,
//   deletions, settings, releases, existing branches, protected refs and workflow files.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { checkout, workspaceView, repoParts, AccessError } from '../verify/workspace.mjs'
import { plannedChecks } from '../verify/collectors.mjs'
import { checkPlan, openDraftPR } from '../verify/remediation.mjs'
import { advisoryDetails } from '../verify/collectors.mjs'
import { sha256, canonical } from '../verify/evidence.mjs'
import { redactSensitive } from '../validate-registry.mjs'

export const EXECUTE_ACTIONS = ['open-draft-pr']
export const PROPOSAL_SCHEMA = 1
const SEVERE = new Set(['critical', 'high'])

export class ExecuteRefused extends Error {}

export const proposalDigest = p => sha256(canonical({ ...p, digest: undefined, prepared: undefined }))
export const branchFor = (prefix, issueId) => `${prefix}${issueId.replace(/:/g, '-').replace(/[^a-z0-9-]/gi, '').toLowerCase()}`

// Which issues prepare may act on, and why the others are left as issue reports.
export function selectForPrepare(queue, { protectedRepositories = [], only = null } = {}) {
  const out = { candidates: [], skipped: [] }
  const prot = new Set(protectedRepositories.map(r => r.toLowerCase()))
  for (const i of queue) {
    if (only && !only.includes(i.project)) continue
    if (!i.autoFix) { if (i.priority <= 4 && i.kind !== 'access') out.skipped.push({ id: i.id, reason: i.relatedPRs.length ? `covered by ${i.relatedPRs.map(p => p.url).join(', ')}` : 'no deterministic fix; issue report only' }); continue }
    let repo = null
    try { const r = repoParts(i.repository); repo = `${r.owner}/${r.repo}`.toLowerCase() } catch { out.skipped.push({ id: i.id, reason: 'no repository' }); continue }
    if (prot.has(repo)) { out.skipped.push({ id: i.id, reason: `${repo} is protected from automated writes` }); continue }
    if (i.relatedPRs.some(p => ['open', 'draft', 'unknown'].includes(p.status))) { out.skipped.push({ id: i.id, reason: `covered by ${i.relatedPRs.map(p => p.url).join(', ')}` }); continue }
    out.candidates.push(i)
  }
  return out
}

function body({ issue, project, baseSha, validation, audit, rollback }) {
  const L = []
  L.push(`Prepared by One Small Engineering (\`npm run engineering:prepare\`). Draft for review; it is not verified and has no owner sign-off.`, '')
  L.push(`## Issue`, '', `- ${issue.title}`, `- Project: ${project.id}; base commit ${baseSha}`, `- Priority: ${issue.priorityText} (${issue.severity}); confidence ${issue.confidence}`, `- Evidence: ${issue.evidence.join(', ')}`, '')
  L.push('## Change', '', 'Lockfile-only dependency update within the ranges package.json already allows (`npm audit fix --package-lock-only --ignore-scripts`, no `--force`). No source, test or workflow file changes.', '')
  L.push('## Audit before and after', '', `- Before: ${audit.before}`, `- After: ${audit.after}`, '')
  L.push('## Validation', '', ...validation.map(v => `- ${v.name}: ${v.result}${v.detail ? ` (${v.detail})` : ''}`), '', 'Project CI on this PR is the authoritative check. Gates affected: supply-chain-review, security-privacy-review; the registry verifier records them, not this PR.', '')
  L.push('## Rollback', '', rollback, '')
  return redactSensitive(L.join('\n'))
}

const auditCounts = report => { const v = (report && report.metadata && report.metadata.vulnerabilities) || {}; return ['critical', 'high', 'moderate'].map(k => `${k} ${v[k] || 0}`).join(', ') }

// Prepares one proposal. deps: { run, workRoot, execute, now, policy, profiles }.
export function prepareOne(issue, project, deps) {
  const dir = join(deps.workRoot, `prepare-${project.id}`)
  const fail = reason => ({ prepared: false, id: issue.id, reason })
  try { checkout(deps.run, project.repository, issue.revision, dir) } catch (e) { return fail(e instanceof AccessError ? `checkout: ${e.message}` : 'checkout failed') }
  const view = workspaceView(dir)
  const lockBefore = view.read('package-lock.json')
  const pkgBefore = view.read('package.json')
  if (!lockBefore) return fail('no package-lock.json')
  const audit = args => { const r = deps.run('npm', ['audit', '--json', '--package-lock-only', ...args], { cwd: dir, timeoutMs: 300_000 }); try { return JSON.parse(r.stdout) } catch { return null } }
  const before = audit([])
  const fix = deps.run('npm', ['audit', 'fix', '--package-lock-only', '--ignore-scripts', '--no-fund'], { cwd: dir, timeoutMs: 600_000 })
  if (fix.status === null) return fail('npm audit fix did not run')
  const lockAfter = view.read('package-lock.json')
  const pkgAfter = view.read('package.json')
  if (lockAfter === lockBefore && pkgAfter === pkgBefore) return fail('npm audit fix changed nothing; a deterministic fix is not available')
  const after = audit([])
  const remaining = advisoryDetails(after || {}, null).filter(a => SEVERE.has(a.severity) && issue.autoFix.packages.includes(a.name)).map(a => a.name)
  if (!after) return fail('re-audit gave no readable report')
  if (remaining.length === issue.autoFix.packages.length) return fail(`the update resolved none of ${remaining.join(', ')}`)
  const validation = [{ name: 'targeted advisories resolved', result: remaining.length ? 'partial' : 'pass', detail: remaining.length ? `still open: ${remaining.join(', ')}` : issue.autoFix.packages.join(', ') }]
  if (deps.execute) {
    const inst = deps.run('npm', ['ci', '--ignore-scripts'], { cwd: dir, timeoutMs: 900_000 })
    validation.push({ name: 'npm ci --ignore-scripts', result: inst.status === 0 ? 'pass' : 'fail' })
    if (inst.status === 0) for (const c of plannedChecks(view, (deps.profiles.projects || {})[project.id] || {}).filter(c => ['build', 'test'].includes(c.kind))) {
      const r = deps.run(c.cmd[0], c.cmd.slice(1), { cwd: dir, timeoutMs: 900_000 })
      validation.push({ name: c.cmd.join(' '), result: r.status === 0 ? 'pass' : r.timedOut ? 'timed out' : 'fail' })
    }
    if (validation.some(v => v.result !== 'pass' && v.name !== 'targeted advisories resolved')) return { ...fail('the project build or tests did not pass with the update; left as an issue report'), validation }
  } else validation.push({ name: 'project build and tests', result: 'not run here', detail: 'run with --execute in an isolated job, or rely on the PR\'s own CI' })
  const files = [{ path: 'package-lock.json', content: lockAfter }, ...(pkgAfter !== pkgBefore ? [{ path: 'package.json', content: pkgAfter }] : [])]
  const rp = deps.policy.remediation || {}
  const title = `fix(deps): ${issue.autoFix.packages.length} advisory update(s) (${issue.severity})`
  const rollback = `Close this draft PR, or after a merge revert its single commit (git revert <commit>); only ${files.map(f => f.path).join(' and ')} change. Re-run npm ci and the test suite after reverting.`
  const plan = {
    schema: PROPOSAL_SCHEMA,
    issueId: issue.id,
    action: 'open-draft-pr',
    repository: project.repository,
    baseRef: project.repositorySnapshot.defaultBranch || 'main',
    baseSha: issue.revision,
    branch: branchFor(rp.branchPrefix || 'verify/remediation/', issue.id),
    title,
    body: body({ issue, project, baseSha: issue.revision, validation, audit: { before: auditCounts(before), after: auditCounts(after) }, rollback }),
    findings: [{ kind: 'defect', proposedFix: 'lockfile-only dependency update', repository: project.repository, commitSha: issue.revision, id: issue.id }],
    files,
    validation,
    rollback,
    gates: ['supply-chain-review', 'security-privacy-review']
  }
  const refusals = checkPlan(plan, deps.policy)
  if (refusals.length) return fail(`plan refused by the remediation guard: ${refusals.join('; ')}`)
  plan.digest = proposalDigest(plan)
  plan.prepared = { at: deps.now(), execute: Boolean(deps.execute) }
  return { prepared: true, id: issue.id, proposal: plan }
}

export function writeProposal(outDir, proposal) {
  const f = join(outDir, `${proposal.issueId.replace(/:/g, '-')}.json`)
  mkdirSync(dirname(f), { recursive: true })
  writeFileSync(f, JSON.stringify(proposal, null, 2) + '\n')
  return f
}

// Every reason an execute call must not write. [] means it may proceed.
export function executeRefusals({ proposal, reviewedDigest, env, confirm, policy, coveredBy = [] }) {
  const r = []
  if (!proposal || proposal.schema !== PROPOSAL_SCHEMA) r.push('not a proposal file')
  else {
    if (!EXECUTE_ACTIONS.includes(proposal.action)) r.push(`action ${JSON.stringify(proposal.action)} is not on the execute allowlist (${EXECUTE_ACTIONS.join(', ')})`)
    if (proposalDigest(proposal) !== proposal.digest) r.push('proposal content does not match its digest (edited after preparation)')
    if (!reviewedDigest || reviewedDigest !== proposal.digest) r.push('the reviewed digest does not match this proposal; review the prepared proposal and pass its digest')
    r.push(...checkPlan(proposal, policy))
  }
  if (!confirm) r.push('--confirm was not given')
  if (env.REMEDIATION_WRITE_ENABLED !== 'true') r.push('writes are disabled (REMEDIATION_WRITE_ENABLED is not true)')
  if (!env.REMEDIATION_TOKEN) r.push('REMEDIATION_TOKEN is not set (a fine-grained token scoped to the target repository)')
  if (env.GITHUB_EVENT_NAME === 'schedule') r.push('scheduled runs never write')
  if (/^pull_request/.test(env.GITHUB_EVENT_NAME || '')) r.push('pull request runs never write')
  if (coveredBy.length) r.push(`already covered by ${coveredBy.join(', ')}; no duplicate PR`)
  return r
}

export async function executeProposal({ proposal, reviewedDigest, env, confirm, policy, coveredBy, client }) {
  const refusals = executeRefusals({ proposal, reviewedDigest, env, confirm, policy, coveredBy })
  if (refusals.length) return { created: false, refused: refusals }
  return openDraftPR(client, proposal, policy, { repository: proposal.repository, confirmed: true, scheduled: false })
}

export function readProposal(file) {
  if (!existsSync(file)) throw new ExecuteRefused(`no proposal at ${file}`)
  return JSON.parse(readFileSync(file, 'utf8'))
}
