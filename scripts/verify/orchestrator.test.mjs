import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { collect, chooseTarget, applicableGates, collectorsFor } from './orchestrator.mjs'
import { checkEvidence } from './evidence.mjs'
import { apiClients } from './cli.mjs'
import { fakeRunner, realRegistry, policy, SHA } from '../../fixtures/verify/helpers.mjs'

const pol = policy()
const PKG = JSON.stringify({ name: 'x', version: '1.0.0', license: 'MIT', scripts: { build: 'b', test: 't' }, engines: { node: '>=22' } })
const files = { 'package.json': PKG, 'package-lock.json': '{}', 'README.md': '# x\n## Install\n' + 'a\n'.repeat(12) }

function setup({ registry = realRegistry(), repos, commands = {}, execute = false, times = ['2026-10-27T01:00:00Z'] } = {}) {
  const run = fakeRunner({ repos, commands })
  let i = 0
  const deps = { run, github: null, fetch: null, now: () => new Date(times[Math.min(i++, times.length - 1)]), workRoot: mkdtempSync(join(tmpdir(), 'ose-orch-')), execute, provenance: { executor: 'fixture', invokedBy: 'test' }, installTools: null }
  return { registry, run, deps }
}

const repoUrl = id => realRegistry().projects.find(p => p.id === id).repository

test('applicable gates follow the tier; not_applicable needs a rationale', () => {
  const r = realRegistry()
  const msp = r.projects.find(p => p.id === 'one-small-mods-pack')
  assert.equal(applicableGates(r, msp).length, 21)
  assert.ok(!applicableGates(r, msp).includes('production-deployment'))
  assert.equal(applicableGates(r, r.projects.find(p => p.id === 'personal-portfolio')).length, 10)
  const names = collectorsFor(pol, applicableGates(r, r.projects.find(p => p.id === 'personal-portfolio'))).map(c => c.name)
  assert.ok(!names.includes('release-packaging'), 'showcase tier has no packaging gates')
  assert.ok(names.includes('repo-structure'))
})

test('target: the registry candidate wins and drift is reported; else the live head', () => {
  const r = realRegistry()
  const msp = r.projects.find(p => p.id === 'one-small-mods-pack')
  const t = chooseTarget(msp, { sha: SHA })
  assert.equal(t.sha, msp.release.candidate.headSha)
  assert.match(t.drift, /owner update/)
  const studio = r.projects.find(p => p.id === 'one-small-studio')
  assert.equal(chooseTarget(studio, { sha: SHA }).sha, SHA)
  assert.match(chooseTarget(studio, { sha: SHA }).drift, /registry sync refreshes it/)
  assert.equal(chooseTarget(studio, {}).source, 'registry snapshot (live head unavailable)')
})

test('inaccessible private repository: every collector reports unavailable, nothing passes', async () => {
  const { registry, deps } = setup({ repos: {} })
  const out = await collect({ registry, policy: pol, policyHash: 'h', profiles: { projects: {} }, ledgers: new Map(), projectIds: ['one-small-ai-workforce'], deps })
  const log = out.log[0]
  assert.equal(log.access, 'not-visible')
  const ev = out.ledgers.get('one-small-ai-workforce')
  assert.ok(ev.length > 5)
  for (const e of ev) {
    assert.deepEqual(checkEvidence(e), [])
    assert.ok(['unavailable', 'not_applicable', 'inconclusive'].includes(e.result), `${e.collector.name} ${e.result}`)
    assert.notEqual(e.result, 'pass')
  }
})

test('network failure is reported as unavailable, not as absence', async () => {
  const url = repoUrl('cortex')
  const { registry, deps } = setup({ repos: { [url]: { network: true } } })
  const out = await collect({ registry, policy: pol, policyHash: 'h', profiles: { projects: {} }, ledgers: new Map(), projectIds: ['cortex'], deps })
  assert.equal(out.log[0].access, 'network-error')
  assert.ok(out.ledgers.get('cortex').every(e => e.result !== 'pass'))
})

test('public repository: checks out the exact commit, collects, and is incremental on rerun', async () => {
  const url = repoUrl('personal-portfolio')
  const { registry, run, deps } = setup({ repos: { [url]: { sha: SHA, files } } })
  const first = await collect({ registry, policy: pol, policyHash: 'h', profiles: { projects: {} }, ledgers: new Map(), projectIds: ['personal-portfolio'], deps })
  const ev = first.ledgers.get('personal-portfolio')
  assert.equal(first.targets.get('personal-portfolio').sha, SHA)
  assert.ok(ev.every(e => e.commitSha === SHA))
  assert.ok(run.calls.some(c => c.cmd === 'git' && c.args[0] === 'fetch' && c.args.at(-1) === SHA))
  const fetches = run.calls.filter(c => c.args[0] === 'fetch').length
  const second = await collect({ registry, policy: pol, policyHash: 'h', profiles: { projects: {} }, ledgers: first.ledgers, projectIds: ['personal-portfolio'], deps })
  const wasUnavailable = new Set(first.log[0].collectors.filter(c => c.result === 'unavailable').map(c => c.name))
  assert.ok(second.log[0].collectors.filter(c => !wasUnavailable.has(c.name)).every(c => c.reused), 'unchanged inputs are not collected twice')
  assert.ok(second.log[0].collectors.filter(c => wasUnavailable.has(c.name)).every(c => !c.reused), 'unavailable is retried')
  assert.ok(run.calls.filter(c => c.args[0] === 'fetch').length <= fetches + 1)
  assert.deepEqual(second.ledgers.get('personal-portfolio').filter(e => e.result !== 'unavailable'), ev.filter(e => e.result !== 'unavailable'))
  // A policy change invalidates the cache.
  const third = await collect({ registry, policy: pol, policyHash: 'changed', profiles: { projects: {} }, ledgers: first.ledgers, projectIds: ['personal-portfolio'], deps })
  assert.ok(third.log[0].collectors.every(c => !c.reused))
  // --full ignores the cache.
  const full = await collect({ registry, policy: pol, policyHash: 'h', profiles: { projects: {} }, ledgers: first.ledgers, projectIds: ['personal-portfolio'], deps, incremental: false })
  assert.ok(full.log[0].collectors.every(c => !c.reused))
})

test('unavailable results are always retried (safe retries)', async () => {
  const url = repoUrl('personal-portfolio')
  const { registry, deps } = setup({ repos: { [url]: { sha: SHA, files } } })
  const first = await collect({ registry, policy: pol, policyHash: 'h', profiles: { projects: {} }, ledgers: new Map(), projectIds: ['personal-portfolio'], deps })
  const dep = first.log[0].collectors.find(c => c.name === 'deployment-health')
  assert.equal(dep.result, 'unavailable')
  const again = await collect({ registry, policy: pol, policyHash: 'h', profiles: { projects: {} }, ledgers: first.ledgers, projectIds: ['personal-portfolio'], deps })
  assert.equal(again.log[0].collectors.find(c => c.name === 'deployment-health').reused, false)
})

test('a commit change makes earlier evidence stale and forces collection', async () => {
  const url = repoUrl('personal-portfolio')
  const a = setup({ repos: { [url]: { sha: SHA, files } } })
  const first = await collect({ registry: a.registry, policy: pol, policyHash: 'h', profiles: { projects: {} }, ledgers: new Map(), projectIds: ['personal-portfolio'], deps: a.deps })
  const b = setup({ repos: { [url]: { sha: 'c'.repeat(40), files } } })
  const second = await collect({ registry: b.registry, policy: pol, policyHash: 'h', profiles: { projects: {} }, ledgers: first.ledgers, projectIds: ['personal-portfolio'], deps: b.deps })
  assert.ok(second.log[0].collectors.every(c => !c.reused))
  assert.ok(second.ledgers.get('personal-portfolio').some(e => e.commitSha === 'c'.repeat(40)))
})

test('a collector that throws is recorded as inconclusive, never as a pass', async () => {
  const url = repoUrl('personal-portfolio')
  const { registry, deps } = setup({ repos: { [url]: { sha: SHA, files: { ...files, 'package.json': '{' } } } })
  const out = await collect({ registry, policy: pol, policyHash: 'h', profiles: { projects: {} }, ledgers: new Map(), projectIds: ['personal-portfolio'], onlyCollectors: ['repo-structure', 'documentation'], deps })
  for (const e of out.ledgers.get('personal-portfolio')) assert.notEqual(e.result, 'pass', e.collector.name)
})

test('project code runs only with execution enabled, with a scrubbed environment', async () => {
  const url = repoUrl('personal-portfolio')
  const { registry, run, deps } = setup({ repos: { [url]: { sha: SHA, files } }, execute: true })
  await collect({ registry, policy: pol, policyHash: 'h', profiles: { projects: {} }, ledgers: new Map(), projectIds: ['personal-portfolio'], onlyCollectors: ['build-test'], deps })
  const npm = run.calls.filter(c => c.cmd === 'npm')
  assert.deepEqual(npm.map(c => c.args.join(' ')), ['ci --ignore-scripts', 'run build', 'test'])
  for (const c of npm) assert.ok(!c.env || !('GITHUB_TOKEN' in c.env))
  const off = setup({ repos: { [url]: { sha: SHA, files } }, execute: false })
  await collect({ registry: off.registry, policy: pol, policyHash: 'h', profiles: { projects: {} }, ledgers: new Map(), projectIds: ['personal-portfolio'], onlyCollectors: ['build-test'], deps: off.deps })
  assert.equal(off.run.calls.filter(c => c.cmd === 'npm').length, 0)
})

test('governance fields are never touched: the registry object is unchanged by collection', async () => {
  const url = repoUrl('personal-portfolio')
  const { registry, deps } = setup({ repos: { [url]: { sha: SHA, files } } })
  const before = JSON.stringify(registry)
  await collect({ registry, policy: pol, policyHash: 'h', profiles: { projects: {} }, ledgers: new Map(), deps })
  assert.equal(JSON.stringify(registry), before)
})

test('CI collection for a private project uses the reader credential, a public one the job token (Codex review finding 2)', async () => {
  const seen = []
  const fetchImpl = async (url, init) => { seen.push({ url, auth: init.headers.authorization }); return new Response(JSON.stringify({ total_count: 0, check_runs: [] }), { status: 200, headers: { 'content-type': 'application/json' } }) }
  const env = { GITHUB_TOKEN: 'fake-hub-token', SYNC_READER_TOKEN: 'fake-reader-token' }
  const reposFor = ids => Object.fromEntries(ids.map(id => [repoUrl(id), { sha: SHA }]))
  const ciRun = async (ids, clients, execute = false) => {
    const { registry, deps } = setup({ repos: reposFor(ids), execute })
    Object.assign(deps, clients)
    seen.length = 0
    await collect({ registry, policy: pol, policyHash: 'h', profiles: { projects: {} }, ledgers: new Map(), projectIds: ids, onlyCollectors: ['ci-results'], deps })
    return seen.map(s => [s.url.match(/repos\/[^/]+\/([^/]+)/)[1], s.auth])
  }
  assert.deepEqual(await ciRun(['one-small-ai-workforce', 'cortex'], apiClients(env, { fetchImpl })), [['cortex-brain-task', 'Bearer fake-hub-token'], ['one-small-ai-workforce', 'Bearer fake-reader-token']])
  // A run that executes project code never holds the reader, for the API as for git.
  assert.deepEqual(await ciRun(['one-small-ai-workforce'], apiClients(env, { fetchImpl, execute: true }), true), [['one-small-ai-workforce', 'Bearer fake-hub-token']])
  // Without a reader the job token is tried and the result is reported, never a silent pass.
  assert.deepEqual(await ciRun(['one-small-ai-workforce'], apiClients({ GITHUB_TOKEN: 'fake-hub-token' }, { fetchImpl })), [['one-small-ai-workforce', 'Bearer fake-hub-token']])
  assert.equal(apiClients(env, { network: false }).githubFor({ visibility: 'private' }), null)
})
