// Static checks on workflows, the project template and the AI adapters.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { ROOT } from './lib.mjs'

const read = p => readFileSync(resolve(ROOT, p), 'utf8')
// Every text assertion runs on the file as checked out and on a CRLF copy (a Windows
// checkout with core.autocrlf), so no check depends on the line-ending convention.
const crlf = text => text.replace(/\r?\n/g, '\r\n')
const both = text => [['LF', text.replace(/\r\n/g, '\n')], ['CRLF', crlf(text)]]
const workflows = readdirSync(resolve(ROOT, '.github/workflows')).map(f => [f, read(`.github/workflows/${f}`)])

// Phase 6 exceptions, each reviewed: the auto-merge workflow listens for workflow_run and
// the event workflow for repository_dispatch. Both run from main, and neither checks out
// or executes PR or payload content (asserted below).
const ALLOWED_EVENTS = { 'automerge.yml': ['workflow_run'], 'events.yml': ['repository_dispatch'] }

test('no workflow uses pull_request_target, unpinned actions or an unlisted privileged trigger', () => {
  for (const [f, text] of [...workflows, ['template', read('templates/project/one-small-report.yml')]]) {
    assert.doesNotMatch(text, /pull_request_target/, f)
    for (const ev of ['workflow_run', 'repository_dispatch']) {
      if (!(ALLOWED_EVENTS[f] || []).includes(ev)) assert.doesNotMatch(text, new RegExp(ev), f)
    }
    for (const m of text.matchAll(/uses:\s*(\S+)/g)) assert.match(m[1], /@[0-9a-f]{40}$/, `${f}: ${m[1]} must be pinned to a commit SHA`)
    assert.match(text, /persist-credentials: false/, f)
  }
})

test('registry sync: schedule every six hours, empty default permissions, writes only from main', () => {
  for (const [eol, text] of both(read('.github/workflows/registry-sync.yml'))) {
    assert.match(text, /cron: '\d+ \*\/6 \* \* \*'/, eol)
    assert.match(text, /^permissions: \{\}\r?$/m, eol)
    assert.match(text, /if: github\.ref == 'refs\/heads\/main'/, eol)
    assert.match(text, /cancel-in-progress: false/, eol)
    assert.match(text, /SYNC_WRITE_ENABLED == 'true'/, eol)
    // The report and write jobs must expect the same projects collect read (F-06).
    assert.equal(text.match(/SYNC_PROJECT: \$\{\{ inputs\.project \}\}/g).length, 3, eol)
    // Staged activation: the stage decides the mode, never a shell-interpolated expression.
    assert.match(text, /run: node scripts\/sync\/run\.mjs write --mode auto --read-only\r?$/m, eol)
    assert.match(text, /run: node scripts\/sync\/run\.mjs write --mode auto\r?$/m, eol)
    assert.doesNotMatch(text, /run: .*\$\{\{/, `${eol}: no expression is interpolated into a run command`)
    assert.match(text, /if: github\.event_name != 'schedule' \|\| vars\.SYNC_STAGE == 'C'/, eol)

    assert.doesNotMatch(text, /workflows: write|administration|secrets: write/, eol)
  }
})

test('registry sync: the stage A report job holds no write permission, and only the write job does', () => {
  for (const [eol, text] of both(read('.github/workflows/registry-sync.yml'))) {
    const jobs = text.split(/\r?\n(?= {2}[a-z]+:\r?$)/m)
    const job = name => jobs.find(j => new RegExp(`^ {2}${name}:\\r?$`, 'm').test(j))
    assert.doesNotMatch(job('collect'), /: write/, eol)
    assert.doesNotMatch(job('report'), /: write/, eol)
    assert.match(job('report'), /if: vars\.SYNC_STAGE != 'B' && vars\.SYNC_STAGE != 'C'/, eol)
    assert.match(job('write'), /if: github\.ref == 'refs\/heads\/main' && \(vars\.SYNC_STAGE == 'B' \|\| vars\.SYNC_STAGE == 'C'/, eol)
  }
})

test('main integrity runs on push and on its own schedule, read-only', () => {
  for (const [eol, text] of both(read('.github/workflows/main-integrity.yml'))) {
    assert.match(text, /^ {2}push:\r?\n {4}branches: \[main\]\r?$/m, eol)
    assert.match(text, /^ {2}schedule:\r?\n {4}- cron: '\d+ \*\/6 \* \* \*'\r?$/m, eol)
    assert.match(text, /^permissions:\r?\n {2}contents: read\r?\n {2}pull-requests: read\r?$/m, eol)
    const code = text.split(/\r?\n/).filter(l => !/^\s*#/.test(l)).join('\n')
    assert.doesNotMatch(code, /: write/, eol)
  }
})

test('sync code makes no AI or non-GitHub network calls', () => {
  for (const f of readdirSync(resolve(ROOT, 'scripts/sync')).filter(f => f.endsWith('.mjs') && !f.endsWith('.test.mjs'))) {
    const text = read(`scripts/sync/${f}`)
    assert.doesNotMatch(text, /anthropic|openai|generativelanguage|googleapis|copilot\.|api\.githubcopilot/i, f)
    for (const m of text.matchAll(/https:\/\/([a-z0-9.-]+)/g)) assert.ok(['api.github.com', 'github.com'].includes(m[1]), `${f} references ${m[1]}`)
  }
})

test('project template: read-only, versioned, no secrets', () => {
  for (const [eol, text] of both(read('templates/project/one-small-report.yml'))) {
    assert.match(text.split(/\r?\n/)[0], /^# one-small-report template v1\.[^\r]*$/, eol)
    // Exactly one permissions block, granting only contents: read.
    assert.match(text, /^permissions:\r?\n {2}contents: read\r?\n\r?\n/m, eol)
    assert.equal(text.match(/^permissions:/gm).length, 1, eol)
    assert.doesNotMatch(text, /: write\b/, eol)
    assert.doesNotMatch(text, /secrets\.|\$\{\{\s*github\.event/, eol)
  }
})

test('every AI adapter points at the shared specs and matches their versions', () => {
  for (const [eol, text] of both(read('agents/project-assessor.md'))) assert.match(text, /^assessor-spec: 1\r?$/m, eol)
  for (const [eol, text] of both(read('agents/onboard-project.md'))) assert.match(text, /^onboard-spec: 1\r?$/m, eol)
  const adapters = ['.claude/skills/assess-project/SKILL.md', '.github/prompts/assess-project.prompt.md', 'AGENTS.md', 'GEMINI.md', '.github/copilot-instructions.md']
  for (const a of adapters) {
    const t = read(a)
    assert.match(t, /agents\/project-assessor\.md/, a)
    assert.match(t, /assessor-spec: 1/, a)
  }
  for (const a of ['.claude/skills/onboard-project/SKILL.md', '.github/prompts/onboard-project.prompt.md', 'AGENTS.md', 'GEMINI.md']) assert.match(read(a), /onboard-spec: 1/, a)
})

test('a manual registry-sync dry run never dispatches a real auto-merge', () => {
  // GitHub Copilot review of PR #40 (2026-11-02): the dispatch used dry_run=false unconditionally.
  const t = read('.github/workflows/registry-sync.yml')
  const step = t.match(/- name: Request auto-merge evaluation\r?\n([\s\S]*?)\r?\n {6}- |- name: Request auto-merge evaluation\r?\n([\s\S]*)$/)
  assert.ok(step, 'the dispatch step exists')
  assert.match(step[0], /if: always\(\) && !\(github\.event_name == 'workflow_dispatch' && inputs\.dry_run\)/)
})

test('auto-merge workflow never checks out PR code and holds only the permissions it needs', () => {
  const t = read('.github/workflows/automerge.yml')
  assert.match(t, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/)
  assert.doesNotMatch(t, /ref: \$\{\{ github\.event\.workflow_run/)
  assert.match(t, /^permissions: \{\}\r?$/m)
  // Anchored to the job-level permissions block, so a comment or another job cannot satisfy it
  // (GitHub Copilot review of PR #41, 2026-11-02).
  const perms = t.match(/^ {4}permissions:\r?\n((?: {6}[a-z-]+: (?:read|write)[^\n]*\r?\n)+)/m)
  assert.ok(perms, 'auto-merge job has its own permissions block')
  const granted = Object.fromEntries([...perms[1].matchAll(/^ {6}([a-z-]+): (read|write)/gm)].map(m => [m[1], m[2]]))
  assert.deepEqual(granted, { contents: 'write', 'pull-requests': 'write', actions: 'write', checks: 'read' }, 'exactly the scopes auto-merge needs; checks: read was found by the first live run')
  // workflow_run (a dangerous trigger, zizmor) was removed on 2026-11-05: GitHub never fired it for
  // the GITHUB_TOKEN-dispatched validation runs, so sync's explicit dispatch and the schedule drive it.
  assert.doesNotMatch(t, /^\s*workflow_run:/m)
  assert.doesNotMatch(t, /pull-requests: write[\s\S]*(issues|packages|deployments|id-token): write/)
})

test('change watch: hourly, read-only detection, dispatches only the existing sync, holds no write beyond actions', () => {
  for (const [eol, t] of both(read('.github/workflows/watch.yml'))) {
    assert.match(t, /cron: '\d+ \* \* \* \*'/, eol)
    assert.match(t, /^permissions: \{\}\r?$/m, eol)
    const jobs = t.split(/\r?\n(?= {2}[a-z]+:\r?$)/m)
    const detect = jobs.find(j => /^ {2}detect:/m.test(j))
    assert.doesNotMatch(detect, /: write/, eol)
    assert.match(t, /actions: write/, eol)
    assert.doesNotMatch(t, /contents: write|pull-requests: write|secrets\.(?!SYNC_READER_TOKEN)/, eol)
    assert.match(t, /vars\.SYNC_STAGE == 'C'/, eol)
    assert.match(t, /registry-sync\.yml\/dispatches/, eol)
  }
})
