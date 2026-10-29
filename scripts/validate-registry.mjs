#!/usr/bin/env node
// Validates projects/registry.json against projects/registry.schema.json and the
// cross-record governance rules in README.md. No dependencies: Node 20+ only.
//
// Usage: node scripts/validate-registry.mjs [registry.json] [registry.schema.json]
// Exit codes: 0 valid, 1 invalid, 2 unreadable input or unsupported schema.

import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_REGISTRY = resolve(ROOT, 'projects/registry.json')
const DEFAULT_SCHEMA = resolve(ROOT, 'projects/registry.schema.json')
const DEFAULT_DOD = resolve(ROOT, 'standards/definition-of-done.md')
// AI tool families come from the owner-controlled verification policy, so the registry rules and
// the verifier (scripts/verify/verification.mjs) agree on who counts as the same party.
const TOOL_FAMILIES = JSON.parse(readFileSync(resolve(ROOT, 'verification/policy.json'), 'utf8')).toolFamilies

const familyOf = n => {
  for (const [family, names] of Object.entries(TOOL_FAMILIES)) {
    if (!family.startsWith('$') && names.some(x => n.includes(x.toLowerCase()))) return family
  }
  return null
}

// Same party for independence: the same name, or the same AI tool family ("Claude Code (Phase 0
// baseline)" is the builder "Claude Code"; a second Claude session is not independent of the first).
export function sameParty(a, b) {
  const x = String(a || '').trim().toLowerCase()
  const y = String(b || '').trim().toLowerCase()
  if (!x || !y) return false
  if (x === y) return true
  const f = familyOf(x)
  return Boolean(f && f === familyOf(y))
}

// ---------------------------------------------------------------------------
// Minimal JSON Schema (2020-12 subset) evaluator. Only the keywords below are
// allowed in the schema; anything else is a SchemaError so the schema can never
// silently rely on a rule this validator does not enforce.
// ---------------------------------------------------------------------------

const ANNOTATIONS = new Set(['$schema', '$id', 'title', 'description', '$comment', '$defs'])
const KEYWORDS = new Set(['$ref', 'type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const', 'pattern', 'format', 'minLength', 'maxLength', 'minItems', 'maxItems', 'minimum', 'uniqueItems'])

export class SchemaError extends Error {}

const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?Z$/

export function isUtcTimestamp(value) {
  const m = DATE_TIME.exec(value)
  if (!m) return false
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return false
  // Reject values the Date parser rolls over, such as 2026-02-30.
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() + 1 === +m[2] && d.getUTCDate() === +m[3] && d.getUTCHours() === +m[4] && d.getUTCMinutes() === +m[5] && d.getUTCSeconds() === +m[6]
}

function isUri(value) {
  try {
    const u = new URL(value)
    return Boolean(u.protocol && u.host)
  } catch {
    return false
  }
}

function typeOf(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (Number.isInteger(value)) return 'integer'
  return typeof value
}

function matchesType(value, type) {
  const actual = typeOf(value)
  if (type === 'number') return actual === 'number' || actual === 'integer'
  return actual === type
}

function resolveRef(ref, root) {
  const m = /^#\/\$defs\/([A-Za-z0-9_]+)$/.exec(ref)
  if (!m || !root.$defs || !root.$defs[m[1]]) throw new SchemaError(`unsupported or unknown $ref ${ref}`)
  return root.$defs[m[1]]
}

export function validateAgainstSchema(value, schema, root = schema, path = '$', errors = []) {
  for (const key of Object.keys(schema)) {
    if (!ANNOTATIONS.has(key) && !KEYWORDS.has(key)) throw new SchemaError(`unsupported schema keyword "${key}" at ${path}`)
  }
  if (schema.$ref) validateAgainstSchema(value, resolveRef(schema.$ref, root), root, path, errors)

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type]
    if (!types.some(t => matchesType(value, t))) {
      errors.push(`${path}: expected ${types.join(' or ')}, got ${typeOf(value)}`)
      return errors
    }
  }
  if (schema.const !== undefined && value !== schema.const) errors.push(`${path}: must equal ${JSON.stringify(schema.const)}`)
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: ${JSON.stringify(value)} is not one of ${schema.enum.join(', ')}`)

  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: must be at least ${schema.minimum}`)

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.trim().length < schema.minLength) errors.push(`${path}: must not be empty`)
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path}: longer than ${schema.maxLength} characters`)
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${path}: ${JSON.stringify(value)} does not match ${schema.pattern}`)
    if (schema.format === 'date-time' && !isUtcTimestamp(value)) errors.push(`${path}: ${JSON.stringify(value)} is not an ISO 8601 UTC timestamp (YYYY-MM-DDTHH:MM:SSZ)`)
    if (schema.format === 'uri' && !isUri(value)) errors.push(`${path}: ${JSON.stringify(value)} is not a valid URL`)
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path}: needs at least ${schema.minItems} item(s)`)
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path}: has more than ${schema.maxItems} item(s)`)
    if (schema.uniqueItems) {
      const seen = new Set()
      for (const item of value) {
        const k = JSON.stringify(item)
        if (seen.has(k)) errors.push(`${path}: duplicate item ${k}`)
        seen.add(k)
      }
    }
    if (schema.items) value.forEach((item, i) => validateAgainstSchema(item, schema.items, root, `${path}[${i}]`, errors))
  }

  if (typeOf(value) === 'object') {
    for (const key of schema.required || []) {
      if (!Object.hasOwn(value, key)) errors.push(`${path}: missing required property "${key}"`)
    }
    const props = schema.properties || {}
    for (const [key, child] of Object.entries(value)) {
      if (Object.hasOwn(props, key)) validateAgainstSchema(child, props[key], root, `${path}.${key}`, errors)
      else if (schema.additionalProperties === false) errors.push(`${path}: unknown property "${key}"`)
    }
  }
  return errors
}

// ---------------------------------------------------------------------------
// Sensitive data scan
// ---------------------------------------------------------------------------

const SECRET_PATTERNS = [
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{30,}/],
  ['GitHub fine-grained token', /\bgithub_pat_[A-Za-z0-9_]{20,}/],
  ['npm token', /\bnpm_[A-Za-z0-9]{30,}/],
  ['AWS access key ID', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['OpenAI/Anthropic-style API key', /\bsk-[A-Za-z0-9_-]{20,}/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['JSON Web Token', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['credential assignment', /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token)\s*[:=]\s*["']?[^\s"']{6,}/i],
  ['credentials in URL', /https?:\/\/[^/\s:@]+:[^/\s@]+@/],
  ['email address', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/]
]

function luhn(digits) {
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    let d = +digits[digits.length - 1 - i]
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9 }
    sum += d
  }
  return sum % 10 === 0
}

export function findSensitive(text) {
  const found = []
  for (const [name, re] of SECRET_PATTERNS) if (re.test(text)) found.push(name)
  // Payment card numbers: 13-19 digits, optionally grouped by spaces or dashes, Luhn-valid.
  for (const m of text.matchAll(/\b\d(?:[ -]?\d){12,18}\b/g)) {
    if (luhn(m[0].replace(/[ -]/g, ''))) { found.push('payment card number'); break }
  }
  // Bank-style account numbers: long digit runs in prose. URLs are exempt (workflow run IDs).
  if (!/^https:\/\//.test(text) && /(?<![0-9a-f])\d{8,}(?![0-9a-f])/i.test(text)) found.push('possible account number (8+ digit run)')
  return [...new Set(found)]
}

// Replaces anything findSensitive would flag with a marker, for text that leaves the process
// (logs, annotations, issue and PR bodies). Long digit runs are kept: they are repository and
// run IDs in diagnostics, not secrets.
export function redactSensitive(text) {
  let s = String(text ?? '')
  // Whole assignments and URL credentials first, so the marker covers the key name too.
  const ordered = [...SECRET_PATTERNS].sort(([a], [b]) => Number(b.startsWith('credential')) - Number(a.startsWith('credential')))
  for (const [name, re] of ordered) s = s.replace(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'), `[redacted ${name}]`)
  s = s.replace(/\b\d(?:[ -]?\d){12,18}\b/g, m => (luhn(m.replace(/[ -]/g, '')) ? '[redacted payment card number]' : m))
  return s
}

function walkStrings(value, path, visit) {
  if (typeof value === 'string') visit(value, path)
  else if (Array.isArray(value)) value.forEach((v, i) => walkStrings(v, `${path}[${i}]`, visit))
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) { visit(k, `${path} (key)`); walkStrings(v, `${path}.${k}`, visit) }
}

// ---------------------------------------------------------------------------
// Definition of Done: the authoritative gate list for each tier
// ---------------------------------------------------------------------------

// Reads the numbered gate tables under "## Tier 1/2/3" in standards/definition-of-done.md.
// Library and application tiers include every Tier 1 gate plus their own.
export function parseDefinitionOfDone(text) {
  const section = n => {
    const start = text.indexOf(`## Tier ${n}`)
    if (start === -1) throw new SchemaError(`definition-of-done.md has no "## Tier ${n}" section`)
    const next = text.indexOf('\n## ', start + 1)
    return text.slice(start, next === -1 ? undefined : next)
  }
  const ids = n => [...section(n).matchAll(/^\|\s*\d+\s*\|\s*`([a-z0-9-]+)`\s*\|/gm)].map(m => m[1])
  const base = ids(1)
  return { showcase: base, library: [...base, ...ids(2)], application: [...base, ...ids(3)] }
}

function compareSets(expected, actual, path, label, err) {
  for (const id of expected) if (!actual.includes(id)) err(path, `missing gate "${id}" required by ${label}`)
  for (const id of actual) if (!expected.includes(id)) err(path, `gate "${id}" is not defined by ${label}`)
}

// ---------------------------------------------------------------------------
// Governance rules that JSON Schema cannot express
// ---------------------------------------------------------------------------

const FINAL_STATUSES = new Set(['verified', 'released'])
const SATISFIED_GATES = new Set(['verified', 'not_applicable'])
// Evidence types that can never prove a gate on their own: they describe a repository, they do not test it.
const NON_PROVING_TYPES = new Set(['repository_metadata'])
// A not_applicable rationale must be a sentence, not "n/a".
const MIN_RATIONALE = 20
const norm = name => (name || '').trim().toLowerCase()
// Automated records describe facts or relay claims. They can never be pass or fail, so they can never verify a gate.
export const SYNC_RECORDER = 'One Small Engineering Sync'
const AUTOMATED_ORIGINS = new Set(['sync', 'builder-report'])
const ALLOWED_RESULTS = {
  sync: new Set(['informational', 'builder_reported']),
  'builder-report': new Set(['informational', 'builder_reported']),
  'ai-assessment': new Set(['informational', 'builder_reported', 'inconclusive'])
}

export function checkRules(registry, { now = new Date(), dod = parseDefinitionOfDone(readFileSync(DEFAULT_DOD, 'utf8')) } = {}) {
  const errors = []
  const err = (path, msg) => errors.push(`${path}: ${msg}`)
  const owner = registry.approvalOwner

  const updated = new Date(registry.lastUpdatedAt)
  if (updated.getTime() > now.getTime() + 24 * 3600 * 1000) err('$.lastUpdatedAt', 'is in the future')

  // The gate catalog must equal the Definition of Done for every tier, in both directions,
  // so a required gate cannot disappear from the catalog and every project at once.
  for (const tier of ['showcase', 'library', 'application']) {
    compareSets(dod[tier], registry.gateCatalog[tier], `$.gateCatalog.${tier}`, `the ${tier} tier in standards/definition-of-done.md`, err)
  }
  // Library and application tiers build on the showcase gates.
  for (const tier of ['library', 'application']) {
    for (const g of registry.gateCatalog.showcase) {
      if (!registry.gateCatalog[tier].includes(g)) err(`$.gateCatalog.${tier}`, `missing shared gate "${g}" from the showcase tier`)
    }
  }

  const projectIds = new Map()
  const repoUrls = new Map()
  const evidenceIds = new Map()
  const noteRepo = (url, path) => {
    const k = url.toLowerCase().replace(/\/+$/, '')
    if (repoUrls.has(k)) err(path, `repository ${url} is already listed at ${repoUrls.get(k)}`)
    else repoUrls.set(k, path)
  }

  registry.projects.forEach((p, i) => {
    const at = `$.projects[${i}] (${p.id})`
    if (projectIds.has(p.id)) err(at, `duplicate project id "${p.id}" (also at ${projectIds.get(p.id)})`)
    projectIds.set(p.id, at)
    noteRepo(p.repository, at)

    // Evidence: IDs unique across the whole registry; every timestamp not after lastUpdatedAt.
    const evidence = new Map()
    const eventKeys = new Map()
    p.evidence.forEach((e, j) => {
      if (evidenceIds.has(e.id)) err(`${at}.evidence[${j}]`, `duplicate evidence id "${e.id}" (also at ${evidenceIds.get(e.id)})`)
      evidenceIds.set(e.id, `${at}.evidence[${j}]`)
      evidence.set(e.id, e)
      if (new Date(e.verifiedAt) > updated) err(`${at}.evidence[${j}]`, 'verifiedAt is later than registry lastUpdatedAt')
      checkEvidenceOrigin(p, e, `${at}.evidence[${j}] (${e.id})`, eventKeys, err)
    })
    const resolveRefs = (refs, path) => refs.map(r => {
      const e = evidence.get(r)
      if (!e) err(path, `evidence reference "${r}" does not match any evidence id in this project`)
      return e
    }).filter(Boolean)
    if (p.lastVerifiedAt && new Date(p.lastVerifiedAt) > updated) err(at, 'lastVerifiedAt is later than registry lastUpdatedAt')

    // Gates: exactly the tier's catalog.
    const gateIds = p.releaseGates.map(g => g.id)
    const seenGates = new Set()
    for (const id of gateIds) {
      if (seenGates.has(id)) err(`${at}.releaseGates`, `gate "${id}" listed twice`)
      seenGates.add(id)
    }
    if (p.tier === 'legacy') {
      if (!['archived', 'maintenance'].includes(p.lifecycle)) err(at, 'a legacy-tier project must have lifecycle archived or maintenance')
    } else {
      const required = registry.gateCatalog[p.tier]
      for (const id of required) if (!seenGates.has(id)) err(`${at}.releaseGates`, `missing required ${p.tier} gate "${id}"`)
      for (const id of seenGates) if (!required.includes(id)) err(`${at}.releaseGates`, `gate "${id}" is not part of the ${p.tier} tier`)
    }

    const openBlockers = p.release.blockers.filter(b => b.status === 'open')
    const blockerIds = new Set()
    p.release.blockers.forEach((b, j) => {
      const bp = `${at}.release.blockers[${j}]`
      if (blockerIds.has(b.id)) err(bp, `duplicate blocker id "${b.id}"`)
      blockerIds.add(b.id)
      const refs = resolveRefs(b.evidenceRefs, bp)
      for (const g of b.gates || []) if (!seenGates.has(g)) err(bp, `gate "${g}" is not one of this project's gates`)
      if (b.severity && b.category !== 'security') err(bp, 'severity applies only to category security (standards/security.md)')
      if (b.status === 'resolved') {
        // A resolution needs its own proof: metadata, failures and builder claims do not show a blocker is gone.
        if (!refs.some(e => !NON_PROVING_TYPES.has(e.type) && ['pass', 'informational'].includes(e.result))) {
          err(bp, 'a resolved blocker needs evidence of the resolution (a pass or informational record that is not repository metadata)')
        }
        if (b.id === 'scope-document-missing' && !p.release.scopeDocument) err(bp, 'scope-document-missing cannot be resolved while release.scopeDocument is null')
      }
    })

    p.releaseGates.forEach((g, j) => {
      const gp = `${at}.releaseGates[${j}] (${g.id})`
      const refs = resolveRefs(g.evidenceRefs, gp)
      if (g.status === 'verified') {
        if (!g.verifiedAt) err(gp, 'a verified gate needs verifiedAt')
        if (g.evidenceRefs.length === 0) err(gp, 'a verified gate needs at least one evidence reference')
        else if (!refs.some(e => e.result === 'pass' && !NON_PROVING_TYPES.has(e.type))) err(gp, 'a verified gate needs evidence with result "pass" (repository metadata and builder-reported results do not count)')
        // Independent verification: separate, named builder and verifier, and proof not recorded by the builder.
        const builder = norm(p.ownership.builder)
        const verifier = norm(p.ownership.verifier)
        if (!builder || !verifier) err(gp, 'a verified gate needs both ownership.builder and ownership.verifier assigned')
        else if (sameParty(builder, verifier)) err(gp, 'a verified gate needs a verifier different from the builder')
        else if (!refs.some(e => e.result === 'pass' && !NON_PROVING_TYPES.has(e.type) && !sameParty(e.recordedBy, builder))) err(gp, 'a verified gate needs "pass" evidence recorded by someone other than the builder (builder results stay builder_reported until independently re-checked)')
        if (g.verifiedAt && new Date(g.verifiedAt) > updated) err(gp, 'verifiedAt is later than registry lastUpdatedAt')
        if (g.id === 'no-release-blockers' && openBlockers.length) err(gp, `cannot be verified while ${openBlockers.length} blocker(s) are open`)
      } else if (g.verifiedAt !== null) {
        err(gp, `verifiedAt must be null unless the gate is verified (status is ${g.status})`)
      }
      if (g.status === 'not_applicable' && !(g.notes && g.notes.trim().length >= MIN_RATIONALE)) err(gp, `not_applicable needs an explicit rationale in notes (at least ${MIN_RATIONALE} characters saying why the gate does not apply)`)
      if (g.status === 'blocked' && !(g.notes && g.notes.trim()) && g.evidenceRefs.length === 0) err(gp, 'a blocked gate needs notes or evidence explaining the block')
    })

    // Release status rules. releaseStatus always describes targetVersion.
    const r = p.release
    const own = p.ownership
    if (FINAL_STATUSES.has(r.releaseStatus) || r.releaseStatus === 'ready_for_review') {
      if (!r.targetVersion) err(`${at}.release`, `releaseStatus ${r.releaseStatus} needs a targetVersion`)
      if (!r.scopeDocument) err(`${at}.release`, `releaseStatus ${r.releaseStatus} needs an approved scopeDocument`)
    }
    if (FINAL_STATUSES.has(r.releaseStatus)) {
      const unmet = p.releaseGates.filter(g => !SATISFIED_GATES.has(g.status)).map(g => g.id)
      if (unmet.length) err(`${at}.release`, `releaseStatus ${r.releaseStatus} but gates are not satisfied: ${unmet.join(', ')}`)
      if (openBlockers.length) err(`${at}.release`, `releaseStatus ${r.releaseStatus} with open blockers: ${openBlockers.map(b => b.id).join(', ')}`)
      if (!own.builder || !own.verifier) err(`${at}.ownership`, `releaseStatus ${r.releaseStatus} needs both a builder and an independent verifier`)
      if (!p.lastVerifiedAt) err(at, `releaseStatus ${r.releaseStatus} needs lastVerifiedAt`)
    }
    for (const role of ['builder', 'verifier']) {
      if (norm(own[role]) === norm(SYNC_RECORDER)) err(`${at}.ownership`, `${role} cannot be the automated recorder "${SYNC_RECORDER}"`)
    }
    if (p.sync && p.sync.lastSyncedAt && new Date(p.sync.lastSyncedAt) > updated) err(`${at}.sync`, 'lastSyncedAt is later than registry lastUpdatedAt')
    // A public repository can always be read, so its identity must be pinned before it syncs.
    if (p.sync && p.sync.repositoryId === null && p.visibility === 'public') err(`${at}.sync`, 'a public repository must have its repositoryId pinned (npm run onboard)')
    if (own.builder && own.verifier && sameParty(own.builder, own.verifier)) {
      err(`${at}.ownership`, 'builder and verifier must be different parties (not the same AI tool family) for independent acceptance')
    }
    if (r.releaseStatus === 'released') {
      if (p.approval.status !== 'approved') err(`${at}.approval`, 'releaseStatus released needs human approval (approval.status approved)')
      if (r.currentVersion !== r.targetVersion) err(`${at}.release`, 'releaseStatus released but currentVersion does not equal targetVersion')
    }
    if (p.lifecycle === 'maintenance' && !r.currentVersion) err(at, 'a project in maintenance needs a released currentVersion')
    if (r.candidate) {
      if (new Date(r.candidate.observedAt) > updated) err(`${at}.release.candidate`, 'observedAt is later than registry lastUpdatedAt')
      if (!r.targetVersion) err(`${at}.release.candidate`, 'a release candidate needs a targetVersion')
    }

    // Declared dependencies: checked here per project; references and cycles after the loop.
    const depIds = new Set()
    ;(p.dependencies || []).forEach((d, j) => {
      const dp = `${at}.dependencies[${j}]`
      if (depIds.has(d.project)) err(dp, `dependency on "${d.project}" declared twice`)
      depIds.add(d.project)
      if (d.project === p.id) err(dp, 'a project cannot depend on itself')
      resolveRefs(d.evidenceRefs, dp)
      if (d.evidenceRefs.length === 0) err(dp, 'a dependency needs evidence for the relationship (it is never inferred from names)')
    })

    // Human approval.
    const a = p.approval
    const ap = `${at}.approval`
    if (a.status === 'pending') {
      if (a.approvedBy !== null || a.approvedAt !== null) err(ap, 'pending approval must have approvedBy and approvedAt null')
    } else {
      if (a.approvedBy !== owner) err(ap, `only the human approval owner (${owner}) can approve or reject; got ${JSON.stringify(a.approvedBy)}`)
      if (!a.approvedAt) err(ap, `${a.status} needs approvedAt`)
      else if (new Date(a.approvedAt) > updated) err(ap, 'approvedAt is later than registry lastUpdatedAt')
      if (a.evidenceRefs.length === 0) err(ap, `${a.status} needs explicit evidence (for example the owner's PR approval)`)
      resolveRefs(a.evidenceRefs, ap)
      if (a.status === 'approved' && !FINAL_STATUSES.has(r.releaseStatus)) err(ap, `approval recorded while releaseStatus is ${r.releaseStatus}; verify the release first`)
    }

    // ModsPack integration.
    const m = p.modsPack
    const mp = `${at}.modsPack`
    resolveRefs(m.evidenceRefs, mp)
    if (['installed', 'verified'].includes(m.integrationStatus)) {
      if (!m.installedVersion) err(mp, `integrationStatus ${m.integrationStatus} needs installedVersion`)
      if (m.adapters.length === 0) err(mp, `integrationStatus ${m.integrationStatus} needs at least one adapter`)
      if (m.evidenceRefs.length === 0) err(mp, `integrationStatus ${m.integrationStatus} needs evidence`)
    }
    if (m.integrationStatus === 'verified') {
      const refs = m.evidenceRefs.map(id => evidence.get(id)).filter(Boolean)
      if (!refs.some(e => e.result === 'pass' && !NON_PROVING_TYPES.has(e.type))) err(mp, 'verified integration needs evidence with result "pass"')
    }
    if (['not_installed', 'not_applicable'].includes(m.integrationStatus) && (m.installedVersion || m.adapters.length)) {
      err(mp, `integrationStatus ${m.integrationStatus} cannot list an installedVersion or adapters`)
    }

    const prNumbers = new Set()
    p.openPullRequests.forEach((pr, j) => {
      if (prNumbers.has(pr.number)) err(`${at}.openPullRequests[${j}]`, `duplicate PR #${pr.number}`)
      prNumbers.add(pr.number)
      if (!pr.url.toLowerCase().startsWith(p.repository.toLowerCase() + '/pull/')) err(`${at}.openPullRequests[${j}]`, 'PR URL is not in this project\'s repository')
    })
  })

  registry.projects.forEach((p, i) => (p.dependencies || []).forEach((d, j) => {
    if (d.project !== p.id && !projectIds.has(d.project)) err(`$.projects[${i}] (${p.id}).dependencies[${j}]`, `"${d.project}" is not a project in this registry`)
  }))
  // A cycle of release-required dependencies could never ship. Other cycles are reported by the readiness engine.
  for (const cycle of dependencyCycles(registry.projects, d => d.requiredForRelease)) err('$.projects', `release-required dependency cycle: ${cycle.join(' -> ')}`)

  registry.legacyRepositories.forEach((r, i) => noteRepo(r.repository, `$.legacyRepositories[${i}] (${r.name})`))
  registry.otherRepositories.forEach((r, i) => noteRepo(r.repository, `$.otherRepositories[${i}] (${r.name})`))

  walkStrings(registry, '$', (text, path) => {
    for (const kind of findSensitive(text)) err(path, `possible sensitive data (${kind}); the registry must not hold credentials or personal financial data`)
  })

  return errors
}

// Every distinct cycle in the declared dependency graph, each listed once from its smallest id
// and closed (a -> b -> a). Unknown ids are ignored here; they are reported on their own.
export function dependencyCycles(projects, include = () => true) {
  const edges = new Map(projects.map(p => [p.id, [...new Set((p.dependencies || []).filter(include).map(d => d.project))].sort()]))
  const found = new Map()
  const walk = (start, node, path) => {
    for (const next of edges.get(node) || []) {
      if (next === start) {
        const min = path.reduce((a, b) => (b < a ? b : a))
        const i = path.indexOf(min)
        const cycle = [...path.slice(i), ...path.slice(0, i), min]
        found.set(cycle.join('>'), cycle)
      } else if (!path.includes(next) && edges.has(next) && next > start) {
        walk(start, next, [...path, next])
      }
    }
  }
  for (const id of [...edges.keys()].sort()) walk(id, id, [id])
  return [...found.values()].sort((a, b) => a.join('>').localeCompare(b.join('>')))
}

// Rules 10 to 13: automated and AI records stay separate from independent verification.
function checkEvidenceOrigin(p, e, path, eventKeys, err) {
  const origin = e.origin || 'manual'
  const automated = AUTOMATED_ORIGINS.has(origin)
  if (ALLOWED_RESULTS[origin] && !ALLOWED_RESULTS[origin].has(e.result)) {
    err(path, `origin ${origin} can only record ${[...ALLOWED_RESULTS[origin]].join(' or ')}, not ${e.result}; independent verification is always a separate manual record`)
  }
  if (e.eventKey) {
    if (!e.eventKey.startsWith(`${p.id}:`)) err(path, `eventKey must start with "${p.id}:"`)
    if (eventKeys.has(e.eventKey)) err(path, `duplicate eventKey "${e.eventKey}" (also ${eventKeys.get(e.eventKey)})`)
    eventKeys.set(e.eventKey, path)
  } else if (automated) {
    err(path, `origin ${origin} needs an eventKey`)
  }
  if (origin === 'sync') {
    if (e.recordedBy !== SYNC_RECORDER) err(path, `origin sync must be recordedBy "${SYNC_RECORDER}"`)
    if (!e.id.startsWith('sync-')) err(path, 'origin sync evidence ids start with "sync-"')
  } else {
    if (norm(e.recordedBy) === norm(SYNC_RECORDER)) err(path, `only origin sync records may use the recorder name "${SYNC_RECORDER}"`)
    if (e.id.startsWith('sync-')) err(path, 'the "sync-" id prefix is reserved for origin sync evidence')
  }
  if (automated) {
    if (!e.url.toLowerCase().startsWith(p.repository.toLowerCase() + '/')) err(path, `automated evidence must link inside ${p.repository}`)
    if (!e.commitSha) err(path, 'automated evidence needs a commitSha')
  }
}

export function validateRegistry(registry, schema, options = {}) {
  const dod = options.dod || parseDefinitionOfDone(readFileSync(DEFAULT_DOD, 'utf8'))
  // The schema's gate enum must list exactly the gates the Definition of Done defines.
  const enumErrors = []
  compareSets([...new Set([...dod.library, ...dod.application])], schema.$defs?.gateId?.enum || [], '$schema.$defs.gateId', 'standards/definition-of-done.md', (path, msg) => enumErrors.push(`${path}: ${msg}`))
  const errors = validateAgainstSchema(registry, schema)
  // Cross-record rules assume a structurally valid document.
  if (errors.length) return [...enumErrors, ...errors]
  return [...enumErrors, ...checkRules(registry, { ...options, dod })]
}

export function validateText(registryText, schema, options) {
  let registry
  try {
    registry = JSON.parse(registryText)
  } catch (e) {
    // Only the position: the parser's message quotes the input, which may hold a secret.
    const at = /at position \d+(?: \(line \d+ column \d+\))?/.exec(e.message)
    return [`$: invalid JSON${at ? ` (${at[0]})` : ''}`]
  }
  return validateRegistry(registry, schema, options)
}

function main(argv) {
  const registryPath = resolve(argv[0] || DEFAULT_REGISTRY)
  const schemaPath = resolve(argv[1] || DEFAULT_SCHEMA)
  let text, schema, dodText
  try {
    text = readFileSync(registryPath, 'utf8')
    schema = JSON.parse(readFileSync(schemaPath, 'utf8'))
    dodText = readFileSync(DEFAULT_DOD, 'utf8')
  } catch (e) {
    console.error(redactSensitive(`validate-registry: cannot read input: ${e.message}`))
    return 2
  }
  let errors
  try {
    errors = validateText(text, schema, { dod: parseDefinitionOfDone(dodText) })
  } catch (e) {
    if (e instanceof SchemaError) {
      console.error(`validate-registry: schema problem: ${e.message}`)
      return 2
    }
    throw e
  }
  if (errors.length) {
    console.error(`validate-registry: ${errors.length} problem(s) in ${registryPath}`)
    // CI logs are public to anyone with read access: values that look sensitive are redacted.
    for (const e of errors) console.error(redactSensitive(`  - ${e}`))
    return 1
  }
  const r = JSON.parse(text)
  console.log(`validate-registry: OK (${r.projects.length} projects, ${r.legacyRepositories.length} legacy and ${r.otherRepositories.length} other repositories, schema ${r.schemaVersion})`)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2))
}
