// Verification orchestrator (Phase 4, docs/verification.md).
//
// For one project or all of them: decide the commit to evaluate, work out which gates apply from
// the tier, find evidence that is missing or stale, run the collectors that are needed, add their
// records to the evidence ledger, route ready evidence to the registry's verifier, and recalculate
// readiness with valid verifications applied.
//
// Incremental: a collector is skipped when the ledger already holds a current record with the
// same cache key (project, commit, collector version, policy hash, execution mode). Unavailable
// results are always retried. Nothing here writes the registry, records a verification, approves
// anything or writes to GitHub.

import { join } from 'node:path'
import { makeEvidence, staleness, cacheKey, mergeLedger, pruneLedger, iso } from './evidence.mjs'
import { COLLECTORS } from './collectors.mjs'
import { resolveRef, checkout, workspaceView, AccessError } from './workspace.mjs'
import { routeRequests } from './verification.mjs'

// Gates of the tier that are applicable (a not_applicable gate needs a written rationale).
export function applicableGates(registry, p) {
  if (p.tier === 'legacy') return []
  return registry.gateCatalog[p.tier].filter(id => {
    const g = p.releaseGates.find(x => x.id === id)
    return !(g && g.status === 'not_applicable' && g.notes && g.notes.trim().length >= 20)
  })
}

// Collectors needed for a set of gates, plus repo-structure for context, in a fixed order.
export function collectorsFor(policy, gates, only = null) {
  const names = new Set(['repo-structure'])
  for (const g of gates) for (const c of [...((policy.gates[g] || {}).collectors || []), ...((policy.gates[g] || {}).supporting || [])]) names.add(c)
  return COLLECTORS.filter(c => names.has(c.name) && (!only || only.includes(c.name)))
}

// The commit to evaluate: the registry's release candidate when one is recorded (owner-governed),
// otherwise the live head of the default branch, otherwise the registry snapshot head.
export function chooseTarget(p, live) {
  const c = p.release && p.release.candidate
  if (c) return { sha: c.headSha, source: `release candidate (PR #${c.pullRequest}, ${c.ref})`, liveSha: live.sha || null, drift: live.sha && live.sha !== c.headSha ? `live ${c.ref} is at ${live.sha.slice(0, 7)}; the registry candidate is ${c.headSha.slice(0, 7)} (an owner update)` : null }
  if (live.sha) return { sha: live.sha, source: `live head of ${p.repositorySnapshot.defaultBranch || 'the default branch'}`, liveSha: live.sha, drift: p.repositorySnapshot.headSha && p.repositorySnapshot.headSha !== live.sha ? `registry snapshot is ${String(p.repositorySnapshot.headSha).slice(0, 7)}; live head is ${live.sha.slice(0, 7)} (registry sync refreshes it)` : null }
  return { sha: p.repositorySnapshot.headSha || null, source: 'registry snapshot (live head unavailable)', liveSha: null, drift: null }
}

// Plans and runs collection for the selected projects. Returns new ledgers and a run log.
//   deps: { run, github, fetch, now, workRoot, execute, provenance, installTools }
export async function collect({ registry, policy, policyHash, profiles, ledgers, projectIds = null, onlyCollectors = null, deps, incremental = true }) {
  const now = deps.now()
  const asOf = new Date(now)
  const log = []
  const targets = new Map()
  const out = new Map(ledgers)
  for (const p of registry.projects.filter(p => p.tier !== 'legacy' && (!projectIds || projectIds.includes(p.id)))) {
    const entry = { project: p.id, access: 'ok', accessReason: null, target: null, collectors: [] }
    const profile = (profiles.projects || {})[p.id] || {}
    const ref = p.release && p.release.candidate ? p.release.candidate.ref : null
    let live = {}
    try { live = resolveRef(deps.run, p.repository, ref) } catch (e) {
      entry.access = e instanceof AccessError ? e.code : 'error'
      entry.accessReason = e instanceof AccessError ? e.message : 'unexpected error resolving the repository'
    }
    const target = chooseTarget(p, live)
    targets.set(p.id, target)
    entry.target = target
    const gates = applicableGates(registry, p)
    const planned = collectorsFor(policy, gates, onlyCollectors)
    const existing = out.get(p.id) || []

    // Checkout lazily, once, only if some collector actually needs to run.
    let view = null
    let checkedOut = false
    const ensureView = () => {
      if (checkedOut) return view
      checkedOut = true
      if (entry.access !== 'ok' || !target.sha) return null
      try {
        const dir = join(deps.workRoot, p.id)
        checkout(deps.run, p.repository, target.sha, dir)
        view = workspaceView(dir)
      } catch (e) {
        entry.access = e instanceof AccessError ? e.code : 'error'
        entry.accessReason = e instanceof AccessError ? e.message : 'checkout failed'
      }
      return view
    }
    let installed = null
    let tools = null
    const records = []
    for (const c of planned) {
      const key = cacheKey({ project: p.id, commitSha: target.sha, collector: c, policyHash, execute: deps.execute })
      const cached = incremental && existing.find(e => e.cacheKey === key && e.result !== 'unavailable' && !staleness(e, { commitSha: target.sha, asOf }))
      if (cached) { entry.collectors.push({ name: c.name, result: cached.result, evidenceId: cached.id, reused: true }); continue }
      // ci-results reads the GitHub API only; every other collector needs the checkout.
      if (c.name !== 'ci-results') ensureView()
      const ctx = {
        project: p, registry, repository: p.repository, commitSha: target.sha, profile, view, execute: deps.execute,
        accessReason: entry.accessReason, run: deps.run, github: deps.github, fetch: deps.fetch,
        install() {
          if (installed) return installed
          if (!view) return (installed = { ok: false, reason: 'no checkout' })
          if (profile.tools && profile.tools.length && deps.installTools) tools = deps.installTools(profile.tools)
          const cmd = profile.install || ['npm', 'ci', '--ignore-scripts']
          if (!view.exists('package-lock.json') && cmd[1] === 'ci') return (installed = { ok: false, reason: 'no package-lock.json' })
          const res = deps.run(cmd[0], cmd.slice(1), { cwd: view.dir, timeoutMs: 900_000 })
          return (installed = res.status === 0 ? { ok: true } : { ok: false, reason: `${cmd.join(' ')} exited ${res.status}${res.timedOut ? ' (timed out)' : ''}` })
        },
        tools: () => (tools ? tools.available : {}),
        toolEnv: () => (tools ? tools.env : {})
      }
      let outcome
      try { outcome = await c.collect(ctx) } catch (e) {
        outcome = { result: 'inconclusive', summary: `${c.name}: collector error`, failureReason: `collector threw ${e && e.name ? e.name : 'an error'}; nothing is inferred from it` }
      }
      const record = makeEvidence({ project: p.id, repository: p.repository, commitSha: target.sha, ref, collector: c, gates: c.gates, outcome, executedAt: deps.now(), provenance: deps.provenance, policy, policyHash, execute: deps.execute })
      records.push(record)
      entry.collectors.push({ name: c.name, result: record.result, evidenceId: record.id, reused: false })
    }
    out.set(p.id, pruneLedger(mergeLedger(existing, records), 6))
    log.push(entry)
  }
  return { ledgers: out, targets, log, collectedAt: iso(now) }
}

// Verification requests for every project, from the ledgers and the assessed state.
export function requestsFor({ registry, policy, ledgers, targets, asOf, assessment }) {
  const out = {}
  for (const a of assessment.projects) {
    const p = registry.projects.find(x => x.id === a.id)
    const verified = new Set(a.gates.filter(g => g.state === 'independently_verified' || g.state === 'not_applicable').map(g => g.id))
    out[a.id] = routeRequests({ project: p, policy, evidence: ledgers.get(a.id) || [], targetSha: (targets.get(a.id) || {}).sha, asOf, gateCatalog: applicableGates(registry, p), verifiedGates: verified })
  }
  return out
}
