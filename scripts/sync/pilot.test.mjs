// ModsPack pilot against the in-memory GitHub: identity, observation, CI run ids and
// attempts, intact blockers, no readiness promotion, a correct proposal for a real change,
// no update on an unchanged rerun, and the write side (one draft PR, no duplicates).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runPilot, governanceView, renderPilot } from './pilot.mjs'
import { collectAll, processAll } from './run.mjs'
import { createClient } from './github.mjs'
import { validateRegistry, parseDefinitionOfDone } from '../validate-registry.mjs'
import { readJson, ROOT } from './lib.mjs'
import { FakeGitHub, projectRepo, hubRepo } from '../../fixtures/sync/fake-github.mjs'
import { loadRegistry, registryText, modspackState, NOW, fakeSha } from '../../fixtures/sync/scenario.mjs'

const schema = readJson('projects/registry.schema.json')
const dod = parseDefinitionOfDone(readFileSync(resolve(ROOT, 'standards/definition-of-done.md'), 'utf8'))
const validate = r => validateRegistry(r, schema, { dod })
const MP_HEAD = '367cede6ffba17de9bf2d3a20968a3e1cd1b3371'
const mpOf = r => r.projects.find(p => p.id === 'one-small-mods-pack')

function mpWorld(overrides = {}, { withHub = false } = {}) {
  const gh = new FakeGitHub()
  const state = projectRepo(gh, modspackState({ packageJson: { name: 'one-small-mods-pack', version: '0.1.0' }, ...overrides }))
  const hub = withHub ? hubRepo(gh, { registryText: registryText(), mainSha: fakeSha('main-pilot') }) : null
  const client = createClient({ token: 't', fetchImpl: gh.fetch, sleep: async () => {}, random: () => 0 })
  return { gh, state, hub, client }
}

// A real-looking change on ModsPack: main fast-forwards, CI is re-run (attempt 2), PR #3 is
// marked ready with a new head, and a release-candidate tag appears (no published release).
function changed(state) {
  const next = fakeSha('mp-next')
  state.headSha = next
  state.ancestry = { [MP_HEAD]: 'ahead' }
  state.runs = [{ id: 40100000001, run_attempt: 2, name: 'CI', path: '.github/workflows/ci.yml', head_sha: next, event: 'push', conclusion: 'success', updated_at: '2026-10-24T20:00:00Z' }]
  state.pulls = [{ number: 3, state: 'open', draft: false, title: 'One Small ModsPack 2.0: toolkit and pre-release verification', headSha: fakeSha('pr3-next') }]
  state.tagList = [{ name: 'v2.0.0-rc.1', sha: next }, { name: 'v0.1.0', sha: fakeSha('old') }]
  state.packageJson = { name: 'one-small-mods-pack', version: '2.0.0-rc.1' }
  return next
}

test('pilot: real-shaped ModsPack state passes all seven checks and writes nothing', async () => {
  const { gh, client } = mpWorld()
  const r = await runPilot({ registry: loadRegistry(), client, now: NOW, validate })
  assert.equal(r.passed, true, JSON.stringify(r.checks, null, 2))
  assert.equal(r.checks.length, 7)
  assert.ok(gh.calls.every(c => c.method === 'GET'), 'the pilot only reads')
  // First run against the committed registry is a bootstrap: new snapshot facts only.
  assert.equal(r.proposal.changed, true)
  assert.ok(r.proposal.changes.some(c => /Visibility recorded as public/.test(c)))
  assert.ok(r.proposal.changes.some(c => /Config source is now hub defaults/.test(c)))
  assert.equal(r.readiness.verdict, 'not-ready')
  assert.match(renderPilot(r), /Result: PASS \(7 of 7 checks\)/)
})

test('pilot: a meaningful ModsPack change gives the correct proposal and no governance change', async () => {
  const { state, client } = mpWorld()
  const next = changed(state)
  const r = await runPilot({ registry: loadRegistry(), client, now: NOW, validate })
  assert.equal(r.passed, true, JSON.stringify(r.checks, null, 2))
  const c = r.proposal.changes.join('\n')
  assert.match(c, new RegExp(`moved from 367cede to ${next.slice(0, 7)} \\(fast-forward\\)`))
  assert.match(c, /PR #3 marked ready for review/)
  assert.match(c, /PR #3 head moved/)
  assert.match(c, /Recorded CI: ci\.yml concluded success/)
  assert.match(c, /Latest version tag is v2\.0\.0-rc\.1/)
  assert.match(c, /package\.json at .*one-small-mods-pack@2\.0\.0-rc\.1/)
  // CI evidence names the run id (base 36) and the attempt.
  const ci = r.checks.find(x => x.name.startsWith('3.'))
  assert.match(ci.detail, /run 40100000001 attempt 2: success/)
  const rec = r.proposal.materialAfter.evidence.find(e => e.type === 'workflow_run')
  assert.equal(rec.eventKey, `one-small-mods-pack:workflow_run:ci.yml/${next.slice(0, 7)}/${(40100000001).toString(36)}/2`)
  assert.equal(rec.result, 'builder_reported')
  // Green CI and a release-candidate tag promote nothing.
  assert.equal(r.proposal.materialAfter.currentVersion, '0.1.0')
  assert.ok(r.proposal.suggestions.some(s => /automation will not/.test(s)))
  assert.ok(r.proposal.suggestions.some(s => /Tag v2\.0\.0-rc\.1 has no published GitHub release/.test(s)))
  assert.equal(r.readiness.verdict, 'not-ready')
  assert.equal(r.readiness.openBlockers.length, 7)
})

test('pilot: governance view covers blockers, gates, ownership, approval and manual evidence', () => {
  const p = mpOf(loadRegistry())
  const base = governanceView(p)
  const mutations = [
    q => { q.release.blockers[0].status = 'resolved' },
    q => { q.release.blockers.pop() },
    q => { q.releaseGates[0].status = 'verified' },
    q => { q.releaseGates.find(g => g.status === 'not_applicable').notes = 'changed' },
    q => { q.ownership.builder = 'Someone' },
    q => { q.approval.status = 'approved' },
    q => { q.evidence.find(e => e.origin !== 'sync').result = 'pass' },
    q => { q.release.releaseStatus = 'verified' },
    q => { q.tier = 'application' },
    q => { q.sync.repositoryId = 1 }
  ]
  for (const m of mutations) {
    const q = structuredClone(p)
    m(q)
    assert.notDeepEqual(governanceView(q), base, m.toString())
  }
})

test('pilot: an unchanged second run is a no-op; a moved head is not mistaken for a duplicate', async () => {
  const { client } = mpWorld()
  const r = await runPilot({ registry: loadRegistry(), client, now: NOW, validate })
  assert.match(r.checks[6].detail, /no material change/)
  // Re-planning the second observation against the applied proposal changes nothing at all.
  assert.equal(r.observations[1].head.relation, 'unchanged')
})

test('pilot: a force push on ModsPack main is reported as a rewrite with a re-check suggestion', async () => {
  const { state, client } = mpWorld()
  state.headSha = fakeSha('mp-rewritten')
  state.ancestry = { [MP_HEAD]: 'diverged' }
  const r = await runPilot({ registry: loadRegistry(), client, now: NOW, validate })
  assert.equal(r.passed, true)
  assert.ok(r.proposal.changes.some(c => /history was rewritten: 367cede is not an ancestor/.test(c)))
  assert.ok(r.proposal.suggestions.some(s => /Re-check the \d+ manual evidence record/.test(s)))
})

test('pilot write side: one draft ModsPack PR in the hub, nothing in ModsPack, no duplicate on rerun', async () => {
  const { gh, state, hub, client } = mpWorld({}, { withHub: true })
  changed(state)
  const registry = loadRegistry()
  const run = async now => {
    const collected = await collectAll({ registry, only: 'one-small-mods-pack', clients: { publicReader: client, privateReader: null }, now })
    return processAll({ registry, collected, mode: 'write', hubClient: client, mainSha: hub.refs['heads/main'], validate })
  }
  const [first] = await run(NOW)
  assert.equal(first.prAction, 'created')
  assert.deepEqual(hub.pulls.map(p => [p.head, p.draft, p.base]), [['sync/one-small-mods-pack', true, 'main']])
  assert.match(hub.pulls[0].body, /## Release readiness/)
  assert.match(hub.pulls[0].body, /Not ready/)
  const writes = gh.writes().length
  const [second] = await run(new Date(NOW.getTime() + 6 * 3600_000))
  assert.equal(second.prAction, 'unchanged')
  assert.equal(gh.writes().length, writes, 'an unchanged rerun sends no write')
  assert.equal(hub.pulls.length, 1, 'no duplicate PR')
  assert.equal(gh.writes().filter(c => /\/repos\/WasteOfADrumBum\/one-small-mods-pack\//.test(c.path)).length, 0, 'ModsPack is never written')
  assert.equal(hub.refs['heads/main'], fakeSha('main-pilot'), 'main is never written')
  const reg = JSON.parse(hub.commits[hub.refs['heads/sync/one-small-mods-pack']].registryText)
  assert.deepEqual(governanceView(mpOf(reg)), governanceView(mpOf(registry)))
})

test('pilot write side: recovery after the PR could not be created, then after its description update failed', async () => {
  const { gh, state, hub, client } = mpWorld({}, { withHub: true })
  changed(state)
  const registry = loadRegistry()
  const run = async now => {
    const collected = await collectAll({ registry, only: 'one-small-mods-pack', clients: { publicReader: client, privateReader: null }, now })
    return processAll({ registry, collected, mode: 'write', hubClient: client, mainSha: hub.refs['heads/main'], validate })
  }
  gh.failNext(/\/one-small-engineering\/pulls$/, 422, { body: { message: 'Validation Failed' } })
  const [failed] = await run(NOW)
  assert.equal(failed.outcome, 'error')
  assert.ok(hub.refs['heads/sync/one-small-mods-pack'], 'the branch was pushed before the PR failed')
  assert.equal(hub.pulls.length, 0)
  const [repaired] = await run(new Date(NOW.getTime() + 3600_000))
  assert.equal(repaired.prAction, 'repaired')
  assert.equal(hub.pulls.length, 1)
  // New facts: the branch moves, the description update fails, and the next run redoes only that.
  state.runs[0].run_attempt = 3
  gh.failNext(/\/one-small-engineering\/pulls\/\d+$/, 502, { times: 5 })
  const [metaFailed] = await run(new Date(NOW.getTime() + 2 * 3600_000))
  assert.equal(metaFailed.outcome, 'error')
  const head = hub.refs['heads/sync/one-small-mods-pack']
  assert.doesNotMatch(hub.pulls[0].body, new RegExp(head))
  const [fixed] = await run(new Date(NOW.getTime() + 3 * 3600_000))
  assert.equal(fixed.prAction, 'repaired')
  assert.match(hub.pulls[0].body, new RegExp(`sync-head: ${head}`))
  assert.equal(hub.pulls.length, 1, 'still exactly one PR')
})
