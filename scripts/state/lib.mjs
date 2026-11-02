// Project development state (.engineering/state.json): validation, checkpoint merge with
// optimistic concurrency, generated views, and freshness against GitHub facts.
// Pure functions; Node built-ins and the hub's own validator only.

import { createHash } from 'node:crypto'
import { validateAgainstSchema, findSensitive } from '../validate-registry.mjs'
import { readJson, cleanText } from '../sync/lib.mjs'

export const STATE_PATHS = Object.freeze({ state: '.engineering/state.json', status: '.engineering/STATUS.md', handoff: '.engineering/HANDOFF.md' })
export const SUPPORTED_VERSION = 1
export const STALE_AFTER_DAYS = 14

export class StateError extends Error {}
export class ConflictError extends StateError {}
export class UnsupportedVersion extends StateError {}

const schema = () => readJson('schemas/project-state.schema.json')
// Names an AI agent may not record itself as. Human decisions need a cited human reference.
const HUMAN_IDENTITY = /\b(joshua|small|owner|human|verifier|approver|user)\b/i

export function serializeState(state) {
  return JSON.stringify(state, null, 2) + '\n'
}

// A fresh record for a project that has none. Everything unknown stays null/empty.
export function initialState({ projectId, repository, branch = null }) {
  return {
    stateVersion: 1, revision: 0, checkpointId: 'init-0000000', projectId, repository,
    hub: 'https://github.com/WasteOfADrumBum/one-small-engineering',
    recorded: { branch, commit: null, recordedAt: null },
    development: { milestone: null, activeTask: null, workingBranch: null, activePr: null, lastCompleted: [], inProgress: [], nextAction: null },
    decisions: { made: [], constraints: [], unresolved: [] },
    verification: { testsRun: [], unverifiedChanges: [] },
    handoff: { lastAgent: null, checkpointedAt: null, unfinished: [], blockers: [], continuation: null, uncommittedWorkOutsideCheckpoint: 'unknown', persistedBy: 'github-api' },
    provenance: { claims: 'agent_reported', independentVerification: 'none' }
  }
}

// Returns a list of problems; empty means the record is valid and safe to share.
export function validateState(state, { projectId } = {}) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return ['state is not an object']
  if (state.stateVersion !== SUPPORTED_VERSION) throw new UnsupportedVersion(`unsupported stateVersion ${JSON.stringify(state.stateVersion)}; this hub reads ${SUPPORTED_VERSION}`)
  const errors = validateAgainstSchema(state, schema())
  if (errors.length) return errors
  if (projectId && state.projectId !== projectId) errors.push(`$.projectId: ${state.projectId} is not ${projectId}`)
  const agent = state.handoff.lastAgent
  if (agent && HUMAN_IDENTITY.test(`${agent.tool} ${agent.model || ''}`)) errors.push('$.handoff.lastAgent: an agent cannot record itself as a human, owner or verifier')
  state.decisions.made.forEach((d, i) => {
    if (d.decidedBy === 'human' && !d.humanRef) errors.push(`$.decisions.made[${i}]: a human decision must cite where the human made it (humanRef)`)
    if (d.decidedBy === 'agent' && d.humanRef) errors.push(`$.decisions.made[${i}]: an agent decision cannot carry a humanRef`)
  })
  const text = JSON.stringify(state)
  // Only long digit runs inside URLs (workflow run and job IDs) are neutralised; the URL itself is
  // still scanned, so credentials in a URL or a token in a query string are caught
  // (GitHub Copilot review of PR #29, 2026-11-02).
  const secrets = findSensitive(text.replace(/https:\/\/[^"\s]+/g, url => url.replace(/\d{8,}/g, '0')))
  if (secrets.length) errors.push(`state contains sensitive-looking content (${secrets.join(', ')}); remove it before sharing`)
  if (/\b(independently verified|verified by (joshua|the owner|a human))\b/i.test(text)) errors.push('state may not claim independent verification; that is recorded only in the hub registry')
  return errors
}

const SECTIONS = ['recorded', 'development', 'decisions', 'verification', 'handoff']

// Applies a checkpoint patch. `expectedRevision` is the revision the agent read; if the file
// has moved on, nothing is written (ConflictError) and the agent must re-read and re-apply.
// A patch replaces whole fields it names; fields it omits are kept. Arrays are replaced, not
// appended, so a checkpoint is a complete statement of those lists.
export function applyCheckpoint(current, patch, { expectedRevision, agent, now, persistedBy = 'local-file' }) {
  if (!Number.isInteger(expectedRevision)) throw new StateError('a checkpoint must name the revision it was based on (expectedRevision)')
  if (!patch || typeof patch.checkpointId !== 'string') throw new StateError('a checkpoint needs a checkpointId')
  if (patch.checkpointId === current.checkpointId) return { state: current, changed: false, reason: 'duplicate checkpoint id; already applied' }
  if (current.revision !== expectedRevision) throw new ConflictError(`state is at revision ${current.revision} but this checkpoint was based on ${expectedRevision}; re-read the state and re-apply`)
  const next = structuredClone(current)
  for (const s of SECTIONS) {
    if (patch[s] === undefined) continue
    if (typeof patch[s] !== 'object' || patch[s] === null || Array.isArray(patch[s])) throw new StateError(`patch.${s} must be an object`)
    next[s] = { ...next[s], ...patch[s] }
  }
  for (const k of Object.keys(patch)) if (k !== 'checkpointId' && !SECTIONS.includes(k)) throw new StateError(`patch.${k} is not a checkpoint field (identity, provenance and revision are not patchable)`)
  next.checkpointId = patch.checkpointId
  next.revision = current.revision + 1
  next.recorded.recordedAt = now
  next.handoff.checkpointedAt = now
  next.handoff.lastAgent = agent
  next.handoff.persistedBy = persistedBy
  const problems = validateState(next, { projectId: current.projectId })
  if (problems.length) throw new StateError(`checkpoint rejected:\n  - ${problems.join('\n  - ')}`)
  return { state: next, changed: true }
}

const list = (items, empty = '_none recorded_') => (items.length ? items.map(i => `- ${cleanText(i, 400)}`).join('\n') : empty)

export function renderStatus(s) {
  const d = s.development
  return `<!-- generated from .engineering/state.json (revision ${s.revision}); edit state.json through a checkpoint, not this file -->

# ${s.projectId}: development status

All values are **agent-reported**, not independently verified. Check GitHub before relying on them.

- Milestone: ${d.milestone ? cleanText(d.milestone) : 'unknown'}
- Active task: ${d.activeTask ? `${cleanText(d.activeTask.id, 80)}: ${cleanText(d.activeTask.title)}` : 'none recorded'}
- Branch: ${d.workingBranch ? `\`${cleanText(d.workingBranch, 120)}\`` : 'unknown'}${d.activePr ? ` · PR #${d.activePr}` : ''}
- Recorded commit: ${s.recorded.commit ? `\`${s.recorded.commit.slice(0, 7)}\` on \`${cleanText(s.recorded.branch, 120)}\`` : 'unknown'}
- Last checkpoint: ${s.handoff.checkpointedAt || 'never'} by ${s.handoff.lastAgent ? cleanText(s.handoff.lastAgent.tool, 80) : 'unknown'}

## Next action

${d.nextAction ? cleanText(d.nextAction, 600) : '_unknown_'}

## Completed

${list(d.lastCompleted)}

## In progress

${list(d.inProgress)}

## Tests (agent-reported)

${s.verification.testsRun.length ? s.verification.testsRun.map(t => `- \`${cleanText(t.command, 120)}\`: ${t.result}${t.commit ? ` at \`${t.commit.slice(0, 7)}\`` : ''}, ${t.at}`).join('\n') : '_none recorded_'}

## Unverified changes

${list(s.verification.unverifiedChanges)}
`
}

export function renderHandoff(s) {
  const h = s.handoff
  return `<!-- generated from .engineering/state.json (revision ${s.revision}) -->

# Handoff: ${s.projectId}

Read this, then **verify against GitHub** (branch head, open PRs, CI) before continuing. Nothing below is independently verified.

- Checkpoint: revision ${s.revision}, \`${s.checkpointId}\`, ${h.checkpointedAt || 'never'} by ${h.lastAgent ? `${cleanText(h.lastAgent.tool, 80)}${h.lastAgent.model ? ` (${cleanText(h.lastAgent.model, 80)})` : ''}` : 'unknown'}
- Written by: ${h.persistedBy === 'github-api' ? 'the hub writer (committed through the GitHub API)' : 'a local edit that the agent then pushed; confirm the branch head matches'}
- Uncommitted work outside this checkpoint: **${h.uncommittedWorkOutsideCheckpoint}**${h.uncommittedWorkOutsideCheckpoint === 'none' ? '' : ' (do not assume it exists anywhere you can read)'}

## Continue with

${h.continuation ? cleanText(h.continuation, 1000) : s.development.nextAction ? cleanText(s.development.nextAction, 600) : '_no instructions recorded_'}

## Unfinished

${list(h.unfinished)}

## Blockers

${list(h.blockers)}

## Decisions

${s.decisions.made.length ? s.decisions.made.map(d => `- [${d.decidedBy}] ${cleanText(d.summary, 400)}${d.humanRef ? ` (${cleanText(d.humanRef, 200)})` : ''}`).join('\n') : '_none recorded_'}

## Constraints

${list(s.decisions.constraints)}

## Unresolved decisions

${list(s.decisions.unresolved)}
`
}

export const viewDigest = text => createHash('sha256').update(text).digest('hex').slice(0, 16)

// Compares the record with what GitHub says. `github` = { head, branchExists, openPrs: [numbers], checkedAt }.
// Anything that cannot be confirmed is reported, never assumed.
export function assess(state, github, now = new Date()) {
  const flags = []
  const age = state.handoff.checkpointedAt ? (now - new Date(state.handoff.checkpointedAt)) / 86_400_000 : null
  if (age === null) flags.push('never-checkpointed')
  else if (age > STALE_AFTER_DAYS) flags.push('stale-checkpoint')
  if (!github) flags.push('github-unavailable')
  else {
    if (state.development.workingBranch && github.branchExists === false) flags.push('working-branch-missing')
    if (state.recorded.commit && github.head && state.recorded.branch === github.defaultBranch && github.head !== state.recorded.commit) flags.push('behind-default-branch')
    if (state.development.activePr && github.openPrs && !github.openPrs.includes(state.development.activePr)) flags.push('active-pr-not-open')
  }
  for (const t of state.verification.testsRun) {
    if (t.result === 'fail') flags.push('recorded-test-failure')
    if (state.recorded.commit && t.commit && t.commit !== state.recorded.commit) flags.push('old-test-evidence')
  }
  if (state.handoff.uncommittedWorkOutsideCheckpoint !== 'none') flags.push('uncommitted-work-possible')
  if (state.handoff.blockers.length) flags.push('blocked')
  return { flags: [...new Set(flags)], ageDays: age === null ? null : Math.floor(age) }
}
