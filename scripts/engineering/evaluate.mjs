// The pure evaluation step (Phase 5, docs/engineering.md): from committed inputs only (registry,
// policy, evidence ledgers, verification records, engineering state, remediation PR list) to the
// unified result the dashboard renders. No network, no clock: the same inputs and asOf give the
// same result, which is what `engineering:report -- --check` relies on.

import { applyVerifications, verificationAssessment } from '../verify/overlay.mjs'
import { assessRegistry } from '../release/engine.mjs'
import { targetsFrom } from '../verify/cli.mjs'
import { staleness } from '../verify/evidence.mjs'
import { dependencyImpact } from './dependencies.mjs'
import { releaseState, releasePlan, RELEASE_STATES } from './release.mjs'
import { advisoryIssues, collectorIssues, blockerIssues, ownershipIssue, verificationIssue, staleIssue, dependencyIssues, attachPullRequests, rankIssues, mergeAccessIssues } from './queue.mjs'

const latestFor = (evidence, name, sha, asOf) => evidence.filter(e => e.collector.name === name && (!sha || e.commitSha === sha) && !staleness(e, { commitSha: sha, asOf })).sort((a, b) => b.executedAt.localeCompare(a.executedAt))[0] || null

// Follow-up verification is pending while a dependent has no evidence newer than the change.
function pendingChanges(registry, state, ledgers) {
  const changed = new Map()
  for (const p of registry.projects.filter(p => p.tier !== 'legacy')) {
    const s = state.projects[p.id]
    if (s && s.previousRevision && s.changedAt) changed.set(p.id, { from: s.previousRevision, to: s.revision, at: s.changedAt })
  }
  return { changed, isPending: (dependent, at) => !(ledgers.get(dependent) || []).some(e => e.executedAt > at) }
}

export function evaluate({ vstate, estate, prs, asOf, staleDays = 30 }) {
  const at = new Date(asOf)
  const { registry, schema, dodText, policy, ledgers, verifications } = vstate
  const targets = targetsFrom(vstate)
  const remediation = new Map(Object.entries(vstate.runs.remediation || {}))
  const v = verificationAssessment({ registry, schema, dodText, asOf: at, policy, ledgers, verifications, targets, remediation, staleDays })
  const applied = applyVerifications(registry, { policy, ledgers, verifications, targets, asOf: at, schema, dodText })
  const engine = assessRegistry(applied.registry, { dodText, asOf: at, staleDays })

  // Advisory triage detail from each project's current audit record.
  const audits = new Map()
  const advisories = new Map()
  for (const p of v.projects) {
    const rec = latestFor(ledgers.get(p.id) || [], 'dependency-audit', p.target.sha, at)
    audits.set(p.id, rec)
    advisories.set(p.id, (rec && rec.details && rec.details.advisories) || [])
  }
  const manifests = new Map(Object.entries(estate.projects).filter(([, s]) => s.manifest).map(([id, s]) => [id, s.manifest]))
  const pend = pendingChanges(registry, estate, ledgers)
  const impact = dependencyImpact({ registry, manifests, changed: pend.changed, advisories, asOf: at, staleDays })
  impact.followUps = impact.followUps.filter(f => pend.isPending(f.project, pend.changed.get(f.because).at))
  const sharedWith = new Map(impact.sharedPackages.map(s => [s.name, Object.keys(s.projects)]))

  const issues = [...ownershipIssue(registry), ...dependencyIssues(impact)]
  const projects = []
  for (const pv of v.projects) {
    const p = registry.projects.find(x => x.id === pv.id)
    const eng = engine.projects.find(x => x.id === pv.id)
    const s = estate.projects[pv.id] || {}
    const access = s.access && s.access !== 'ok' ? s.access : (pv.findings.some(f => f.kind === 'access' && f.collector === 'repo-structure') ? 'unavailable' : 'ok')
    const depBlocked = eng.derived.dependencies.filter(d => d.blocking).map(d => d.project)
    const rs = releaseState({ p, v: pv, engine: eng, approvalOwner: registry.approvalOwner, access, dependencyBlocked: depBlocked })
    const depNotes = [...impact.edges.filter(e => e.from === pv.id).map(e => `${e.confirmed ? 'confirmed' : 'suspected'} ${e.kind}: ${e.relationship} ${e.to}${e.requiredForRelease ? ' (required for release)' : ''}`), ...eng.derived.dependencies.filter(d => d.blocking).map(d => d.message)]
    const audit = audits.get(pv.id)
    issues.push(...(audit && audit.result === 'fail' ? advisoryIssues(p, audit, sharedWith) : []), ...collectorIssues(p, pv, { hasAdvisoryDetail: Boolean(audit && audit.details) }), ...blockerIssues(p, pv), ...verificationIssue(p, pv), ...staleIssue(p, pv))
    const ci = latestFor(ledgers.get(pv.id) || [], 'ci-results', pv.target.sha, at)
    projects.push({
      id: pv.id,
      name: pv.name,
      tier: pv.tier,
      repository: pv.repository,
      revision: pv.target.sha,
      revisionSource: pv.target.source,
      liveRevision: s.revision || null,
      revisionSeenSince: s.changedAt || null,
      access: access === 'ok' ? 'readable' : `${access}${s.accessReason ? `: ${s.accessReason}` : ''}`,
      lastCollection: pv.lastCollection,
      ci: ci ? ci.result : 'no current evidence',
      readiness: pv.readiness,
      gateStates: pv.gateStates,
      release: rs,
      releasePlan: releasePlan({ p, v: pv, engine: eng, state: rs, policy, dependencyNotes: depNotes }),
      blockers: pv.blockers.filter(b => b.origin === 'registry' || /^auto-(gate-failed|ci-failed|dependency|candidate-moved)/.test(b.id)).map(b => ({ id: b.id, severity: b.severity, description: b.description })),
      openPullRequests: (p.openPullRequests || []).length,
      sync: (estate.sync || {})[pv.id] || { status: 'unknown', reason: 'no sync observation recorded', changes: [] },
      previousReleaseState: (s.history || []).length > 1 ? s.history[s.history.length - 2].state : null
    })
  }
  const queue = rankIssues(attachPullRequests(mergeAccessIssues(issues), prs), registry).map(i => ({ ...i, firstSeen: (estate.findings[i.id] || {}).firstSeen || asOf, isNew: !estate.findings[i.id] || (estate.lastRun && estate.findings[i.id].firstSeen === estate.lastRun.at) }))
  for (const p of projects) {
    const mine = queue.filter(i => i.projects.includes(p.id) || i.project === p.id)
    p.security = { critical: 0, high: 0, medium: 0, low: 0 }
    for (const i of mine.filter(i => i.kind === 'vulnerability' || (i.id.endsWith(':secret-scan') && i.kind === 'defect'))) p.security[i.severity === 'info' ? 'low' : i.severity]++
    const top = mine[0]
    p.nextAction = top ? top.nextAction : 'None'
    p.queueItems = mine.length
  }
  const total = (k, f) => projects.reduce((n, p) => n + f(p), 0)
  const overview = {
    activeProjects: projects.length,
    readyForRelease: projects.filter(p => ['approved', 'released'].includes(p.release.state)).length,
    candidateReady: projects.filter(p => ['candidate_ready', 'awaiting_approval'].includes(p.release.state)).length,
    blocked: projects.filter(p => p.release.state === 'blocked').length,
    failingCi: projects.filter(p => p.ci === 'fail').length,
    ciUnknown: projects.filter(p => !['pass', 'fail'].includes(p.ci)).length,
    security: ['critical', 'high', 'medium', 'low'].reduce((o, s) => ({ ...o, [s]: total(s, p => p.security[s]) }), {}),
    verificationCoverage: { verified: total('v', p => p.readiness.verifiedGates), applicable: total('a', p => p.readiness.applicableGates) },
    openRemediationPRs: prs.filter(pr => ['open', 'draft', 'unknown'].includes(pr.status || 'unknown')).length,
    unreviewedRemediationPRs: prs.filter(pr => ['open', 'draft'].includes(pr.status) && pr.reviewed === false).length,
    staleEvidence: total('s', p => (v.projects.find(x => x.id === p.id).staleEvidence || []).length),
    dependencyRisks: impact.risks.length,
    inaccessible: projects.filter(p => p.access !== 'readable').map(p => p.id),
    releaseStates: Object.fromEntries(RELEASE_STATES.map(s => [s, projects.filter(p => p.release.state === s).length])),
    queue: Object.fromEntries(['automatic', 'independent-verification', 'owner-decision', 'blocked-credentials', 'informational'].map(c => [c, queue.filter(i => i.actionClass === c).length]))
  }
  return { asOf, overview, projects, queue, dependencies: impact, pullRequests: prs, run: estate.lastRun, policyVersion: policy.policyVersion, overlayErrors: v.overlayErrors }
}
