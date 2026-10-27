// Independent verification records and the builder/verifier rules (Phase 4, docs/verification.md).
//
// Collectors gather evidence; they never verify. A gate counts as verified only when a separate,
// named verifier examined evidence for the exact commit and recorded their own verification here.
// This module checks every rule and gives the reason a record does not count. It never creates a
// verification, an approval or an identity: records come only from a person (or a permitted,
// distinguishable AI verifier) through a reviewed PR to verification/verifications/.

import { checkEvidence, staleness, canonical, sha256 } from './evidence.mjs'
import { SYNC_RECORDER } from '../validate-registry.mjs'

export const VERIFICATION_SCHEMA = 1
export const METHODS = ['re-executed', 'reviewed-artifacts', 'manual-test']
const SHA = /^[0-9a-f]{40}$/
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/
const norm = s => String(s || '').trim().toLowerCase()

// The AI tool family an identity belongs to, or null for a person or unknown tool.
export function toolFamily(identity, policy) {
  const n = norm(identity)
  if (!n) return null
  for (const [family, names] of Object.entries(policy.toolFamilies || {})) {
    if (family.startsWith('$')) continue
    if (names.some(x => n.includes(norm(x)))) return family
  }
  return null
}

// Are two identities the same party for independence purposes? Same name, or the same AI tool
// family (a second Claude session is not independent of the first).
export function sameParty(a, b, policy) {
  if (!norm(a) || !norm(b)) return false
  if (norm(a) === norm(b)) return true
  const fa = toolFamily(a, policy)
  return Boolean(fa && fa === toolFamily(b, policy))
}

// Problems with a verification record's shape, or [].
export function checkShape(v) {
  const errs = []
  const bad = m => errs.push(`${v && v.id ? v.id : 'verification'}: ${m}`)
  if (!v || typeof v !== 'object' || Array.isArray(v)) return ['verification: not an object']
  if (v.schema !== VERIFICATION_SCHEMA) bad(`unsupported schema ${JSON.stringify(v.schema)}`)
  if (typeof v.id !== 'string' || !/^vr-[a-z0-9-]+$/.test(v.id)) bad('id must start with vr-')
  for (const k of ['project', 'gate']) if (typeof v[k] !== 'string' || !v[k]) bad(`${k} is required`)
  if (!SHA.test(v.commitSha || '')) bad('commitSha must be a full 40-character SHA')
  if (!Array.isArray(v.evidence) || v.evidence.some(x => !x || typeof x.id !== 'string' || !/^[0-9a-f]{64}$/.test(x.digest || ''))) bad('evidence must list { id, digest } for every record examined')
  if (!v.verifier || typeof v.verifier.name !== 'string' || !v.verifier.name.trim() || !['human', 'ai'].includes(v.verifier.kind)) bad('verifier needs a name and kind human or ai')
  if (v.verifier && v.verifier.kind === 'ai' && !(typeof v.verifier.tool === 'string' && v.verifier.tool.trim())) bad('an AI verifier must name its tool')
  if (!METHODS.includes(v.method)) bad(`method must be one of ${METHODS.join(', ')}`)
  if (!['pass', 'fail'].includes(v.result)) bad('result must be pass or fail')
  if (!TIME.test(v.verifiedAt || '')) bad('verifiedAt must be a UTC time')
  if (typeof v.attestation !== 'string' || !/^https:\/\/github\.com\//.test(v.attestation)) bad('attestation must be a github.com URL where the verifier recorded this (a review, comment or commit)')
  if (typeof v.notes !== 'string' || v.notes.trim().length < 20) bad('notes must say what was examined (20+ characters)')
  return errs
}

// Decides whether one verification record counts. Returns { valid, reasons }. Every rule that
// fails is listed, so a reviewer sees all of them at once.
//   ctx: { project (registry entry), evidence (this project's ledger, valid records),
//          policy, targetSha (the commit being evaluated), asOf (Date) }
export function judgeVerification(v, ctx) {
  const reasons = [...checkShape(v)]
  if (reasons.length) return { valid: false, reasons }
  const { project: p, policy } = ctx
  const builder = p.ownership.builder
  const assigned = p.ownership.verifier
  const name = v.verifier.name
  const gatePolicy = (policy.gates || {})[v.gate]

  if (v.project !== p.id) reasons.push(`is for project ${v.project}, not ${p.id}`)
  const catalog = ctx.gateCatalog || []
  if (!catalog.includes(v.gate)) reasons.push(`gate ${v.gate} is not part of the ${p.tier} tier`)
  if (!gatePolicy) reasons.push(`gate ${v.gate} has no verification policy`)

  // Identity separation.
  if (!norm(builder) || !norm(assigned)) reasons.push('the registry does not name both a builder and a verifier for this project (an owner decision)')
  else if (sameParty(builder, assigned, policy)) reasons.push('the registry builder and verifier are the same party')
  if (norm(name) === norm(SYNC_RECORDER) || norm(name) === norm(policy.collectorIdentity)) reasons.push('automation cannot verify')
  if (norm(builder) && sameParty(name, builder, policy)) reasons.push(`${name} is the builder (or the same tool family as the builder ${builder}) and cannot verify its own work`)
  if (norm(assigned) && norm(name) !== norm(assigned)) reasons.push(`${name} is not the verifier named in the registry (${assigned})`)

  // AI verifiers only where governance allows, with a distinguishable identity.
  if (v.verifier.kind === 'ai') {
    const family = toolFamily(v.verifier.tool, policy) || toolFamily(name, policy)
    const allowed = (policy.aiVerifiers.allowed || []).find(a => a.project === p.id && norm(a.tool) === norm(v.verifier.tool) && norm(a.identity) === norm(name))
    if (!allowed) reasons.push(`AI verifier ${name} (${v.verifier.tool}) is not permitted for ${p.id} by verification/policy.json`)
    if (!family) reasons.push('the AI verifier\'s tool family is not distinguishable')
    if (norm(builder) && family && family === toolFamily(builder, policy)) reasons.push('the AI verifier is the same tool family as the builder')
    if (v.method === 'manual-test') reasons.push('an AI verifier cannot record a manual test; manual review is a person\'s')
  } else if (toolFamily(name, policy)) reasons.push(`${name} is an AI tool identity but is recorded as human`)
  if ((policy.humanOnlyGates || []).includes(v.gate) && v.verifier.kind !== 'human') reasons.push(`${v.gate} is human-only`)

  // Method must fit the gate: partial or non-automatable gates need a person's manual review.
  if (gatePolicy && gatePolicy.automation !== 'full' && v.result === 'pass' && v.method !== 'manual-test') reasons.push(`${v.gate} is ${gatePolicy.automation === 'none' ? 'not automatable' : 'only partly automatable'}; a pass needs method manual-test`)

  // Evidence: must exist, be untampered, match the digest examined, and be for this commit.
  if (!SHA.test(ctx.targetSha || '')) reasons.push('no evaluated commit is known for this project')
  else if (v.commitSha !== ctx.targetSha) reasons.push(`verifies ${v.commitSha.slice(0, 7)}, but the evaluated commit is ${ctx.targetSha.slice(0, 7)}`)
  const byId = new Map(ctx.evidence.map(e => [e.id, e]))
  const examined = []
  for (const ref of v.evidence) {
    const e = byId.get(ref.id)
    if (!e) { reasons.push(`evidence ${ref.id} is not in the ledger`); continue }
    if (checkEvidence(e).length) { reasons.push(`evidence ${ref.id} is malformed or forged`); continue }
    if (e.digest !== ref.digest) reasons.push(`evidence ${ref.id} changed after it was examined (digest mismatch)`)
    if (e.commitSha !== v.commitSha) reasons.push(`evidence ${ref.id} is for ${String(e.commitSha).slice(0, 7)}, not ${v.commitSha.slice(0, 7)}`)
    const stale = staleness(e, { commitSha: v.commitSha, asOf: new Date(v.verifiedAt) })
    if (stale) reasons.push(`evidence ${ref.id} was stale when examined: ${stale}`)
    if (!e.gates.includes(v.gate)) reasons.push(`evidence ${ref.id} (${e.collector.name}) does not speak for ${v.gate}`)
    examined.push(e)
  }
  if (gatePolicy && v.result === 'pass') {
    for (const c of gatePolicy.collectors || []) {
      const e = examined.find(x => x.collector.name === c)
      if (!e) reasons.push(`a pass on ${v.gate} needs the ${c} collector's evidence for this commit`)
      else if (e.result !== 'pass' && v.method !== 'manual-test') reasons.push(`${c} evidence is ${e.result}; an automated pass cannot rest on it`)
      else if (e.result === 'fail') reasons.push(`${c} evidence failed; fix and re-collect before a pass`)
    }
    if (!examined.length && v.method !== 'manual-test') reasons.push('a pass needs evidence')
  }
  if (new Date(v.verifiedAt) > ctx.asOf) reasons.push('verifiedAt is after the evaluation time')
  if (v.verifiedAt < (examined.map(e => e.executedAt).sort().pop() || '')) reasons.push('verifiedAt is before the evidence it cites was collected')
  return { valid: reasons.length === 0, reasons: [...new Set(reasons)] }
}

// Loads one project's verification file; malformed and duplicate records are rejected.
export function loadVerifications(value, project) {
  const problems = []
  if (!value || typeof value !== 'object' || !Array.isArray(value.verifications)) return { verifications: [], problems: [`${project}: verifications file must be an object with a verifications list`] }
  if (value.project !== project) problems.push(`${project}: verifications file is for ${JSON.stringify(value.project)}`)
  const seen = new Set()
  const out = []
  for (const v of value.verifications) {
    const errs = checkShape(v)
    if (!errs.length && seen.has(v.id)) errs.push(`${v.id}: duplicate record`)
    if (errs.length) { problems.push(...errs); continue }
    seen.add(v.id)
    out.push(v)
  }
  return { verifications: out, problems }
}

// Verification requests: which gates have fresh collector evidence ready for a verifier, and who
// may verify them. Routing never records anything; it tells the verifier what to examine.
export function routeRequests({ project: p, policy, evidence, targetSha, asOf, gateCatalog, verifiedGates }) {
  const builder = p.ownership.builder
  const verifier = p.ownership.verifier
  const eligible = norm(builder) && norm(verifier) && !sameParty(builder, verifier, policy)
  const requests = []
  for (const gate of gateCatalog) {
    if (verifiedGates.has(gate)) continue
    const gp = policy.gates[gate]
    if (!gp) continue
    const current = evidence.filter(e => e.gates.includes(gate) && !staleness(e, { commitSha: targetSha, asOf }))
    const needed = gp.collectors || []
    const have = needed.filter(c => current.some(e => e.collector.name === c))
    const ready = needed.length > 0 && have.length === needed.length
    requests.push({
      gate,
      automation: gp.automation,
      humanOnly: (policy.humanOnlyGates || []).includes(gate),
      evidence: current.map(e => ({ id: e.id, digest: e.digest, collector: e.collector.name, result: e.result })).sort((a, b) => a.id.localeCompare(b.id)),
      missingCollectors: needed.filter(c => !have.includes(c)),
      method: gp.automation === 'full' ? 're-executed' : 'manual-test',
      routedTo: eligible ? verifier : null,
      status: !eligible ? 'blocked: no independent verifier assigned in the registry' : ready ? 'ready for verifier' : needed.length ? 'waiting for evidence' : 'manual verification only'
    })
  }
  return requests
}

// A verification record id that is stable for the same inputs (for the record CLI).
export function verificationId(v) {
  return `vr-${v.project}-${v.gate}-${v.commitSha.slice(0, 7)}-${sha256(canonical({ verifier: v.verifier.name, verifiedAt: v.verifiedAt, evidence: v.evidence })).slice(0, 8)}`
}
