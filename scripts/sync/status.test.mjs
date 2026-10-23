// Status report tests: last successful sync, changes, errors and outstanding PRs, in words.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderStatus, parseState, renderPrBody } from './status.mjs'

const ok = { projectId: 'taskforge', outcome: 'changed', changes: ['Recorded CI: ci.yml concluded success at 11975d0.'], suggestions: ['CI passed; verifier may re-check.'], notes: [], errors: [], pr: { number: 7, url: 'https://github.com/WasteOfADrumBum/one-small-engineering/pull/7' }, prAction: 'created' }
const bad = { projectId: 'one-small-mods-pack', outcome: 'error', changes: [], suggestions: [], notes: [], errors: ['repo-unreachable: not found'], pr: null, prAction: null }

test('renders every required section with text statuses', () => {
  const { markdown } = renderStatus({ runAt: '2026-10-23T06:23:00Z', trigger: 'schedule', mode: 'write', results: [ok, bad], openSyncPrs: [{ number: 7, url: ok.pr.url, title: 'sync(taskforge): registry update', branch: 'sync/taskforge', draft: true, updatedAt: '2026-10-23T06:23:00Z' }] })
  for (const h of ['# Registry sync status', '## Summary', '## Detected changes', '## Errors', '## Outstanding registry PRs', '## Suggested manual updates']) assert.ok(markdown.includes(h), h)
  assert.match(markdown, /\| taskforge \| Changes found \| 2026-10-23T06:23:00Z \| 0 \| \[PR #7\]/)
  assert.match(markdown, /\| one-small-mods-pack \| Error \| Never \| 1 \| None \|/)
  assert.match(markdown, /repo-unreachable/)
  assert.match(markdown, /\| \[PR #7\]\(.*\): sync\(taskforge\): registry update \| sync\/taskforge \| Yes \|/)
  assert.doesNotMatch(markdown, /[\u{1F300}-\u{1FAFF}✅❌]/u, 'no emoji-only status')
})

test('history persists across runs: last success kept, failures counted, attention after three', () => {
  let body = ''
  for (let i = 1; i <= 3; i++) {
    const results = [ok, bad].map(r => ({ ...r }))
    body = renderStatus({ runAt: `2026-10-2${i}T00:00:00Z`, trigger: 'schedule', mode: 'dry-run', results, previous: parseState(body) }).markdown
  }
  const state = parseState(body)
  assert.equal(state.projects.taskforge.lastSuccessAt, '2026-10-23T00:00:00Z')
  assert.equal(state.projects['one-small-mods-pack'].consecutiveFailures, 3)
  assert.equal(state.projects['one-small-mods-pack'].lastSuccessAt, null)
  assert.match(body, /Attention: one-small-mods-pack failed three or more runs in a row/)
  const recovered = renderStatus({ runAt: '2026-10-24T00:00:00Z', trigger: 'schedule', mode: 'dry-run', results: [{ ...bad, outcome: 'unchanged', errors: [] }], previous: state })
  assert.equal(recovered.state.projects['one-small-mods-pack'].consecutiveFailures, 0)
})

test('a corrupt state comment is ignored rather than crashing', () => {
  assert.deepEqual(parseState('<!-- registry-sync-state:!!!notbase64 -->'), { projects: {} })
  assert.deepEqual(parseState('<!-- registry-sync-state:bm90IGpzb24= -->'), { projects: {} })
})

test('PR body follows the template sections and says nothing is verified', () => {
  const body = renderPrBody({ projectId: 'taskforge', result: { changes: ['a'], suggestions: [], notes: [] }, observation: { repo: { fullName: 'WasteOfADrumBum/TaskForge', url: 'https://github.com/WasteOfADrumBum/TaskForge' }, head: { sha: 'a'.repeat(40) }, collectedAt: '2026-10-23T00:00:00Z' } })
  for (const h of ['## Summary', '## Reason for change', '## Registry entries modified', '## Verification evidence', '## Human approval requirement', '## Unresolved findings']) assert.ok(body.includes(h), h)
  assert.match(body, /None of them can verify a gate/)
})
