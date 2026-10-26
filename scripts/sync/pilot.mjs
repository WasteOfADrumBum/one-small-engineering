#!/usr/bin/env node
// ModsPack pilot: proves the hub can track a project independently of its release process.
//
//   node scripts/sync/pilot.mjs [--project one-small-mods-pack] [--out-dir out/pilot]
//
// Read-only. Collects the project twice from GitHub, plans against the registry, applies the
// proposal in memory and re-plans, and checks seven things: identity, PR and release state
// observed, CI evidence with run ids and attempts, manual blockers and governance intact,
// readiness not promoted, a correct proposal for what changed, and no update on an
// unchanged second run. Nothing is written to GitHub; write-side behaviour is exercised
// against the in-memory GitHub in pilot.test.mjs.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { validateRegistry, parseDefinitionOfDone } from '../validate-registry.mjs'
import { createClient } from './github.mjs'
import { collect } from './collect.mjs'
import { plan, materialView } from './plan.mjs'
import { checkProposal } from './write.mjs'
import { readiness } from '../readiness.mjs'
import { ROOT, REGISTRY_PATH, SLUG, readJson, deepEqual, isoSeconds, safeOutput } from './lib.mjs'

const PROMOTED = new Set(['released', 'approved-not-released', 'awaiting-owner-approval'])

// Everything that is governance: what automation must leave exactly as it found it.
export function governanceView(p) {
  return {
    tier: p.tier,
    lifecycle: p.lifecycle,
    visibility: p.visibility,
    scope: { targetVersion: p.release.targetVersion, releaseStatus: p.release.releaseStatus, scopeDocument: p.release.scopeDocument, candidate: p.release.candidate, nextAction: p.release.nextAction, enhancements: p.release.enhancements },
    blockers: p.release.blockers,
    ownership: p.ownership,
    approval: p.approval,
    gates: p.releaseGates,
    manualEvidence: p.evidence.filter(e => e.origin !== 'sync'),
    modsPack: p.modsPack,
    missingEvidence: p.missingEvidence,
    dependencies: p.dependencies,
    syncIdentity: p.sync && { enabled: p.sync.enabled, mode: p.sync.mode, repositoryId: p.sync.repositoryId }
  }
}

export async function runPilot({ registry, client, projectId = 'one-small-mods-pack', now = new Date(), secondNow = new Date(now.getTime() + 60_000), validate }) {
  const checks = []
  const check = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail })
  const before = registry.projects.find(p => p.id === projectId)
  if (!before) throw new Error(`project ${projectId} is not in the registry`)

  check('1. identified in the registry', before.sync && before.sync.enabled && Number.isInteger(before.sync.repositoryId) && before.sync.mode === 'observe',
    `${before.repository}, pinned repository id ${before.sync && before.sync.repositoryId}, mode ${before.sync && before.sync.mode}`)

  const first = await collect({ project: before, client, now })
  check('2. PR and release state observed', Array.isArray(first.openPullRequests) && Array.isArray(first.releases) && first.tags.status !== 'unavailable',
    `head ${first.head.sha.slice(0, 7)} (${first.head.relation}); open PRs: ${first.openPullRequests.map(pr => `#${pr.number}${pr.draft ? ' (draft)' : ''} at ${pr.headSha.slice(0, 7)}`).join(', ') || 'none'}; published releases: ${first.releases.length}; tags: ${first.tags.status}${first.tags.latest ? ` (latest ${first.tags.latest.name})` : ''}; package.json: ${first.package.status}${first.package.version ? ` ${first.package.name}@${first.package.version}` : ''}; collection ${first.collection.complete ? 'complete' : `incomplete: ${first.collection.gaps.join('; ')}`}`)

  const planned = plan(registry, first)
  let proposalOk = true
  let proposalError = ''
  if (planned.changed) {
    try {
      checkProposal({ baseRegistry: registry, nextRegistry: planned.registry, projectId, validate })
    } catch (e) {
      proposalOk = false
      proposalError = e.message
    }
  }
  const after = planned.registry.projects.find(p => p.id === projectId)

  const runs = first.workflowRuns
  const runRecords = after.evidence.filter(e => e.origin === 'sync' && e.type === 'workflow_run' && e.commitSha === first.head.sha)
  const idsOk = runs.every(r => runRecords.some(e => e.eventKey.endsWith(`/${r.runId.toString(36)}/${r.attempt}`) && e.url === r.url && e.result === 'builder_reported'))
  check('3. CI evidence with run ids and attempts', idsOk,
    runs.length ? runs.map(r => `${r.workflow} run ${r.runId} attempt ${r.attempt}: ${r.conclusion}`).join('; ') : `no completed workflow run on ${first.head.sha.slice(0, 7)} (confirmed: GitHub listed ${runs.length} run(s) for the head); nothing recorded, nothing inferred`)

  check('4. manual blockers and governance intact', deepEqual(governanceView(before), governanceView(after)),
    `${before.release.blockers.filter(b => b.status === 'open').length} open blocker(s) unchanged: ${before.release.blockers.filter(b => b.status === 'open').map(b => b.id).join(', ') || 'none'}`)

  const rBefore = readiness(before)
  const rAfter = readiness(after)
  check('5. release readiness not promoted', rBefore.verdict === rAfter.verdict && (!PROMOTED.has(rAfter.verdict) || PROMOTED.has(rBefore.verdict)) && after.release.releaseStatus === before.release.releaseStatus,
    `verdict ${rAfter.verdict} (was ${rBefore.verdict}); releaseStatus ${after.release.releaseStatus}; ${rAfter.gates.satisfied.length} of ${after.releaseGates.length} gates satisfied`)

  check('6. proposal matches what changed, and passes guard and validator', proposalOk && (planned.changed ? planned.changes.length > 0 : planned.changes.length === 0),
    planned.changed ? `proposed: ${planned.changes.join(' ')}${proposalError ? ` REFUSED: ${proposalError}` : ''}` : 'no material change: nothing proposed')

  // Second run against the registry as it would be after the proposal merged.
  const second = await collect({ project: after, client, now: secondNow })
  const replanned = plan(planned.registry, second)
  const moved = second.head.sha !== first.head.sha || !deepEqual(second.openPullRequests, first.openPullRequests)
  check('7. unchanged second run proposes nothing', !replanned.changed || moved,
    replanned.changed ? (moved ? `GitHub changed between the two reads; proposed: ${replanned.changes.join(' ')}` : `unexpected proposal: ${replanned.changes.join(' ')}`) : `no material change at ${second.head.sha.slice(0, 7)}: no branch, PR or commit would be written`)

  return {
    projectId,
    collectedAt: first.collectedAt,
    repository: first.repo.fullName,
    passed: checks.every(c => c.ok),
    checks,
    proposal: { changed: planned.changed, changes: planned.changes, suggestions: planned.suggestions, notes: planned.notes, materialAfter: materialView(after) },
    readiness: rAfter,
    observations: [first, second]
  }
}

export function renderPilot(r) {
  const lines = [`# ${r.projectId} pilot`, '', `Repository ${r.repository}, collected ${r.collectedAt}. Read-only: nothing was written to GitHub.`, '', `Result: ${r.passed ? 'PASS' : 'FAIL'} (${r.checks.filter(c => c.ok).length} of ${r.checks.length} checks).`, '']
  lines.push('| Check | Result | Detail |', '| --- | --- | --- |')
  for (const c of r.checks) lines.push(`| ${c.name} | ${c.ok ? 'Pass' : 'Fail'} | ${String(c.detail).replace(/\|/g, '\\|')} |`)
  lines.push('', '## Suggested manual updates', '')
  if (r.proposal.suggestions.length) for (const s of r.proposal.suggestions) lines.push(`- ${s}`)
  else lines.push('None.')
  return safeOutput(lines.join('\n') + '\n')
}

function opt(argv, name, fallback) {
  const i = argv.indexOf(name)
  return i === -1 ? fallback : argv[i + 1]
}

async function main(argv) {
  const projectId = opt(argv, '--project', 'one-small-mods-pack')
  if (!SLUG.test(projectId)) throw new Error('invalid --project')
  const registry = JSON.parse(readFileSync(resolve(ROOT, REGISTRY_PATH), 'utf8'))
  const schema = readJson('projects/registry.schema.json')
  const dod = parseDefinitionOfDone(readFileSync(resolve(ROOT, 'standards/definition-of-done.md'), 'utf8'))
  const client = createClient({ token: process.env.READER_TOKEN || process.env.GITHUB_TOKEN || '' })
  const result = await runPilot({ registry, client, projectId, now: new Date(isoSeconds(new Date())), validate: r => validateRegistry(r, schema, { dod }) })
  const outDir = resolve(ROOT, opt(argv, '--out-dir', 'out/pilot'))
  mkdirSync(outDir, { recursive: true })
  writeFileSync(resolve(outDir, `${projectId}.json`), safeOutput(JSON.stringify(result, null, 2)) + '\n')
  writeFileSync(resolve(outDir, `${projectId}.md`), renderPilot(result))
  console.log(renderPilot(result))
  return result.passed ? 0 : 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code }, e => { console.error(`pilot: ${safeOutput(e.message)}`); process.exitCode = 1 })
}
