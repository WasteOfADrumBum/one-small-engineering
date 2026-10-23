// Main integrity: every intervening commit is checked, and GITHUB_TOKEN pushes (which do
// not trigger push workflows) are caught by the scheduled window scan.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkCommits, commitsInPush, windowScan, loadAcknowledged } from './main-integrity.mjs'
import { createClient } from './github.mjs'
import { FakeGitHub, fakeSha } from '../../fixtures/sync/fake-github.mjs'

const merged = [fakeSha('merge-1'), fakeSha('pr-commit-1'), fakeSha('merge-2')]
const direct = fakeSha('direct-push')

function repo({ commits = [], activity = [], activityStatus = 200, compare = null } = {}) {
  const gh = new FakeGitHub()
  gh.on('GET', /\/commits\/([0-9a-f]{40})\/pulls$/, ({ m }) => (merged.includes(m[1]) ? [{ number: 5, html_url: 'https://github.com/x/pull/5', merged_at: '2026-10-23T00:00:00Z', base: { ref: 'main' } }] : m[1] === fakeSha('open-pr') ? [{ number: 6, merged_at: null, base: { ref: 'main' } }] : []))
  gh.on('GET', /\/one-small-engineering\/commits$/, ({ q }) => (+(q.get('page') || 1) === 1 ? commits.map(sha => ({ sha })) : []))
  gh.on('GET', /\/one-small-engineering\/activity$/, () => (activityStatus === 200 ? activity : new Response(JSON.stringify({ message: 'Not Found' }), { status: activityStatus })))
  gh.on('GET', /\/compare\/([0-9a-f]{40})\.\.\.([0-9a-f]{40})$/, () => compare)
  const client = createClient({ token: 't', fetchImpl: gh.fetch, sleep: async () => {} })
  return { gh, client }
}
const quick = { attempts: 1, sleep: async () => {} }

test('push mode checks every commit between before and after, not just the head', async () => {
  const { client } = repo({ compare: { total_commits: 3, commits: [{ sha: merged[1] }, { sha: direct }, { sha: merged[0] }] } })
  const { shas, problems } = await commitsInPush({ client, before: fakeSha('old'), after: merged[0], forced: false })
  assert.deepEqual(shas, [merged[1], direct, merged[0]])
  assert.deepEqual(problems, [])
  const { violations, checked } = await checkCommits({ client, shas, ...quick })
  assert.deepEqual(violations.map(v => v.sha), [direct], 'the head is a merge, but an intervening direct commit is still caught')
  assert.equal(checked.length, 2)
})

test('force pushes and vanished bases are problems in their own right', async () => {
  const { client } = repo({ compare: null })
  const r = await commitsInPush({ client, before: fakeSha('gone'), after: merged[0], forced: true })
  assert.ok(r.problems.some(p => p.reason.startsWith('force push')))
  assert.ok(r.problems.some(p => p.reason.includes('old head is gone')))
})

test('a commit only on an open (unmerged) PR is not accepted', async () => {
  const { client } = repo()
  const { violations } = await checkCommits({ client, shas: [fakeSha('open-pr')], ...quick })
  assert.equal(violations.length, 1)
})

test('scheduled window scan catches a GITHUB_TOKEN push that no push workflow saw', async () => {
  const activity = [
    { id: 1, after: merged[0], activity_type: 'pr_merge', actor: { login: 'WasteOfADrumBum' }, timestamp: '2026-10-23T01:00:00Z' },
    { id: 2, after: direct, activity_type: 'push', actor: { login: 'github-actions[bot]' }, timestamp: '2026-10-23T02:00:00Z' },
    { id: 3, after: merged[2], activity_type: 'force_push', actor: { login: 'github-actions[bot]' }, timestamp: '2026-10-23T03:00:00Z' }
  ]
  const { client } = repo({ commits: [direct, merged[0], merged[1]], activity })
  const scan = await windowScan({ client, now: new Date('2026-10-23T06:47:00Z') })
  assert.equal(scan.since, '2026-10-16T06:47:00Z')
  assert.deepEqual(scan.problems.map(p => p.reason.split(' ')[0]), ['push', 'force_push'])
  assert.match(scan.problems[0].reason, /github-actions\[bot\]/)
  const { violations } = await checkCommits({ client, shas: scan.shas, ...quick })
  assert.deepEqual(violations.map(v => v.sha), [direct])
})

test('without the activity log the commit check still catches the direct commit', async () => {
  const { client } = repo({ commits: [direct, merged[0]], activityStatus: 404 })
  const scan = await windowScan({ client })
  assert.match(scan.notes[0], /activity log unavailable/)
  const { violations } = await checkCommits({ client, shas: scan.shas, ...quick })
  assert.deepEqual(violations.map(v => v.sha), [direct])
})

test('acknowledged commits (the initial commit) are accepted in both checks', async () => {
  const acknowledged = loadAcknowledged()
  const initial = '954833cfe46ce807bc40faeca8781a31d27a20f9'
  assert.ok(acknowledged.has(initial))
  const { client } = repo({ commits: [initial], activity: [{ id: 9, after: initial, activity_type: 'branch_creation', actor: { login: 'WasteOfADrumBum' }, timestamp: '2026-10-22T16:16:45Z' }] })
  const scan = await windowScan({ client, acknowledged })
  assert.deepEqual(scan.problems, [])
  const { violations } = await checkCommits({ client, shas: scan.shas, acknowledged, ...quick })
  assert.deepEqual(violations, [])
})
