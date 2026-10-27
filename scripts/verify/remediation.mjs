// Remediation: issue reports for every finding, and scoped draft PRs in project repositories
// for confirmed defects with a clear fix (Phase 4, docs/verification.md).
//
// Safety rules enforced in code, not only in documentation:
// - Writes are off unless the caller passes an explicit authorization naming the repository and
//   the run is not scheduled; scheduled runs can never write.
// - Only a new branch under the policy prefix is created. An existing branch is never updated,
//   force-pushed or deleted; main, master and protected refs are never written.
// - Only draft PRs are opened. The client refuses merge, review-approval, delete, visibility and
//   release endpoints outright, whatever the caller asks.
// - A plan may change only the files it lists, at most maxFilesPerPullRequest, never a workflow
//   file, and only for findings of kind "defect" with a proposed fix.

import { repoParts } from './workspace.mjs'
import { redactSensitive } from '../validate-registry.mjs'

export class RemediationRefused extends Error {}

// Every endpoint the remediation client may call. Anything else is refused before it is sent.
const ALLOWED = [
  ['GET', /^\/repos\/[\w.-]+\/[\w.-]+$/],
  ['GET', /^\/repos\/[\w.-]+\/[\w.-]+\/git\/ref\/heads\/[\w./-]+$/],
  ['GET', /^\/repos\/[\w.-]+\/[\w.-]+\/git\/commits\/[0-9a-f]{40}$/],
  ['POST', /^\/repos\/[\w.-]+\/[\w.-]+\/git\/blobs$/],
  ['POST', /^\/repos\/[\w.-]+\/[\w.-]+\/git\/trees$/],
  ['POST', /^\/repos\/[\w.-]+\/[\w.-]+\/git\/commits$/],
  ['POST', /^\/repos\/[\w.-]+\/[\w.-]+\/git\/refs$/],
  ['POST', /^\/repos\/[\w.-]+\/[\w.-]+\/pulls$/]
]

// Wraps a GitHub client so only the allowlisted calls go through.
export function guardedClient(client) {
  const check = (method, path) => {
    if (!ALLOWED.some(([m, re]) => m === method && re.test(path.split('?')[0]))) throw new RemediationRefused(`refused ${method} ${path.split('?')[0]}: not a remediation endpoint (merging, approving, deleting, releasing and settings changes are never allowed)`)
  }
  return {
    get(path, opts) { check('GET', path); return client.request('GET', path, opts) },
    request(method, path, opts) { check(method, path); return client.request(method, path, opts) }
  }
}

// A Markdown issue report for one finding. Values that look sensitive are redacted.
export function issueReport(f) {
  const L = [`## ${f.title}`, '']
  L.push(`- Project: ${f.project} (${f.repository})`)
  L.push(`- Commit: ${f.commitSha || 'unknown'}`)
  L.push(`- Gate(s): ${f.gates.length ? f.gates.join(', ') : 'none (context)'}`)
  L.push(`- Severity: ${f.severity}; kind: ${f.kind}; release impact: ${f.releaseImpact}`)
  L.push(`- Evidence: ${f.evidenceId}`)
  L.push('', '### Reproduction', '', '```text', f.reproduction, '```', '')
  L.push('### Root cause', '', f.rootCause || 'Not established. The collector could not decide; see the failure reason.', '')
  L.push('### Failure reason', '', f.failureReason || 'None recorded.', '')
  L.push('### Proposed fix', '', f.proposedFix || 'No fix proposed by automation. A person decides the fix.', '')
  L.push('### Acceptance criteria', '', f.acceptance, '')
  L.push('### Verification required', '', ...(f.verification.length ? f.verification.map(v => `- ${v}`) : ['- None beyond re-collection.']), '')
  return redactSensitive(L.join('\n'))
}

// Validates a remediation plan against the safety rules. Returns a list of reasons it is refused.
//   plan: { repository, baseRef, baseSha, branch, title, body, findings: [finding], files: [{ path, content }] }
export function checkPlan(plan, policy) {
  const r = []
  const rp = policy.remediation || {}
  let parts = null
  try { parts = repoParts(plan.repository) } catch (e) { r.push(e.message) }
  if (parts && (rp.protectedRepositories || []).map(x => x.toLowerCase()).includes(`${parts.owner}/${parts.repo}`.toLowerCase())) r.push(`${parts.owner}/${parts.repo} is protected from automated writes`)
  if (typeof plan.branch !== 'string' || !plan.branch.startsWith(rp.branchPrefix || 'verify/remediation/')) r.push(`branch must start with ${rp.branchPrefix}`)
  if (typeof plan.branch === 'string' && (/\.\.|[~^:?*[\\\s]|\/\/|\/$|\.lock$/.test(plan.branch))) r.push('branch name is not a safe git ref')
  if ((rp.protectedRefs || []).includes(plan.branch)) r.push(`${plan.branch} is a protected ref`)
  if (!/^[0-9a-f]{40}$/.test(plan.baseSha || '')) r.push('baseSha must be the exact base commit')
  const defects = (plan.findings || []).filter(f => f.kind === 'defect' && f.proposedFix)
  if (!plan.findings || !plan.findings.length) r.push('a remediation PR needs at least one finding')
  else if (defects.length !== plan.findings.length) r.push('only confirmed defects with a proposed fix can be remediated by PR; the rest become issue reports')
  if (plan.findings && plan.findings.some(f => f.repository && f.repository.toLowerCase() !== String(plan.repository).toLowerCase())) r.push('every finding must belong to the plan\'s repository (one PR per repository)')
  if (plan.findings && plan.findings.some(f => f.commitSha && f.commitSha !== plan.baseSha)) r.push('findings must be for the base commit; re-collect on the current base first')
  if (!Array.isArray(plan.files) || !plan.files.length) r.push('a plan must list the files it changes')
  else {
    if (plan.files.length > (rp.maxFilesPerPullRequest || 20)) r.push(`at most ${rp.maxFilesPerPullRequest} files per PR`)
    for (const f of plan.files) {
      if (typeof f.path !== 'string' || !f.path || f.path.startsWith('/') || f.path.split('/').includes('..') || f.path.includes('\\')) r.push(`unsafe path ${JSON.stringify(f.path)}`)
      else if (/^\.github\/workflows\//.test(f.path)) r.push(`${f.path}: workflow files are never changed by automation`)
      if (typeof f.content !== 'string') r.push(`${f.path}: content must be text`)
    }
    if (new Set(plan.files.map(f => f.path)).size !== plan.files.length) r.push('a file is listed twice')
  }
  if (!plan.title || !plan.body) r.push('title and body are required')
  if (/\b(approve|approved|LGTM)\b/i.test(plan.body || '')) r.push('a remediation PR body must not claim approval')
  return r
}

// Creates the branch and draft PR. Requires `authorization` = { repository, confirmed: true,
// scheduled: false }. Idempotent: an existing branch is never touched; the result says so.
export async function openDraftPR(client, plan, policy, authorization) {
  const refusals = checkPlan(plan, policy)
  if (!authorization || authorization.confirmed !== true) refusals.push('writes are not authorized for this run')
  else {
    if (authorization.scheduled) refusals.push('scheduled runs never create remediation branches or PRs')
    if (String(authorization.repository).toLowerCase() !== String(plan.repository).toLowerCase()) refusals.push('the authorization names a different repository')
  }
  if (refusals.length) return { created: false, refused: refusals }
  const gh = guardedClient(client)
  const { owner, repo } = repoParts(plan.repository)
  const base = `/repos/${owner}/${repo}`
  const existing = await gh.request('GET', `${base}/git/ref/heads/${plan.branch}`, { allow404: true })
  if (existing) return { created: false, refused: [`branch ${plan.branch} already exists; it is never rewritten (use a new branch name)`] }
  const baseCommit = await gh.get(`${base}/git/commits/${plan.baseSha}`)
  if (!baseCommit || !baseCommit.tree || !baseCommit.tree.sha) return { created: false, refused: ['base commit not readable'] }
  const tree = []
  for (const f of [...plan.files].sort((a, b) => a.path.localeCompare(b.path))) {
    const blob = await gh.request('POST', `${base}/git/blobs`, { body: { content: f.content, encoding: 'utf-8' } })
    tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha })
  }
  const newTree = await gh.request('POST', `${base}/git/trees`, { body: { base_tree: baseCommit.tree.sha, tree } })
  const commit = await gh.request('POST', `${base}/git/commits`, { body: { message: plan.title, tree: newTree.sha, parents: [plan.baseSha] } })
  await gh.request('POST', `${base}/git/refs`, { body: { ref: `refs/heads/${plan.branch}`, sha: commit.sha } })
  const pr = await gh.request('POST', `${base}/pulls`, { body: { title: plan.title, head: plan.branch, base: plan.baseRef, body: redactSensitive(plan.body), draft: true, maintainer_can_modify: true } })
  return { created: true, refused: [], branch: plan.branch, commitSha: commit.sha, pullRequest: pr ? { number: pr.number, url: pr.html_url, draft: pr.draft } : null }
}

// Groups defects by repository so each repository gets at most one remediation PR.
export function groupByRepository(findings) {
  const out = new Map()
  for (const f of findings.filter(f => f.kind === 'defect')) {
    const k = f.repository.toLowerCase()
    if (!out.has(k)) out.set(k, [])
    out.get(k).push(f)
  }
  return out
}
