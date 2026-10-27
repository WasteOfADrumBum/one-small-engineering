// Cross-project monitoring (Phase 5, docs/engineering.md).
//
// Read-only observation of every active project: the live revision (git ls-remote, no API
// needed), which collectors are missing or stale for that revision (so only those run), what a
// registry sync would change (the Phase 2 collector and planner, dry run), and the status of
// known remediation PRs. Every GitHub API call goes through a client that refuses anything but
// GET, so monitoring cannot write even if a write-capable token were present.

import { resolveRef, AccessError } from '../verify/workspace.mjs'
import { applicableGates, collectorsFor } from '../verify/orchestrator.mjs'
import { staleness } from '../verify/evidence.mjs'
import { collectAll } from '../sync/run.mjs'
import { plan as syncPlan } from '../sync/plan.mjs'
import { describeAccess } from '../sync/github.mjs'
import { repoParts } from '../verify/workspace.mjs'
import { observeRevision } from './state.mjs'

export class ReadOnlyViolation extends Error {}

// Wraps a GitHub client so only GET requests can be sent.
export function readOnlyClient(client) {
  if (!client) return null
  const guard = method => { if (method !== 'GET') throw new ReadOnlyViolation(`refused ${method}: monitoring is read-only`) }
  return {
    async request(method, path, opts) { guard(method); return client.request(method, path, opts) },
    get(path, opts) { return client.request('GET', path, opts) },
    paginate(path, opts) { return client.paginate(path, opts) }
  }
}

// Live revision of the branch each project is evaluated on (candidate ref, else default branch).
export function observeRevisions({ registry, state, run, at, only = null }) {
  const changed = new Map()
  const access = new Map()
  for (const p of registry.projects.filter(p => p.tier !== 'legacy' && (!only || only.includes(p.id)))) {
    const ref = p.release.candidate ? p.release.candidate.ref : null
    try {
      const { sha } = resolveRef(run, p.repository, ref)
      const r = observeRevision(state, p.id, { revision: sha, ref, at })
      access.set(p.id, { access: 'ok', reason: null })
      if (r.changed) changed.set(p.id, { from: r.previous, to: sha })
    } catch (e) {
      const code = e instanceof AccessError ? e.code : 'error'
      const reason = e instanceof AccessError ? e.message : 'could not resolve the repository'
      observeRevision(state, p.id, { revision: null, ref, access: code, accessReason: reason, at })
      access.set(p.id, { access: code, reason })
    }
  }
  return { changed, access }
}

// Collectors that need to run for each project: no current record for the evaluated revision.
// A record collected with project execution also satisfies a run without it (never the reverse),
// and the latest unavailable result is always retried.
export function refreshPlan({ registry, policy, policyHash = null, ledgers, revisions, asOf, execute = false, only = null, full = false }) {
  const plan = new Map()
  for (const p of registry.projects.filter(p => p.tier !== 'legacy' && (!only || only.includes(p.id)))) {
    const sha = p.release.candidate ? p.release.candidate.headSha : revisions.get(p.id) || p.repositorySnapshot.headSha
    const collectors = collectorsFor(policy, applicableGates(registry, p))
    const version = new Map(collectors.map(c => [c.name, c.version]))
    const names = collectors.map(c => c.name)
    const evidence = ledgers.get(p.id) || []
    const need = names.filter(n => {
      if (full) return true
      const recs = evidence.filter(e => e.collector.name === n).sort((a, b) => b.executedAt.localeCompare(a.executedAt))
      if (!recs.length || recs[0].result === 'unavailable') return true
      // Current = same revision, inside its freshness window, same collector version and policy.
      return !recs.some(e => e.commitSha === sha && !staleness(e, { commitSha: sha, asOf }) && (e.execute || !execute) && e.collector.version === version.get(n) && (!policyHash || e.policyHash === policyHash))
    })
    if (need.length) plan.set(p.id, need)
  }
  return plan
}

// What a registry sync would change for each project (dry run; nothing is written).
export async function syncDrift({ registry, clients, now }) {
  const out = {}
  let collected
  try { collected = await collectAll({ registry, only: null, clients, now }) } catch (e) {
    for (const p of registry.projects.filter(p => p.sync && p.sync.enabled)) out[p.id] = { status: 'unavailable', reason: 'sync collection failed', changes: [] }
    return out
  }
  for (const c of collected) {
    if (!c.ok) { out[c.projectId] = { status: 'unavailable', reason: `${c.error.code}: ${c.error.message}`, changes: [] }; continue }
    try {
      const pl = syncPlan(registry, c.observation)
      out[c.projectId] = { status: pl.changed ? 'drift' : 'in-sync', reason: null, changes: pl.changes.slice(0, 10) }
    } catch (e) { out[c.projectId] = { status: 'unavailable', reason: 'sync plan failed', changes: [] } }
  }
  return out
}

// Status of each known remediation PR: open/draft/merged/closed, and whether anyone reviewed it.
export async function pullRequestStatus({ client, prs, now }) {
  const out = []
  for (const pr of prs) {
    const m = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)$/.exec(pr.url || '')
    if (!m) { out.push({ ...pr, status: 'unknown', reason: 'not a pull request URL' }); continue }
    if (!client) { out.push({ ...pr, status: pr.status || 'unknown', reason: 'GitHub API not reachable from this run; status from the last run that could read it' }); continue }
    try {
      repoParts(`https://github.com/${m[1]}/${m[2]}`)
      const data = await client.get(`/repos/${m[1]}/${m[2]}/pulls/${m[3]}`)
      const reviews = await client.get(`/repos/${m[1]}/${m[2]}/pulls/${m[3]}/reviews?per_page=100`)
      const status = data.merged_at ? 'merged' : data.state === 'closed' ? 'closed' : data.draft ? 'draft' : 'open'
      out.push({ ...pr, status, headSha: data.head && data.head.sha ? data.head.sha : null, reviewed: Array.isArray(reviews) && reviews.length > 0, observedAt: now, reason: null })
    } catch (e) {
      const a = describeAccess(e, 'pull request')
      out.push({ ...pr, status: pr.status || 'unknown', reason: a ? a.message : 'could not read the pull request' })
    }
  }
  return out
}
