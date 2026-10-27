// Release orchestration states (Phase 5, docs/engineering.md).
//
// The state is derived on every run from the Phase 3 engine's readiness (with Phase 4 independent
// verifications applied), current collector findings, dependency readiness and the registry's
// approval record. It is never stored as a fact and never written to the registry; only the
// owner moves a release forward, through reviewed registry PRs.
//
//   not_ready              no release is scoped (no target version or scope document)
//   blocked                open blockers, failing critical/high defects, a blocked required
//                          dependency, or the repository cannot be read
//   verification_required  scoped, nothing blocking, but applicable gates lack independent
//                          verification at the evaluated commit
//   candidate_ready        every pre-publication gate is independently verified at a recorded
//                          candidate commit; release preparation can be reviewed
//   awaiting_approval      candidate ready and the owner has put the release up for review
//                          (registry releaseStatus ready_for_review or verified)
//   approved               the owner's approval is valid AND bound to the candidate commit
//   released               the registry records the release, with approval
//
// Approval is never inferred. It counts only when the Phase 3 approvalState accepts it (by the
// approval owner, with evidence that automation did not record) and every approval evidence
// record names the candidate commit. An approval for another commit, by anyone else, recorded by
// automation, or without evidence leaves the release at most at awaiting_approval.

import { approvalState } from '../release/engine.mjs'

export const RELEASE_STATES = ['not_ready', 'blocked', 'verification_required', 'candidate_ready', 'awaiting_approval', 'approved', 'released']
export const RELEASE_STATE_TEXT = {
  not_ready: 'Not Ready',
  blocked: 'Blocked',
  verification_required: 'Verification Required',
  candidate_ready: 'Candidate Ready',
  awaiting_approval: 'Awaiting Human Approval',
  approved: 'Approved for Release',
  released: 'Released'
}

// Transitions the system may report between two runs. Anything may fall back (a new blocker, a
// moved candidate); moving forward past candidate_ready needs an owner action in the registry.
const FORWARD = {
  not_ready: ['blocked', 'verification_required'],
  blocked: ['verification_required', 'candidate_ready'],
  verification_required: ['blocked', 'candidate_ready'],
  candidate_ready: ['awaiting_approval'],
  awaiting_approval: ['approved'],
  approved: ['released'],
  released: []
}
export const OWNER_ONLY = new Set(['awaiting_approval', 'approved', 'released'])

// Is prev -> next a transition the evidence can explain? Returns { ok, reason }.
export function checkTransition(prev, next, { approvalValid = false, approvalBound = false, registryReleased = false } = {}) {
  if (!RELEASE_STATES.includes(next)) return { ok: false, reason: `unknown state ${next}` }
  if (!prev || prev === next) return { ok: true, reason: null }
  if (RELEASE_STATES.indexOf(next) < RELEASE_STATES.indexOf(prev) || next === 'blocked') return { ok: true, reason: 'regression: evidence or blockers changed' }
  if (!(FORWARD[prev] || []).includes(next) && !(prev === 'not_ready' && next === 'candidate_ready')) return { ok: false, reason: `${prev} -> ${next} skips a step` }
  if (next === 'approved' && !(approvalValid && approvalBound)) return { ok: false, reason: 'approved needs a valid approval bound to the candidate commit' }
  if (next === 'released' && !(approvalValid && registryReleased)) return { ok: false, reason: 'released needs approval and a registry release record' }
  return { ok: true, reason: null }
}

// Is the approval bound to the commit being released?
export function approvalBinding(p, candidateSha) {
  const byId = new Map(p.evidence.map(e => [e.id, e]))
  const refs = (p.approval.evidenceRefs || []).map(r => byId.get(r)).filter(Boolean)
  if (!candidateSha) return { bound: false, reason: 'no release candidate commit is recorded' }
  if (!refs.length) return { bound: false, reason: 'approval has no evidence' }
  const other = refs.filter(e => e.commitSha !== candidateSha)
  if (other.length) return { bound: false, reason: `approval evidence ${other.map(e => e.id).join(', ')} names ${other.map(e => String(e.commitSha || 'no commit').slice(0, 7)).join(', ')}, not the candidate ${candidateSha.slice(0, 7)}` }
  return { bound: true, reason: null }
}

// The release state of one project.
//   v: the project's Phase 4 verification view (readiness, findings, blockers, gates, target)
//   engine: the Phase 3 assessment of the same project (with verifications applied)
export function releaseState({ p, v, engine, approvalOwner, access = 'ok', dependencyBlocked = [] }) {
  const r = engine.derived.readiness
  const cand = p.release.candidate || null
  const approval = approvalState(p, { approvalOwner })
  const binding = approvalBinding(p, cand ? cand.headSha : null)
  const reasons = []
  const scoped = Boolean(p.release.targetVersion && p.release.scopeDocument)
  const severe = v.findings.filter(f => f.kind === 'defect' && ['critical', 'high'].includes(f.severity))
  // Registry blockers (except the approval itself) and derived blockers that report a failure
  // block; derived "not yet verified" and "not yet approved" blockers are the next steps instead.
  const HARD = /^auto-(gate-failed|ci-failed|dependency|candidate-moved)/
  const openBlockers = v.blockers.filter(b => (b.origin === 'registry' && b.category !== 'approval') || HARD.test(b.id))
  const derivedBlockers = v.blockers.filter(b => b.origin !== 'registry' && !HARD.test(b.id) && !['auto-owner-approval', 'auto-scope-missing'].includes(b.id))
  let state
  if (p.release.releaseStatus === 'released' && r.eligibility === 'released') state = 'released'
  else if (!scoped) { state = 'not_ready'; reasons.push(!p.release.targetVersion ? 'no target version' : 'no scope document') }
  else if (access !== 'ok' || openBlockers.length || severe.length || dependencyBlocked.length || r.candidateMoved) {
    state = 'blocked'
    if (access !== 'ok') reasons.push(`repository not readable (${access})`)
    if (openBlockers.length) reasons.push(`${openBlockers.length} open registry blocker(s): ${openBlockers.map(b => b.id).join(', ')}`)
    if (severe.length) reasons.push(`${severe.length} critical/high defect(s) at ${String(v.target.sha || '').slice(0, 7)}: ${severe.map(f => f.collector).join(', ')}`)
    if (dependencyBlocked.length) reasons.push(`required dependency not released: ${dependencyBlocked.join(', ')}`)
    if (r.candidateMoved) reasons.push('the candidate PR moved past the recorded commit')
  } else if (!(cand && r.prePublication.applicable > 0 && r.prePublication.verified === r.prePublication.applicable && r.ownershipValid)) {
    state = 'verification_required'
    if (!r.ownershipValid) reasons.push('no builder and independent verifier assigned')
    reasons.push(`${r.prePublication.applicable - r.prePublication.verified} of ${r.prePublication.applicable} pre-publication gate(s) not independently verified`)
    if (!cand) reasons.push('no release candidate commit recorded')
    if (derivedBlockers.length) reasons.push(`derived blockers: ${derivedBlockers.map(b => b.id).join(', ')}`)
  } else if (approval.valid && binding.bound && r.releaseReady) state = 'approved'
  else if (['ready_for_review', 'verified'].includes(p.release.releaseStatus)) {
    state = 'awaiting_approval'
    reasons.push(approval.valid ? `approval not usable: ${binding.reason}` : `approval: ${approval.reason}`)
  } else { state = 'candidate_ready'; reasons.push('owner puts the release up for review (registry releaseStatus ready_for_review)') }
  if (approval.valid && !binding.bound && state !== 'released') reasons.push(`recorded approval is not bound to the candidate: ${binding.reason}`)
  return { state, text: RELEASE_STATE_TEXT[state], reasons, candidate: cand ? { pullRequest: cand.pullRequest, ref: cand.ref, sha: cand.headSha } : null, approval: { valid: approval.valid, bound: binding.bound, reason: approval.valid ? binding.reason : approval.reason } }
}

// What release preparation needs for one project. Preparation documents only: nothing here
// publishes, tags, merges or deploys.
export function releasePlan({ p, v, engine, state, policy, dependencyNotes = [] }) {
  const gates = v.gates.filter(g => g.state !== 'not_applicable')
  const manual = gates.filter(g => g.automation !== 'full' && g.state !== 'independently_verified').map(g => `${g.id}${g.humanOnly ? ' (human only)' : ''}`)
  const version = p.release.targetVersion
  const current = p.release.currentVersion
  return {
    state: state.state,
    candidateRevision: state.candidate ? state.candidate.sha : v.target.sha,
    candidateSource: state.candidate ? `PR #${state.candidate.pullRequest} (${state.candidate.ref})` : v.target.source,
    applicableGates: gates.length,
    verifiedGates: gates.filter(g => g.state === 'independently_verified').length,
    readinessPercent: v.readiness.percentage,
    missingEvidence: gates.filter(g => g.missingVerification).map(g => g.id),
    activeBlockers: v.blockers.map(b => b.id),
    dependencyReadiness: dependencyNotes,
    manualTesting: manual,
    approvalsRequired: [`${engine.facts.ownership.approvalOwner} (release approval, recorded in the registry with evidence)`, ...(engine.facts.ownership.verifier ? [] : ['an independent verifier must be assigned in the registry'])],
    versionRecommendation: version ? `${version} (registry target${current ? `; current ${current}` : ''})` : 'none: the owner sets release.targetVersion when a release is scoped',
    preparation: state.state === 'candidate_ready' || state.state === 'awaiting_approval' || state.state === 'approved'
      ? ['release checklist', 'release notes draft', 'changelog draft', 'compatibility summary', 'rollback instructions', 'deployment checklist']
      : [],
    preparationStatus: ['candidate_ready', 'awaiting_approval', 'approved'].includes(state.state) ? 'ready to draft (npm run release:prepare)' : `not started: ${state.text}`,
    rollback: p.tier === 'library'
      ? `Deprecate the bad version (npm deprecate) and publish a fix; never unpublish. Consumers pin the previous version (${current || 'none published'}).`
      : `Redeploy the previous production revision from the hosting provider, then revert the release commit on ${p.repositorySnapshot.defaultBranch || 'main'} through a PR.`,
    ownerActions: ['merge', 'publish', 'deploy', 'tag'].map(a => `${a}: owner only`)
  }
}
