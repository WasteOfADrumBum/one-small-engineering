import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, utimesSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fixtureRegistry, realRegistry, policy, ev, fakeRunner, SHA, SHA2, AS_OF } from '../../fixtures/verify/helpers.mjs'
import { memoryView, withGitReader, gitReaderFrom, checkout } from '../verify/workspace.mjs'
import { advisoryDetails } from '../verify/collectors.mjs'
import { emptyState, observeRevision, trackFindings, recordReleaseState, acquireLock, loadState, saveState, checkState, StateError, LOCK_PATH } from './state.mjs'
import { readManifest, ownerRepoRefs } from './manifest.mjs'
import { relationships, dependencyImpact, releaseOrder } from './dependencies.mjs'
import { releaseState, checkTransition, approvalBinding, RELEASE_STATES } from './release.mjs'
import { advisoryIssues, collectorIssues, attachPullRequests, rankIssues, mergeAccessIssues, ownershipIssue } from './queue.mjs'
import { readOnlyClient, ReadOnlyViolation, refreshPlan, observeRevisions, syncDrift, pullRequestStatus } from './monitor.mjs'
import { createClient } from '../sync/github.mjs'

const R = 'https://github.com/WasteOfADrumBum/'
const pkg = (name, deps = {}, dev = {}, extra = {}) => JSON.stringify({ name, version: '1.0.0', dependencies: deps, devDependencies: dev, ...extra })

// ---- state, idempotency, locking ----

test('state: revision changes are detected once; repeating an observation is idempotent', () => {
  const s = emptyState()
  assert.deepEqual(observeRevision(s, 'x', { revision: SHA, at: '2026-10-27T01:00:00Z' }), { changed: false, first: true, previous: null })
  const again = observeRevision(s, 'x', { revision: SHA, at: '2026-10-27T02:00:00Z' })
  assert.equal(again.changed, false)
  const moved = observeRevision(s, 'x', { revision: SHA2, at: '2026-10-27T03:00:00Z' })
  assert.deepEqual(moved, { changed: true, first: false, previous: SHA })
  assert.equal(s.projects.x.previousRevision, SHA)
  assert.equal(s.projects.x.changedAt, '2026-10-27T03:00:00Z')
  // An unreachable repository keeps the last known revision and records why.
  observeRevision(s, 'x', { revision: null, access: 'network-error', accessReason: 'network error', at: '2026-10-27T04:00:00Z' })
  assert.equal(s.projects.x.revision, SHA2)
  assert.equal(s.projects.x.access, 'network-error')
})

test('state: findings keep first-seen across runs; fixed findings are dropped and come back as new', () => {
  const s = emptyState()
  const a = trackFindings(s, [{ id: 'p:a', project: 'p' }, { id: 'p:b', project: 'p' }], '2026-10-27T01:00:00Z')
  assert.deepEqual([...a.fresh].sort(), ['p:a', 'p:b'])
  const b = trackFindings(s, [{ id: 'p:a', project: 'p' }], '2026-10-27T02:00:00Z')
  assert.equal(b.fresh.size, 0)
  assert.deepEqual(b.resolved, ['p:b'])
  assert.equal(s.findings['p:a'].firstSeen, '2026-10-27T01:00:00Z')
  const c = trackFindings(s, [{ id: 'p:a', project: 'p' }, { id: 'p:b', project: 'p' }], '2026-10-27T03:00:00Z')
  assert.deepEqual([...c.fresh], ['p:b'])
})

test('state: release-state history records transitions only', () => {
  const s = emptyState()
  assert.equal(recordReleaseState(s, 'p', 'not_ready', 't1'), null)
  recordReleaseState(s, 'p', 'not_ready', 't2')
  assert.equal(recordReleaseState(s, 'p', 'blocked', 't3'), 'not_ready')
  assert.deepEqual(s.projects.p.history.map(h => h.state), ['not_ready', 'blocked'])
})

test('concurrency: a second run cannot take the lock; a stale lock from a crashed run is replaced', () => {
  const root = mkdtempSync(join(tmpdir(), 'ose-eng-lock-'))
  const release = acquireLock(root)
  assert.throws(() => acquireLock(root), StateError)
  release()
  const r2 = acquireLock(root)
  assert.ok(existsSync(join(root, LOCK_PATH)))
  const old = new Date(Date.now() - 4 * 3600 * 1000)
  utimesSync(join(root, LOCK_PATH), old, old)
  const r3 = acquireLock(root)
  r3(); r2()
})

test('recovery: a corrupt or invalid state file is refused with a restore instruction, never half-read', () => {
  const root = mkdtempSync(join(tmpdir(), 'ose-eng-state-'))
  saveState(root, emptyState())
  assert.deepEqual(loadState(root), emptyState())
  writeFileSync(join(root, 'engineering/state.json'), '{ not json')
  assert.throws(() => loadState(root), /git checkout -- engineering\/state.json/)
  writeFileSync(join(root, 'engineering/state.json'), JSON.stringify({ schema: 1, projects: { x: { revision: 'abc' } }, findings: {} }))
  assert.throws(() => loadState(root), /revision must be a full SHA/)
  assert.throws(() => saveState(root, { schema: 2, projects: {}, findings: {} }), /invalid state/)
  assert.ok(checkState(emptyState()).length === 0)
})

// ---- incremental refresh ----

test('incremental refresh: current evidence is reused; a new revision, stale, unavailable, other policy or missing execution re-collects', () => {
  const reg = fixtureRegistry()
  const pol = policy()
  const p = reg.projects.find(x => x.id === 'one-small-mods-pack')
  const only = ['one-small-mods-pack']
  const all = refreshPlan({ registry: reg, policy: pol, ledgers: new Map(), revisions: new Map(), asOf: AS_OF, only })
  const names = all.get('one-small-mods-pack')
  assert.ok(names.includes('build-test') && names.includes('dependency-audit'))
  const { COLLECTORS } = awaitCollectors
  const full = names.map(n => ev(COLLECTORS.find(c => c.name === n), 'pass', { execute: true }))
  const ledgers = new Map([['one-small-mods-pack', full]])
  const hash = 'f'.repeat(64)
  assert.equal(refreshPlan({ registry: reg, policy: pol, policyHash: hash, ledgers, revisions: new Map(), asOf: AS_OF, only }).size, 0, 'nothing to do when every collector is current')
  // An execute record satisfies a non-execute run, not the reverse.
  const noExec = new Map([['one-small-mods-pack', names.map(n => ev(COLLECTORS.find(c => c.name === n), 'pass', { execute: false }))]])
  assert.equal(refreshPlan({ registry: reg, policy: pol, policyHash: hash, ledgers: noExec, revisions: new Map(), asOf: AS_OF, only }).size, 0)
  assert.ok(refreshPlan({ registry: reg, policy: pol, policyHash: hash, ledgers: noExec, revisions: new Map(), asOf: AS_OF, only, execute: true }).get('one-small-mods-pack').length > 0)
  // A policy change invalidates the evidence.
  assert.equal(refreshPlan({ registry: reg, policy: pol, policyHash: '0'.repeat(64), ledgers, revisions: new Map(), asOf: AS_OF, only }).get('one-small-mods-pack').length, names.length)
  // Stale (expired) evidence is refreshed.
  assert.ok(refreshPlan({ registry: reg, policy: pol, policyHash: hash, ledgers, revisions: new Map(), asOf: new Date('2026-12-30T00:00:00Z'), only }).get('one-small-mods-pack').length > 0)
  // Unavailable is always retried.
  const unav = new Map([['one-small-mods-pack', [...full, ev(COLLECTORS.find(c => c.name === 'ci-results'), 'unavailable', { at: '2026-10-27T01:30:00Z' })]]])
  assert.deepEqual(refreshPlan({ registry: reg, policy: pol, policyHash: hash, ledgers: unav, revisions: new Map(), asOf: AS_OF, only }).get('one-small-mods-pack'), ['ci-results'])
  // A project on its default branch follows the live revision: evidence for an older commit is not current.
  const ui = reg.projects.find(x => x.id === 'one-small-ui')
  const uiNames = refreshPlan({ registry: reg, policy: pol, ledgers: new Map(), revisions: new Map(), asOf: AS_OF, only: ['one-small-ui'] }).get('one-small-ui')
  const uiLedger = new Map([['one-small-ui', uiNames.map(n => ev(COLLECTORS.find(c => c.name === n), 'pass', { commitSha: SHA, project: 'one-small-ui' }))]])
  assert.equal(refreshPlan({ registry: reg, policy: pol, policyHash: hash, ledgers: uiLedger, revisions: new Map([['one-small-ui', SHA]]), asOf: AS_OF, only: ['one-small-ui'] }).size, 0)
  assert.equal(refreshPlan({ registry: reg, policy: pol, policyHash: hash, ledgers: uiLedger, revisions: new Map([['one-small-ui', SHA2]]), asOf: AS_OF, only: ['one-small-ui'] }).get('one-small-ui').length, uiNames.length)
  assert.ok(p && ui)
})
const awaitCollectors = await import('../verify/collectors.mjs')

test('monitoring: revisions come from git; a private repository without a reader is recorded as not visible, never as empty', () => {
  const reg = realRegistry()
  const repos = {}
  for (const p of reg.projects.filter(p => p.tier !== 'legacy')) repos[p.repository] = { sha: SHA, private: p.visibility !== 'public' }
  const run = fakeRunner({ repos })
  const s = emptyState()
  const r = observeRevisions({ registry: reg, state: s, run, at: '2026-10-27T01:00:00Z' })
  assert.equal(r.access.get('one-small-ai-workforce').access, 'not-visible')
  assert.equal(r.access.get('taskforge').access, 'ok')
  assert.equal(s.projects['one-small-ai-workforce'].revision, null)
  // ModsPack is evaluated on its candidate branch, not main.
  assert.ok(run.calls.some(c => c.args.includes('refs/heads/modspack-2-0')))
})

// ---- read-only enforcement, API failures, rate limits ----

test('unauthorized writes: the monitoring client refuses every method but GET', async () => {
  const calls = []
  const client = readOnlyClient({ request: async (m, p) => { calls.push(`${m} ${p}`); return {} }, paginate: async () => [] })
  await assert.rejects(() => client.request('POST', '/repos/a/b/pulls'), ReadOnlyViolation)
  await assert.rejects(() => client.request('PUT', '/repos/a/b/pulls/1/merge'), ReadOnlyViolation)
  await assert.rejects(() => client.request('DELETE', '/repos/a/b/git/refs/heads/x'), ReadOnlyViolation)
  await assert.rejects(() => client.request('PATCH', '/repos/a/b'), ReadOnlyViolation)
  await client.get('/repos/a/b')
  assert.deepEqual(calls, ['GET /repos/a/b'])
})

const fakeFetch = handler => async (url, init) => { const r = handler(url, init); return { ok: r.status < 400, status: r.status, headers: new Map(Object.entries(r.headers || {})), text: async () => r.body || '' } }

test('GitHub API failures and rate limits leave PR status unknown with a reason; nothing is inferred', async () => {
  const prs = [{ url: `${R}TaskForge/pull/43`, project: 'taskforge', covers: ['taskforge:advisory'] }]
  let n = 0
  const limited = createClient({ token: 't', maxRetries: 1, baseDelayMs: 1, sleep: async () => {}, fetchImpl: fakeFetch(() => { n++; return { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1' }, body: '{"message":"API rate limit exceeded"}' } }) })
  const out = await pullRequestStatus({ client: readOnlyClient(limited), prs, now: '2026-10-27T01:00:00Z' })
  assert.equal(out[0].status, 'unknown')
  assert.ok(out[0].reason)
  assert.ok(n >= 2, 'rate-limited calls are retried a bounded number of times')
  const down = createClient({ token: 't', maxRetries: 1, baseDelayMs: 1, sleep: async () => {}, fetchImpl: fakeFetch(() => ({ status: 502, body: 'bad gateway' })) })
  const out2 = await pullRequestStatus({ client: readOnlyClient(down), prs: [{ ...prs[0], status: 'draft' }], now: 'x' })
  assert.equal(out2[0].status, 'draft', 'last known status kept')
  assert.ok(out2[0].reason)
  const none = await pullRequestStatus({ client: null, prs, now: 'x' })
  assert.match(none[0].reason, /not reachable/)
  // Live answer: open, unreviewed draft.
  const ok = createClient({ token: 't', fetchImpl: fakeFetch(url => ({ status: 200, body: url.endsWith('/reviews?per_page=100') ? '[]' : JSON.stringify({ state: 'open', draft: true, merged_at: null, head: { sha: SHA } }) })) })
  const out3 = await pullRequestStatus({ client: readOnlyClient(ok), prs, now: 'x' })
  assert.deepEqual([out3[0].status, out3[0].reviewed], ['draft', false])
})

test('missing private-repository credential: sync drift reports the private project as needing a reader, not in sync', async () => {
  const reg = realRegistry()
  const failing = readOnlyClient(createClient({ token: '', maxRetries: 0, fetchImpl: fakeFetch(() => ({ status: 404, body: '{}' })) }))
  const out = await syncDrift({ registry: reg, clients: { publicReader: failing, privateReader: null }, now: new Date('2026-10-27T01:00:00Z') })
  const aiw = out['one-small-ai-workforce']
  if (aiw) { assert.equal(aiw.status, 'unavailable'); assert.match(aiw.reason, /reader/) }
  for (const v of Object.values(out)) assert.notEqual(v.status, 'in-sync')
})

// ---- manifests and dependencies ----

test('manifests: names, workspace packages, locked versions and owner repository references', () => {
  const view = memoryView({
    'package.json': pkg('@x/app', { next: '^15.0.0', '@onesmall/ui': '^0.5.0' }, { vitest: '^1.0.0' }, { engines: { node: '>=24' } }),
    'packages/core/package.json': pkg('@x/core'),
    'package-lock.json': JSON.stringify({ packages: { 'node_modules/next': { version: '15.1.0' }, 'node_modules/vitest': { version: '1.6.0' } } }),
    '.github/workflows/ci.yml': 'jobs:\n  a:\n    steps:\n      - uses: actions/checkout@v4\n      - uses: WasteOfADrumBum/one-small-ui/.github/actions/x@main\n'
  })
  const m = readManifest(view, SHA)
  assert.deepEqual(m.packages.map(p => p.name), ['@x/app', '@x/core'])
  assert.deepEqual(m.locked, { next: '15.1.0', vitest: '1.6.0' })
  assert.deepEqual(m.repoRefs, ['wasteofadrumbum/one-small-ui'])
  assert.deepEqual(ownerRepoRefs('"github:WasteOfADrumBum/cortex-brain-task#main" https://github.com/someone/else'), ['wasteofadrumbum/cortex-brain-task'])
  assert.equal(readManifest(view, SHA).digest, m.digest, 'deterministic')
})

function depFixture() {
  const reg = realRegistry()
  const manifests = new Map([
    ['one-small-ui', readManifest(memoryView({ 'package.json': pkg('@onesmall/ui', { react: '^19.0.0' }) }), SHA)],
    ['personal-portfolio', readManifest(memoryView({ 'package.json': pkg('joshsmall-site', { '@onesmall/ui': '^0.5.0', next: '15.0.0', react: '^19.0.0' }), 'package-lock.json': JSON.stringify({ packages: { 'node_modules/next': { version: '15.0.0' } } }) }), SHA)],
    // Name similarity only: depends on "one-small-ui-kit", which no registry project publishes.
    ['one-small-studio', readManifest(memoryView({ 'package.json': pkg('one-small-studio', { 'one-small-ui-kit': '^1.0.0', next: '14.2.0', react: '^18.0.0' }) }), SHA)],
    ['taskforge', readManifest(memoryView({ 'package.json': pkg('taskforge', { next: '15.0.0' }), '.github/workflows/ci.yml': 'uses: WasteOfADrumBum/cortex-brain-task/.github/workflows/x.yml@main' }), SHA)]
  ])
  return { reg, manifests }
}

test('dependencies: confirmed from manifests, workflows and evidenced declarations; never from name similarity', () => {
  const { reg, manifests } = depFixture()
  const edges = relationships(reg, manifests)
  const key = e => `${e.from}>${e.to}:${e.kind}:${e.confirmed}`
  const keys = edges.map(key)
  assert.ok(keys.includes('personal-portfolio>one-small-ui:manifest:true'))
  assert.ok(keys.includes('taskforge>cortex:ci:true'))
  assert.ok(keys.includes('cortex>one-small-ui:declared:true'), 'registry declaration with evidence')
  assert.ok(!edges.some(e => e.from === 'one-small-studio' && e.to === 'one-small-ui'), 'one-small-ui-kit is not One Small UI')
  // A declaration without evidence is only suspected.
  const r2 = structuredClone(reg)
  r2.projects.find(p => p.id === 'cortex').dependencies[0].evidenceRefs = ['nope']
  const sus = relationships(r2, manifests).find(e => e.from === 'cortex' && e.to === 'one-small-ui' && e.kind === 'declared')
  assert.equal(sus.confirmed, false)
})

test('dependency impact: a changed library flags its confirmed dependents for re-verification; shared advisories and divergence are reported', () => {
  const { reg, manifests } = depFixture()
  const advisories = new Map([['personal-portfolio', [{ name: 'next', severity: 'critical', production: true, fix: 'available' }]], ['taskforge', [{ name: 'next', severity: 'high', production: true, fix: 'available' }]]])
  const out = dependencyImpact({ registry: reg, manifests, changed: new Map([['one-small-ui', { from: SHA, to: SHA2 }]]), advisories, asOf: AS_OF })
  const fu = out.followUps.map(f => f.project).sort()
  assert.deepEqual(fu, ['cortex', 'personal-portfolio'])
  const shared = out.risks.find(r => r.kind === 'shared-advisory' && r.package === 'next')
  assert.deepEqual(shared.projects.sort(), ['personal-portfolio', 'taskforge'])
  assert.equal(shared.severity, 'critical')
  assert.ok(out.risks.some(r => r.kind === 'version-divergence' && r.package === 'react'))
  assert.equal(out.runtimeFloors['one-small-ui'], null)
  assert.ok(out.manifestsMissing.includes('one-small-ai-workforce'), 'unread manifests are unknown, not absent')
  assert.deepEqual(releaseOrder(['a', 'b'], [{ from: 'a', to: 'b', confirmed: true, requiredForRelease: true }]), ['b', 'a'])
})

// ---- advisory triage, prioritization, deduplication ----

test('advisory triage: production exposure and fix type decide priority and action, not the raw severity alone', () => {
  const report = { vulnerabilities: { next: { name: 'next', severity: 'critical', isDirect: true, fixAvailable: true }, vitest: { name: 'vitest', severity: 'critical', isDirect: true, fixAvailable: { name: 'vitest', version: '3.0.0', isSemVerMajor: true } }, zod: { name: 'zod', severity: 'high', isDirect: false, fixAvailable: false }, ms: { name: 'ms', severity: 'low' } } }
  const prod = { vulnerabilities: { next: {}, zod: {} } }
  const adv = advisoryDetails(report, prod)
  assert.deepEqual(adv.map(a => [a.name, a.production, a.fix]), [['next', true, 'available'], ['vitest', false, 'major'], ['zod', true, 'none']])
  const p = realRegistry().projects.find(x => x.id === 'personal-portfolio')
  const rec = { id: 'ev-1', commitSha: SHA, details: { advisories: adv, productionAudit: 'ran' } }
  const issues = advisoryIssues(p, rec)
  const by = Object.fromEntries(issues.map(i => [i.id.split(':').pop(), i]))
  assert.equal(by['critical-production'].priority, 1)
  assert.equal(by['critical-production'].actionClass, 'automatic')
  assert.deepEqual(by['critical-production'].autoFix, { type: 'npm-audit-fix', packages: ['next'] })
  assert.equal(by['critical-dev'].priority, 4, 'dev-only critical is not ranked as a production critical')
  assert.equal(by['critical-dev'].actionClass, 'owner-decision', 'a major upgrade is a decision, not an automatic fix')
  assert.equal(by['high-production'].autoFix, null, 'no published fix: no automatic change')
  assert.match(by['high-production'].proposedCorrection, /No fix published/)
})

test('prioritization: security, then broken builds, release blockers, vulnerabilities, compatibility, accessibility, verification, debt', () => {
  const reg = realRegistry()
  const mk = (id, priority, severity, project = 'taskforge') => ({ id, project, projects: [project], priority, severity, relatedPRs: [], crossProject: [] })
  const ranked = rankIssues([mk('d', 8, 'low'), mk('a', 7, 'high'), mk('b', 1, 'critical'), mk('c', 2, 'high'), mk('e', 4, 'high'), mk('f', 4, 'critical'), mk('g', 6, 'medium'), mk('h', 5, 'medium'), mk('i', 3, 'high')], reg)
  assert.deepEqual(ranked.map(i => i.id), ['b', 'c', 'i', 'f', 'e', 'h', 'g', 'a', 'd'])
  assert.deepEqual(ranked.map(i => i.rank), [1, 2, 3, 4, 5, 6, 7, 8, 9])
  // Same input in another order: same queue.
  assert.deepEqual(rankIssues([...ranked].reverse().map(({ rank, priorityText, actionText, ...i }) => i), reg).map(i => i.id), ranked.map(i => i.id))
})

test('collector findings map to the right class; a secret-scan failure is critical security', () => {
  const p = realRegistry().projects.find(x => x.id === 'taskforge')
  const f = (collector, kind, extra = {}) => ({ collector, kind, commitSha: SHA, evidenceId: `ev-${collector}`, gates: ['automated-checks'], title: `${collector} ${kind}`, releaseImpact: 'x', failureReason: kind === 'access' ? 'network error reaching github.com' : 'r', rootCause: null, verification: [], acceptance: 'a', ...extra })
  const v = { findings: [f('secret-scan', 'defect'), f('build-test', 'defect'), f('accessibility', 'evidence-gap', { failureReason: 'manual review by a person' }), f('ci-results', 'access'), f('documentation', 'access')] }
  const out = collectorIssues(p, v)
  const get = id => out.find(i => i.id === id)
  assert.equal(get('taskforge:collector:secret-scan').priority, 1)
  assert.equal(get('taskforge:collector:secret-scan').severity, 'critical')
  assert.equal(get('taskforge:collector:build-test').priority, 2)
  assert.equal(get('taskforge:collector:accessibility').actionClass, 'independent-verification')
  const access = out.filter(i => i.kind === 'access')
  assert.equal(access.length, 1, 'access problems with one cause are one issue per project')
  assert.equal(access[0].actionClass, 'blocked-credentials')
})

test('deduplication: one id per underlying issue; shared environment problems merge; covered issues are not fixed twice', () => {
  const reg = realRegistry()
  const a = (project) => ({ id: `${project}:access:ci-results`, project, projects: [project], kind: 'access', accessReason: 'GitHub API not reachable', collectors: ['ci-results'], priority: 7, severity: 'medium', evidence: [`ev-${project}`], relatedPRs: [], crossProject: [] })
  const merged = mergeAccessIssues([a('taskforge'), a('cortex'), a('one-small-ui')])
  assert.equal(merged.length, 1)
  assert.deepEqual(merged[0].projects, ['taskforge', 'cortex', 'one-small-ui'])
  const dup = rankIssues([a('taskforge'), a('taskforge')], reg)
  assert.equal(dup.length, 1)
  const issue = { id: 'taskforge:advisory:high-production', project: 'taskforge', projects: ['taskforge'], revision: SHA, autoFix: { type: 'npm-audit-fix', packages: ['zod'] }, actionClass: 'automatic', relatedPRs: [], crossProject: [] }
  attachPullRequests([issue], [{ url: `${R}TaskForge/pull/43`, covers: ['taskforge:advisory'], status: 'draft', reviewed: false, openedFor: SHA2 }])
  assert.equal(issue.autoFix, null)
  assert.equal(issue.actionClass, 'owner-decision')
  assert.match(issue.nextAction, /pull\/43.*earlier commit/)
  // A merged PR no longer suppresses a finding that is still present.
  const again = { ...issue, autoFix: { type: 'npm-audit-fix', packages: ['zod'] }, actionClass: 'automatic', relatedPRs: [] }
  attachPullRequests([again], [{ url: `${R}TaskForge/pull/43`, covers: ['taskforge:advisory'], status: 'merged' }])
  assert.equal(again.actionClass, 'automatic')
  assert.equal(ownershipIssue(reg)[0].projects.length, 8, 'one owner action, one portfolio issue')
})

// ---- release states and approvals ----

function releaseFixture({ verified = true, releaseStatus = 'in_progress', approval = null, evidenceCommit = SHA, recordedBy = 'Joshua Small', blockers = [], findings = [] } = {}) {
  const reg = fixtureRegistry()
  const p = reg.projects.find(x => x.id === 'one-small-mods-pack')
  p.release.releaseStatus = releaseStatus
  if (approval) {
    p.evidence.push({ id: 'owner-approval', type: 'pr_review', url: `${R}one-small-mods-pack/pull/3#pullrequestreview-1`, commitSha: evidenceCommit, verifiedAt: '2026-10-27T01:00:00Z', result: 'pass', description: 'approval', recordedBy })
    p.approval = { status: 'approved', approvedBy: approval, approvedAt: '2026-10-27T01:00:00Z', evidenceRefs: ['owner-approval'] }
  }
  const readiness = { prePublication: { applicable: 10, verified: verified ? 10 : 3 }, ownershipValid: true, releaseReady: verified, candidateMoved: false, eligibility: verified ? 'release-ready' : 'not-eligible' }
  const v = { findings, blockers, target: { sha: SHA }, gates: [], readiness: { percentage: 0 } }
  const engine = { derived: { readiness }, facts: { ownership: p.ownership } }
  return { p, v, engine, approvalOwner: reg.approvalOwner }
}

test('release states follow evidence: blocked, verification required, candidate ready, awaiting approval, approved', () => {
  assert.equal(releaseState({ ...releaseFixture({ blockers: [{ id: 'x', origin: 'registry', category: 'manual', description: 'd' }] }) }).state, 'blocked')
  assert.equal(releaseState({ ...releaseFixture({ findings: [{ kind: 'defect', severity: 'high', collector: 'build-test' }] }) }).state, 'blocked')
  assert.equal(releaseState({ ...releaseFixture(), access: 'not-visible' }).state, 'blocked')
  assert.equal(releaseState({ ...releaseFixture({ verified: false }) }).state, 'verification_required')
  assert.equal(releaseState({ ...releaseFixture() }).state, 'candidate_ready')
  assert.equal(releaseState({ ...releaseFixture({ releaseStatus: 'ready_for_review' }) }).state, 'awaiting_approval')
  assert.equal(releaseState({ ...releaseFixture({ releaseStatus: 'verified', approval: 'Joshua Small' }) }).state, 'approved')
  // Not scoped: not ready, whatever else is true.
  const f = releaseFixture()
  f.p.release.scopeDocument = null
  assert.equal(releaseState(f).state, 'not_ready')
})

test('forged or misbound approvals never reach Approved for Release', () => {
  const forged = [
    releaseFixture({ releaseStatus: 'verified', approval: 'Claude Code' }),
    releaseFixture({ releaseStatus: 'verified', approval: 'Joshua Small', recordedBy: 'One Small Engineering Sync' }),
    releaseFixture({ releaseStatus: 'verified', approval: 'Joshua Small', evidenceCommit: SHA2 })
  ]
  for (const f of forged) assert.equal(releaseState(f).state, 'awaiting_approval')
  assert.match(releaseState(forged[2]).reasons.join(' '), /not the candidate/)
  const noEvidence = releaseFixture({ releaseStatus: 'verified', approval: 'Joshua Small' })
  noEvidence.p.approval.evidenceRefs = []
  assert.equal(releaseState(noEvidence).state, 'awaiting_approval')
  assert.equal(approvalBinding(noEvidence.p, null).bound, false)
})

test('Released also needs an approval bound to the released commit, not only Phase 3 eligibility', () => {
  const released = over => {
    const f = releaseFixture({ releaseStatus: 'released', approval: 'Joshua Small', ...over })
    f.engine.derived.readiness.eligibility = 'released'
    return f
  }
  assert.equal(releaseState(released()).state, 'released')
  // Phase 3 says released, but the approval evidence names another commit (Codex review finding 1).
  const misbound = releaseState(released({ evidenceCommit: SHA2 }))
  assert.equal(misbound.state, 'blocked')
  assert.equal(misbound.approval.bound, false)
  assert.match(misbound.reasons.join(' '), /without an approval bound to the released commit.*not the candidate/)
  const noCandidate = released()
  noCandidate.p.release.candidate = null
  assert.equal(releaseState(noCandidate).state, 'blocked')
  assert.equal(releaseState(released({ approval: 'Claude Code' })).state, 'blocked')
})

test('release transitions: forward steps need evidence; owner-only states cannot be skipped to', () => {
  assert.equal(checkTransition('verification_required', 'candidate_ready').ok, true)
  assert.equal(checkTransition('candidate_ready', 'approved').ok, false)
  assert.equal(checkTransition('awaiting_approval', 'approved').ok, false)
  assert.equal(checkTransition('awaiting_approval', 'approved', { approvalValid: true, approvalBound: true }).ok, true)
  assert.equal(checkTransition('approved', 'released', { approvalValid: true }).ok, false)
  assert.equal(checkTransition('approved', 'released', { approvalValid: true, registryReleased: true }).ok, true)
  assert.equal(checkTransition('not_ready', 'approved').ok, false)
  assert.equal(checkTransition('approved', 'blocked').ok, true, 'regressions are always reportable')
  assert.equal(checkTransition('x', 'nope').ok, false)
  assert.equal(RELEASE_STATES.length, 7)
})

test('the reader credential reaches git only, as a header, and never a run that executes project code', () => {
  const calls = []
  const base = (cmd, args, opts = {}) => { calls.push({ cmd, args, env: opts.env || {} }); return { status: 0, stdout: cmd === 'git' && args[0] === 'rev-parse' ? `${SHA}\n` : '', stderr: '' } }
  assert.equal(withGitReader(base, ''), base)
  const run = withGitReader(base, 'reader-token-value')
  checkout(run, 'https://github.com/WasteOfADrumBum/private-repo', SHA, mkdtempSync(join(tmpdir(), 'ose-reader-')))
  run('npm', ['audit', '--json'], { env: { CI: 'true' } })
  const git = calls.filter(c => c.cmd === 'git')
  assert.ok(git.length >= 4)
  for (const c of git) {
    assert.equal(c.env.GIT_CONFIG_KEY_0, 'http.https://github.com/.extraheader')
    assert.equal(c.env.GIT_CONFIG_VALUE_0, `AUTHORIZATION: basic ${Buffer.from('x-access-token:reader-token-value').toString('base64')}`)
    assert.ok(!c.args.join(' ').includes('reader-token-value'), 'never in arguments or the remote URL')
  }
  const npm = calls.find(c => c.cmd === 'npm')
  assert.deepEqual(npm.env, { CI: 'true' })
  assert.equal(gitReaderFrom({ SYNC_READER_TOKEN: 'x' }), 'x')
  assert.equal(gitReaderFrom({ READER_TOKEN: 'y', SYNC_READER_TOKEN: 'x' }), 'y')
  assert.equal(gitReaderFrom({ SYNC_READER_TOKEN: 'x' }, { execute: true }), '')
})
