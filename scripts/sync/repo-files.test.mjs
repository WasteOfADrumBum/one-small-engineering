// Static checks on workflows, the project template and the AI adapters.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { ROOT } from './lib.mjs'

const read = p => readFileSync(resolve(ROOT, p), 'utf8')
const workflows = readdirSync(resolve(ROOT, '.github/workflows')).map(f => [f, read(`.github/workflows/${f}`)])

test('no workflow uses pull_request_target, workflow_run or unpinned actions', () => {
  for (const [f, text] of [...workflows, ['template', read('templates/project/one-small-report.yml')]]) {
    assert.doesNotMatch(text, /pull_request_target|workflow_run|repository_dispatch/, f)
    for (const m of text.matchAll(/uses:\s*(\S+)/g)) assert.match(m[1], /@[0-9a-f]{40}$/, `${f}: ${m[1]} must be pinned to a commit SHA`)
    assert.match(text, /persist-credentials: false/, f)
  }
})

test('registry sync: schedule every six hours, empty default permissions, writes only from main', () => {
  const text = read('.github/workflows/registry-sync.yml')
  assert.match(text, /cron: '\d+ \*\/6 \* \* \*'/)
  assert.match(text, /^permissions: \{\}$/m)
  assert.match(text, /if: github\.ref == 'refs\/heads\/main'/)
  assert.match(text, /cancel-in-progress: false/)
  assert.match(text, /SYNC_WRITE_ENABLED == 'true'/)
  assert.doesNotMatch(text, /workflows: write|administration|secrets: write/)
})

test('sync code makes no AI or non-GitHub network calls', () => {
  for (const f of readdirSync(resolve(ROOT, 'scripts/sync')).filter(f => f.endsWith('.mjs') && !f.endsWith('.test.mjs'))) {
    const text = read(`scripts/sync/${f}`)
    assert.doesNotMatch(text, /anthropic|openai|generativelanguage|googleapis|copilot\.|api\.githubcopilot/i, f)
    for (const m of text.matchAll(/https:\/\/([a-z0-9.-]+)/g)) assert.ok(['api.github.com', 'github.com'].includes(m[1]), `${f} references ${m[1]}`)
  }
})

test('project template: read-only, versioned, no secrets', () => {
  const text = read('templates/project/one-small-report.yml')
  assert.match(text.split('\n')[0], /^# one-small-report template v1\./)
  assert.match(text, /^permissions:\n {2}contents: read$/m)
  assert.doesNotMatch(text, /secrets\.|\$\{\{\s*github\.event/)
})

test('every AI adapter points at the shared specs and matches their versions', () => {
  const assess = read('agents/project-assessor.md')
  const onboard = read('agents/onboard-project.md')
  assert.match(assess, /^assessor-spec: 1$/m)
  assert.match(onboard, /^onboard-spec: 1$/m)
  const adapters = ['.claude/skills/assess-project/SKILL.md', '.github/prompts/assess-project.prompt.md', 'AGENTS.md', 'GEMINI.md', '.github/copilot-instructions.md']
  for (const a of adapters) {
    const t = read(a)
    assert.match(t, /agents\/project-assessor\.md/, a)
    assert.match(t, /assessor-spec: 1/, a)
  }
  for (const a of ['.claude/skills/onboard-project/SKILL.md', '.github/prompts/onboard-project.prompt.md', 'AGENTS.md', 'GEMINI.md']) assert.match(read(a), /onboard-spec: 1/, a)
})
