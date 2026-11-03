#!/usr/bin/env node
// Change watch (Phase 6 final integration): the credential-free alternative to cross-repo
// event dispatch. A cheap hourly read compares each sync-enabled project's live default-branch
// head and open pull requests with what the registry on main records. When any differ it
// asks the existing Registry sync for a full run; otherwise it does nothing. No project
// repository holds a Hub credential, and nothing read here is written anywhere: the sync
// rereads state through its own collector, planner, guard and validator.
//
// A read failure never dispatches (the six-hour schedule remains the fallback).
// CLI (workflow): env GITHUB_TOKEN, READER_TOKEN -> prints "changed <ids>" or "unchanged"
// and sets `changed=true|false` in $GITHUB_OUTPUT. It makes only GitHub REST reads.

import { readFileSync, appendFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createClient } from './github.mjs'
import { ROOT, REGISTRY_PATH, repoFromUrl, safeOutput } from './lib.mjs'

const fingerprint = prs => prs.map(p => `${p.number}:${p.headSha}`).sort().join(',')

// live: { [projectId]: { head, openPullRequests: [{ number, headSha }] } | null (unreadable) }
// Returns { changed: [ids], unreadable: [ids] }.
export function detectChanges(registry, live) {
  const changed = []
  const unreadable = []
  for (const p of registry.projects) {
    if (!(p.sync && p.sync.enabled)) continue
    const l = live[p.id]
    if (!l) { unreadable.push(p.id); continue }
    const recorded = p.repositorySnapshot && p.repositorySnapshot.headSha
    if (l.head !== recorded || fingerprint(l.openPullRequests) !== fingerprint(p.openPullRequests || [])) changed.push(p.id)
  }
  return { changed, unreadable }
}

// Public repositories are read with the job's GITHUB_TOKEN; the reader secret is used only for
// private projects (and for public ones only when no job token exists, e.g. a local run).
// GitHub Copilot review of PR #45, 2026-11-02.
export function chooseTokens({ token = '', reader = '' } = {}) {
  return { publicToken: token || reader, privateToken: reader || null }
}

// A list that could not be read in full is unreadable, never a change: a partial PR list
// would give a wrong fingerprint (fail closed, like the sync collector).
export async function readLive(registry, { publicClient, privateClient }) {
  const live = {}
  for (const p of registry.projects) {
    if (!(p.sync && p.sync.enabled)) continue
    const { owner, name } = repoFromUrl(p.repository)
    const client = p.repositorySnapshot && p.repositorySnapshot.visibility === 'private' ? privateClient : publicClient
    try {
      if (!client) throw new Error('no reader credential')
      const branch = p.repositorySnapshot.defaultBranch
      const head = await client.get(`/repos/${owner}/${name}/branches/${encodeURIComponent(branch)}`)
      const prs = await client.paginate(`/repos/${owner}/${name}/pulls?state=open`)
      if (prs.truncated) throw new Error('open pull request list is incomplete')
      live[p.id] = { head: head.commit.sha, openPullRequests: prs.map(x => ({ number: x.number, headSha: x.head.sha })) }
    } catch {
      live[p.id] = null
    }
  }
  return live
}

async function main() {
  const registry = JSON.parse(readFileSync(resolve(ROOT, REGISTRY_PATH), 'utf8'))
  const token = process.env.GITHUB_TOKEN || ''
  const reader = process.env.READER_TOKEN || ''
  const { publicToken, privateToken } = chooseTokens({ token, reader })
  const live = await readLive(registry, {
    publicClient: createClient({ token: publicToken }),
    privateClient: privateToken ? createClient({ token: privateToken }) : null
  })
  const { changed, unreadable } = detectChanges(registry, live)
  console.log(safeOutput(changed.length ? `changed ${changed.join(', ')}` : 'unchanged'))
  if (unreadable.length) console.log(safeOutput(`unreadable (left to the scheduled sync): ${unreadable.join(', ')}`))
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed.length ? 'true' : 'false'}\n`)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().then(c => { process.exitCode = c }, e => { console.error(`watch: ${safeOutput(e.message)}`); process.exitCode = 1 })
