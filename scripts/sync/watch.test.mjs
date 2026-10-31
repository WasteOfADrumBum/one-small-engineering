import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectChanges } from './watch.mjs'

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
  assert.deepEqual(detectChanges(registry, same).changed, [])
})
