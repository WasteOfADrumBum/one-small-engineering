#!/usr/bin/env node
// Detects changes to main that did not arrive through a merged pull request.
//
// These are code-level and detection controls, NOT token-level branch protection: on
// GitHub Free nothing at the GitHub level stops a token with contents: write from pushing
// to main of this private repository. This script only reads and reports.
//
// Two modes, because a push made with GITHUB_TOKEN does not trigger push workflows:
//   push      (on: push)              every commit in before..after, plus force pushes
//   window    (on: schedule/dispatch) every commit on main in the look-back window, and
//                                     every main ref update in GitHub's repository
//                                     activity log (which also records GITHUB_TOKEN
//                                     pushes and force pushes)
// A commit is accepted when GitHub associates it with a PR merged into main (squash,
// rebase and merge-commit merges all qualify), or when it is listed in
// sync/main-integrity-acknowledged.json (for example the repository's initial commit).
//
// Acknowledging a commit only says "this commit needs no PR". It never excuses a change to
// main's history: a force push, a rewrite or an unmerged ref update is reported even when it
// lands on an acknowledged commit. A single past ref update (such as the creation of main)
// is excused only by its own activity id, so it can never cover a later one.

import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { createClient, expectArray, expectObject } from './github.mjs'
import { OWNER, HUB_REPO, HUB_DEFAULT_BRANCH, SHA, readJson, safeOutput, annotation } from './lib.mjs'

const REPO = `/repos/${OWNER}/${HUB_REPO}`
const MERGE_ACTIVITIES = new Set(['pr_merge', 'merge_queue_merge'])
export const WINDOW_DAYS = 7

export function loadAcknowledged() {
  return new Set(readJson('sync/main-integrity-acknowledged.json').acknowledged.map(a => a.sha))
}

// Activity-log entries (by id) that are known and reviewed, such as the creation of main.
export function loadAcknowledgedActivity() {
  return new Set((readJson('sync/main-integrity-acknowledged.json').acknowledgedActivity || []).map(a => String(a.id)))
}

async function mergedIntoMain(client, sha, attempts, sleep) {
  // GitHub links a merge commit to its PR asynchronously; allow a short delay.
  for (let i = 0; i < attempts; i++) {
    const prs = expectArray(await client.get(`${REPO}/commits/${sha}/pulls`), `commit ${sha.slice(0, 7)} pulls`)
    const pr = prs.find(p => p.merged_at && p.base && p.base.ref === HUB_DEFAULT_BRANCH)
    if (pr) return { number: pr.number, url: pr.html_url }
    if (i < attempts - 1) await sleep(10_000)
  }
  return null
}

// Checks each commit; returns the ones with no merged PR and no acknowledgement.
export async function checkCommits({ client, shas, acknowledged = new Set(), attempts = 3, sleep = ms => new Promise(r => setTimeout(r, ms)) }) {
  const violations = []
  const checked = []
  for (const sha of shas) {
    if (!SHA.test(sha || '')) throw new Error(`invalid commit sha ${sha}`)
    if (acknowledged.has(sha)) { checked.push({ sha, via: 'acknowledged' }); continue }
    const pr = await mergedIntoMain(client, sha, attempts, sleep)
    if (pr) checked.push({ sha, via: `PR #${pr.number}` })
    else violations.push({ sha, reason: 'no merged pull request into main contains this commit' })
  }
  return { checked, violations }
}

// Compatibility helper for a single commit.
export async function checkMainCommit({ client, sha, attempts = 3, sleep }) {
  const { violations, checked } = await checkCommits({ client, shas: [sha], attempts, sleep })
  return violations.length ? { ok: false } : { ok: true, via: checked[0].via }
}

// Commits a push added to main. A force push, or a base GitHub no longer has, is itself a violation.
export async function commitsInPush({ client, before, after, forced }) {
  const problems = []
  if (forced) problems.push({ sha: after, reason: `force push to ${HUB_DEFAULT_BRANCH} (history before ${String(before).slice(0, 7)} was rewritten)` })
  if (!before || /^0+$/.test(before)) return { shas: [after], problems }
  const cmp = await client.get(`${REPO}/compare/${before}...${after}`, { allow404: true })
  if (!cmp) {
    problems.push({ sha: after, reason: `cannot compare ${before.slice(0, 7)}...${after.slice(0, 7)}; the old head is gone (history rewrite?)` })
    return { shas: [after], problems }
  }
  expectObject(cmp, `compare ${before.slice(0, 7)}...${after.slice(0, 7)}`, ['status', 'commits'])
  // A fast-forward is "ahead". Anything else means the old head is no longer in main's
  // history, whether or not the event said forced.
  if (!forced && !['ahead', 'identical'].includes(cmp.status)) problems.push({ sha: after, reason: `history rewritten: the new head is ${cmp.status} of the previous head ${before.slice(0, 7)}` })
  if (cmp.total_commits > (cmp.commits || []).length) problems.push({ sha: after, reason: `push of ${cmp.total_commits} commits is larger than the comparison lists; the scheduled check covers the rest` })
  return { shas: expectArray(cmp.commits, 'compare commits').map(c => c.sha), problems }
}

// Every commit on main in the window, and every non-merge update of main in the activity log.
// A scan that cannot see everything is itself a problem: a green run must mean "checked", not
// "could not look". Those problems have no commit, and are reported as an incomplete check.
export const MAX_WINDOW_COMMITS = 1000
const ACTIVITY_PAGE = 100
export async function windowScan({ client, now = new Date(), days = WINDOW_DAYS, acknowledgedActivity = new Set() }) {
  const since = new Date(now.getTime() - days * 86400_000).toISOString().replace(/\.\d{3}Z$/, 'Z')
  const commits = await client.paginate(`${REPO}/commits?sha=${HUB_DEFAULT_BRANCH}&since=${since}`, { max: MAX_WINDOW_COMMITS })
  const problems = []
  const notes = []
  if (commits.length >= MAX_WINDOW_COMMITS) problems.push({ sha: null, incomplete: true, reason: `main has at least ${MAX_WINDOW_COMMITS} commits since ${since}; only the newest ${MAX_WINDOW_COMMITS} were checked` })
  let activity = null
  try {
    // One page: this endpoint pages by cursor, and a week of main updates is far below 100.
    activity = expectArray(await client.get(`${REPO}/activity?ref=refs/heads/${HUB_DEFAULT_BRANCH}&time_period=week&per_page=${ACTIVITY_PAGE}`), 'repository activity log')
  } catch (e) {
    // Without the log a force push that removed commits, or a push since rewritten away, is invisible.
    problems.push({ sha: null, incomplete: true, reason: `the repository activity log could not be read (${e.message}); force pushes and GITHUB_TOKEN pushes cannot be ruled out` })
  }
  if (activity && activity.length >= ACTIVITY_PAGE) problems.push({ sha: null, incomplete: true, reason: `the activity log returned a full page of ${ACTIVITY_PAGE} updates to ${HUB_DEFAULT_BRANCH} this week; older entries were not checked` })
  for (const a of activity || []) {
    // Excused by its own id only: an acknowledged commit SHA never excuses a ref update.
    if (MERGE_ACTIVITIES.has(a.activity_type) || acknowledgedActivity.has(String(a.id))) continue
    const who = (a.actor && a.actor.login) || 'unknown'
    problems.push({ sha: a.after, reason: `${a.activity_type} to ${HUB_DEFAULT_BRANCH} by ${who} at ${a.timestamp}, not a pull request merge` })
  }
  return { shas: commits.map(c => c.sha), problems, notes, since }
}

// The whole check for one run. Ref-level problems (force pushes, rewrites, unmerged ref
// updates, incomplete scans) are never filtered by commit acknowledgements; only the
// per-commit "no merged PR" check consults them. Stateless, so repeating it repeats the result.
export async function integrityProblems({ client, mode, before, after, forced, acknowledged = new Set(), acknowledgedActivity = new Set(), now, attempts, sleep }) {
  let scan
  if (mode === 'push') scan = { ...(await commitsInPush({ client, before, after, forced })), notes: [] }
  else scan = await windowScan({ client, now, acknowledgedActivity })
  const { checked, violations } = await checkCommits({ client, shas: scan.shas, acknowledged, attempts, sleep })
  return { checked, problems: [...scan.problems, ...violations], notes: scan.notes || [] }
}

function report({ mode, checked, violations, notes }) {
  const lines = [`# Main integrity (${mode})`, '', `${checked.length} commit(s) accepted, ${violations.length} problem(s).`, '']
  lines.push('These checks detect changes; they do not prevent them. Branch protection is not enforced on this private repository on GitHub Free.', '')
  if (violations.length) {
    lines.push('| Commit | Problem |', '| --- | --- |')
    for (const v of violations) lines.push(`| ${v.sha ? v.sha.slice(0, 7) : 'check incomplete'} | ${v.reason} |`)
    lines.push('', 'If a change is legitimate (for example a deliberate direct push by the owner), add its SHA with a reason to sync/main-integrity-acknowledged.json through a PR. Otherwise disable Registry sync and review the commit.', '')
  }
  for (const n of notes) lines.push(`Note: ${n}`)
  return lines.join('\n') + '\n'
}

async function main() {
  const client = createClient({ token: process.env.GITHUB_TOKEN })
  const event = process.env.GITHUB_EVENT_NAME || 'workflow_dispatch'
  const push = event === 'push'
  const mode = push ? 'push' : `window, last ${WINDOW_DAYS} days`
  const { checked, problems: all, notes } = await integrityProblems({
    client,
    mode: push ? 'push' : 'window',
    before: process.env.BEFORE_SHA,
    after: process.env.AFTER_SHA,
    forced: process.env.FORCED === 'true',
    acknowledged: loadAcknowledged(),
    acknowledgedActivity: loadAcknowledgedActivity()
  })
  const text = safeOutput(report({ mode, checked, violations: all, notes }))
  console.log(text)
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import('node:fs')
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, text)
  }
  for (const v of all) {
    if (v.incomplete) console.error(`::error title=Main integrity check incomplete::${annotation(v.reason)}`)
    else console.error(`::error title=Change to main without a merged pull request::${annotation(`${String(v.sha).slice(0, 7)}: ${v.reason}`)}`)
  }
  return all.length ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then(code => { process.exitCode = code }, e => { console.error(`::error title=Main integrity failed::${annotation(e.message)}`); process.exitCode = 1 })
}
