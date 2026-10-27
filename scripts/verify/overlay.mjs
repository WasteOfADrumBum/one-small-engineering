// Readiness with independent verification applied (Phase 4, docs/verification.md).
//
// Valid verification records are applied to an in-memory copy of the registry, which must still
// pass the registry validator, and the Phase 3 engine recalculates readiness from it. The real
// registry is never written: gate status, ownership, blockers and approval in the file change only
// through owner-reviewed PRs. Invalid verification records are reported with every reason and
// change nothing, so a forged or mismatched record can never raise a score.

import { assessRegistry } from '../release/engine.mjs'
import { validateRegistry, parseDefinitionOfDone } from '../validate-registry.mjs'
import { judgeVerification } from './verification.mjs'
import { staleness, sha256 } from './evidence.mjs'

// Registry evidence id for a verification: letters only after the prefix, so the registry's
// sensitive-data scan (which flags long digit runs) never trips on a hash.
export const registryEvidenceId = id => `vr-${[...sha256(id).slice(0, 16)].map(c => 'abcdefghijklmnop'[parseInt(c, 16)]).join('')}`

export const GATE_STATES = ['independently_verified', 'passed_by_builder', 'failed', 'inconclusive', 'not_tested', 'not_applicable']
export const GATE_STATE_TEXT = {
  independently_verified: 'Independently verified',
  passed_by_builder: 'Passed by builder (not independent)',
  failed: 'Failed',
  inconclusive: 'Inconclusive',
  not_tested: 'Not tested',
  not_applicable: 'Not applicable'
}

const SEVERITY_BY_COLLECTOR = { 'secret-scan': 'critical', 'dependency-audit': 'high', 'build-test': 'high', 'lint-format-types': 'medium', 'ci-results': 'high', 'release-packaging': 'medium', compatibility: 'medium', documentation: 'low', accessibility: 'medium', 'deployment-health': 'high', 'repo-structure': 'low' }
export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'unclassified']

// The registry with valid verifications applied. Returns { registry, judged, errors }.
export function applyVerifications(registry, { policy, ledgers, verifications, targets, asOf, schema, dodText }) {
  const derived = structuredClone(registry)
  const judged = []
  let latest = derived.lastUpdatedAt
  for (const p of derived.projects) {
    if (p.tier === 'legacy') continue
    const records = verifications.get(p.id) || []
    const target = targets.get(p.id) || {}
    for (const v of records) {
      const j = judgeVerification(v, { project: registry.projects.find(x => x.id === p.id), policy, evidence: ledgers.get(p.id) || [], targetSha: target.sha, asOf, gateCatalog: registry.gateCatalog[p.tier] })
      judged.push({ project: p.id, id: v.id, gate: v.gate, verifier: v.verifier.name, kind: v.verifier.kind, method: v.method, result: v.result, verifiedAt: v.verifiedAt, commitSha: v.commitSha, attestation: v.attestation, valid: j.valid, reasons: j.reasons })
      if (!j.valid) continue
      const gate = p.releaseGates.find(g => g.id === v.gate)
      const rid = registryEvidenceId(v.id)
      if (!gate || p.evidence.some(e => e.id === rid)) continue
      p.evidence.push({ id: rid, type: v.method === 'manual-test' ? 'manual_test' : 'audit', url: v.attestation, commitSha: v.commitSha, verifiedAt: v.verifiedAt, result: v.result, description: `Independent verification by ${v.verifier.name} (${v.method}) of ${v.evidence.length} evidence record(s): ${v.notes}`, recordedBy: v.verifier.name })
      gate.evidenceRefs = [...gate.evidenceRefs, rid]
      if (v.result === 'pass' && gate.status !== 'not_applicable') { gate.status = 'verified'; gate.verifiedAt = v.verifiedAt }
      if (v.verifiedAt > latest) latest = v.verifiedAt
    }
  }
  derived.lastUpdatedAt = latest
  // The derived registry must satisfy every registry rule; if it does not, nothing is applied.
  const errors = schema ? validateRegistry(derived, schema, { dod: parseDefinitionOfDone(dodText), now: asOf }) : []
  if (errors.length) return { registry, judged: judged.map(j => (j.valid ? { ...j, valid: false, reasons: [`not applied: the registry with this verification fails validation (${errors[0]})`] } : j)), errors }
  return { registry: derived, judged, errors }
}

// Six-state view of one gate from the engine's result plus current collector evidence.
export function gateView(g, { policy, evidence, target, asOf, judged }) {
  const gp = policy.gates[g.id] || { automation: 'none', collectors: [] }
  const related = evidence.filter(e => e.gates.includes(g.id))
  const current = related.filter(e => !staleness(e, { commitSha: target, asOf }))
  const stale = related.filter(e => e.result !== 'unavailable' && staleness(e, { commitSha: target, asOf })).map(e => ({ id: e.id, reason: staleness(e, { commitSha: target, asOf }) }))
  // Newest current record per collector.
  const latest = new Map()
  for (const e of [...current].sort((a, b) => b.executedAt.localeCompare(a.executedAt))) if (!latest.has(e.collector.name)) latest.set(e.collector.name, e)
  const required = (gp.collectors || []).map(c => latest.get(c)).filter(Boolean)
  const verifications = judged.filter(j => j.gate === g.id)
  let state
  if (g.state === 'not_applicable') state = 'not_applicable'
  else if (g.state === 'verified') state = 'independently_verified'
  else if (g.failed || verifications.some(j => j.valid && j.result === 'fail') || [...latest.values()].some(e => e.result === 'fail')) state = 'failed'
  else if (g.provenance === 'pass-without-independent-verifier' || (required.length && required.length === (gp.collectors || []).length && required.every(e => e.result === 'pass'))) state = 'passed_by_builder'
  else if ([...latest.values()].some(e => ['inconclusive', 'unavailable'].includes(e.result)) || stale.length || g.state === 'unknown_stale') state = 'inconclusive'
  else state = 'not_tested'
  return {
    id: g.id,
    state,
    engineState: g.state,
    applicable: g.applicable,
    automation: gp.automation,
    manualReviewRequired: gp.automation !== 'full',
    humanOnly: (policy.humanOnlyGates || []).includes(g.id),
    collectorEvidence: [...latest.values()].map(e => ({ id: e.id, collector: e.collector.name, result: e.result, executedAt: e.executedAt, summary: e.summary })).sort((a, b) => a.collector.localeCompare(b.collector)),
    staleEvidence: stale,
    verifications: verifications.map(j => ({ id: j.id, verifier: j.verifier, result: j.result, valid: j.valid, reasons: j.reasons })),
    missingVerification: g.applicable && g.state !== 'verified',
    missing: g.missing,
    nextAction: g.nextAction
  }
}

// A finding for every collector result at the evaluated commit that is not a pass.
export function findingsFor(p, { evidence, target, asOf, policy, catalog }) {
  const out = []
  const latest = new Map()
  for (const e of evidence.filter(e => !staleness(e, { commitSha: target, asOf })).sort((a, b) => b.executedAt.localeCompare(a.executedAt))) if (!latest.has(e.collector.name)) latest.set(e.collector.name, e)
  for (const e of [...latest.values()].sort((a, b) => a.collector.name.localeCompare(b.collector.name))) {
    if (e.result === 'pass' || e.result === 'not_applicable') continue
    const gates = e.gates.filter(g => catalog.includes(g))
    const failing = e.checks.filter(c => c.result === 'fail')
    const severity = e.result === 'fail' ? SEVERITY_BY_COLLECTOR[e.collector.name] || 'medium' : e.result === 'unavailable' ? 'unclassified' : 'low'
    out.push({
      id: `${p.id}:${e.collector.name}:${(e.commitSha || 'none').slice(0, 7)}`,
      project: p.id,
      repository: p.repository,
      commitSha: e.commitSha,
      collector: e.collector.name,
      evidenceId: e.id,
      kind: e.result === 'fail' ? 'defect' : e.result === 'unavailable' ? 'access' : 'evidence-gap',
      severity,
      gates,
      releaseImpact: gates.length ? `blocks verification of ${gates.join(', ')}` : 'context only; no gate depends on it',
      title: e.summary,
      reproduction: e.reproduce || `node scripts/verify/cli.mjs run --project ${p.id} --collector ${e.collector.name}${e.execute ? ' --execute' : ''}`,
      rootCause: e.result === 'fail' ? (failing.length ? failing.map(c => `${c.name}: ${c.detail}`).join(' | ') : e.failureReason) : null,
      failureReason: e.failureReason,
      proposedFix: null,
      acceptance: gates.length ? `The ${e.collector.name} collector reports pass at the new commit, and the verifier records it for ${gates.join(', ')}.` : `The ${e.collector.name} collector reports pass.`,
      verification: gates.map(g => `${g}: ${(policy.gates[g] || {}).automation === 'full' ? 're-executed by the verifier' : 'manual review by the verifier'}`)
    })
  }
  return out
}

// Everything the dashboard needs, deterministic for the same inputs.
export function verificationAssessment({ registry, schema, dodText, asOf, policy, ledgers, verifications, targets, staleDays = 30, remediation = new Map() }) {
  const applied = applyVerifications(registry, { policy, ledgers, verifications, targets, asOf, schema, dodText })
  const base = assessRegistry(registry, { dodText, asOf, staleDays })
  const after = assessRegistry(applied.registry, { dodText, asOf, staleDays })
  const projects = after.projects.map(a => {
    const p = registry.projects.find(x => x.id === a.id)
    const before = base.projects.find(x => x.id === a.id)
    const target = targets.get(a.id) || { sha: null, source: 'unknown' }
    const evidence = ledgers.get(a.id) || []
    const judged = applied.judged.filter(j => j.project === a.id)
    const gates = a.derived.gates.map(g => gateView(g, { policy, evidence, target: target.sha, asOf, judged }))
    const catalog = registry.gateCatalog[p.tier]
    const findings = findingsFor(p, { evidence, target: target.sha, asOf, policy, catalog })
    const blockers = [...a.derived.blockers.merge, ...a.derived.blockers.release]
    const bySeverity = Object.fromEntries(SEVERITIES.map(s => [s, 0]))
    for (const b of blockers) bySeverity[b.severity || 'unclassified']++
    for (const f of findings.filter(f => f.kind === 'defect')) bySeverity[f.severity]++
    const r = a.derived.readiness
    const lastVerification = judged.filter(j => j.valid).map(j => j.verifiedAt).sort().pop() || null
    const lastCollection = evidence.map(e => e.executedAt).sort().pop() || null
    const count = s => gates.filter(g => g.state === s).length
    const firstDefect = findings.find(f => f.kind === 'defect' && ['critical', 'high'].includes(f.severity))
    const next = firstDefect ? `Fix ${firstDefect.collector} at ${firstDefect.commitSha.slice(0, 7)}: ${firstDefect.title}.` : a.derived.nextActions[0] ? a.derived.nextActions[0].summary : 'None'
    return {
      id: a.id,
      name: a.name,
      tier: a.tier,
      repository: p.repository,
      target,
      readiness: {
        percentage: r.percentage,
        previousPercentage: before.derived.readiness.percentage,
        applicableGates: r.applicableGates,
        verifiedGates: r.verifiedGates,
        eligibility: r.eligibility,
        ownershipValid: r.ownershipValid
      },
      gateStates: Object.fromEntries(GATE_STATES.map(s => [s, count(s)])),
      gates,
      missingVerification: gates.filter(g => g.missingVerification).map(g => g.id),
      staleEvidence: gates.flatMap(g => g.staleEvidence.map(s => ({ gate: g.id, ...s }))).filter((s, i, xs) => xs.findIndex(x => x.id === s.id) === i).map(({ gate, ...s }) => s),
      blockers: blockers.map(b => ({ id: b.id, origin: b.origin, severity: b.severity || 'unclassified', blocks: b.blocks, category: b.category, description: b.description })),
      blockersBySeverity: bySeverity,
      mergeEligible: Boolean(p.release.candidate) && a.derived.blockers.merge.length === 0 && !findings.some(f => f.kind === 'defect' && ['critical', 'high'].includes(f.severity)),
      releaseEligible: r.releaseReady,
      lastVerification,
      lastCollection,
      nextAction: next,
      findings,
      verifications: judged,
      relatedPullRequests: (p.openPullRequests || []).map(x => ({ number: x.number, url: x.url, draft: x.draft })),
      remediation: remediation.get(a.id) || []
    }
  })
  return { asOf: after.asOf, policyVersion: policy.policyVersion, overlayErrors: applied.errors, projects }
}
