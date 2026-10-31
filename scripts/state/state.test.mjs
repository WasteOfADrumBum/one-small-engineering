// State contract tests: validation, optimistic concurrency, GitHub-native writer, aggregation.
// GitHub is an in-memory fake git repository (refs, commits, trees, blobs); no network.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { GitHubError } from '../sync/github.mjs'
import { initialState, validateState, applyCheckpoint, renderStatus, renderHandoff, serializeState, assess, ConflictError, StateError, UnsupportedVersion, STATE_PATHS } from './lib.mjs'
import { pushCheckpoint } from './push.mjs'
import { aggregate, renderAggregate } from './aggregate.mjs'
import { fakeGit } from './fake-git.mjs'

const NOW = '2026-10-31T05:00:00Z'
const REPO = 'https://github.com/WasteOfADrumBum/cortex-brain-task'
const sha = s => createHash('sha1').update(s).digest('hex')
const base = () => initialState({ projectId: 'cortex', repository: REPO, branch: 'main' })
const claude = { tool: 'Claude Code', model: 'sonnet' }
const patchA = id => ({ checkpointId: id, recorded: { branch: 'feat/x', commit: sha('c1') }, development: { milestone: 'M1', activeTask: { id: 'T-1', title: 'Add parser' }, workingBranch: 'feat/x', nextAction: 'Write parser tests' } })

const seeded = (state = base()) => fakeGit({ files: { [STATE_PATHS.state]: serializeState(state), [STATE_PATHS.status]: renderStatus(state), [STATE_PATHS.handoff]: renderHandoff(state) } })
const push = (g, patch, expectedRevision, extra = {}) => pushCheckpoint({ client: g.client, owner: 'WasteOfADrumBum', repo: 'cortex-brain-task', branch: 'main', patch, expectedRevision, agent: claude, now: NOW, projectId: 'cortex', ...extra })

test('a new record is valid, all-unknown, and never claims verification', () => {
  const s = base()
  assert.deepEqual(validateState(s, { projectId: 'cortex' }), [])
  assert.equal(s.provenance.independentVerification, 'none')
  assert.equal(s.development.nextAction, null)
})

test('checkpoint advances revision and records agent, time and where it came from', () => {
  const { state, changed } = applyCheckpoint(base(), patchA('cp-aaaaaa'), { expectedRevision: 0, agent: claude, now: NOW })
  assert.equal(changed, true)
  assert.equal(state.revision, 1)
  assert.equal(state.handoff.lastAgent.tool, 'Claude Code')
  assert.equal(state.handoff.persistedBy, 'local-file')
  assert.equal(state.development.nextAction, 'Write parser tests')
})

test('stale expected revision is a conflict and changes nothing', () => {
  const one = applyCheckpoint(base(), patchA('cp-aaaaaa'), { expectedRevision: 0, agent: claude, now: NOW }).state
  assert.throws(() => applyCheckpoint(one, patchA('cp-bbbbbb'), { expectedRevision: 0, agent: { tool: 'Codex', model: null }, now: NOW }), ConflictError)
})

test('a repeated checkpoint id is an idempotent no-op', () => {
  const one = applyCheckpoint(base(), patchA('cp-aaaaaa'), { expectedRevision: 0, agent: claude, now: NOW }).state
  const again = applyCheckpoint(one, patchA('cp-aaaaaa'), { expectedRevision: 0, agent: claude, now: NOW })
  assert.equal(again.changed, false)
  assert.equal(again.state.revision, 1)
})

test('invalid or unsafe checkpoints are rejected', () => {
  const go = patch => applyCheckpoint(base(), { checkpointId: 'cp-aaaaaa', ...patch }, { expectedRevision: 0, agent: claude, now: NOW })
  assert.throws(() => go({ development: { activePr: 'not a number' } }), StateError, 'schema')
  assert.throws(() => go({ provenance: { independentVerification: 'verified' } }), /not a checkpoint field/)
  assert.throws(() => go({ revision: 99 }), /not a checkpoint field/)
  assert.throws(() => go({ development: { nextAction: 'use token ghp_abcdefghijklmnopqrstuvwxyz0123456789ABCD' } }), /sensitive/)
  assert.throws(() => go({ development: { lastCompleted: ['Independently verified by Joshua'] } }), /independent verification/)
  assert.throws(() => go({ decisions: { made: [{ id: 'd1', summary: 'ship it', decidedBy: 'human', humanRef: null, recordedAt: NOW }] } }), /human decision must cite/)
  assert.throws(() => applyCheckpoint(base(), { checkpointId: 'cp-aaaaaa' }, { expectedRevision: 0, agent: { tool: 'Joshua Small', model: null }, now: NOW }), /cannot record itself as a human/)
  assert.throws(() => applyCheckpoint(base(), { checkpointId: 'cp-aaaaaa' }, { expectedRevision: 0, agent: { tool: 'Verifier', model: null }, now: NOW }), /cannot record itself/)
})

test('unsupported schema version fails loudly, unknown project is refused', () => {
  assert.throws(() => validateState({ ...base(), stateVersion: 2 }), UnsupportedVersion)
  assert.ok(validateState(base(), { projectId: 'taskforge' }).some(e => /projectId/.test(e)))
  assert.ok(validateState({ ...base(), extra: 1 }).length)
})

test('writer: one commit with state and both views; main fast-forwards', async () => {
  const g = seeded()
  const r = await push(g, patchA('cp-aaaaaa'), 0)
  assert.equal(r.action, 'written')
  const files = g.st.commits[g.st.refs.main].files
  const s = JSON.parse(files[STATE_PATHS.state])
  assert.equal(s.revision, 1)
  assert.equal(s.handoff.persistedBy, 'github-api')
  assert.match(files[STATE_PATHS.handoff], /Write parser tests/)
  assert.equal(files[STATE_PATHS.status], renderStatus(s))
})

test('writer: two agents from the same revision, only the first wins; the loser can re-read and succeed', async () => {
  const g = seeded()
  await push(g, patchA('cp-aaaaaa'), 0)
  await assert.rejects(push(g, { checkpointId: 'cp-bbbbbb', development: { nextAction: 'other' } }, 0, { agent: { tool: 'Codex', model: null } }), ConflictError)
  const head = JSON.parse(g.st.commits[g.st.refs.main].files[STATE_PATHS.state])
  assert.equal(head.development.nextAction, 'Write parser tests', 'first agent\'s work survives')
  const r = await push(g, { checkpointId: 'cp-bbbbbb', development: { nextAction: 'other' } }, head.revision, { agent: { tool: 'Codex', model: null } })
  assert.equal(r.action, 'written')
})

test('writer: branch moved between read and ref update is a conflict, nothing lost', async () => {
  const g = seeded()
  g.st.failRefUpdate = 1
  await assert.rejects(push(g, patchA('cp-aaaaaa'), 0), ConflictError)
  assert.equal(JSON.parse(g.st.commits[g.st.refs.main].files[STATE_PATHS.state]).revision, 0)
  assert.equal((await push(g, patchA('cp-aaaaaa'), 0)).action, 'written', 'an interrupted handoff is simply retried')
})

test('writer: duplicate update, missing branch, missing state, unauthorized', async () => {
  const g = seeded()
  await push(g, patchA('cp-aaaaaa'), 0)
  assert.equal((await push(g, patchA('cp-aaaaaa'), 0)).action, 'unchanged')
  await assert.rejects(push(g, patchA('cp-cccccc'), 1, { branch: 'nope' }), /does not exist/)
  await assert.rejects(push(fakeGit(), patchA('cp-cccccc'), 0), /no \.engineering\/state\.json/)
  const denied = { ...g.client, request: async (m, p, o) => { if (m !== 'GET') throw new GitHubError('x', 403, ''); return g.client.request(m, p, o) } }
  await assert.rejects(pushCheckpoint({ client: denied, owner: 'WasteOfADrumBum', repo: 'cortex-brain-task', branch: 'main', patch: patchA('cp-dddddd'), expectedRevision: 1, agent: claude, now: NOW }), GitHubError)
})

test('assess flags stale commit, old tests, failed tests, missing branch, closed PR, unknown work, blockers', () => {
  let s = base()
  s = applyCheckpoint(s, { checkpointId: 'cp-aaaaaa', recorded: { branch: 'main', commit: sha('c1') }, development: { workingBranch: 'feat/x', activePr: 7 }, verification: { testsRun: [{ command: 'npm test', result: 'fail', commit: sha('older'), at: NOW, ciRunUrl: null }] }, handoff: { blockers: ['needs API key'], uncommittedWorkOutsideCheckpoint: 'possible' } }, { expectedRevision: 0, agent: claude, now: NOW }).state
  const f = assess(s, { defaultBranch: 'main', head: sha('moved'), branchExists: false, openPrs: [] }, new Date('2026-10-31T06:00:00Z')).flags
  for (const x of ['behind-default-branch', 'working-branch-missing', 'active-pr-not-open', 'recorded-test-failure', 'old-test-evidence', 'blocked', 'uncommitted-work-possible']) assert.ok(f.includes(x), x)
  assert.ok(assess(s, null, new Date('2026-12-31T00:00:00Z')).flags.includes('stale-checkpoint'))
  assert.ok(assess(base(), null).flags.includes('never-checkpointed'))
})

test('aggregation: checkpoint projects shown, observe-mode projects reported without error', async () => {
  const g = seeded()
  await push(g, patchA('cp-aaaaaa'), 0)
  const mixed = {
    get: async (p, o) => /cortex-brain-task/.test(p) ? g.client.get(p, o) : (/\/git\/ref\/heads\/main$/.test(p) ? { object: { sha: sha('h') } } : /^\/repos\/[^/]+\/[^/]+$/.test(p) ? { default_branch: 'main' } : null),
    paginate: async () => []
  }
  const reg = { projects: [{ id: 'cortex', repository: REPO }, { id: 'taskforge', repository: 'https://github.com/WasteOfADrumBum/TaskForge' }] }
  const agg = await aggregate({ registry: reg, client: mixed, now: new Date('2026-10-31T06:00:00Z') })
  assert.equal(agg.projects[0].status, 'ok')
  assert.equal(agg.projects[0].state.development.activeTask.id, 'T-1')
  assert.equal(agg.projects[1].status, 'no-checkpoint')
  const md = renderAggregate(agg)
  assert.match(md, /Add parser/)
  assert.match(md, /1 of 2 projects have no checkpoint/)
})

test('aggregation: invalid, wrong-project and unsupported-version files surface as states, an outage as unavailable', async () => {
  const bad = (content) => ({ get: async p => (/contents/.test(p) ? { content: Buffer.from(content).toString('base64'), size: content.length } : /git\/ref/.test(p) ? { object: { sha: sha('h') } } : { default_branch: 'main' }), paginate: async () => [] })
  const proj = [{ id: 'cortex', repository: REPO }]
  assert.equal((await aggregate({ registry: { projects: proj }, client: bad('{not json') })).projects[0].status, 'invalid')
  assert.equal((await aggregate({ registry: { projects: proj }, client: bad(JSON.stringify({ ...base(), stateVersion: 9 })) })).projects[0].status, 'unsupported-version')
  assert.equal((await aggregate({ registry: { projects: proj }, client: bad(JSON.stringify({ ...base(), projectId: 'taskforge' })) })).projects[0].status, 'invalid')
  const down = { get: async () => { throw new GitHubError('x', 503, '') }, paginate: async () => [] }
  assert.equal((await aggregate({ registry: { projects: proj }, client: down })).projects[0].status, 'unavailable')
})
