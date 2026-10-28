// Release-readiness engine (Phase 3). Pure: no network, no file writes, no clock.
//
// Input: the registry, the Definition of Done text, and an explicit `asOf` time. Output: for
// every project, each gate of its tier with a readiness state, evidence provenance, missing
// requirements, blockers and a next action; a readiness calculation; blockers split into merge,
// release and post-release; and prioritized next actions. The same input always gives the same
// output, and the input is never modified.
//
// Governance this module keeps (docs/release-readiness.md):
// - The gate list comes from the registry's gateCatalog, which the validator ties to
//   standards/definition-of-done.md. Nothing here defines or renames a gate.
// - A gate counts as verified only with independent `pass` evidence (separate, named builder and
//   verifier; recorded by someone other than the builder; manual origin; not repository metadata)
//   that is current: for the release candidate's commit when one is recorded, and no older than
//   the staleness window. CI success, an open PR or a deployment never verifies a gate by itself.
// - Registry-recorded blockers are always reported and always block. Derived blockers are proposals
//   with their rule and inputs; they are never written back to the registry.
// - A readiness percentage is progress, not authorization. A release is ready only when every
//   applicable gate is verified and current, no blocker is open, and Joshua Small's approval is
//   recorded with evidence.

import { SYNC_RECORDER, sameParty } from '../validate-registry.mjs'
import { gateProven } from '../readiness.mjs'
import { dependencyFindings } from './dependencies.mjs'

export const ENGINE_VERSION = 1
export const DEFAULT_STALE_DAYS = 30

// Gates that can only be shown after publication or deployment (release.md steps 9 and 10).
// They count toward completion, but not toward being ready for the owner's release decision.
export const POST_PUBLICATION_GATES = new Set(['production-deployment', 'distribution-verified', 'published-artifact-matches', 'release-provenance'])

export const STATES = ['verified', 'in_progress', 'not_started', 'blocked', 'not_applicable', 'unknown_stale']
export const STATE_TEXT = {
  verified: 'Verified',
  in_progress: 'In progress',
  not_started: 'Not started',
  blocked: 'Blocked',
  not_applicable: 'Not applicable',
  unknown_stale: 'Unknown or stale'
}

// Strongest first. "independent" is the only class that can verify a gate.
export const PROVENANCE = ['independent', 'pass-without-independent-verifier', 'builder-reported', 'observation', 'none']
export const PROVENANCE_TEXT = {
  independent: 'independently verified',
  'pass-without-independent-verifier': 'pass recorded without an independent verifier (verifies nothing)',
  'builder-reported': 'builder-reported (unverified)',
  observation: 'observation or metadata only',
  none: 'no evidence'
}

const NON_PROVING_TYPES = new Set(['repository_metadata'])
const MIN_RATIONALE = 20
const DAY = 24 * 3600 * 1000
const norm = s => (s || '').trim().toLowerCase()

export const GATE_CATEGORY = {
  'security-privacy-review': 'security', 'supply-chain-review': 'security', authentication: 'security', 'authorization-boundaries': 'security',
  'sensitive-data-handling': 'security', 'api-integration-security': 'security', 'user-data-isolation': 'security', 'audit-logging': 'security',
  'wcag-22-aa': 'accessibility', 'keyboard-screen-reader': 'accessibility', 'responsive-layouts': 'accessibility',
  'automated-checks': 'ci', 'ci-release-pipeline': 'ci',
  'critical-workflows': 'workflow', 'e2e-critical-workflows': 'workflow', 'integration-failure-handling': 'workflow', 'backup-recovery': 'workflow',
  'runtime-compatibility': 'workflow', 'clean-consumer-install': 'workflow',
  'production-deployment': 'distribution', 'distribution-verified': 'distribution', 'published-artifact-matches': 'distribution',
  'release-provenance': 'distribution', 'deployment-rollback': 'distribution', 'package-archive-inspection': 'distribution',
  'package-metadata-exports': 'distribution', 'versioning-changelog': 'distribution',
  'scope-complete': 'scope',
  'documentation-accurate': 'documentation', 'public-docs-accurate': 'documentation', 'upgrade-rollback-uninstall-docs': 'documentation',
  'no-release-blockers': 'manual'
}
const CRITICAL_WORKFLOW_GATES = ['critical-workflows', 'e2e-critical-workflows']

export class ReadinessInputError extends Error {}

// Requirement text for each gate, read from the Definition of Done tables. LF or CRLF.
export function gateRequirements(dodText) {
  const out = {}
  for (const line of String(dodText).split(/\r?\n/)) {
    const m = /^\|\s*\d+\s*\|\s*`([a-z0-9-]+)`\s*\|\s*(.+?)\s*\|\s*$/.exec(line)
    if (m) out[m[1]] = m[2]
  }
  return out
}

function isTime(v) {
  return typeof v === 'string' && !Number.isNaN(new Date(v).getTime())
}

// Malformed input is refused, never read as "nothing wrong".
export function checkInput(registry) {
  const fail = msg => { throw new ReadinessInputError(msg) }
  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) fail('registry is not an object')
  if (!registry.gateCatalog || typeof registry.gateCatalog !== 'object') fail('registry has no gateCatalog')
  if (!Array.isArray(registry.projects)) fail('registry has no projects array')
  if (typeof registry.approvalOwner !== 'string' || !registry.approvalOwner.trim()) fail('registry has no approvalOwner')
  registry.projects.forEach((p, i) => {
    const at = `projects[${i}]${p && p.id ? ` (${p.id})` : ''}`
    if (!p || typeof p !== 'object') fail(`${at} is not an object`)
    if (typeof p.id !== 'string' || !p.id) fail(`${at} has no id`)
    for (const k of ['releaseGates', 'evidence']) if (!Array.isArray(p[k])) fail(`${at}.${k} is not an array`)
    if (!p.release || !Array.isArray(p.release.blockers)) fail(`${at}.release.blockers is not an array`)
    if (!p.ownership || typeof p.ownership !== 'object') fail(`${at}.ownership is missing`)
    if (!p.approval || typeof p.approval !== 'object' || !Array.isArray(p.approval.evidenceRefs)) fail(`${at}.approval is missing or malformed`)
    if (!p.repositorySnapshot || typeof p.repositorySnapshot !== 'object') fail(`${at}.repositorySnapshot is missing`)
    if (p.tier !== 'legacy' && !Array.isArray(registry.gateCatalog[p.tier])) fail(`${at} has unknown tier ${JSON.stringify(p.tier)}`)
    for (const e of p.evidence) {
      if (!e || typeof e.id !== 'string') fail(`${at} has an evidence record without an id`)
      if (!isTime(e.verifiedAt)) fail(`${at} evidence ${e.id} has no valid verifiedAt`)
    }
    for (const g of p.releaseGates) if (!g || typeof g.id !== 'string' || !Array.isArray(g.evidenceRefs)) fail(`${at} has a malformed release gate`)
  })
}

// Builder and verifier must be named, different, and neither may be automation.
export function ownershipState(p) {
  const builder = norm(p.ownership.builder)
  const verifier = norm(p.ownership.verifier)
  const automation = norm(SYNC_RECORDER)
  if (!builder || !verifier) return { valid: false, reason: 'builder and independent verifier are not both assigned' }
  if (sameParty(builder, verifier)) return { valid: false, reason: 'builder and verifier are the same identity or AI tool family' }
  if (builder === automation || verifier === automation) return { valid: false, reason: 'automation cannot be the builder or verifier' }
  return { valid: true, reason: null }
}

// The class of one evidence record. Only "independent" can verify a gate.
export function classifyEvidence(p, e, ownership = ownershipState(p)) {
  const manual = !e.origin || e.origin === 'manual'
  if (e.result === 'fail') return 'failed'
  if (e.result === 'builder_reported') return 'builder-reported'
  if (e.result === 'pass' && manual && !NON_PROVING_TYPES.has(e.type) && norm(e.recordedBy) !== norm(SYNC_RECORDER)) {
    return ownership.valid && !sameParty(e.recordedBy, p.ownership.builder) ? 'independent' : 'pass-without-independent-verifier'
  }
  return 'observation'
}

// Why a record would not count as current evidence for the release, or null when it is current.
function staleReason(e, ctx, candidate) {
  const age = ctx.asOf.getTime() - new Date(e.verifiedAt).getTime()
  if (age > ctx.staleDays * DAY) return `${e.id} is ${Math.floor(age / DAY)} days old (window ${ctx.staleDays} days)`
  if (age < 0) return `${e.id} is dated after the report time`
  if (candidate && e.commitSha && e.commitSha !== candidate.headSha) return `${e.id} is for ${e.commitSha.slice(0, 7)}, not the release candidate ${candidate.headSha.slice(0, 7)}`
  return null
}

// The candidate is stale when its pull request is still open and has moved past headSha.
export function candidateState(p) {
  const c = p.release.candidate
  if (!c) return { candidate: null, moved: false, currentHead: null }
  const pr = c.pullRequest ? (p.openPullRequests || []).find(x => x.number === c.pullRequest) : null
  return { candidate: c, moved: Boolean(pr && pr.headSha !== c.headSha), currentHead: pr ? pr.headSha : null }
}

export function evaluateGate(p, g, ctx, cand = candidateState(p), ownership = ownershipState(p)) {
  const byId = new Map(p.evidence.map(e => [e.id, e]))
  const refs = g.evidenceRefs.map(r => byId.get(r))
  const missingRefs = g.evidenceRefs.filter((r, i) => !refs[i])
  const evidence = refs.filter(Boolean).map(e => ({
    id: e.id,
    type: e.type,
    result: e.result,
    url: e.url,
    commitSha: e.commitSha,
    verifiedAt: e.verifiedAt,
    recordedBy: e.recordedBy,
    origin: e.origin || 'manual',
    provenance: classifyEvidence(p, e, ownership),
    stale: staleReason(e, ctx, cand.moved ? null : cand.candidate)
  }))
  const classes = new Set(evidence.map(e => e.provenance))
  const provenance = PROVENANCE.find(c => classes.has(c)) || 'none'
  const lastObservedAt = evidence.reduce((m, e) => (!m || e.verifiedAt > m ? e.verifiedAt : m), null)
  const currentIndependent = evidence.filter(e => e.provenance === 'independent' && !e.stale)
  const missing = []
  let state

  // not_applicable counts only with a written rationale; without one the gate stays applicable.
  const applicable = !(g.status === 'not_applicable' && g.notes && g.notes.trim().length >= MIN_RATIONALE)
  if (!applicable) state = 'not_applicable'
  else if (g.status === 'not_applicable') { state = 'unknown_stale'; missing.push('not_applicable needs a written rationale') }
  else if (g.status === 'verified') {
    if (currentIndependent.length && gateProven(p, g) && !cand.moved) state = 'verified'
    else {
      state = 'unknown_stale'
      if (!ownership.valid) missing.push(ownership.reason)
      if (!evidence.some(e => e.provenance === 'independent')) missing.push('independent pass evidence from a verifier who is not the builder')
      else if (!currentIndependent.length) missing.push(...evidence.filter(e => e.provenance === 'independent').map(e => `current evidence: ${e.stale}`))
      if (cand.moved) missing.push(`re-verification on the moved candidate ${cand.currentHead.slice(0, 7)}`)
    }
  } else if (g.status === 'blocked') state = 'blocked'
  else if (g.status === 'in_progress') {
    state = evidence.length && evidence.every(e => e.stale) ? 'unknown_stale' : 'in_progress'
  } else if (g.status === 'not_verified') state = 'not_started'
  else { state = 'unknown_stale'; missing.push(`unrecognized gate status ${JSON.stringify(g.status)}`) }

  if (missingRefs.length) missing.push(`cited evidence not found: ${missingRefs.join(', ')}`)
  if (applicable && state !== 'verified') {
    if (!ownership.valid && !missing.includes(ownership.reason)) missing.push(ownership.reason)
    if (classes.has('builder-reported') || classes.has('pass-without-independent-verifier')) missing.push('independent re-check of the builder-reported result, recorded by the verifier as its own pass evidence')
    else if (!evidence.length) missing.push('evidence for this gate')
    for (const e of evidence) if (e.stale && state !== 'not_started') missing.push(`current evidence: ${e.stale}`)
    if (classes.has('failed')) missing.push('a passing re-check after the recorded failure')
    if (g.notes && g.notes.trim()) missing.push(`registry notes: ${g.notes.trim().replace(/\.$/, '')}`)
  }
  return {
    id: g.id,
    requirement: ctx.requirements[g.id] || null,
    phase: POST_PUBLICATION_GATES.has(g.id) ? 'post-publication' : 'pre-publication',
    registryStatus: g.status,
    state,
    applicable,
    provenance,
    evidence,
    lastObservedAt,
    failed: classes.has('failed'),
    missing: [...new Set(missing)],
    notes: g.notes || null,
    blockers: [],
    nextAction: null
  }
}

function gateNextAction(gate) {
  if (gate.state === 'verified' || gate.state === 'not_applicable') return null
  if (gate.state === 'blocked') return gate.blockers.length ? `Resolve ${gate.blockers.join(', ')}, then verify.` : 'Record why the gate is blocked, resolve it, then verify.'
  if (gate.state === 'unknown_stale') return gate.applicable ? 'Re-collect evidence for the current release candidate and have the verifier re-check it.' : 'Write the not-applicable rationale or mark the gate applicable.'
  if (gate.failed) return 'Fix the recorded failure, then have the verifier re-check.'
  if (gate.provenance === 'builder-reported' || gate.provenance === 'pass-without-independent-verifier') return 'Verifier re-checks the builder evidence on the candidate commit and records a pass.'
  if (gate.state === 'in_progress') return 'Finish the work and record evidence, then have the verifier re-check.'
  return gate.phase === 'post-publication' ? 'After the authorized publication or deployment, verify it and record evidence.' : 'Produce evidence for this gate.'
}

const BLOCKER_SORT = b => `${b.origin === 'registry' ? 0 : 1}:${b.id}`

// Owner-recorded blockers (registry) and derived, proposed blockers (rules over the registry).
export function projectBlockers(p, gates, ctx, deps, cand, ownership) {
  const owner = p.release.blockers.filter(b => b.status === 'open').map(b => ({
    id: b.id,
    origin: 'registry',
    status: 'open',
    category: b.category || 'manual',
    severity: b.severity || null,
    blocks: b.blocks || 'release',
    gates: b.gates || [],
    description: b.description,
    evidenceRefs: b.evidenceRefs,
    rule: null
  }))
  const derived = []
  const ownerCats = new Set(owner.map(b => b.category))
  const add = (id, category, blocks, description, rule, action, gateIds = [], evidenceRefs = [], severity = null) => derived.push({ id: `auto-${id}`, origin: 'derived', status: 'proposed', category, severity, blocks, gates: gateIds, description, evidenceRefs, rule, action })
  const r = p.release

  if ((!r.targetVersion || !r.scopeDocument) && !ownerCats.has('scope')) {
    add('scope-missing', 'scope', 'release', `No ${[!r.targetVersion && 'target version', !r.scopeDocument && 'scope document'].filter(Boolean).join(' and ')}: the release cannot be scoped or verified.`, 'release.targetVersion and release.scopeDocument are required before verification', r.scopeDocument ? 'Choose the target version for the scoped release and record it as release.targetVersion in the registry.' : `Commit a release scope document in the project repository, then record scopeDocument${r.targetVersion ? '' : ' and targetVersion'} in the registry.`, ['scope-complete'])
  }
  if (!ownership.valid) add('ownership', 'evidence', 'release', `Independent verification impossible: ${ownership.reason}.`, 'ownership.builder and ownership.verifier must be named, different and not automation', 'Record the builder and a different, independent verifier in the registry ownership block (an owner decision).')
  if (cand.moved) add('candidate-moved', 'stale-evidence', 'release', `Release candidate moved: PR #${cand.candidate.pullRequest} is now at ${cand.currentHead.slice(0, 7)}, the registry candidate is ${cand.candidate.headSha.slice(0, 7)}. Evidence for the old commit does not apply.`, 'release.candidate.headSha must equal the open PR head', 'Record the new candidate commit in release.candidate and re-collect evidence for it.')

  const heads = new Set([p.repositorySnapshot.headSha, cand.candidate && cand.candidate.headSha].filter(Boolean))
  for (const e of p.evidence) {
    const concluded = /concluded (failure|cancelled|timed_out|startup_failure)/.exec(e.description || '')
    if (e.type === 'workflow_run' && e.commitSha && heads.has(e.commitSha) && (e.result === 'fail' || concluded)) {
      add(`ci-failed-${e.id}`, 'ci', 'merge', `CI did not pass on ${e.commitSha.slice(0, 7)} (${e.result === 'fail' ? 'recorded fail' : concluded[1]}).`, 'a failing workflow run on the head or candidate commit blocks merge', `Fix the failing CI run on ${e.commitSha.slice(0, 7)} and re-run it (never skip or disable tests).`, [], [e.id])
    }
  }
  for (const g of gates) {
    if (!g.applicable) continue
    if (g.failed) {
      const cat = GATE_CATEGORY[g.id] || 'evidence'
      add(`gate-failed-${g.id}`, cat === 'ci' ? 'ci' : cat, 'release', `Recorded failure on ${g.id}${cat === 'security' ? ' (severity not classified: treated as blocking until classified under standards/security.md)' : ''}.`, 'fail evidence on an applicable gate blocks release', `Fix the failure recorded on ${g.id}, then have the verifier re-check.`, [g.id], g.evidence.filter(e => e.provenance === 'failed').map(e => e.id))
    }
    if (g.state === 'unknown_stale') add(`stale-${g.id}`, 'stale-evidence', 'release', `${g.id}: ${g.missing.join('; ') || 'evidence is unknown or stale'}.`, 'verified or in-progress gates need current evidence for the candidate', `Re-collect current evidence for ${g.id} on the release candidate and have the verifier re-check it.`, [g.id], g.evidence.map(e => e.id))
  }
  const workflows = gates.filter(g => g.applicable && CRITICAL_WORKFLOW_GATES.includes(g.id) && g.state !== 'verified')
  if (workflows.length) add('critical-workflows-unverified', 'workflow', 'release', `Critical workflows are not independently verified (${workflows.map(g => g.id).join(', ')}).`, 'critical workflow gates must be verified before release', `Test the critical workflows on the candidate commit (${workflows.map(g => g.id).join(', ')}) and have the verifier record the result.`, workflows.map(g => g.id))
  const unverified = gates.filter(g => g.applicable && g.phase === 'pre-publication' && g.state !== 'verified' && g.state !== 'unknown_stale' && g.id !== 'no-release-blockers')
  if (unverified.length) add('missing-verification', 'evidence', 'release', `${unverified.length} applicable pre-publication gate(s) lack current independent verification.`, 'every applicable gate needs independent pass evidence', null, unverified.map(g => g.id))
  for (const f of deps.filter(f => f.blocking)) add(`dependency-${f.kind}-${f.project}`, f.kind === 'stale' ? 'stale-evidence' : 'dependency', 'release', f.message, f.rule, f.kind === 'blocked' ? `Release ${f.project} first, or record an owner decision that this release no longer requires it.` : `Fix the dependency declaration: ${f.message}`)
  const approval = approvalState(p, ctx)
  if (!approval.valid && !ownerCats.has('approval')) add('owner-approval', 'approval', 'release', `${ctx.approvalOwner}'s approval is not recorded (${approval.reason}). Only the owner approves a release.`, 'approval.status approved with evidence, by the approval owner', 'Ask Joshua Small to review the evidence and approve or decline the release.')

  const all = [...owner, ...derived].sort((a, b) => BLOCKER_SORT(a).localeCompare(BLOCKER_SORT(b)))
  return {
    merge: all.filter(b => b.blocks === 'merge'),
    release: all.filter(b => b.blocks === 'release'),
    postRelease: (r.enhancements || []).map((text, i) => ({ id: `enhancement-${i + 1}`, origin: 'registry', text }))
  }
}

// Priority buckets from the Phase 3 brief: security, broken functionality, missing verification,
// failed CI, accessibility, release artifacts, documentation and the rest.
const PRIORITY = [
  [1, 'Critical and high security', b => b.category === 'security' && (!b.severity || ['critical', 'high'].includes(b.severity))],
  [2, 'Broken functionality', b => b.category === 'defect'],
  [3, 'Missing required verification', b => ['scope', 'evidence', 'workflow', 'stale-evidence'].includes(b.category)],
  [4, 'Failed or missing CI', b => b.category === 'ci'],
  [5, 'Accessibility release blockers', b => b.category === 'accessibility'],
  [6, 'Missing release artifacts', b => ['distribution', 'dependency'].includes(b.category)],
  [7, 'Documentation and lower priority', () => true]
]
// Within a bucket: scope, then naming a verifier (nothing can be verified before either), then
// registry blockers before derived ones, merge blockers first.
const WITHIN = b => `${b.category === 'scope' ? 0 : b.id === 'auto-ownership' ? 1 : 2}:${b.origin === 'registry' ? 0 : 1}:${b.blocks === 'merge' ? 0 : 1}:${b.id}`

// First sentence (or clause) of an action, at most 140 characters, for one-line views.
export function summarize(text) {
  const first = /^(.+?[.;:])(\s|$)/.exec(text)
  let s = first ? first[1].replace(/[;:]$/, '.') : text
  if (s.length > 140) s = s.slice(0, s.lastIndexOf(' ', 139)).replace(/[,;:]$/, '') + '...'
  return s
}

export function nextActions(blockers, gates) {
  const actions = []
  const items = [...blockers.merge, ...blockers.release].filter(b => b.category !== 'approval')
  for (const b of items) {
    const [priority, bucket] = PRIORITY.find(([, , test]) => test(b))
    let text
    if (b.id === 'auto-missing-verification') {
      // Gates held by another open blocker are covered by that blocker's action.
      const held = new Set(items.filter(x => x.id !== b.id).flatMap(x => x.gates))
      const free = gates.filter(g => b.gates.includes(g.id) && !held.has(g.id))
      const reported = free.filter(g => ['builder-reported', 'pass-without-independent-verifier'].includes(g.provenance))
      const none = free.filter(g => !reported.includes(g))
      const parts = []
      if (reported.length) parts.push(`independently re-check the builder evidence for ${reported.map(g => g.id).join(', ')}`)
      if (none.length) parts.push(`produce evidence for ${none.map(g => g.id).join(', ')}`)
      if (held.size && b.gates.some(id => held.has(id))) parts.push(`then verify ${b.gates.filter(id => held.has(id)).join(', ')} once their blockers are resolved`)
      text = `${parts.join('; ')}.`
      text = text[0].toUpperCase() + text.slice(1)
    } else if (b.origin === 'registry') text = `Resolve blocker ${b.id}: ${b.description}`
    else text = b.action || b.description
    actions.push({ priority, bucket, source: b.id, origin: b.origin, blocks: b.blocks, gates: b.gates, text, summary: summarize(text), sort: WITHIN(b) })
  }
  actions.sort((a, b) => a.priority - b.priority || a.sort.localeCompare(b.sort))
  // Approval is last and only once nothing else remains: it is the owner's decision, not work.
  const approval = [...blockers.release].find(b => b.category === 'approval')
  if (approval && !actions.length) {
    const text = 'Ask Joshua Small to review the evidence and approve or decline the release.'
    actions.push({ priority: 8, bucket: 'Owner decision', source: approval.id, origin: approval.origin, blocks: 'release', gates: [], text, summary: text })
  }
  return actions.map(({ sort, ...a }, i) => ({ rank: i + 1, ...a }))
}

export function assessProject(p, ctx, depFindings = []) {
  const ownership = ownershipState(p)
  const cand = candidateState(p)
  const catalog = p.tier === 'legacy' ? [] : ctx.registry.gateCatalog[p.tier]
  const byId = new Map(p.releaseGates.map(g => [g.id, g]))
  const findings = []
  const gates = catalog.map(id => {
    const g = byId.get(id)
    if (g) return evaluateGate(p, g, ctx, cand, ownership)
    findings.push({ kind: 'missing-gate', message: `gate ${id} of the ${p.tier} tier is missing from the registry entry` })
    return { id, requirement: ctx.requirements[id] || null, phase: POST_PUBLICATION_GATES.has(id) ? 'post-publication' : 'pre-publication', registryStatus: null, state: 'unknown_stale', applicable: true, provenance: 'none', evidence: [], lastObservedAt: null, failed: false, missing: ['the gate is missing from the registry'], notes: null, blockers: [], nextAction: null }
  })
  for (const g of p.releaseGates) if (!catalog.includes(g.id)) findings.push({ kind: 'extra-gate', message: `gate ${g.id} is not part of the ${p.tier} tier and is ignored` })

  const blockers = projectBlockers(p, gates, ctx, depFindings, cand, ownership)
  const open = [...blockers.merge, ...blockers.release]
  for (const g of gates) {
    g.blockers = open.filter(b => b.gates.includes(g.id) && b.id !== 'auto-missing-verification').map(b => b.id)
    if (g.id === 'no-release-blockers') g.blockers = open.filter(b => b.origin === 'registry').map(b => b.id)
    g.nextAction = gateNextAction(g)
  }

  const count = s => gates.filter(g => g.state === s).length
  const applicable = gates.filter(g => g.applicable)
  const verified = count('verified')
  const pre = applicable.filter(g => g.phase === 'pre-publication')
  const approval = approvalState(p, ctx)
  const registryOpen = open.filter(b => b.origin === 'registry')
  const nonApproval = open.filter(b => b.category !== 'approval')
  const preVerified = pre.every(g => g.state === 'verified')
  const allVerified = applicable.length > 0 && applicable.every(g => g.state === 'verified')
  const scoped = Boolean(p.release.targetVersion && p.release.scopeDocument)
  const missingIndependent = applicable.filter(g => g.state !== 'verified' && ['builder-reported', 'pass-without-independent-verifier'].includes(g.provenance)).map(g => g.id)

  let eligibility
  if (scoped && allVerified && !open.length && approval.valid && p.release.releaseStatus === 'released') eligibility = 'released'
  else if (scoped && allVerified && !nonApproval.length && approval.valid) eligibility = 'release-ready'
  else if (scoped && preVerified && ownership.valid && !nonApproval.filter(b => !b.gates.length || b.gates.some(id => !POST_PUBLICATION_GATES.has(id))).length) eligibility = 'awaiting-owner-decision'
  else eligibility = scoped ? 'not-eligible' : 'not-scoped'

  const lastEvidenceAt = p.evidence.reduce((m, e) => (!m || e.verifiedAt > m ? e.verifiedAt : m), null)
  return {
    id: p.id,
    name: p.name,
    tier: p.tier,
    facts: {
      repository: p.repository,
      currentVersion: p.release.currentVersion,
      targetVersion: p.release.targetVersion,
      releaseStatus: p.release.releaseStatus,
      scopeDocument: p.release.scopeDocument,
      candidate: cand.candidate,
      openPullRequests: (p.openPullRequests || []).map(pr => ({ number: pr.number, url: pr.url, headSha: pr.headSha, draft: pr.draft })),
      head: p.repositorySnapshot.headSha,
      snapshotObservedAt: p.repositorySnapshot.observedAt,
      lastSyncedAt: p.sync ? p.sync.lastSyncedAt : null,
      lastEvidenceAt,
      ownership: { builder: p.ownership.builder, verifier: p.ownership.verifier, approvalOwner: p.ownership.approvalOwner },
      approval: { status: p.approval.status, approvedBy: p.approval.approvedBy, approvedAt: p.approval.approvedAt, evidenceRefs: p.approval.evidenceRefs },
      registryNextAction: p.release.nextAction,
      missingEvidence: p.missingEvidence || []
    },
    derived: {
      readiness: {
        totalGates: gates.length,
        applicableGates: applicable.length,
        verifiedGates: verified,
        remainingGates: applicable.length - verified,
        byState: Object.fromEntries(STATES.map(s => [s, count(s)])),
        percentage: applicable.length ? Math.floor((verified * 1000) / applicable.length) / 10 : null,
        prePublication: { applicable: pre.length, verified: pre.filter(g => g.state === 'verified').length },
        blockingFindings: open.length,
        registryBlockers: registryOpen.length,
        missingIndependentVerification: missingIndependent,
        candidateMoved: cand.moved,
        ownershipValid: ownership.valid,
        approvalRecorded: approval.valid,
        eligibility,
        releaseReady: eligibility === 'release-ready' || eligibility === 'released'
      },
      gates,
      blockers,
      nextActions: [],
      dependencies: depFindings,
      findings,
      approval
    },
    unverified: gates.flatMap(g => g.evidence.filter(e => ['builder-reported', 'pass-without-independent-verifier'].includes(e.provenance)).map(e => ({ gate: g.id, evidence: e.id, provenance: e.provenance })))
  }
}

// Approval counts only when the approval owner gave it, with evidence that exists and was not
// written by automation. Nothing in this engine can create or change an approval.
export function approvalState(p, ctx) {
  const a = p.approval
  if (a.status !== 'approved') return { valid: false, reason: `approval is ${a.status}` }
  if (a.approvedBy !== ctx.approvalOwner) return { valid: false, reason: `approval by ${JSON.stringify(a.approvedBy)} is not by ${ctx.approvalOwner}` }
  const byId = new Map(p.evidence.map(e => [e.id, e]))
  const refs = a.evidenceRefs.map(r => byId.get(r))
  if (!refs.length || refs.some(e => !e)) return { valid: false, reason: 'approval evidence is missing' }
  if (refs.some(e => (e.origin && e.origin !== 'manual') || norm(e.recordedBy) === norm(SYNC_RECORDER))) return { valid: false, reason: 'approval evidence was recorded by automation' }
  return { valid: true, reason: null }
}

export function assessRegistry(registry, { dodText, asOf, staleDays = DEFAULT_STALE_DAYS } = {}) {
  checkInput(registry)
  if (!(asOf instanceof Date) || Number.isNaN(asOf.getTime())) throw new ReadinessInputError('asOf must be a valid Date (pass --as-of)')
  if (!Number.isInteger(staleDays) || staleDays < 1) throw new ReadinessInputError('staleDays must be a positive integer')
  const ctx = { registry, asOf, staleDays, requirements: gateRequirements(dodText || ''), approvalOwner: registry.approvalOwner }
  const deps = dependencyFindings(registry, ctx)
  const projects = registry.projects.filter(p => p.tier !== 'legacy').map(p => {
    const a = assessProject(p, ctx, deps.byProject.get(p.id) || [])
    a.derived.nextActions = nextActions(a.derived.blockers, a.derived.gates)
    return a
  })
  return { engineVersion: ENGINE_VERSION, asOf: asOf.toISOString().replace(/\.\d{3}Z$/, 'Z'), staleDays, approvalOwner: registry.approvalOwner, projects, dependencyCycles: deps.cycles }
}
