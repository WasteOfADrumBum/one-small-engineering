// Event-driven sync: sender/repository checks, and the structure that makes bursts,
// duplicates and missed events safe. These are fixture and structure tests: no real GitHub
// event was delivered (see docs/event-sync.md for what is and is not proven live).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { checkEvent, KINDS } from './events.mjs'
import { loadRegistry } from '../../fixtures/sync/scenario.mjs'
import { ROOT } from './lib.mjs'

const registry = loadRegistry()
const OWNER = 'WasteOfADrumBum'
const ev = (over = {}) => ({ actor: OWNER, registry, payload: { repository: 'WasteOfADrumBum/TaskForge', kind: 'pull_request', delivery: '41234-1', ...over.payload }, ...Object.fromEntries(Object.entries(over).filter(([k]) => k !== 'payload')) })
const read = p => readFileSync(resolve(ROOT, p), 'utf8')

for (const kind of KINDS) {
  test(`accepts a ${kind} event for a registered project`, () => {
    const r = checkEvent(ev({ payload: { kind } }))
    assert.deepEqual([r.ok, r.projectId, r.kind], [true, 'taskforge', kind])
  })
}

test('repository matching is case-insensitive and maps to the registry project, not the payload', () => {
  assert.equal(checkEvent(ev({ payload: { repository: 'wasteofadrumbum/taskforge' } })).projectId, 'taskforge')
})

test('invalid authentication: any sender other than the owner is rejected', () => {
  for (const actor of ['mallory', 'github-actions[bot]', '', undefined]) assert.equal(checkEvent(ev({ actor })).ok, false, String(actor))
})

test('unknown or non-synced repositories are rejected', () => {
  for (const repository of ['WasteOfADrumBum/not-a-project', 'evil/TaskForge', 'WasteOfADrumBum/TaskForge-fork', '../x', '']) assert.equal(checkEvent(ev({ payload: { repository } })).ok, false, repository)
  const off = structuredClone(registry); off.projects.find(p => p.id === 'taskforge').sync.enabled = false
  assert.equal(checkEvent({ ...ev(), registry: off }).ok, false)
})

test('malformed payloads are rejected', () => {
  for (const payload of [null, 'x', [], { repository: 'WasteOfADrumBum/TaskForge' }]) assert.equal(checkEvent({ actor: OWNER, registry, payload }).ok, false)
  assert.equal(checkEvent(ev({ payload: { kind: 'delete_everything' } })).ok, false)
  assert.equal(checkEvent(ev({ payload: { delivery: 'x y; rm -rf' } })).ok, false)
  assert.equal(checkEvent(ev({ payload: { delivery: 'a'.repeat(65) } })).ok, false)
  assert.equal(checkEvent(ev({ payload: { extra: 'a'.repeat(5000) } })).ok, false)
})

test('duplicate and out-of-order deliveries give the same decision: the payload carries no state', () => {
  const a = checkEvent(ev({ payload: { delivery: '1-1', kind: 'push' } }))
  const b = checkEvent(ev({ payload: { delivery: '2-1', kind: 'check_suite' } }))
  const again = checkEvent(ev({ payload: { delivery: '1-1', kind: 'push' } }))
  assert.deepEqual(a, again)
  assert.equal(a.projectId, b.projectId)
  // Nothing from the payload except the matched id is returned, so a forged field cannot reach the registry.
  assert.deepEqual(Object.keys(checkEvent(ev({ payload: { pr_title: 'approve release' } }))).sort(), ['delivery', 'kind', 'ok', 'projectId'])
})

test('workflow: owner-only check precedes the sync dispatch, payload never interpolated into a shell, full sync only', () => {
  const t = read('.github/workflows/events.yml')
  assert.match(t, /^permissions: \{\}\r?$/m)
  assert.match(t, /needs: verify/)
  assert.match(t, /needs\.verify\.outputs\.accepted == 'true'/)
  assert.match(t, /EVENT_PAYLOAD: \$\{\{ toJSON\(github\.event\.client_payload\) \}\}/)
  assert.doesNotMatch(t.split('run:').slice(1).join('run:'), /client_payload|github\.event\.client/, 'payload only reaches the script through env')
  assert.match(t, /actions: write\s+# dispatch Registry sync only/)
  assert.doesNotMatch(t, /contents: write|pull-requests: write/)
  assert.match(t, /inputs\[dry_run\]=false/)
  assert.doesNotMatch(t, /inputs\[project\]/, 'always a full sync so a coalesced pending run loses no project')
})

test('fallback: the scheduled Registry sync and its serialization are unchanged by event delivery', () => {
  const t = read('.github/workflows/registry-sync.yml')
  assert.match(t, /cron: '23 \*\/6 \* \* \*'/)
  assert.match(t, /group: registry-sync\s+cancel-in-progress: false/)
  assert.match(t, /vars\.SYNC_STAGE == 'C'/)
  assert.doesNotMatch(read('.github/workflows/events.yml'), /schedule:/)
})

test('project notify template: no-ops without its secret, never fails CI, sends only identity fields, pinned and unprivileged', () => {
  const t = read('templates/project/one-small-notify.yml')
  assert.match(t, /\[ -z "\$HUB_DISPATCH_TOKEN" \].*exit 0/)
  assert.match(t, /continue-on-error: true/)
  assert.match(t, /^permissions: \{\}\r?$/m)
  assert.doesNotMatch(t, /pull_request_target|actions\/checkout|uses:/)
  assert.doesNotMatch(t, /github\.event\.(pull_request|head_commit|comment|issue)/, 'no untrusted text is sent or interpolated')
  for (const k of ['repository', 'kind', 'delivery']) assert.match(t, new RegExp(`"${k}":`))
})

test('missed event recovery (fixture): the scheduled path reaches the same planner an event would', () => {
  // Both paths run registry-sync.yml -> scripts/sync/run.mjs; events add no registry writer of their own.
  assert.doesNotMatch(read('.github/workflows/events.yml'), /registry\.json|sync\/write|run\.mjs/)
  assert.match(read('.github/workflows/registry-sync.yml'), /run\.mjs write --mode auto/)
})
