// One-command onboarding: existing and new projects, with no duplicate registration.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { onboard, OnboardError } from './onboard.mjs'
import { validateRegistry, parseDefinitionOfDone } from '../validate-registry.mjs'
import { readJson, ROOT } from './lib.mjs'
import { loadRegistry } from '../../fixtures/sync/scenario.mjs'

const schema = readJson('projects/registry.schema.json')
const dod = parseDefinitionOfDone(readFileSync(resolve(ROOT, 'standards/definition-of-done.md'), 'utf8'))
const valid = r => assert.deepEqual(validateRegistry(r, schema, { dod, now: new Date('2030-01-01T00:00:00Z') }), [])
const NOW = '2026-10-23T07:00:00Z'
// Every active project is onboarded on main now, so these tests start from a registry
// where the project has not been onboarded yet.
const unsynced = id => {
  const r = loadRegistry()
  delete r.projects.find(p => p.id === id).sync
  return r
}
const repo = (full, id, extra = {}) => ({ id, full_name: full, owner: { login: 'WasteOfADrumBum' }, default_branch: 'main', archived: false, ...extra })

test('enables sync for an existing project with only its id', () => {
  const r = onboard(unsynced('one-small-studio'), { projectId: 'one-small-studio', repo: repo('WasteOfADrumBum/one-small-studio', 555), now: NOW })
  const p = r.registry.projects.find(x => x.id === 'one-small-studio')
  assert.deepEqual(p.sync, { enabled: true, mode: 'observe', repositoryId: 555, lastSyncedAt: null, lastSyncedHead: null, configSource: null })
  assert.match(r.files['.github/one-small-engineering.json'], /"projectId": "one-small-studio"/)
  assert.match(r.files['.github/workflows/one-small-report.yml'], /^# one-small-report template v1/)
  assert.match(r.files['.github/workflows/one-small-report.yml'], /branches: \[main\]/)
  valid(r.registry)
})

test('the generated project config is the minimal form: nothing duplicated from the registry', () => {
  const r = onboard(unsynced('cortex'), { projectId: 'cortex', repo: repo('WasteOfADrumBum/cortex-brain-task', 777), now: NOW })
  const c = JSON.parse(r.files['.github/one-small-engineering.json'])
  assert.deepEqual(Object.keys(c).sort(), ['$schema', 'configVersion', 'projectId'])
})

test('scaffolds a new project with every tier gate not_verified and no builder or verifier', () => {
  const r = onboard(loadRegistry(), { projectId: 'new-site', isNew: true, name: 'New Site', repository: 'https://github.com/WasteOfADrumBum/new-site', tier: 'showcase', visibility: 'public', repo: repo('WasteOfADrumBum/new-site', 999), now: NOW })
  const p = r.registry.projects.at(-1)
  assert.equal(p.releaseGates.length, r.registry.gateCatalog.showcase.length)
  assert.ok(p.releaseGates.every(g => g.status === 'not_verified'))
  assert.deepEqual([p.ownership.builder, p.ownership.verifier], [null, null])
  valid(r.registry)
})

test('refuses duplicates, unclassified repos without --reclassify, wrong owners and re-pinning', () => {
  const reg = loadRegistry()
  assert.throws(() => onboard(reg, { projectId: 'taskforge', isNew: true, name: 'x', repository: 'https://github.com/WasteOfADrumBum/TaskForge', tier: 'application', visibility: 'public', repo: repo('WasteOfADrumBum/TaskForge', 1), now: NOW }), OnboardError)
  const other = reg.otherRepositories[0]
  const name = other.repository.split('/').pop()
  assert.throws(() => onboard(reg, { projectId: 'from-other', isNew: true, name: 'x', repository: other.repository, tier: 'showcase', visibility: 'private', repo: repo(`WasteOfADrumBum/${name}`, 2), now: NOW }), /--reclassify/)
  const moved = onboard(reg, { projectId: 'from-other', isNew: true, reclassify: true, name: 'x', repository: other.repository, tier: 'showcase', visibility: 'private', repo: repo(`WasteOfADrumBum/${name}`, 2), now: NOW })
  assert.ok(!moved.registry.otherRepositories.some(r => r.repository === other.repository))
  valid(moved.registry)
  assert.throws(() => onboard(reg, { projectId: 'one-small-studio', repo: { ...repo('WasteOfADrumBum/one-small-studio', 3), owner: { login: 'x' } }, now: NOW }), /owner/)
  assert.throws(() => onboard(reg, { projectId: 'taskforge', repo: repo('WasteOfADrumBum/TaskForge', 1), now: NOW }), /pins repository id/)
  assert.throws(() => onboard(reg, { projectId: 'Bad Id', repo: repo('x/y', 1), now: NOW }), /slug/)
})

test('switching a project to integrated keeps its pinned identity', () => {
  const r = onboard(loadRegistry(), { projectId: 'taskforge', mode: 'integrated', repo: repo('WasteOfADrumBum/TaskForge', 962181990), now: NOW })
  const p = r.registry.projects.find(x => x.id === 'taskforge')
  assert.equal(p.sync.mode, 'integrated')
  assert.equal(p.sync.repositoryId, 962181990)
})

test('an unpinned project (private, no reader yet) is pinned once; a pinned id is never replaced', () => {
  const reg = loadRegistry()
  assert.equal(reg.projects.find(p => p.id === 'one-small-ai-workforce').sync.repositoryId, null)
  const r = onboard(reg, { projectId: 'one-small-ai-workforce', repo: repo('WasteOfADrumBum/one-small-ai-workforce', 4242, { private: true }), now: NOW })
  assert.equal(r.project.sync.repositoryId, 4242)
  valid(r.registry)
  assert.throws(() => onboard(r.registry, { projectId: 'one-small-ai-workforce', repo: repo('WasteOfADrumBum/one-small-ai-workforce', 4343), now: NOW }), /investigate before re-pinning/)
})
