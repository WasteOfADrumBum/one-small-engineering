// Remediation queue (Phase 5, docs/engineering.md).
//
// Turns everything the other stages found into one ranked, deduplicated list of issues. Sources:
// collector findings at the evaluated commit, dependency advisories (triaged by production
// exposure and fix type), registry and derived blockers, missing ownership and verification,
// stale evidence, repository access, dependency impacts and open remediation PRs.
//
// Deduplication: an issue's id is a fingerprint without the commit (project:source:key), so the
// same underlying problem keeps one id across runs and revisions. Issues that several projects
// share because of one owner action (assigning verifiers) are one portfolio issue. A remediation
// PR that already covers an issue is attached to it instead of producing a second fix.
//
// Pure: same inputs, same queue.

export const PRIORITIES = {
  1: 'Critical security',
  2: 'Broken build or failing required CI',
  3: 'Release-blocking defect',
  4: 'High-severity vulnerability',
  5: 'Cross-project compatibility',
  6: 'Accessibility',
  7: 'Missing verification or documentation',
  8: 'Lower-priority technical debt'
}
export const ACTION_CLASSES = {
  automatic: 'Automatically actionable',
  'independent-verification': 'Requires independent verification',
  'owner-decision': 'Requires owner decision',
  'blocked-credentials': 'Blocked by credentials or environment',
  informational: 'Informational'
}
const SEV = ['critical', 'high', 'medium', 'low', 'info']
const short = s => String(s || 'unknown').slice(0, 7)

function issue(base) {
  return { projects: [base.project], revision: null, rootCause: null, complexity: 'unknown', validation: [], confidence: 'medium', evidence: [], relatedPRs: [], crossProject: [], ...base }
}

// Advisory issues for one project from the dependency-audit record's triage detail.
export function advisoryIssues(p, record, sharedWith = new Map()) {
  const adv = (record && record.details && record.details.advisories) || []
  const groups = new Map()
  for (const a of adv) {
    const prodKnown = a.production !== null && a.production !== undefined
    const exposed = !prodKnown || a.production
    let key
    if (a.severity === 'critical') key = exposed ? 'critical-production' : 'critical-dev'
    else if (a.severity === 'high') key = exposed ? 'high-production' : 'high-dev'
    else key = 'moderate'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(a)
  }
  const meta = {
    'critical-production': [1, 'critical', 'critical advisories in production dependencies'],
    'high-production': [4, 'high', 'high advisories in production dependencies'],
    'critical-dev': [4, 'medium', 'critical advisories in development tooling only (not shipped; runs in CI and on developer machines)'],
    'high-dev': [8, 'low', 'high advisories in development tooling only (not shipped)'],
    moderate: [8, 'low', 'moderate advisories']
  }
  const out = []
  for (const [key, list] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const [priority, severity, what] = meta[key]
    const names = list.map(a => a.name)
    const majors = list.filter(a => a.fix === 'major')
    const none = list.filter(a => a.fix === 'none')
    const deterministic = !majors.length && !none.length && record.details && record.details.productionAudit !== undefined
    const shared = [...new Set(names.flatMap(n => sharedWith.get(n) || []))].filter(x => x !== p.id).sort()
    out.push(issue({
      id: `${p.id}:advisory:${key}`,
      project: p.id,
      repository: p.repository,
      revision: record.commitSha,
      priority,
      severity,
      kind: 'vulnerability',
      title: `${list.length} ${what}: ${names.join(', ')}`,
      rootCause: `npm audit at ${short(record.commitSha)}: ${list.map(a => `${a.name} (${a.severity}${a.direct ? ', direct' : ''}${a.production === true ? ', production' : a.production === false ? ', dev only' : ', exposure unknown'}, fix ${a.fix}${a.fixVia ? ` via ${a.fixVia}` : ''})`).join('; ')}`,
      impact: key.endsWith('dev') ? 'Not in the shipped bundle or server; affects build and test tooling. Release impact: supply-chain-review stays unverified.' : key === 'moderate' ? 'Low; tracked as technical debt.' : 'Reachable from production dependencies. Release impact: blocks supply-chain-review and security-privacy-review.',
      proposedCorrection: majors.length ? `Upgrade needs a major version (${majors.map(a => a.fixVia || a.name).join(', ')}): review breaking changes before changing it.` : none.length ? `No fix published for ${none.map(a => a.name).join(', ')}: assess reachability and mitigate or accept with a written rationale.` : 'Lockfile-only update within declared ranges (npm audit fix, without --force).',
      complexity: majors.length ? 'medium' : none.length ? 'unknown' : 'small',
      validation: ['npm ci --ignore-scripts and the project test suite pass at the fix commit', 'dependency-audit collector reports no critical/high advisories', 'an independent verifier records supply-chain-review'],
      confidence: record.details && record.details.productionAudit === 'ran' ? 'high' : 'medium',
      evidence: [record.id],
      crossProject: shared,
      actionClass: deterministic && key !== 'moderate' ? 'automatic' : key === 'moderate' || key === 'high-dev' ? 'informational' : 'owner-decision',
      autoFix: deterministic ? { type: 'npm-audit-fix', packages: names } : null,
      nextAction: majors.length ? `Decide on the major upgrade for ${majors.map(a => a.name).join(', ')} in ${p.id}.` : deterministic ? `Prepare a lockfile fix for ${p.id} (npm run engineering:prepare -- --project ${p.id}).` : `Assess ${names.join(', ')} in ${p.id}.`
    }))
  }
  return out
}

const COLLECTOR_RULES = {
  // collector: [priority if fail, severity if fail, priority if inconclusive]
  'secret-scan': [1, 'critical', 7],
  'build-test': [2, 'high', 7],
  'ci-results': [2, 'high', 7],
  'lint-format-types': [2, 'medium', 7],
  'deployment-health': [2, 'high', 7],
  'release-packaging': [3, 'medium', 7],
  compatibility: [5, 'medium', 7],
  accessibility: [6, 'medium', 6],
  documentation: [7, 'low', 7],
  'dependency-audit': [4, 'high', 7],
  'repo-structure': [8, 'low', 8]
}

const accessFix = reason => /not visible|private|reader credential/i.test(reason || '') ? 'Provide a read-only reader credential (repository secret SYNC_READER_TOKEN, read-only Metadata, Contents, Pull requests and Actions on that repository only) or take the project out of active monitoring.' : 'Run where the GitHub API is reachable: the engineering workflow in GitHub Actions has a read-only token for this.'

export function collectorIssues(p, v, { hasAdvisoryDetail = false } = {}) {
  const out = []
  const candidate = Boolean(p.release.candidate)
  // Collectors that could not reach the repository or the API: one issue per project and reason.
  const access = new Map()
  for (const f of v.findings.filter(f => f.kind === 'access')) {
    const k = f.failureReason || f.title
    if (!access.has(k)) access.set(k, [])
    access.get(k).push(f)
  }
  for (const [reason, list] of access) {
    const names = list.map(f => f.collector).sort()
    out.push(issue({ id: `${p.id}:access:${names.join('+')}`, project: p.id, repository: p.repository, revision: list[0].commitSha, priority: 7, severity: 'medium', kind: 'access', title: `${names.length === 1 ? names[0] : `${names.length} collectors`} unavailable: ${reason}`, rootCause: reason, impact: `No evidence for ${[...new Set(list.flatMap(f => f.gates))].sort().join(', ') || 'context'}; unavailable is never a pass.`, proposedCorrection: accessFix(reason), complexity: 'trivial', validation: ['the collectors report a result other than unavailable'], confidence: 'high', evidence: list.map(f => f.evidenceId), actionClass: 'blocked-credentials', nextAction: accessFix(reason).split(':')[0] + '.', accessReason: reason, collectors: names }))
  }
  for (const f of v.findings) {
    if (f.kind === 'access') continue
    if (f.collector === 'dependency-audit' && f.kind === 'defect' && hasAdvisoryDetail) continue
    const [pf, sf, pi] = COLLECTOR_RULES[f.collector] || [7, 'medium', 7]
    const defect = f.kind === 'defect'
    const priority = defect ? (f.collector === 'release-packaging' && !candidate ? 7 : pf) : pi
    const manual = /manual|human review|person/i.test(f.failureReason || '')
    out.push(issue({
      id: `${p.id}:collector:${f.collector}`,
      project: p.id,
      repository: p.repository,
      revision: f.commitSha,
      priority,
      severity: defect ? sf : 'low',
      kind: defect ? (f.collector === 'dependency-audit' ? 'vulnerability' : 'defect') : 'evidence-gap',
      title: f.title,
      rootCause: f.rootCause || f.failureReason,
      impact: f.releaseImpact,
      proposedCorrection: defect ? 'A developer fixes the cause at the evaluated commit; automation does not guess code fixes.' : manual ? 'A person performs the manual review and the verifier records it.' : 'Configure or run the missing check, then re-collect.',
      complexity: defect ? 'medium' : manual ? 'small' : 'small',
      validation: f.verification.length ? f.verification : [f.acceptance],
      confidence: defect ? 'high' : 'medium',
      evidence: [f.evidenceId],
      actionClass: defect ? 'owner-decision' : manual ? 'independent-verification' : priority === 8 ? 'informational' : 'independent-verification',
      nextAction: defect ? `Fix ${f.collector} in ${p.id} at ${short(f.commitSha)}.` : `${manual ? 'Review' : 'Complete'} ${f.collector} for ${p.id}.`
    }))
  }
  return out
}

const BLOCKER_PRIORITY = { security: 1, ci: 2, defect: 3, dependency: 5, accessibility: 6, documentation: 7, distribution: 3 }

export function blockerIssues(p, v) {
  const out = []
  for (const b of v.blockers) {
    if (b.origin === 'registry' && b.category === 'approval') {
      out.push(issue({ id: `${p.id}:blocker:${b.id}`, project: p.id, repository: p.repository, revision: v.target.sha, priority: 7, severity: 'low', kind: 'approval', title: b.description, rootCause: `Registry blocker ${b.id} (approval).`, impact: 'The release cannot ship without the owner\'s authorization.', proposedCorrection: 'The owner decides after verification is complete; automation never records approval.', complexity: 'trivial', validation: ['approval recorded in the registry with evidence for the candidate commit'], confidence: 'high', evidence: [`registry:${p.id}:${b.id}`], actionClass: 'owner-decision', nextAction: `Owner: decide on ${b.id} once ${p.id} is verified.` }))
      continue
    }
    if (b.origin === 'registry') {
      const priority = b.category === 'security' && !['critical', 'high', 'unclassified'].includes(b.severity) ? 4 : BLOCKER_PRIORITY[b.category] || 3
      out.push(issue({ id: `${p.id}:blocker:${b.id}`, project: p.id, repository: p.repository, revision: v.target.sha, priority, severity: b.severity && b.severity !== 'unclassified' ? b.severity : 'medium', kind: 'blocker', title: b.description, rootCause: `Registry blocker ${b.id} (${b.category}, blocks ${b.blocks}).`, impact: `Blocks ${b.blocks}.`, proposedCorrection: 'Resolve the cause, then record the resolution with evidence in a registry PR.', complexity: b.category === 'scope' ? 'large' : 'medium', validation: ['the blocker is marked resolved in the registry with resolution evidence'], confidence: 'high', evidence: [`registry:${p.id}:${b.id}`], actionClass: 'owner-decision', nextAction: `Resolve ${b.id} in ${p.id}.` }))
      continue
    }
    if (/^auto-(gate-failed|ci-failed)/.test(b.id)) out.push(issue({ id: `${p.id}:blocker:${b.id}`, project: p.id, repository: p.repository, revision: v.target.sha, priority: b.category === 'ci' ? 2 : 3, severity: 'high', kind: 'blocker', title: b.description, impact: `Blocks ${b.blocks}.`, proposedCorrection: 'Fix the recorded failure; never skip or disable tests.', complexity: 'medium', validation: ['a passing re-run at the candidate commit'], confidence: 'high', evidence: [], actionClass: 'owner-decision', nextAction: `Fix ${b.id.replace(/^auto-/, '')} in ${p.id}.` }))
    else if (/^auto-dependency/.test(b.id)) out.push(issue({ id: `${p.id}:blocker:${b.id}`, project: p.id, repository: p.repository, revision: v.target.sha, priority: 5, severity: 'high', kind: 'dependency', title: b.description, impact: 'Blocks release until the dependency is released.', proposedCorrection: 'Release the dependency first, or record an owner decision that it is no longer required.', complexity: 'medium', validation: ['dependency released at minVersion'], confidence: 'high', actionClass: 'owner-decision', nextAction: b.description }))
    else if (b.id === 'auto-scope-missing') out.push(issue({ id: `${p.id}:scope`, project: p.id, repository: p.repository, revision: v.target.sha, priority: 7, severity: 'medium', kind: 'scope', title: b.description, impact: 'No release can be verified until it is scoped.', proposedCorrection: 'Commit a scope document and set release.targetVersion in the registry.', complexity: 'medium', validation: ['registry validator passes with targetVersion and scopeDocument'], confidence: 'high', actionClass: 'owner-decision', nextAction: `Scope the next ${p.id} release.` }))
    else if (b.id === 'auto-candidate-moved' || /^auto-stale-/.test(b.id)) out.push(issue({ id: `${p.id}:blocker:${b.id}`, project: p.id, repository: p.repository, revision: v.target.sha, priority: 7, severity: 'medium', kind: 'stale', title: b.description, impact: 'Evidence no longer matches the candidate.', proposedCorrection: 'Record the current candidate in the registry and re-collect.', complexity: 'small', validation: ['evidence current for the candidate commit'], confidence: 'high', actionClass: 'owner-decision', nextAction: b.description }))
  }
  return out
}

// One portfolio issue for projects without a builder and independent verifier.
export function ownershipIssue(registry) {
  const missing = registry.projects.filter(p => p.tier !== 'legacy' && (!p.ownership.builder || !p.ownership.verifier || p.ownership.builder === p.ownership.verifier)).map(p => p.id)
  if (!missing.length) return []
  return [issue({ id: 'portfolio:ownership', project: 'portfolio', projects: missing, repository: null, priority: 7, severity: 'high', kind: 'governance', title: `${missing.length} project(s) have no builder and independent verifier assigned, so no gate can be independently verified`, rootCause: 'ownership.builder / ownership.verifier are null in the registry (owner rule: assign when a release is scoped).', impact: 'Every project stays at 0% verified readiness.', proposedCorrection: 'Assign a builder and a different, independent verifier for each project with a scoped release (registry PR).', complexity: 'trivial', validation: ['registry validator passes', 'verification records by the assigned verifier are accepted'], confidence: 'high', evidence: missing.map(id => `registry:${id}:ownership`), actionClass: 'owner-decision', nextAction: 'Assign builder and verifier per project (owner decision).' })]
}

export function verificationIssue(p, v) {
  const open = v.missingVerification
  if (!open.length) return []
  return [issue({ id: `${p.id}:verification`, project: p.id, repository: p.repository, revision: v.target.sha, priority: 7, severity: 'medium', kind: 'verification', title: `${open.length} applicable gate(s) without independent verification (${v.readiness.verifiedGates}/${v.readiness.applicableGates} verified)`, impact: 'Release readiness cannot rise above the verified share.', proposedCorrection: 'The assigned verifier re-checks current evidence and records each gate (npm run verify:record, outside CI).', complexity: 'medium', validation: ['verify:record accepted for each gate'], confidence: 'high', evidence: [], actionClass: 'independent-verification', nextAction: `Verifier: record ${open.slice(0, 3).join(', ')}${open.length > 3 ? ', ...' : ''} for ${p.id}.`, gates: open })]
}

export function staleIssue(p, v) {
  if (!v.staleEvidence.length) return []
  return [issue({ id: `${p.id}:stale-evidence`, project: p.id, repository: p.repository, revision: v.target.sha, priority: 7, severity: 'low', kind: 'stale', title: `${v.staleEvidence.length} evidence record(s) are stale or for another commit`, rootCause: v.staleEvidence.slice(0, 3).map(s => `${s.id}: ${s.reason}`).join('; '), impact: 'Stale evidence counts for nothing.', proposedCorrection: 'Re-collect (the next scheduled run, or a manual engineering run with execute for build and test).', complexity: 'trivial', validation: ['verify:freshness reports 0 for the project'], confidence: 'high', evidence: v.staleEvidence.map(s => s.id), actionClass: 'automatic', nextAction: `Re-collect evidence for ${p.id}.` })]
}

export function dependencyIssues(impact) {
  const out = []
  for (const f of impact.followUps) out.push(issue({ id: `${f.project}:follow-up:${f.because}`, project: f.project, repository: null, revision: f.to, priority: 5, severity: f.requiredForRelease ? 'high' : 'medium', kind: 'dependency', title: f.action, rootCause: `${f.because} changed (${short(f.from)} -> ${short(f.to)}); ${f.project} depends on it (${f.kind}).`, impact: 'Earlier verification of the dependent may no longer hold.', proposedCorrection: 'Re-run the dependent project\'s checks against the new revision.', complexity: 'small', validation: ['dependent project collectors pass'], confidence: 'high', actionClass: 'independent-verification', nextAction: f.action }))
  for (const r of impact.risks.filter(r => r.kind === 'version-divergence' || r.kind === 'suspected')) out.push(issue({ id: `portfolio:${r.kind}:${r.package || r.projects.join('+')}`, project: 'portfolio', projects: r.projects, repository: null, priority: r.kind === 'suspected' ? 8 : 5, severity: 'low', kind: 'dependency', title: r.message, impact: 'Informational until an upgrade is planned.', proposedCorrection: r.kind === 'suspected' ? 'Add evidence for the declaration or remove it.' : 'Plan the shared upgrade per project.', complexity: 'small', confidence: r.kind === 'suspected' ? 'low' : 'high', actionClass: 'informational', nextAction: r.message }))
  return out
}

// Attaches remediation PRs to the issues they cover. A PR covers an issue when one of its cover
// keys is a prefix of the issue id. Returns the PRs with their review status summarized.
export function attachPullRequests(issues, prs) {
  for (const i of issues) {
    const related = prs.filter(pr => (pr.covers || []).some(c => i.id === c || i.id.startsWith(`${c}:`)))
    if (!related.length) continue
    i.relatedPRs = related.map(pr => ({ url: pr.url, status: pr.status || 'unknown', reviewed: pr.reviewed ?? null, openedFor: pr.openedFor || null }))
    const open = related.filter(pr => ['open', 'draft', 'unknown'].includes(pr.status || 'unknown'))
    if (open.length) {
      i.actionClass = 'owner-decision'
      i.autoFix = null
      i.nextAction = `Review ${open.map(pr => pr.url).join(', ')}${open.some(pr => pr.openedFor && i.revision && pr.openedFor !== i.revision) ? ' (opened for an earlier commit; check it still applies)' : ''}.`
    }
  }
  return issues
}

// The same access problem in several projects (for example the GitHub API not reachable from
// the collecting machine) is one environment issue, not one per project.
export function mergeAccessIssues(issues) {
  const groups = new Map()
  for (const i of issues.filter(i => i.kind === 'access' && i.project !== 'portfolio')) {
    const k = `${i.accessReason}|${i.collectors.join('+')}`
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(i)
  }
  const drop = new Set()
  const add = []
  for (const list of groups.values()) {
    if (list.length < 2) continue
    for (const i of list) drop.add(i.id)
    const projects = list.map(i => i.project)
    add.push({ ...list[0], id: `portfolio:access:${list[0].collectors.join('+')}`, project: 'portfolio', projects, repository: null, revision: null, title: `${list[0].collectors.join(', ')} unavailable in ${projects.length} projects: ${list[0].accessReason}`, evidence: list.flatMap(i => i.evidence) })
  }
  return [...issues.filter(i => !drop.has(i.id)), ...add]
}

const rank = (registry, id) => { const i = registry.projects.findIndex(p => p.id === id); return i === -1 ? 999 : i }

// The ranked queue. Ties: severity, production exposure, project order in the registry, id.
export function rankIssues(issues, registry) {
  const seen = new Set()
  const unique = issues.filter(i => (seen.has(i.id) ? false : seen.add(i.id)))
  return unique.sort((a, b) => a.priority - b.priority || SEV.indexOf(a.severity) - SEV.indexOf(b.severity) || rank(registry, a.project) - rank(registry, b.project) || a.id.localeCompare(b.id)).map((i, n) => ({ rank: n + 1, ...i, priorityText: PRIORITIES[i.priority], actionText: ACTION_CLASSES[i.actionClass] }))
}
