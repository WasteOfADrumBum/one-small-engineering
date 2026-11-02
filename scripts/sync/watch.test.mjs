import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectChanges, readLive, chooseTokens } from './watch.mjs'

const proj = (id, head, prs = [], enabled = true) => ({ id, sync: { enabled }, repositorySnapshot: { headSha: head }, openPullRequests: prs.map(([number, headSha]) => ({ number, headSha })) })
const registry = { projects: [proj('a', 'h1', [[1, 'p1']]), proj('b', 'h2'), proj('off', 'h3', [], false)] }
const same = { a: { head: 'h1', openPullRequests: [{ number: 1, headSha: 'p1' }] }, b: { head: 'h2', openPullRequests: [] } }

test('no difference means no sync', () => {
  assert.deepEqual(detectChanges(registry, same), { changed: [], unreadable: [] })
})
test('a new default-branch head is a change', () => {
  assert.deepEqual(detectChanges(registry, { ...same, b: { head: 'h9', openPullRequests: [] } }).changed, ['b'])
})
test('a pushed, opened or closed pull request is a change', () => {
  assert.deepEqual(detectChanges(registry, { ...same, a: { head: 'h1', openPullRequests: [{ number: 1, headSha: 'p2' }] } }).changed, ['a'])
  assert.deepEqual(detectChanges(registry, { ...same, b: { head: 'h2', openPullRequests: [{ number: 5, headSha: 'x' }] } }).changed, ['b'])
  assert.deepEqual(detectChanges(registry, { ...same, a: { head: 'h1', openPullRequests: [] } }).changed, ['a'])
})
test('an unreadable project is reported, never treated as changed', () => {
  assert.deepEqual(detectChanges(registry, { ...same, b: null }), { changed: [], unreadable: ['b'] })
})
test('projects with sync disabled are ignored', () => {
  // The disabled project differs live and is unreadable in another case: neither counts.
  assert.deepEqual(detectChanges(registry, { ...same, off: { head: 'h-moved', openPullRequests: [{ number: 9, headSha: 'z' }] } }), { changed: [], unreadable: [] })
  assert.deepEqual(detectChanges(registry, { ...same, off: null }), { changed: [], unreadable: [] })
})

// GitHub Copilot review of PR #45, 2026-11-02.
test('public repositories use the job token; the reader secret is only for private ones', () => {
  assert.deepEqual(chooseTokens({ token: 'job', reader: 'reader' }), { publicToken: 'job', privateToken: 'reader' })
  assert.deepEqual(chooseTokens({ token: 'job', reader: '' }), { publicToken: 'job', privateToken: null })
  assert.deepEqual(chooseTokens({ token: '', reader: 'reader' }), { publicToken: 'reader', privateToken: 'reader' })
})

test('a truncated open pull request list makes the project unreadable, never changed', async () => {
  const reg = { projects: [{ id: 'a', repository: 'https://github.com/WasteOfADrumBum/a', sync: { enabled: true }, repositorySnapshot: { headSha: 'h1', defaultBranch: 'main', visibility: 'public' }, openPullRequests: [] }] }
  const client = {
    get: async () => ({ commit: { sha: 'h1' } }),
    paginate: async () => Object.defineProperty([{ number: 1, head: { sha: 'p' } }], 'truncated', { value: true })
  }
  const live = await readLive(reg, { publicClient: client, privateClient: null })
  assert.equal(live.a, null)
  assert.deepEqual(detectChanges(reg, live), { changed: [], unreadable: ['a'] })
})
