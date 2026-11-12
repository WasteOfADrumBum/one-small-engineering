// Main integrity: every intervening commit is checked, and GITHUB_TOKEN pushes (which do
// not trigger push workflows) are caught by the scheduled window scan.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkCommits, commitsInPush, windowScan, integrityProblems, loadAcknowledged, loadAcknowledgedActivity, MAX_WINDOW_COMMITS, MAX_ACTIVITY } from './main-integrity.mjs'
import { createClient } from './github.mjs'
import { FakeGitHub, fakeSha } from '../../fixtures/sync/fake-github.mjs'

const merged = [fakeSha('merge-1'), fakeSha('pr-commit-1'), fakeSha('merge-2')]
const direct = fakeSha('direct-push')

function repo({ commits = [], activity = [], activityStatus = 200, compare = null } = {}) {
  const gh = new FakeGitHub()
  gh.on('GET', /\/commits\/([0-9a-f]{40})\/pulls$/, ({ m }) => (merged.includes(m[1]) ? [{ number: 5, html_url: 'https://github.com/x/pull/5', merged_at: '2026-10-23T00:00:00Z', base: { ref: 'main' } }] : m[1] === fakeSha('open-pr') ? [{ number: 6, merged_at: null, base: { ref: 'main' } }] : []))
  gh.on('GET', /\/one-small-engineering\/commits$/, ({ q }) => {
    const page = +(q.get('page') || 1)
    return commits.slice((page - 1) * 100, page * 100).map(sha => ({ sha }))
  })
  gh.on('GET', /\/one-small-engineering\/activity$/, () => (activityStatus === 200 ? activity : new Response(JSON.stringify({ message: 'Not Found' }), { status: activityStatus })))
  gh.on('GET', /\/compare\/([0-9a-f]{40})\.\.\.([0-9a-f]{40})$/, () => compare)
  const client = createClient({ token: 't', fetchImpl: gh.fetch, sleep: async () => {} })
  return { gh, client }
}
const quick = { attempts: 1, sleep: async () => {} }

test('push mode checks every commit between before and after, not just the head', async () => {
  const { client } = repo({ compare: { status: 'ahead', total_commits: 3, commits: [{ sha: merged[1] }, { sha: direct }, { sha: merged[0] }] } })
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

test('without the activity log the scan is reported incomplete, and the commit check still runs', async () => {
  const { client } = repo({ commits: [direct, merged[0]], activityStatus: 403 })
  const scan = await windowScan({ client })
  assert.equal(scan.problems.length, 1)
  assert.equal(scan.problems[0].incomplete, true)
  assert.match(scan.problems[0].reason, /activity log could not be read/)
  const { violations } = await checkCommits({ client, shas: scan.shas, ...quick })
  assert.deepEqual(violations.map(v => v.sha), [direct])
})

test('the initial commit and the creation of main are accepted, each by its own acknowledgement', async () => {
  const acknowledged = loadAcknowledged()
  const acknowledgedActivity = loadAcknowledgedActivity()
  const initial = '954833cfe46ce807bc40faeca8781a31d27a20f9'
  assert.ok(acknowledged.has(initial))
  assert.ok(acknowledgedActivity.has('47413237880'))
  const { client } = repo({ commits: [initial], activity: [{ id: 47413237880, before: '0'.repeat(40), after: initial, activity_type: 'branch_creation', actor: { login: 'WasteOfADrumBum' }, timestamp: '2026-10-22T16:16:45Z' }] })
  const scan = await windowScan({ client, acknowledgedActivity })
  assert.deepEqual(scan.problems, [])
  const { violations } = await checkCommits({ client, shas: scan.shas, acknowledged, ...quick })
  assert.deepEqual(violations, [])
})

test('a truncated commit window is reported incomplete, never silently passed', async () => {
  const many = Array.from({ length: MAX_WINDOW_COMMITS + 50 }, (_, i) => fakeSha(`c${i}`))
  const { client } = repo({ commits: many, activity: [] })
  const scan = await windowScan({ client })
  assert.equal(scan.shas.length, MAX_WINDOW_COMMITS)
  const incomplete = scan.problems.filter(p => p.incomplete)
  assert.equal(incomplete.length, 1)
  assert.match(incomplete[0].reason, /only the newest 1000 were checked/)
})

// The activity log pages by cursor. Serve `entries` 100 at a time with Link: rel="next".
const API = 'https://api.github.com/repos/WasteOfADrumBum/one-small-engineering/activity'
function pagedActivity(entries, { nextUrl = (cursor, q) => `${API}?ref=${encodeURIComponent(q.get('ref'))}&time_period=week&per_page=100&after=${cursor}` } = {}) {
  const { gh, client } = repo({ commits: [merged[0]] })
  gh.routes.unshift({ method: 'GET', re: /\/(one-small-engineering|repositories\/[0-9]+)\/activity$/, handler: ({ q }) => {
    const start = +(q.get('after') || 0)
    const page = entries.slice(start, start + 100)
    const headers = { 'content-type': 'application/json' }
    if (start + 100 < entries.length) headers.link = `<${nextUrl(start + 100, q)}>; rel="next"`
    return new Response(JSON.stringify(page), { status: 200, headers })
  } })
  return { gh, client }
}
const mergeEntry = i => ({ id: i, after: merged[0], activity_type: 'pr_merge', actor: { login: 'WasteOfADrumBum' }, timestamp: '2026-10-23T01:00:00Z' })

test('a full page of 100 merges with no next page is a complete check (regression: Nov 2026 false failures)', async () => {
  const { client } = pagedActivity(Array.from({ length: 100 }, (_, i) => mergeEntry(i)))
  const scan = await windowScan({ client })
  assert.deepEqual(scan.problems, [])
})

test('every activity page is read, so a direct push past the first 100 entries is still caught', async () => {
  const entries = Array.from({ length: 250 }, (_, i) => mergeEntry(i))
  entries[230] = { id: 230, after: direct, activity_type: 'push', actor: { login: 'github-actions[bot]' }, timestamp: '2026-10-23T02:00:00Z' }
  const { gh, client } = pagedActivity(entries)
  const scan = await windowScan({ client })
  assert.equal(gh.calls.filter(c => c.path.includes('/activity')).length, 3)
  assert.equal(scan.problems.length, 1)
  assert.equal(scan.problems[0].sha, direct)
  assert.match(scan.problems[0].reason, /push to main by github-actions\[bot\]/)
})

test('more activity than the cap is reported incomplete, never silently passed', async () => {
  const { client } = pagedActivity(Array.from({ length: MAX_ACTIVITY + 50 }, (_, i) => mergeEntry(i)))
  const scan = await windowScan({ client })
  const incomplete = scan.problems.filter(p => p.incomplete)
  assert.equal(incomplete.length, 1)
  assert.match(incomplete[0].reason, /more than 1000 updates to main this week/)
})

test('a next link in GitHub\'s numeric repository form is followed (regression: Main integrity red, Nov 12 2026)', async () => {
  const entries = Array.from({ length: 250 }, (_, i) => mergeEntry(i))
  entries[230] = { id: 230, after: direct, activity_type: 'push', actor: { login: 'github-actions[bot]' }, timestamp: '2026-10-23T02:00:00Z' }
  const { gh, client } = pagedActivity(entries, { nextUrl: cursor => `https://api.github.com/repositories/1429985443/activity?per_page=100&after=${cursor}` })
  const scan = await windowScan({ client })
  assert.equal(gh.calls.filter(c => c.path.includes('/activity')).length, 3)
  assert.equal(scan.problems.length, 1)
  assert.equal(scan.problems[0].sha, direct)
})

test('a next link to another host or endpoint is refused, not followed', async () => {
  for (const bad of ['https://evil.example/repos/WasteOfADrumBum/one-small-engineering/activity?after=100', 'https://api.github.com/repos/WasteOfADrumBum/other-repo/activity?after=100', 'https://api.github.com/repositories/1429985443/commits?after=100', 'https://evil.example/repositories/1429985443/activity?after=100']) {
    const { gh, client } = pagedActivity(Array.from({ length: 150 }, (_, i) => mergeEntry(i)), { nextUrl: () => bad })
    const scan = await windowScan({ client })
    assert.equal(gh.calls.filter(c => c.path.includes('/activity')).length, 1)
    assert.equal(scan.problems.length, 1)
    assert.match(scan.problems[0].reason, /activity log could not be read \(GET .*pagination link points outside the endpoint\)/)
  }
})

// F-01: an acknowledged commit must never excuse a later change to main's history.
const initial = '954833cfe46ce807bc40faeca8781a31d27a20f9'
const ack = () => ({ acknowledged: loadAcknowledged(), acknowledgedActivity: loadAcknowledgedActivity() })

test('F-01: a force push of main back to an acknowledged commit is reported (window mode, repeated runs)', async () => {
  const activity = [
    { id: 47413237880, before: '0'.repeat(40), after: initial, activity_type: 'branch_creation', actor: { login: 'WasteOfADrumBum' }, timestamp: '2026-10-22T16:16:45Z' },
    { id: 900, before: merged[0], after: initial, activity_type: 'force_push', actor: { login: 'github-actions[bot]' }, timestamp: '2026-10-23T03:00:00Z' }
  ]
  const { client } = repo({ commits: [initial], activity })
  for (let run = 1; run <= 2; run++) {
    const { problems } = await integrityProblems({ client, mode: 'window', ...ack(), ...quick, now: new Date('2026-10-23T06:47:00Z') })
    assert.equal(problems.length, 1, `run ${run}`)
    assert.match(problems[0].reason, /^force_push to main by github-actions\[bot\]/, `run ${run}`)
  }
})

test('F-01: a direct push or branch re-creation onto an acknowledged commit is reported unless that exact activity id is acknowledged', async () => {
  const activity = [
    { id: 901, before: merged[0], after: initial, activity_type: 'push', actor: { login: 'someone' }, timestamp: '2026-10-23T04:00:00Z' },
    { id: 902, before: '0'.repeat(40), after: initial, activity_type: 'branch_creation', actor: { login: 'someone' }, timestamp: '2026-10-23T05:00:00Z' }
  ]
  const { client } = repo({ commits: [initial], activity })
  const { problems } = await integrityProblems({ client, mode: 'window', ...ack(), ...quick, now: new Date('2026-10-23T06:47:00Z') })
  assert.deepEqual(problems.map(p => p.reason.split(' ')[0]), ['push', 'branch_creation'])
})

test('F-01: push mode reports a force push to an acknowledged commit', async () => {
  const { client } = repo({ compare: { status: 'behind', total_commits: 0, commits: [] } })
  const { problems } = await integrityProblems({ client, mode: 'push', before: merged[0], after: initial, forced: true, ...ack(), ...quick })
  assert.ok(problems.some(p => p.reason.startsWith('force push')), JSON.stringify(problems))
})

test('F-01: push mode reports rewritten history even when the forced flag is missing', async () => {
  for (const status of ['behind', 'diverged']) {
    const { client } = repo({ compare: { status, total_commits: 1, commits: [{ sha: merged[1] }] } })
    const { problems } = await integrityProblems({ client, mode: 'push', before: merged[0], after: merged[1], forced: false, ...ack(), ...quick })
    assert.equal(problems.length, 1, status)
    assert.match(problems[0].reason, new RegExp(`history rewritten: the new head is ${status}`))
  }
})

// F-03: malformed responses fail closed.
test('F-03: malformed integrity API responses fail closed with a clear diagnostic', async () => {
  const empty = repo({ commits: [], activity: [] })
  empty.gh.routes.unshift({ method: 'GET', re: /\/one-small-engineering\/activity$/, handler: () => new Response('', { status: 200 }) })
  const scan = await windowScan({ client: empty.client })
  assert.equal(scan.problems.length, 1)
  assert.match(scan.problems[0].reason, /activity log could not be read \(repository activity log: malformed response/)

  const obj = repo({ activity: [] })
  obj.gh.routes.unshift({ method: 'GET', re: /\/one-small-engineering\/commits$/, handler: () => ({ message: 'not a list' }) })
  await assert.rejects(windowScan({ client: obj.client }), /malformed response \(expected a list, got object\)/)

  const cmp = repo({ compare: { message: 'odd' } })
  await assert.rejects(commitsInPush({ client: cmp.client, before: merged[0], after: merged[1], forced: false }), /malformed response \(missing status, commits, total_commits\)/)

  const prs = repo()
  prs.gh.routes.unshift({ method: 'GET', re: /\/commits\/([0-9a-f]{40})\/pulls$/, handler: () => ({}) })
  await assert.rejects(checkCommits({ client: prs.client, shas: [merged[0]], ...quick }), /malformed response/)
})
