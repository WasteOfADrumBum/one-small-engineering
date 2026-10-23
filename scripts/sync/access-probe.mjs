#!/usr/bin/env node
// TEMPORARY read-only probe (removed in the next commit): which GitHub API calls the job's
// own GITHUB_TOKEN can make. Prints status codes only, never bodies. Makes no writes.
const token = process.env.GITHUB_TOKEN
const H = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'one-small-engineering-access-probe', authorization: `Bearer ${token}` }
const hub = '/repos/WasteOfADrumBum/one-small-engineering'
const tf = '/repos/WasteOfADrumBum/TaskForge'
const mp = '/repos/WasteOfADrumBum/one-small-mods-pack'
const calls = [
  ['collect', 'TaskForge repository', `${tf}`],
  ['collect', 'TaskForge default branch', `${tf}/branches/main`],
  ['collect', 'TaskForge config file (404 = absent)', `${tf}/contents/.github/one-small-engineering.json`],
  ['collect', 'TaskForge open PRs', `${tf}/pulls?state=open&per_page=1`],
  ['collect', 'TaskForge closed PRs', `${tf}/pulls?state=closed&per_page=1`],
  ['collect', 'TaskForge Actions runs', `${tf}/actions/runs?branch=main&per_page=1`],
  ['collect', 'TaskForge releases', `${tf}/releases?per_page=1`],
  ['collect', 'ModsPack repository', `${mp}`],
  ['collect', 'ModsPack open PRs', `${mp}/pulls?state=open&per_page=1`],
  ['integrity', 'hub commits on main', `${hub}/commits?sha=main&per_page=1`],
  ['integrity', 'hub repository activity log', `${hub}/activity?ref=refs/heads/main&time_period=week&per_page=5`],
  ['integrity', 'hub PRs for a commit', `${hub}/commits/7d5deb71cd9769a8bb2e6b0a11e0db6e56b085de/pulls`],
  ['integrity', 'hub compare', `${hub}/compare/7bc6b1309376f0305ed2cad411f0697d26af2f73...7d5deb71cd9769a8bb2e6b0a11e0db6e56b085de`],
  ['write (read side)', 'hub open PRs', `${hub}/pulls?state=open&per_page=1`],
  ['write (read side)', 'hub issues', `${hub}/issues?state=open&per_page=1`],
  ['write (read side)', 'hub Validate registry runs', `${hub}/actions/workflows/validate.yml/runs?per_page=1`]
]
const rows = ['| Job | Call | HTTP | Shape |', '| --- | --- | --- | --- |']
let limit = ''
for (const [job, name, path] of calls) {
  const res = await fetch(`https://api.github.com${path}`, { headers: H })
  const text = await res.text()
  let shape = 'n/a'
  try { const j = JSON.parse(text); shape = Array.isArray(j) ? `list(${j.length})` : 'object' } catch {}
  limit = res.headers.get('x-ratelimit-limit') || limit
  rows.push(`| ${job} | ${name} | ${res.status} | ${shape} |`)
}
const out = [`# Access probe (GITHUB_TOKEN, event ${process.env.GITHUB_EVENT_NAME})`, '', `Rate limit for this token: ${limit} requests/hour.`, '', ...rows, ''].join('\n')
console.log(out)
if (process.env.GITHUB_STEP_SUMMARY) (await import('node:fs')).appendFileSync(process.env.GITHUB_STEP_SUMMARY, out)
