#!/usr/bin/env node
// Agent-facing state commands (docs/agent-continuity.md).
//   node scripts/state/cli.mjs show <owner/repo> [--ref <branch>]
//   node scripts/state/cli.mjs checkpoint <owner/repo> --branch <b> --patch <file.json> --expected-revision <n> --agent <tool> [--model <m>] [--project <id>]
//   node scripts/state/cli.mjs aggregate [--out <dir>]
//   node scripts/state/cli.mjs validate <state.json>
// Env: GITHUB_TOKEN (read for show/aggregate, contents:write on the target repo for checkpoint).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createClient } from '../sync/github.mjs'
import { ROOT, REGISTRY_PATH, safeOutput, isoSeconds } from '../sync/lib.mjs'
import { validateState } from './lib.mjs'
import { pushCheckpoint, readState } from './push.mjs'
import { aggregate, renderAggregate } from './aggregate.mjs'

const opt = (argv, name) => { const i = argv.indexOf(name); return i === -1 ? undefined : argv[i + 1] }

async function main(argv) {
  const [cmd, target] = argv
  // Commands that act on a repository or a file need it named; fail with usage, not a TypeError
  // (GitHub Copilot review of PR #29, 2026-11-02).
  if (['show', 'checkpoint'].includes(cmd) && !/^[^/\s]+\/[^/\s]+$/.test(target || '')) { console.error(`usage: cli.mjs ${cmd} <owner/repo> (see header)`); return 2 }
  if (cmd === 'validate' && !target) { console.error('usage: cli.mjs validate <state.json>'); return 2 }
  if (cmd === 'checkpoint') for (const flag of ['--branch', '--patch', '--expected-revision', '--agent']) if (!opt(argv, flag)) { console.error(`usage: cli.mjs checkpoint needs ${flag} (see header)`); return 2 }
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  const out = t => console.log(safeOutput(t))
  if (cmd === 'validate') {
    const problems = validateState(JSON.parse(readFileSync(resolve(target), 'utf8')))
    problems.forEach(p => console.error(safeOutput(p)))
    return problems.length ? 1 : 0
  }
  const client = createClient({ token })
  if (cmd === 'show') {
    const [owner, repo] = target.split('/')
    const info = await client.get(`/repos/${owner}/${repo}`)
    const state = await readState({ client, owner, repo, ref: opt(argv, '--ref') || info.default_branch })
    out(state ? JSON.stringify(state, null, 2) : 'no .engineering/state.json: this project has no checkpoint yet')
    return 0
  }
  if (cmd === 'checkpoint') {
    const [owner, repo] = target.split('/')
    const patch = JSON.parse(readFileSync(resolve(opt(argv, '--patch')), 'utf8'))
    const r = await pushCheckpoint({
      client, owner, repo, branch: opt(argv, '--branch'), patch, projectId: opt(argv, '--project'),
      expectedRevision: Number(opt(argv, '--expected-revision')),
      agent: { tool: opt(argv, '--agent'), model: opt(argv, '--model') || null }, now: isoSeconds(new Date())
    })
    out(JSON.stringify(r))
    return 0
  }
  if (cmd === 'aggregate') {
    const registry = JSON.parse(readFileSync(resolve(ROOT, REGISTRY_PATH), 'utf8'))
    const result = await aggregate({ registry, client })
    const md = renderAggregate(result)
    const dir = resolve(opt(argv, '--out') || 'out/state')
    mkdirSync(dir, { recursive: true })
    writeFileSync(resolve(dir, 'state.json'), JSON.stringify(result, null, 2) + '\n')
    writeFileSync(resolve(dir, 'state.md'), md)
    if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, md, { flag: 'a' })
    out(md)
    return 0
  }
  console.error('usage: cli.mjs show|checkpoint|aggregate|validate (see header)')
  return 2
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(c => { process.exitCode = c }, e => { console.error(`state: ${safeOutput(e.message)}`); process.exitCode = 1 })
}
