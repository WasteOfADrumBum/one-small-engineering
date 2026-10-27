// Collector evidence records (Phase 4, docs/verification.md).
//
// A collector evidence record says what one automated collector observed for one project at one
// exact commit. It is never verification: it has no verifier, it is never a registry `pass`, and it
// counts toward readiness only after a separate verifier examines it and records their own
// verification (scripts/verify/verification.mjs).
//
// Every record carries a sha256 digest of its canonical content. A record whose digest does not
// match was edited after collection and is rejected as forged. The digest proves integrity, not
// authorship: who ran the collector is in `provenance`, and a run URL makes it reproducible.

import { createHash } from 'node:crypto'
import { redactSensitive } from '../validate-registry.mjs'

export const EVIDENCE_SCHEMA = 1
export const RESULTS = ['pass', 'fail', 'inconclusive', 'unavailable', 'not_applicable']
export const EXECUTORS = ['github-actions', 'local', 'fixture']
const SHA = /^[0-9a-f]{40}$/
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/
const SLUG = /^[a-z0-9][a-z0-9-]*$/
const DAY = 24 * 3600 * 1000

export class EvidenceError extends Error {}

export const iso = d => new Date(d).toISOString().replace(/\.\d{3}Z$/, 'Z')

// Stable JSON: keys sorted at every level, so the same content always hashes the same.
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`
  return JSON.stringify(value)
}

export const sha256 = text => createHash('sha256').update(String(text)).digest('hex')

export function digestOf(record) {
  const { digest, ...rest } = record
  return sha256(canonical(rest))
}

// The cache key: the same project, commit, collector version, rules and execution mode give the
// same key, so an unchanged input is not collected twice.
export function cacheKey({ project, commitSha, collector, policyHash, execute }) {
  return sha256(canonical({ project, commitSha, collector: `${collector.name}@${collector.version}`, policyHash, execute: Boolean(execute) })).slice(0, 16)
}

function redactDeep(value) {
  if (typeof value === 'string') return redactSensitive(value)
  if (Array.isArray(value)) return value.map(redactDeep)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactDeep(v)]))
  return value
}

// Builds a complete, redacted, digested record from a collector's outcome.
export function makeEvidence({ project, repository, commitSha, ref = null, collector, gates, outcome, executedAt, provenance, policy, policyHash, execute = false }) {
  const days = (policy.freshness.byCollector || {})[collector.name] || policy.freshness.defaultDays
  const key = cacheKey({ project, commitSha, collector, policyHash, execute })
  const result = outcome.result
  const record = redactDeep({
    schema: EVIDENCE_SCHEMA,
    id: `ev-${project}-${collector.name}-${(commitSha || 'none').slice(0, 7)}-${sha256(key + iso(executedAt)).slice(0, 8)}`,
    project,
    gates: [...gates].sort(),
    repository,
    commitSha,
    ref,
    collector: { name: collector.name, version: collector.version },
    policyHash,
    cacheKey: key,
    execute: Boolean(execute),
    executedAt: iso(executedAt),
    result,
    summary: outcome.summary,
    failureReason: result === 'pass' || result === 'not_applicable' ? null : (outcome.failureReason || outcome.summary),
    checks: (outcome.checks || []).map(c => ({ name: c.name, result: c.result, detail: c.detail || null })),
    artifacts: (outcome.artifacts || []).map(a => ({ name: a.name, sha256: a.sha256 || null, ref: a.ref || null })),
    reproduce: outcome.reproduce || null,
    ...(outcome.details ? { details: outcome.details } : {}),
    provenance: {
      collectorIdentity: policy.collectorIdentity,
      executor: provenance.executor,
      runUrl: provenance.runUrl || null,
      invokedBy: provenance.invokedBy || null,
      toolchain: provenance.toolchain || {}
    },
    freshness: { policy: `commit-bound; expires ${days} day(s) after collection`, expiresAt: iso(new Date(executedAt).getTime() + days * DAY) }
  })
  record.digest = digestOf(record)
  return record
}

// Problems with one record, or [] when it is well formed and untampered.
export function checkEvidence(e) {
  const errs = []
  const bad = m => errs.push(`${e && e.id ? e.id : 'evidence'}: ${m}`)
  if (!e || typeof e !== 'object' || Array.isArray(e)) return ['evidence: not an object']
  if (e.schema !== EVIDENCE_SCHEMA) bad(`unsupported schema ${JSON.stringify(e.schema)}`)
  if (typeof e.id !== 'string' || !/^ev-[a-z0-9-]+$/.test(e.id)) bad('id must start with ev-')
  if (!SLUG.test(e.project || '')) bad('project is missing')
  if (!Array.isArray(e.gates) || e.gates.some(g => !SLUG.test(g))) bad('gates must be a list of gate ids')
  if (typeof e.repository !== 'string' || !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(e.repository)) bad('repository must be a GitHub repository URL')
  if (e.result !== 'unavailable' && !SHA.test(e.commitSha || '')) bad('commitSha must be a full 40-character SHA (only unavailable evidence may lack one)')
  if (e.commitSha !== null && e.commitSha !== undefined && !SHA.test(e.commitSha)) bad('commitSha is malformed')
  if (!e.collector || !SLUG.test(e.collector.name || '') || typeof e.collector.version !== 'string') bad('collector name and version are required')
  if (!TIME.test(e.executedAt || '')) bad('executedAt must be a UTC time')
  if (!RESULTS.includes(e.result)) bad(`result must be one of ${RESULTS.join(', ')}`)
  if (e.result !== 'pass' && e.result !== 'not_applicable' && !(typeof e.failureReason === 'string' && e.failureReason.trim())) bad('a non-passing result needs a failureReason')
  if (!e.provenance || !EXECUTORS.includes(e.provenance.executor) || !e.provenance.collectorIdentity) bad('provenance needs collectorIdentity and executor')
  if (!e.freshness || !TIME.test(e.freshness.expiresAt || '')) bad('freshness.expiresAt is required')
  else if (TIME.test(e.executedAt || '') && e.freshness.expiresAt <= e.executedAt) bad('expiresAt must be after executedAt')
  if (typeof e.digest !== 'string' || e.digest !== digestOf(e)) bad('digest does not match the content (edited after collection or forged)')
  return errs
}

// Why a record cannot be used for `commitSha` at `asOf`, or null when it is current.
export function staleness(e, { commitSha, asOf }) {
  if (e.result === 'unavailable') return null
  if (commitSha && e.commitSha !== commitSha) return `collected for ${String(e.commitSha).slice(0, 7)}, not the evaluated commit ${commitSha.slice(0, 7)}`
  const t = asOf.getTime()
  if (new Date(e.executedAt).getTime() > t) return 'dated after the evaluation time'
  if (new Date(e.freshness.expiresAt).getTime() <= t) return `expired ${e.freshness.expiresAt.slice(0, 10)}`
  return null
}

// A ledger is one project's list of evidence records. Duplicates (same id) and forged or malformed
// records are rejected with a reason; they are never silently merged.
export function loadLedger(value, project) {
  const problems = []
  if (!value || typeof value !== 'object' || !Array.isArray(value.evidence)) return { evidence: [], problems: [`${project}: ledger must be an object with an evidence list`] }
  if (value.project !== project) problems.push(`${project}: ledger is for ${JSON.stringify(value.project)}`)
  const seen = new Set()
  const evidence = []
  for (const e of value.evidence) {
    const errs = checkEvidence(e)
    if (!errs.length && e.project !== project) errs.push(`${e.id}: belongs to ${e.project}, not ${project}`)
    if (!errs.length && seen.has(e.id)) errs.push(`${e.id}: duplicate record`)
    if (errs.length) { problems.push(...errs); continue }
    seen.add(e.id)
    evidence.push(e)
  }
  return { evidence, problems }
}

// Adds records to a ledger: a record with an id already present replaces nothing (idempotent);
// newest first by executedAt, then id, so the file is deterministic.
export function mergeLedger(existing, records) {
  const byId = new Map(existing.map(e => [e.id, e]))
  for (const r of records) if (!byId.has(r.id)) byId.set(r.id, r)
  return [...byId.values()].sort((a, b) => (b.executedAt.localeCompare(a.executedAt)) || a.id.localeCompare(b.id))
}

// Older records for the same commit and collector are kept for history; this keeps at most
// `keep` per collector so a ledger cannot grow without bound.
export function pruneLedger(records, keep = 3) {
  const count = new Map()
  return records.filter(r => {
    const k = `${r.collector.name}`
    const n = (count.get(k) || 0) + 1
    count.set(k, n)
    return n <= keep
  })
}
