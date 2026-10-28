// Field-ownership guard: every manual field is protected, on the sync job and in CI.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { guardRegistryChange, guardPaths, projectIdFromBranch } from './guard.mjs'
import { plan } from './plan.mjs'
import { collect } from './collect.mjs'
import { ROOT, serializeRegistry } from './lib.mjs'
import { world, loadRegistry, NOW } from '../../fixtures/sync/scenario.mjs'

const tf = r => r.projects.find(p => p.id === 'taskforge')

async function legit() {
  const base = loadRegistry()
  const { client } = world()
  const obs = await collect({ project: tf(base), client, now: NOW })
  return { base, head: plan(base, obs).registry }
}

function rejects(base, head, fragment, projectId = 'taskforge') {
  const errors = guardRegistryChange(base, head, projectId)
  assert.ok(errors.some(e => e.includes(fragment)), `expected "${fragment}" in:\n${errors.join('\n')}`)
}

test('a planner-produced change passes', async () => {
  const { base, head } = await legit()
  assert.deepEqual(guardRegistryChange(base, head, 'taskforge'), [])
})

test('manual project fields are protected', async () => {
  const cases = [
    [p => { p.releaseGates[0].status = 'verified' }, 'releaseGates'],
    [p => { p.release.blockers = [] }, 'release.blockers'],
    [p => { p.release.releaseStatus = 'released' }, 'release.releaseStatus'],
    [p => { p.release.targetVersion = '9.9.9' }, 'release.targetVersion'],
    [p => { p.ownership.verifier = 'Someone' }, 'ownership'],
    [p => { p.approval.status = 'approved' }, 'approval'],
    [p => { p.lifecycle = 'maintenance' }, 'lifecycle'],
    [p => { p.tier = 'showcase' }, 'tier'],
    [p => { p.modsPack.integrationStatus = 'planned' }, 'modsPack'],
    [p => { p.missingEvidence = [] }, 'missingEvidence'],
    [p => { p.lastVerifiedAt = '2026-10-23T00:00:00Z' }, 'lastVerifiedAt'],
    [p => { p.sync.repositoryId = 5 }, 'sync.repositoryId'],
    [p => { p.sync.mode = 'integrated' }, 'sync.mode'],
    [p => { p.sync.enabled = false }, 'sync.enabled'],
    [p => { p.evidence[0].result = 'pass' }, 'manual evidence'],
    [p => { p.evidence.push({ ...p.evidence[0], id: 'tf-new-manual' }) }, 'manual evidence'],
    [p => { p.evidence.reverse() }, 'manual evidence']
  ]
  for (const [mutate, fragment] of cases) {
    const { base, head } = await legit()
    mutate(tf(head))
    rejects(base, head, fragment)
  }
})

test('other projects and top-level fields are protected', async () => {
  let { base, head } = await legit()
  head.projects.find(p => p.id === 'cortex').nextAction = 'changed'
  rejects(base, head, 'only taskforge may change')
  ;({ base, head } = await legit())
  head.gateCatalog.showcase.pop()
  rejects(base, head, '$.gateCatalog')
  ;({ base, head } = await legit())
  head.otherRepositories.pop()
  rejects(base, head, '$.otherRepositories')
  ;({ base, head } = await legit())
  head.projects.pop()
  rejects(base, head, 'cannot add, remove or reorder')
  ;({ base, head } = await legit())
  head.lastUpdatedAt = '2020-01-01T00:00:00Z'
  rejects(base, head, 'backwards')
})

test('automated records are immutable, cannot pass, and cited ones cannot be removed', async () => {
  let { base, head } = await legit()
  const rec = tf(head).evidence.find(e => e.origin === 'sync')
  rec.result = 'pass'
  rejects(base, head, 'cannot have result pass')
  ;({ base, head } = await legit())
  const b2 = structuredClone(head)
  tf(b2).releaseGates[1].evidenceRefs = ['sync-taskforge-run-ci-yml-11975d0-2t-1']
  const h2 = structuredClone(b2)
  tf(h2).evidence = tf(h2).evidence.filter(e => e.origin !== 'sync')
  rejects(b2, h2, 'cited record cannot be removed')
  const h3 = structuredClone(b2)
  tf(h3).evidence.find(e => e.origin === 'sync').description = 'edited'
  rejects(b2, h3, 'immutable')
})

test('currentVersion changes need forward movement and a backing release record', async () => {
  let { base, head } = await legit()
  tf(head).release.currentVersion = '1.0.0'
  tf(head).release.currentVersionSource = 'typed by hand'
  rejects(base, head, 'must cite a sync release evidence record')
  ;({ base, head } = await legit())
  tf(base).release.currentVersion = '2.0.0'
  tf(head).release.currentVersion = '1.0.0'
  rejects(base, head, 'forward')
  ;({ base, head } = await legit())
  tf(head).release.currentVersionSource = 'changed'
  rejects(base, head, 'unless currentVersion changes')
})

test('paths and branch names', () => {
  assert.deepEqual(guardPaths(['projects/registry.json']), [])
  assert.equal(guardPaths(['projects/registry.json', '.github/workflows/validate.yml', 'scripts/sync/guard.mjs']).length, 2)
  assert.equal(projectIdFromBranch('sync/taskforge'), 'taskforge')
  for (const bad of ['main', 'sync/', 'sync/Bad', 'sync/a/b', 'sync/../main', 'refs/heads/sync/x']) assert.throws(() => projectIdFromBranch(bad))
})

test('CLI guard on a real git history: passes a sync change, fails an extra file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'guard-'))
  for (const d of ['projects', 'sync', 'scripts', 'schemas', 'standards', 'verification']) cpSync(resolve(ROOT, d), join(dir, d), { recursive: true })
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } })
  git('init', '-q', '-b', 'main')
  git('add', '.')
  git('commit', '-qm', 'base')
  git('checkout', '-qb', 'sync/taskforge')
  const { head } = await legit()
  writeFileSync(join(dir, 'projects/registry.json'), serializeRegistry(head))
  git('commit', '-qam', 'sync')
  const run = () => execFileSync(process.execPath, [join(dir, 'scripts/sync/guard.mjs'), '--base', 'main', '--branch', 'sync/taskforge'], { cwd: dir, encoding: 'utf8', stdio: 'pipe' })
  assert.match(run(), /sync-guard: OK/)
  mkdirSync(join(dir, '.github'), { recursive: true })
  writeFileSync(join(dir, '.github/evil.yml'), 'x')
  git('add', '.')
  git('commit', '-qm', 'extra')
  assert.throws(run, e => /automated sync may only change/.test(e.stderr))
})
