// Cross-agent handoff acceptance (producer/consumer). Two SIMULATED agents, "Agent A" and
// "Agent B", share nothing but the fake GitHub repository. This proves the contract works
// end to end; it is not a cross-vendor runtime test.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { fakeGit } from './fake-git.mjs'
import { initialState, serializeState, renderStatus, renderHandoff, validateState, assess, STATE_PATHS, ConflictError } from './lib.mjs'
import { pushCheckpoint, readState } from './push.mjs'
import { aggregate, renderAggregate } from './aggregate.mjs'

const REPO = 'https://github.com/WasteOfADrumBum/cortex-brain-task'
const sha = s => createHash('sha1').update(s).digest('hex')
const O = { owner: 'WasteOfADrumBum', repo: 'cortex-brain-task' }
const registry = { projects: [{ id: 'cortex', repository: REPO }] }

function repoWithState() {
  const s = initialState({ projectId: 'cortex', repository: REPO, branch: 'main' })
  return fakeGit({ files: { [STATE_PATHS.state]: serializeState(s), [STATE_PATHS.status]: renderStatus(s), [STATE_PATHS.handoff]: renderHandoff(s) }, branches: ['main', 'feat/parser'] })
}
const agent = tool => ({ tool, model: null })

test('Agent A checkpoints partway; Agent B resumes from GitHub alone, finishes, and the hub reports completion', async () => {
  const g = repoWithState()
  const head = sha('commit-1')

  // Agent A: begins T-1, checkpoints partial progress.
  await pushCheckpoint({ client: g.client, ...O, branch: 'main', projectId: 'cortex', expectedRevision: 0, agent: agent('Claude Code'), now: '2026-10-31T03:00:00Z', patch: {
    checkpointId: 'cp-a-000001',
    recorded: { branch: 'feat/parser', commit: head },
    development: { milestone: 'M1 parser', activeTask: { id: 'T-1', title: 'Add parser' }, workingBranch: 'feat/parser', lastCompleted: ['Tokenizer'], inProgress: ['Parser rules'], nextAction: 'Implement parser rules, then run npm test' },
    verification: { testsRun: [{ command: 'npm test', result: 'pass', commit: head, at: '2026-10-31T02:59:00Z', ciRunUrl: null }], unverifiedChanges: ['Parser rules untested'] },
    decisions: { made: [{ id: 'D-1', summary: 'Hand-written parser, no generator', decidedBy: 'agent', humanRef: null, recordedAt: '2026-10-31T02:30:00Z' }] },
    handoff: { unfinished: ['Parser rules'], blockers: [], continuation: 'Resume on feat/parser', uncommittedWorkOutsideCheckpoint: 'possible' }
  } })

  // Agent B: knows nothing about A except what the repository says.
  const state = await readState({ client: g.client, ...O, ref: 'main' })
  assert.deepEqual(validateState(state, { projectId: 'cortex' }), [])
  assert.equal(state.development.nextAction, 'Implement parser rules, then run npm test')
  assert.equal(state.handoff.lastAgent.tool, 'Claude Code')
  assert.equal(state.handoff.uncommittedWorkOutsideCheckpoint, 'possible')
  assert.equal(state.provenance.independentVerification, 'none', 'A\'s claims are not verification')
  // B validates branch/commit against GitHub before trusting it.
  const github = { defaultBranch: 'main', head: sha('commit-2'), branchExists: true, openPrs: [] }
  const flags = assess(state, github, new Date('2026-10-31T04:00:00Z')).flags
  assert.ok(flags.includes('uncommitted-work-possible'))

  // B finishes the task and writes a new checkpoint based on the revision it read.
  const done = sha('commit-2')
  await pushCheckpoint({ client: g.client, ...O, branch: 'main', projectId: 'cortex', expectedRevision: state.revision, agent: agent('Codex'), now: '2026-10-31T05:00:00Z', patch: {
    checkpointId: 'cp-b-000002',
    recorded: { branch: 'feat/parser', commit: done },
    development: { activeTask: null, lastCompleted: ['Tokenizer', 'Parser rules'], inProgress: [], nextAction: 'Start T-2: wire parser into CLI' },
    verification: { testsRun: [{ command: 'npm test', result: 'pass', commit: done, at: '2026-10-31T04:59:00Z', ciRunUrl: null }], unverifiedChanges: [] },
    handoff: { unfinished: [], continuation: null, uncommittedWorkOutsideCheckpoint: 'none' }
  } })

  // Hub aggregation sees B's state, B as last agent, and the A decision preserved.
  const hubClient = { get: (p, o) => g.client.get(p, o), paginate: async () => [] }
  const agg = await aggregate({ registry, client: hubClient, now: new Date('2026-10-31T06:00:00Z') })
  const p = agg.projects[0]
  assert.equal(p.status, 'ok')
  assert.equal(p.state.revision, 2)
  assert.equal(p.state.handoff.lastAgent.tool, 'Codex')
  assert.equal(p.state.development.activeTask, null)
  assert.deepEqual(p.state.development.lastCompleted, ['Tokenizer', 'Parser rules'])
  assert.equal(p.state.decisions.made[0].id, 'D-1')
  assert.ok(!p.flags.includes('old-test-evidence'))
  assert.match(renderAggregate(agg), /Start T-2/)
})

test('Agent B working from a stale read cannot overwrite A\'s newer checkpoint', async () => {
  const g = repoWithState()
  const mk = (id, tool, rev, next) => pushCheckpoint({ client: g.client, ...O, branch: 'main', projectId: 'cortex', expectedRevision: rev, agent: agent(tool), now: '2026-10-31T03:00:00Z', patch: { checkpointId: id, development: { nextAction: next } } })
  await mk('cp-a-000001', 'Claude Code', 0, 'A next')
  await assert.rejects(mk('cp-b-000002', 'Codex', 0, 'B next'), ConflictError)
  assert.equal((await readState({ client: g.client, ...O, ref: 'main' })).development.nextAction, 'A next')
})

test('negative: missing checkpoint, missing branch, failed CI and old test evidence are visible, never silent', async () => {
  const none = fakeGit()
  const hub = { get: (p, o) => none.client.get(p, o), paginate: async () => [] }
  assert.equal((await aggregate({ registry, client: hub })).projects[0].status, 'no-checkpoint')

  const g = repoWithState()
  await pushCheckpoint({ client: g.client, ...O, branch: 'main', projectId: 'cortex', expectedRevision: 0, agent: agent('Claude Code'), now: '2026-10-31T03:00:00Z', patch: {
    checkpointId: 'cp-a-000001', recorded: { branch: 'main', commit: sha('c1') }, development: { workingBranch: 'feat/gone', activePr: 4 },
    verification: { testsRun: [{ command: 'npm test', result: 'fail', commit: sha('older'), at: '2026-10-30T03:00:00Z', ciRunUrl: null }], unverifiedChanges: [] }
  } })
  const flags = (await aggregate({ registry, client: { get: (p, o) => g.client.get(p, o), paginate: async () => [] }, now: new Date('2026-10-31T06:00:00Z') })).projects[0].flags
  for (const f of ['working-branch-missing', 'active-pr-not-open', 'recorded-test-failure', 'old-test-evidence']) assert.ok(flags.includes(f), f)
})

test('negative: an agent cannot impersonate the human verifier or leak a secret through a checkpoint', async () => {
  const g = repoWithState()
  const go = (tool, patch) => pushCheckpoint({ client: g.client, ...O, branch: 'main', projectId: 'cortex', expectedRevision: 0, agent: agent(tool), now: '2026-10-31T03:00:00Z', patch: { checkpointId: 'cp-x-000001', ...patch } })
  await assert.rejects(go('Joshua Small', {}), /cannot record itself/)
  await assert.rejects(go('Claude Code', { decisions: { made: [{ id: 'D', summary: 'Release approved', decidedBy: 'human', humanRef: null, recordedAt: '2026-10-31T03:00:00Z' }] } }), /human decision must cite/)
  await assert.rejects(go('Claude Code', { development: { nextAction: 'export AWS key AKIAIOSFODNN7EXAMPLE' } }), /sensitive/)
  assert.equal(JSON.parse(g.st.commits[g.st.refs.main].files[STATE_PATHS.state]).revision, 0, 'nothing was written')
})
