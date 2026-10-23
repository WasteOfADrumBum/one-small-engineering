#!/usr/bin/env node
// Detects a commit on main that did not arrive through a merged pull request.
// Without enforced branch protection this is the backstop for the sync writer's
// code-level refusal to touch main. It only reads and reports.

import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { createClient } from './github.mjs'
import { OWNER, HUB_REPO, HUB_DEFAULT_BRANCH, SHA } from './lib.mjs'

export async function checkMainCommit({ client, sha, attempts = 3, sleep = ms => new Promise(r => setTimeout(r, ms)) }) {
  if (!SHA.test(sha || '')) throw new Error(`invalid commit sha ${sha}`)
  // GitHub links a merge commit to its PR asynchronously; allow a short delay.
  for (let i = 0; i < attempts; i++) {
    const prs = await client.get(`/repos/${OWNER}/${HUB_REPO}/commits/${sha}/pulls`)
    const pr = prs.find(p => p.merged_at && p.base && p.base.ref === HUB_DEFAULT_BRANCH && p.merge_commit_sha === sha)
    if (pr) return { ok: true, pr: { number: pr.number, url: pr.html_url } }
    if (i < attempts - 1) await sleep(10_000)
  }
  return { ok: false }
}

async function main() {
  const sha = process.env.AFTER_SHA
  const pusher = process.env.PUSHER || 'unknown'
  const client = createClient({ token: process.env.GITHUB_TOKEN })
  const result = await checkMainCommit({ client, sha })
  if (result.ok) {
    console.log(`main-integrity: OK (${sha.slice(0, 7)} is the merge of PR #${result.pr.number})`)
    return 0
  }
  const bot = /\[bot\]$/.test(pusher)
  console.error(`::error title=Commit on main without a merged pull request::${sha.slice(0, 7)} was pushed to main by ${pusher} without a merged pull request.${bot ? ' The pusher is automation: disable Registry sync and review the commit immediately.' : ' Review it and revert if it was not intended.'}`)
  return 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then(code => { process.exitCode = code }, e => { console.error(`main-integrity: ${e.message}`); process.exitCode = 1 })
}
