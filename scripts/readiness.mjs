#!/usr/bin/env node
// Release readiness and evidence summary, computed from the registry alone.
//
//   node scripts/readiness.mjs [--project <id>]     (npm run readiness)
//
// Pure: no network, no clock. Readiness follows the Definition of Done and release
// governance, never CI: a green workflow run is builder-reported evidence and cannot make a
// project ready. Every gate is re-checked here the way the validator checks it, so a gate
// marked verified without independent pass evidence is reported as unproven, not satisfied.

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { SYNC_RECORDER, redactSensitive } from './validate-registry.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const norm = s => (s || '').trim().toLowerCase()
const NON_PROVING_TYPES = new Set(['repository_metadata'])

export const VERDICT_TEXT = {
  released: 'Released and approved',
  'awaiting-owner-approval': 'Verified; awaiting Joshua Small\'s approval',
  'approved-not-released': 'Approved; not yet recorded as released',
  'not-ready': 'Not ready',
  'not-scoped': 'Not scoped (no target version or scope document)'
}

// The four kinds of evidence, kept apart: what automation observed, what a builder reports,
// what an independent verifier re-checked, and what the owner approved. A pass recorded
// while no separate builder and verifier are assigned is counted on its own: it cannot
// verify a gate until the release is scoped and a verifier re-checks it.
export function provenance(p) {
  const builder = norm(p.ownership.builder)
  const verifier = norm(p.ownership.verifier)
  const independent = Boolean(builder && verifier && builder !== verifier)
  const approval = new Set(p.approval.status === 'approved' ? p.approval.evidenceRefs : [])
  const c = { observation: 0, builderReported: 0, independentlyVerified: 0, passWithoutVerifier: 0, failed: 0, ownerApproval: 0 }
  for (const e of p.evidence) {
    if (approval.has(e.id)) c.ownerApproval++
    const manualPass = e.result === 'pass' && !NON_PROVING_TYPES.has(e.type) && (!e.origin || e.origin === 'manual') && norm(e.recordedBy) !== norm(SYNC_RECORDER)
    if (e.result === 'builder_reported') c.builderReported++
    else if (manualPass && independent && norm(e.recordedBy) !== builder) c.independentlyVerified++
    else if (manualPass) c.passWithoutVerifier++
    else if (e.result === 'fail') c.failed++
    else if (e.result === 'informational' || e.result === 'inconclusive') c.observation++
  }
  return c
}

// A gate is satisfied only with independent pass evidence, exactly as the validator demands.
// Exported for the release-readiness engine (scripts/release/), which adds currency checks.
export function gateProven(p, g) {
  const builder = norm(p.ownership.builder)
  const verifier = norm(p.ownership.verifier)
  if (!builder || !verifier || builder === verifier) return false
  const byId = new Map(p.evidence.map(e => [e.id, e]))
  return g.evidenceRefs.map(r => byId.get(r)).some(e => e && e.result === 'pass' && !NON_PROVING_TYPES.has(e.type) && (!e.origin || e.origin === 'manual') && norm(e.recordedBy) !== builder)
}

// Latest automated CI on the recorded head: shown for context, labelled builder-reported.
function latestCi(p) {
  const head = p.repositorySnapshot.headSha
  const runs = p.evidence.filter(e => e.origin === 'sync' && e.type === 'workflow_run' && head && e.commitSha === head)
  return runs.map(e => {
    const m = /concluded (\w+)/.exec(e.description)
    return { evidenceId: e.id, url: e.url, conclusion: m ? m[1] : 'unknown', at: e.verifiedAt }
  })
}

export function readiness(p) {
  const gates = { satisfied: [], inProgress: [], blocked: [], notStarted: [], notApplicable: [], unproven: [] }
  for (const g of p.releaseGates) {
    if (g.status === 'verified') (gateProven(p, g) ? gates.satisfied : gates.unproven).push(g.id)
    else if (g.status === 'not_applicable') gates.notApplicable.push(g.id)
    else if (g.status === 'in_progress') gates.inProgress.push(g.id)
    else if (g.status === 'blocked') gates.blocked.push(g.id)
    else gates.notStarted.push(g.id)
  }
  const openBlockers = p.release.blockers.filter(b => b.status === 'open').map(b => b.id)
  const r = p.release
  const own = p.ownership
  const reasons = []
  const unmet = p.releaseGates.length - gates.satisfied.length - gates.notApplicable.length
  if (unmet) reasons.push(`${unmet} of ${p.releaseGates.length} gates not independently verified`)
  if (gates.unproven.length) reasons.push(`marked verified without independent pass evidence: ${gates.unproven.join(', ')}`)
  if (openBlockers.length) reasons.push(`${openBlockers.length} open blocker(s): ${openBlockers.join(', ')}`)
  if (!r.targetVersion) reasons.push('no target version')
  if (!r.scopeDocument) reasons.push('no scope document')
  if (!own.builder || !own.verifier) reasons.push('builder and verifier not both assigned')
  else if (norm(own.builder) === norm(own.verifier)) reasons.push('builder and verifier are the same')

  let verdict
  if (!reasons.length) verdict = p.approval.status !== 'approved' ? 'awaiting-owner-approval' : r.releaseStatus === 'released' ? 'released' : 'approved-not-released'
  else verdict = !r.targetVersion || !r.scopeDocument ? 'not-scoped' : 'not-ready'
  if (verdict === 'awaiting-owner-approval' && p.approval.status !== 'approved') reasons.push('approval pending: only Joshua Small approves a release')

  return {
    id: p.id,
    name: p.name,
    tier: p.tier,
    releaseStatus: r.releaseStatus,
    currentVersion: r.currentVersion,
    targetVersion: r.targetVersion,
    verdict,
    reasons,
    gates,
    openBlockers,
    evidence: provenance(p),
    ci: latestCi(p),
    head: p.repositorySnapshot.headSha,
    observedAt: p.repositorySnapshot.observedAt,
    lastSyncedAt: p.sync ? p.sync.lastSyncedAt : null
  }
}

const cell = s => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ')
const ciText = ci => (ci.length ? ci.map(c => `${c.conclusion} (builder-reported)`).join(', ') : 'none recorded')

export function renderReadiness(registry, { only = null, heading = '#' } = {}) {
  const projects = registry.projects.filter(p => !only || p.id === only).map(readiness)
  const lines = [`${heading} Release readiness`, '']
  lines.push('Computed from the registry under the Definition of Done. CI results are builder-reported and never make a project ready; only independent verification and Joshua Small\'s approval do.', '')
  lines.push('| Project | Tier | Target | Verdict | Satisfied | Not applicable | In progress | Blocked | Not started | Open blockers | CI on recorded head |')
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
  for (const x of projects) {
    lines.push(`| ${cell(x.id)} | ${x.tier} | ${x.targetVersion || 'None'} | ${VERDICT_TEXT[x.verdict]} | ${x.gates.satisfied.length} | ${x.gates.notApplicable.length} | ${x.gates.inProgress.length} | ${x.gates.blocked.length} | ${x.gates.notStarted.length + x.gates.unproven.length} | ${x.openBlockers.length} | ${ciText(x.ci)} |`)
  }
  lines.push('')
  for (const x of projects) {
    lines.push(`${heading}# ${x.name} (${x.id})`, '')
    lines.push(`- Verdict: ${VERDICT_TEXT[x.verdict]}. Release status in the registry: ${x.releaseStatus}. Current version: ${x.currentVersion || 'none'}; target: ${x.targetVersion || 'none'}.`)
    if (x.reasons.length) lines.push(`- Why: ${x.reasons.join('; ')}.`)
    lines.push(`- Evidence: ${x.evidence.independentlyVerified} independently verified, ${x.evidence.builderReported} builder-reported, ${x.evidence.observation} observation, ${x.evidence.failed} failed, ${x.evidence.ownerApproval} owner approval${x.evidence.passWithoutVerifier ? `; ${x.evidence.passWithoutVerifier} pass record(s) made before a verifier was assigned, which verify nothing yet` : ''}.`)
    const g = x.gates
    if (g.inProgress.length) lines.push(`- In progress: ${g.inProgress.join(', ')}.`)
    if (g.blocked.length) lines.push(`- Blocked: ${g.blocked.join(', ')}.`)
    if (g.unproven.length) lines.push(`- Marked verified without independent proof: ${g.unproven.join(', ')}.`)
    lines.push(`- Repository head: ${x.head ? x.head.slice(0, 7) : 'unknown'} (observed ${x.observedAt}; last sync ${x.lastSyncedAt || 'never'}).`)
    lines.push('')
  }
  return lines.join('\n')
}

function main(argv) {
  const i = argv.indexOf('--project')
  const only = i === -1 ? null : argv[i + 1]
  const registry = JSON.parse(readFileSync(resolve(ROOT, 'projects/registry.json'), 'utf8'))
  if (only && !registry.projects.some(p => p.id === only)) {
    console.error(`readiness: no project "${only}" in the registry`)
    return 1
  }
  console.log(redactSensitive(renderReadiness(registry, { only })))
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2))
}
