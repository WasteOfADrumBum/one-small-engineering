// Release preparation: reviewable draft artifacts for one project's scoped release.
// Pure and deterministic. It prepares; it never publishes, tags, deploys, merges or approves.
//
// Inputs: one project's assessment (engine.mjs), and optionally the project's CHANGELOG text
// with the commit it was read from. Changelog text is builder-authored and is always labelled
// unverified; it is used for wording only and never changes a gate, blocker or percentage.

import { redactSensitive } from '../validate-registry.mjs'
import { STATE_TEXT, PROVENANCE_TEXT, GATE_CATEGORY } from './engine.mjs'
import { ELIGIBILITY_TEXT, redactJson } from './render.mjs'

const short = sha => (sha ? sha.slice(0, 7) : 'none')
const day = t => (t ? t.slice(0, 10) : 'never')
const esc = s => String(s ?? '').replace(/\r?\n/g, ' ')

// The "## [x.y.z]" / "## x.y.z" / "## vx.y.z" section of a changelog, LF-normalised, or null.
export function changelogSection(text, version) {
  if (!text || !version) return null
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n')
  const v = version.replace(/[.+]/g, m => `\\${m}`)
  const start = lines.findIndex(l => new RegExp(`^##\\s+\\[?v?${v}\\]?(?=\\s|$)`).test(l))
  if (start === -1) return null
  let end = lines.findIndex((l, i) => i > start && /^##\s/.test(l))
  if (end === -1) end = lines.length
  return { heading: lines[start], body: lines.slice(start + 1, end).join('\n').trim() }
}

// "### Heading" subsections of a changelog section body.
function subsections(body) {
  const out = {}
  let name = null
  for (const line of body.split('\n')) {
    const m = /^###\s+(.+?)\s*$/.exec(line)
    if (m) { name = m[1]; out[name] = [] } else if (name) out[name].push(line)
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.join('\n').trim()]))
}

const ROLLBACK = {
  library: 'npm versions cannot be reused: roll back with `npm deprecate <name>@<bad version>` plus a patch release, and point users to the previous version. A git revert of the merge restores the source. See standards/release.md#rollback-and-recovery.',
  showcase: 'Promote the previous production deployment in the hosting provider (for Vercel, the previous deployment), then revert the merge on main. See standards/release.md#rollback-and-recovery.',
  application: 'Follow the verified deployment-rollback procedure for the application (previous deployment promotion and data restore where needed). See standards/release.md#rollback-and-recovery.'
}

export function prepareRelease(p, meta, { changelogText = null, changelogSource = null } = {}) {
  const f = p.facts
  const r = p.derived.readiness
  const target = f.targetVersion
  const gates = p.derived.gates
  const section = changelogSection(changelogText, target)
  const changelogStale = Boolean(section && changelogSource && f.candidate && changelogSource.commitSha && changelogSource.commitSha !== f.candidate.headSha)
  const sub = section ? subsections(section.body) : {}

  const byCat = cat => gates.filter(g => GATE_CATEGORY[g.id] === cat).map(g => ({ id: g.id, state: g.state, provenance: g.provenance, missing: g.missing }))
  const commits = new Map()
  for (const g of gates) for (const e of g.evidence) if (e.commitSha) commits.set(e.commitSha, [...new Set([...(commits.get(e.commitSha) || []), e.id])])
  const testEvidence = [...new Map(gates.flatMap(g => g.evidence).filter(e => ['workflow_run', 'manual_test', 'audit'].includes(e.type) || /test|ci|verification/i.test(e.id)).map(e => [e.id, e])).values()]
    .sort((a, b) => a.id.localeCompare(b.id))
  const limitations = {
    registryMissingEvidence: f.missingEvidence,
    unverifiedGateNotes: gates.filter(g => g.applicable && g.state !== 'verified' && g.notes).map(g => ({ gate: g.id, notes: g.notes })),
    changelogKnownLimitations: sub['Known limitations'] || null
  }
  const rollbackGates = gates.filter(g => ['upgrade-rollback-uninstall-docs', 'deployment-rollback'].includes(g.id)).map(g => ({ id: g.id, state: g.state, provenance: g.provenance, evidence: g.evidence.map(e => e.url) }))
  const blockers = [...p.derived.blockers.merge, ...p.derived.blockers.release]
  const nonApproval = blockers.filter(b => b.category !== 'approval')
  const pre = gates.filter(g => g.applicable && g.phase === 'pre-publication')
  const post = gates.filter(g => g.applicable && g.phase === 'post-publication')
  const checklist = [
    { item: 'Release scope frozen: targetVersion and scopeDocument recorded', done: Boolean(f.targetVersion && f.scopeDocument) },
    { item: 'Release candidate commit recorded and unchanged', done: Boolean(f.candidate && !r.candidateMoved) },
    { item: 'Builder and a different, independent verifier assigned', done: r.ownershipValid },
    { item: `Every applicable pre-publication gate independently verified on current evidence (${r.prePublication.verified}/${r.prePublication.applicable})`, done: pre.every(g => g.state === 'verified') },
    { item: 'No open merge blockers', done: !p.derived.blockers.merge.length },
    { item: 'No open release blockers other than the approval itself', done: !nonApproval.filter(b => b.blocks === 'release').length },
    { item: 'Changelog and release notes reviewed against verified evidence (drafts below are unverified)', done: false, manual: true },
    { item: 'Joshua Small approves the release, linked as evidence in a registry PR', done: r.approvalRecorded, manual: true },
    { item: `After the authorized publication or deployment: post-publication gates verified (${post.map(g => g.id).join(', ') || 'none'})`, done: post.every(g => g.state === 'verified') && post.length > 0 },
    { item: 'Registry updated by PR: currentVersion, releaseStatus released, lifecycle maintenance', done: f.releaseStatus === 'released' }
  ]

  const json = redactJson({
    kind: 'one-small-engineering/release-preparation',
    generatedBy: meta.command,
    asOf: meta.asOf,
    staleDays: meta.staleDays,
    engineVersion: meta.engineVersion,
    registrySha256: meta.registryHash,
    notice: 'Draft preparation only. Nothing was published, tagged, deployed, merged or approved. Release authorization is manual and belongs to Joshua Small.',
    project: { id: p.id, name: p.name, tier: p.tier },
    facts: {
      currentVersion: f.currentVersion,
      targetVersion: target,
      releaseStatus: f.releaseStatus,
      scopeDocument: f.scopeDocument,
      candidate: f.candidate,
      openPullRequests: f.openPullRequests,
      evidenceCommits: [...commits.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([sha, ids]) => ({ commitSha: sha, evidence: ids.sort() })),
      ownership: f.ownership,
      approval: f.approval
    },
    derived: {
      readiness: r,
      eligibility: r.eligibility,
      security: byCat('security'),
      accessibility: byCat('accessibility'),
      testAndCiEvidence: testEvidence.map(e => ({ id: e.id, type: e.type, result: e.result, provenance: e.provenance, commitSha: e.commitSha, verifiedAt: e.verifiedAt, url: e.url, stale: e.stale })),
      blockers: p.derived.blockers,
      nextActions: p.derived.nextActions,
      rollback: { guidance: ROLLBACK[p.tier], gates: rollbackGates },
      ownerChecklist: checklist
    },
    unverified: {
      evidence: p.unverified,
      changelog: section ? { source: changelogSource, stale: changelogStale, heading: section.heading } : null,
      limitations
    }
  })

  const statusLine = `Status: ${ELIGIBILITY_TEXT[r.eligibility]}. ${r.verifiedGates} of ${r.applicableGates} applicable gates independently verified (${r.percentage ?? 'n/a'}%); ${blockers.length} open blocker(s).`
  const cl = section ? `CHANGELOG.md at ${short(changelogSource && changelogSource.commitSha)}${changelogStale ? ' (older than the release candidate: re-read it)' : ''}` : null

  // release-prep.md
  const L = [`# ${p.name} ${target || '(unscoped)'}: release preparation`, '']
  L.push(`Generated by \`${meta.command}\` as of ${meta.asOf} from registry sha256 \`${meta.registryHash.slice(0, 12)}\`. **Draft for review.** Nothing was published, tagged, deployed, merged or approved; release authorization is manual and belongs to Joshua Small.`, '')
  L.push('## Readiness summary (derived)', '', `- ${statusLine}`, `- Pre-publication gates verified: ${r.prePublication.verified} of ${r.prePublication.applicable}.`, `- Missing independent verification: ${r.missingIndependentVerification.join(', ') || 'none'}.`, `- Full gate table: [project report](../../../projects/${p.id}.md).`, '')
  L.push('## Version and target (facts)', '', `- Current version: ${f.currentVersion || 'none'}. Target: ${target || 'none'}. Registry release status: ${f.releaseStatus}.`, `- Scope document: ${f.scopeDocument || 'none'}.`)
  L.push(`- Release candidate: ${f.candidate ? `${f.candidate.pullRequest ? `PR #${f.candidate.pullRequest}, ` : ''}\`${esc(f.candidate.ref)}\` at \`${f.candidate.headSha}\` (observed ${f.candidate.observedAt})${r.candidateMoved ? ', **moved since**' : ''}` : 'not recorded'}.`, '')
  L.push('## Relevant pull requests and commits (facts)', '')
  for (const pr of f.openPullRequests) L.push(`- PR [#${pr.number}](${pr.url})${pr.draft ? ' (draft)' : ''} at \`${short(pr.headSha)}\``)
  if (!f.openPullRequests.length) L.push('- No open pull requests recorded.')
  for (const [sha, ids] of [...commits.entries()].sort(([a], [b]) => a.localeCompare(b))) L.push(`- Commit \`${short(sha)}\`: cited by ${ids.sort().join(', ')}`)
  L.push('')
  L.push('## Test and CI evidence', '')
  if (!testEvidence.length) L.push('None cited by a gate.')
  for (const e of testEvidence) L.push(`- [${e.id}](${e.url}): ${e.type}, result ${e.result}, ${PROVENANCE_TEXT[e.provenance]}, commit ${short(e.commitSha)}, ${day(e.verifiedAt)}${e.stale ? `, stale (${esc(e.stale)})` : ''}.`)
  L.push('', 'A passing CI run is evidence for the automated-checks gate. It is not release readiness.', '')
  for (const [title, cat] of [['Security status (derived)', 'security'], ['Accessibility status (derived)', 'accessibility']]) {
    L.push(`## ${title}`, '')
    const rows = byCat(cat)
    if (!rows.length) L.push('No gates in this category for this tier.')
    for (const g of rows) L.push(`- ${g.id}: ${STATE_TEXT[g.state]} (${PROVENANCE_TEXT[g.provenance]}).${g.missing.length ? ` Missing: ${esc(g.missing.join('; '))}.` : ''}`)
    const bl = blockers.filter(b => b.category === cat)
    if (bl.length) L.push(`- Open ${cat} blockers: ${bl.map(b => b.id).join(', ')}.`)
    L.push('')
  }
  L.push('## Remaining blockers', '')
  if (!blockers.length) L.push('None.')
  for (const b of blockers) L.push(`- **${b.id}** (${b.origin === 'registry' ? 'registry-recorded' : 'derived, proposed'}; ${b.blocks} blocker; ${b.category}): ${esc(b.description)}`)
  L.push('')
  L.push('## Known limitations (unverified until re-checked)', '')
  for (const m of limitations.registryMissingEvidence) L.push(`- Missing evidence (registry): ${esc(m)}`)
  for (const n of limitations.unverifiedGateNotes) L.push(`- ${n.gate} (registry notes): ${esc(n.notes)}`)
  if (limitations.changelogKnownLimitations) L.push(`- From ${cl}: ${esc(limitations.changelogKnownLimitations)}`)
  if (!limitations.registryMissingEvidence.length && !limitations.unverifiedGateNotes.length && !limitations.changelogKnownLimitations) L.push('None recorded.')
  L.push('')
  L.push('## Rollback and recovery references', '', `- ${ROLLBACK[p.tier]}`)
  for (const g of rollbackGates) L.push(`- Gate ${g.id}: ${STATE_TEXT[g.state]} (${PROVENANCE_TEXT[g.provenance]})${g.evidence.length ? `; evidence ${g.evidence.join(', ')}` : ''}.`)
  L.push('')
  L.push('## Owner approval checklist', '', 'Ticked only where the registry shows it; the approval line is ticked only when Joshua Small\'s approval is recorded with evidence.', '')
  for (const c of checklist) L.push(`- [${c.done ? 'x' : ' '}] ${c.item}`)
  L.push('')
  L.push('## Drafts', '', '- [Release notes draft](release-notes.draft.md)', '- [Changelog draft](CHANGELOG.draft.md)', '- [Completion checklist](checklist.md)', '')

  // checklist.md: the minimum remaining work, in order.
  const C = [`# ${p.name} ${target || '(unscoped)'}: completion checklist`, '', `Derived as of ${meta.asOf}. ${statusLine}`, '']
  let n = 0
  for (const a of p.derived.nextActions.filter(x => x.bucket !== 'Owner decision')) C.push(`${++n}. [ ] ${a.text}`)
  if (!r.approvalRecorded) C.push(`${++n}. [ ] Joshua Small reviews the evidence and approves or declines the release (recorded in a registry PR).`)
  C.push(`${++n}. [ ] Only after approval: publish or deploy, then verify ${post.map(g => g.id).join(', ') || 'the release identity'} and record the result in the registry.`)
  C.push('')

  // release-notes.draft.md
  const N = [`# ${p.name}${target ? ` ${target}` : ''} release notes (draft)`, '']
  N.push(`> **Draft, not approved, not published.** ${statusLine} Generated ${meta.asOf}.`, '')
  N.push('## Highlights', '')
  if (sub.Added) N.push(`_From ${cl}; builder-authored, not independently verified._`, '', sub.Added, '')
  else N.push('_Fill in from the approved scope document._', '')
  if (sub.Fixed) N.push('## Fixes', '', `_From ${cl}; builder-authored._`, '', sub.Fixed, '')
  N.push('## Verification status', '', `- ${r.verifiedGates} of ${r.applicableGates} applicable release gates independently verified.`)
  if (r.missingIndependentVerification.length) N.push(`- Builder-reported, awaiting independent verification: ${r.missingIndependentVerification.join(', ')}.`)
  N.push('')
  N.push('## Known limitations', '')
  if (limitations.changelogKnownLimitations) N.push(limitations.changelogKnownLimitations, '')
  for (const m of limitations.registryMissingEvidence) N.push(`- Not yet verified: ${esc(m)}`)
  N.push('', '## Upgrade, rollback and uninstall', '', ROLLBACK[p.tier], '')

  // CHANGELOG.draft.md
  const G = [`# Changelog draft for ${p.name} ${target || ''}`.trimEnd(), '', `> Draft generated ${meta.asOf}. Review it against verified evidence before copying it into the project repository. ${statusLine}`, '']
  if (section) G.push(`_Source: ${cl}. Builder-authored text, not independently verified._`, '', `## ${target} (unreleased)`, '', section.body, '')
  else G.push(`## ${target || 'next'} (unreleased)`, '', '### Added', '', '- ', '', '### Changed', '', '- ', '', '### Fixed', '', '- ', '', '### Known limitations', '', '- ', '')

  return {
    json,
    files: {
      'release-prep.md': redactSensitive(L.join('\n')),
      'release-prep.json': JSON.stringify(json, null, 2) + '\n',
      'checklist.md': redactSensitive(C.join('\n')),
      'release-notes.draft.md': redactSensitive(N.join('\n')),
      'CHANGELOG.draft.md': redactSensitive(G.join('\n'))
    }
  }
}
