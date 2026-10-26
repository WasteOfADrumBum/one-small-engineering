// Planning: registry + observation → proposed registry. Pure: no I/O, no clock
// except the observation's collectedAt, so the same inputs always give the same output.
//
// Automation may only change the fields listed in sync/field-ownership.json.
// Everything it records is informational or builder_reported; it never verifies,
// approves, resolves or reclassifies anything. Those become suggestions instead.

import { checkObservation } from './collect.mjs'
import { SYNC_RECORDER, effectiveConfig, slugify, globToRegExp, compareSemver, parseSemver, deepEqual } from './lib.mjs'

const short = sha => sha.slice(0, 7)

// Run identity is workflow + commit + run id + attempt, so a re-run on the same commit
// (success then failure, or the reverse) is a new record, never a silent no-op. The run
// id is written in base 36: registry strings may not hold 8+ digit runs (sensitive-data scan).
export function runIdentity(run) {
  return `${short(run.headSha)}-${run.runId.toString(36)}-${run.attempt}`
}

function runEvidence(pid, branch, run) {
  const wf = slugify(run.workflow)
  return {
    id: `sync-${pid}-run-${wf}-${runIdentity(run)}`,
    type: 'workflow_run',
    url: run.url,
    commitSha: run.headSha,
    verifiedAt: run.completedAt,
    result: 'builder_reported',
    description: `Automated observation: workflow ${run.workflow} ("${run.name}") concluded ${run.conclusion} on ${branch} at ${short(run.headSha)} (${run.event} event, attempt ${run.attempt}). Project CI is builder evidence; a verifier must re-check before any gate is verified.`,
    recordedBy: SYNC_RECORDER,
    origin: 'sync',
    eventKey: `${pid}:workflow_run:${run.workflow}/${runIdentity(run).replace(/-/g, '/')}`
  }
}

function releaseEvidence(pid, branch, rel) {
  const where = rel.onDefaultBranch ? `at ${short(rel.commitSha)} on ${branch}` : `at ${short(rel.commitSha)}, which is not on ${branch}`
  return {
    id: `sync-${pid}-release-${slugify(rel.tag)}`,
    type: 'release',
    url: rel.url,
    commitSha: rel.commitSha,
    verifiedAt: rel.publishedAt,
    result: 'informational',
    description: `Automated observation: GitHub release ${rel.tag} published${rel.prerelease ? ' as a prerelease' : ''} ${where}. Distribution and artifact checks remain manual.`,
    recordedBy: SYNC_RECORDER,
    origin: 'sync',
    eventKey: `${pid}:release:${slugify(rel.tag)}`
  }
}

function mergeEvidence(pid, branch, pr, reason) {
  return {
    id: `sync-${pid}-pr-${pr.number}`,
    type: 'pull_request',
    url: pr.url,
    commitSha: pr.mergeCommitSha,
    verifiedAt: pr.mergedAt,
    result: 'informational',
    description: `Automated observation: PR #${pr.number} "${pr.title}" merged into ${branch} (${reason}).`,
    recordedBy: SYNC_RECORDER,
    origin: 'sync',
    eventKey: `${pid}:pull_request:${pr.number}`
  }
}

// IDs of evidence cited anywhere in the project. Cited automated records are never pruned.
function referencedIds(p) {
  const refs = new Set()
  for (const g of p.releaseGates) g.evidenceRefs.forEach(r => refs.add(r))
  for (const b of p.release.blockers) b.evidenceRefs.forEach(r => refs.add(r))
  p.approval.evidenceRefs.forEach(r => refs.add(r))
  p.modsPack.evidenceRefs.forEach(r => refs.add(r))
  return refs
}

// The facts that make a sync PR worth opening. Timestamps of the sync itself are excluded,
// so re-running against unchanged GitHub state is a no-op.
export function materialView(p) {
  const { observedAt, ...snapshot } = p.repositorySnapshot
  return {
    snapshot,
    openPullRequests: p.openPullRequests,
    evidence: p.evidence.filter(e => e.origin === 'sync'),
    currentVersion: p.release.currentVersion,
    currentVersionSource: p.release.currentVersionSource,
    configSource: p.sync ? p.sync.configSource : null
  }
}

// The snapshot written for this observation. Keys are always in the same order, so the
// same facts give byte-identical output.
export function snapshotFrom(prev, observation, notes = []) {
  const s = { defaultBranch: observation.repo.defaultBranch, headSha: observation.head.sha, archived: observation.repo.archived, observedAt: observation.collectedAt, visibility: observation.repo.visibility }
  const t = observation.tags
  if (t.status === 'unavailable') {
    if (prev.latestTag !== undefined) s.latestTag = prev.latestTag
    notes.push('Tags could not be read; the recorded latest tag is kept unchanged.')
  } else s.latestTag = t.latest ? { name: t.latest.name, version: t.latest.version, commitSha: t.latest.commitSha } : null
  const k = observation.package
  if (k.status === 'unavailable') {
    if (prev.package !== undefined) s.package = prev.package
    notes.push('package.json could not be read; the recorded package metadata is kept unchanged.')
  } else if (k.status === 'observed') s.package = { status: 'observed', name: k.name, version: k.version, private: k.private }
  else s.package = { status: k.status, name: null, version: null, private: null }
  if (t.status === 'observed' && t.truncated) notes.push(`More than ${t.count} tags exist; the latest version tag was chosen from the first ${t.count} only.`)
  return s
}

export function plan(registry, observation) {
  const index = registry.projects.findIndex(p => p.id === observation.projectId)
  if (index === -1) throw new Error(`project ${observation.projectId} is not in the registry`)
  const before = registry.projects[index]
  checkObservation(before, observation)

  const pid = before.id
  const config = effectiveConfig(observation.config.value)
  const branch = observation.repo.defaultBranch
  const notes = []
  const suggestions = []
  if (!config.enabled) {
    return { registry, changed: false, changes: [], suggestions, notes: ['Paused: the repository config sets reporting.enabled to false.'] }
  }

  const p = structuredClone(before)
  const changes = []

  // Repository snapshot and open PRs are replaced from GitHub. A section GitHub could not
  // answer keeps its previous value: missing data is never written as "none".
  const prev = before.repositorySnapshot
  p.repositorySnapshot = snapshotFrom(prev, observation, notes)
  // The relation describes the head recorded when collecting; if main has moved on since, it is not known.
  const rel = observation.head.previousSha === (prev.headSha || null) ? observation.head.relation : 'unknown'
  if (prev.headSha !== observation.head.sha) {
    const from = prev.headSha ? short(prev.headSha) : 'unknown'
    if (rel === 'rewritten' || rel === 'unreachable') {
      changes.push(`Default branch ${branch} history was rewritten: ${from} is ${rel === 'rewritten' ? 'not an ancestor of' : 'no longer in the repository, so it cannot be an ancestor of'} ${short(observation.head.sha)} (force push or branch reset).`)
      const commitRefs = before.evidence.filter(e => e.origin !== 'sync' && e.commitSha).length
      suggestions.push(`History on ${branch} was rewritten (${from} → ${short(observation.head.sha)}). Re-check the ${commitRefs} manual evidence record(s) that name a commit, and any gate verified against a commit from before the rewrite, before relying on them.`)
    } else {
      changes.push(`Default branch ${branch} moved from ${from} to ${short(observation.head.sha)}${rel === 'fast-forward' ? ' (fast-forward)' : ''}.`)
      if (rel === 'unknown') notes.push(`Whether ${branch} moved by fast-forward or by a rewrite could not be read; the next run checks again.`)
    }
  }
  if (prev.defaultBranch !== branch) {
    changes.push(`Default branch renamed from ${prev.defaultBranch} to ${branch}.`)
    suggestions.push(`The default branch is now ${branch}; check any documentation or evidence that names ${prev.defaultBranch}.`)
  }
  if (prev.archived !== observation.repo.archived) {
    changes.push(`Archived flag changed to ${observation.repo.archived}.`)
    if (observation.repo.archived && p.lifecycle === 'active') suggestions.push('The repository is archived but the project lifecycle is active; review lifecycle.')
  }
  const snap = p.repositorySnapshot
  if (prev.visibility !== snap.visibility) changes.push(`Visibility recorded as ${snap.visibility}${prev.visibility ? ` (was ${prev.visibility})` : ''}.`)
  if (snap.visibility !== p.visibility) suggestions.push(`GitHub reports the repository as ${snap.visibility} but the registry says ${p.visibility}; update the project's visibility by hand (a private repository needs the reader credential).`)
  if (!deepEqual(prev.latestTag, snap.latestTag) && snap.latestTag !== undefined) {
    changes.push(snap.latestTag ? `Latest version tag is ${snap.latestTag.name} at ${short(snap.latestTag.commitSha)}.` : 'No version tag on the repository.')
  }
  if (snap.latestTag && !observation.releases.some(r => r.tag === snap.latestTag.name)) suggestions.push(`Tag ${snap.latestTag.name} has no published GitHub release${observation.releases.length ? ` among the ${observation.releases.length} newest` : ' (the repository has none)'}; a tag alone does not move currentVersion or satisfy any release gate.`)
  if (!deepEqual(prev.package, snap.package) && snap.package !== undefined) {
    const k = snap.package
    changes.push(k.status === 'observed' ? `package.json at ${short(observation.head.sha)}: ${k.name || '(no valid name)'}@${k.version || '(no valid version)'}${k.private ? ' (private)' : ''}.` : k.status === 'none' ? 'No root package.json at the head commit.' : 'Root package.json is present but unreadable.')
  }
  // A private package is never published, so its version says nothing about distribution.
  if (snap.package && snap.package.status === 'observed' && !snap.package.private && snap.package.version && parseSemver(snap.package.version) && (!parseSemver(p.release.currentVersion) || compareSemver(snap.package.version, p.release.currentVersion) > 0)) {
    suggestions.push(`package.json declares ${snap.package.version} but currentVersion is ${p.release.currentVersion || 'unset'}. currentVersion moves only from a published release; distribution and provenance are verified by hand.`)
  }

  p.openPullRequests = observation.openPullRequests
    .filter(pr => config.includeDraftPullRequests || !pr.draft)
    .map(pr => ({ number: pr.number, url: pr.url, title: pr.title, headSha: pr.headSha, draft: pr.draft }))
  const oldPrs = new Map(before.openPullRequests.map(pr => [pr.number, pr]))
  const newPrs = new Map(p.openPullRequests.map(pr => [pr.number, pr]))
  for (const [n, pr] of newPrs) {
    const old = oldPrs.get(n)
    if (!old) changes.push(`PR #${n} opened${pr.draft ? ' as a draft' : ''}: ${pr.title}.`)
    else {
      if (old.draft !== pr.draft) changes.push(`PR #${n} ${pr.draft ? 'converted to draft' : 'marked ready for review'}.`)
      if (old.headSha !== pr.headSha) changes.push(`PR #${n} head moved to ${short(pr.headSha)}.`)
      if (old.title !== pr.title) changes.push(`PR #${n} retitled: ${pr.title}.`)
    }
  }
  const mergedNumbers = new Set(observation.mergedPullRequests.map(pr => pr.number))
  for (const n of oldPrs.keys()) if (!newPrs.has(n)) changes.push(`PR #${n} ${mergedNumbers.has(n) ? 'merged' : 'closed or no longer listed'}.`)

  // Evidence: deterministic IDs and eventKeys make re-runs and missed windows idempotent.
  const keys = new Set(p.evidence.map(e => e.eventKey).filter(Boolean))
  const ids = new Set(p.evidence.map(e => e.id))
  const add = e => {
    if (keys.has(e.eventKey) || ids.has(e.id)) return false
    p.evidence.push(e)
    keys.add(e.eventKey)
    ids.add(e.id)
    return true
  }

  for (const run of observation.workflowRuns) {
    if (add(runEvidence(pid, branch, run))) changes.push(`Recorded CI: ${run.workflow} concluded ${run.conclusion} at ${short(run.headSha)}.`)
  }
  const failed = observation.workflowRuns.filter(r => r.conclusion !== 'success' && r.conclusion !== 'skipped' && r.conclusion !== 'neutral')
  // Incomplete CI evidence never supports a positive conclusion, and never prunes older records.
  const complete = observation.collection.complete
  if (failed.length) suggestions.push(`CI did not pass on ${short(observation.head.sha)} (${failed.map(r => `${r.workflow}: ${r.conclusion}`).join(', ')}); automated-checks must not be verified for this commit.`)
  if (!complete) {
    suggestions.push(`Collection for ${short(observation.head.sha)} is incomplete (${observation.collection.gaps.join('; ')}); automated-checks must not be verified from this run.`)
    notes.push('Incomplete CI collection: older automated CI records were kept, and no CI pass was reported.')
  } else if (!failed.length && observation.workflowRuns.length) {
    const gate = p.releaseGates.find(g => g.id === 'automated-checks')
    if (gate && gate.status !== 'verified') suggestions.push(`CI passed on ${short(observation.head.sha)}. If this is the release commit, the verifier can re-check the run and record their own pass evidence for automated-checks; automation will not.`)
  }

  // Older automated CI records are superseded by the current head, unless something cites them.
  const cited = referencedIds(p)
  const currentRunIds = new Set(observation.workflowRuns.map(r => runEvidence(pid, branch, r).id))
  const pruned = []
  if (observation.workflowRuns.length && complete) {
    p.evidence = p.evidence.filter(e => {
      const stale = e.origin === 'sync' && e.type === 'workflow_run' && !currentRunIds.has(e.id) && !cited.has(e.id)
      if (stale) pruned.push(e.id)
      return !stale
    })
  }
  if (pruned.length) changes.push(`Superseded ${pruned.length} older automated CI record(s): ${pruned.join(', ')}.`)
  // A superseded record that something cites stays, but the citing owner should know it is no longer current.
  const keptStale = p.evidence.filter(e => e.origin === 'sync' && e.type === 'workflow_run' && !currentRunIds.has(e.id) && cited.has(e.id) && observation.workflowRuns.length && complete)
  for (const e of keptStale) suggestions.push(`${e.id} is cited but superseded by a newer CI run; check whether the citing gate, blocker or approval still holds.`)

  const tagRe = new RegExp(config.releaseTagPattern)
  for (const rel of observation.releases) {
    if (keys.has(`${pid}:release:${slugify(rel.tag)}`)) continue
    if (!rel.commitSha) {
      notes.push(`Release ${rel.tag} skipped: its tag could not be resolved to a commit.`)
      continue
    }
    if (add(releaseEvidence(pid, branch, rel))) changes.push(`Recorded release ${rel.tag}.`)
  }

  const matchers = config.materialPaths.map(globToRegExp)
  for (const pr of observation.mergedPullRequests) {
    const labelled = pr.labels.includes(config.evidenceLabel)
    const paths = (pr.files || []).filter(f => matchers.some(m => m.test(f)))
    if (!labelled && !paths.length) continue
    const reason = labelled ? `label ${config.evidenceLabel}` : `touches ${paths.slice(0, 3).join(', ')}${paths.length > 3 ? ' and more' : ''}`
    if (add(mergeEvidence(pid, branch, pr, reason))) changes.push(`Recorded merged PR #${pr.number} (${reason}).`)
  }

  // currentVersion moves forward only for a published, non-prerelease release on the default branch.
  let best = null
  for (const rel of observation.releases) {
    if (rel.prerelease || !rel.onDefaultBranch || !rel.commitSha) continue
    const m = tagRe.exec(rel.tag)
    if (!m || !parseSemver(m[1])) continue
    if (!best || compareSemver(m[1], best.version) > 0) best = { version: m[1], rel }
  }
  if (best && (!before.release.currentVersion || compareSemver(best.version, before.release.currentVersion) > 0)) {
    p.release = { ...p.release, currentVersion: best.version, currentVersionSource: `GitHub release ${best.rel.tag}, recorded by ${SYNC_RECORDER} (evidence sync-${pid}-release-${slugify(best.rel.tag)})` }
    changes.push(`currentVersion ${before.release.currentVersion || 'none'} → ${best.version} from release ${best.rel.tag}.`)
    if (p.release.targetVersion === best.version) suggestions.push(`Release ${best.rel.tag} matches targetVersion ${best.version}. releaseStatus, gates and approval stay manual: verify distribution and record approval before marking it released.`)
  }

  p.sync = { ...p.sync, lastSyncedAt: observation.collectedAt, lastSyncedHead: observation.head.sha, configSource: observation.config.source }
  if ((before.sync && before.sync.configSource) !== observation.config.source) changes.push(`Config source is now ${observation.config.source === 'repository' ? 'the repository config file' : 'hub defaults'}.`)
  if (before.sync && before.sync.mode === 'integrated' && observation.template.present === false) suggestions.push('The project-side template workflow is missing; onboarding can regenerate it.')

  const changed = !deepEqual(materialView(before), materialView(p))
  if (!changed) return { registry, changed: false, changes: [], suggestions, notes }

  const next = structuredClone(registry)
  next.projects[index] = p
  next.lastUpdatedAt = observation.collectedAt > registry.lastUpdatedAt ? observation.collectedAt : registry.lastUpdatedAt
  return { registry: next, changed: true, changes, suggestions, notes }
}
