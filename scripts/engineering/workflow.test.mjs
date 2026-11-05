// Static checks on the workflow files: the guarantees that must not drift with an edit.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const wf = name => readFileSync(join(ROOT, '.github/workflows', name), 'utf8').replace(/\r\n?/g, '\n')
// Splits a workflow into its jobs' text.
const jobs = text => { const out = {}; const body = text.split(/^jobs:\n/m)[1]; for (const part of body.split(/^ {2}(?=[a-z][\w-]*:\n)/m).filter(Boolean)) out[part.split(':')[0]] = part; return out }

test('engineering.yml: least privilege, six-hour schedule, queued concurrency, no write permission anywhere', () => {
  const t = wf('engineering.yml')
  assert.match(t, /^permissions: \{\}$/m)
  assert.match(t, /cron: '17 \*\/6 \* \* \*'/)
  assert.match(t, /concurrency:\n {2}group: engineering-\$\{\{ github\.ref \}\}\n {2}cancel-in-progress: false/)
  assert.doesNotMatch(t, /: write/)
  assert.doesNotMatch(t, /pull_request_target/)
  assert.doesNotMatch(t, /REMEDIATION_TOKEN/)
  for (const [name, j] of Object.entries(jobs(t))) {
    assert.match(j, /timeout-minutes: \d+/, `${name} has a timeout`)
    assert.match(j, /permissions:\n {6}contents: read/, `${name} declares read-only permissions`)
    if (/actions\/checkout/.test(j)) assert.match(j, /persist-credentials: false/, `${name} does not persist credentials`)
  }
})

test('engineering.yml: project code runs only in a manual job with no secret and no API token; schedules never execute', () => {
  const j = jobs(wf('engineering.yml'))
  assert.match(j.execute, /if: github\.event_name == 'workflow_dispatch' && inputs\.execute/)
  assert.doesNotMatch(j.execute, /secrets\.|GITHUB_TOKEN/)
  assert.match(j.execute, /--no-api/)
  assert.doesNotMatch(j.observe, /--execute/)
  // Pull requests cannot trigger this workflow at all (2026-11-05), so the reader secret never reaches PR code.
  assert.doesNotMatch(wf('engineering.yml'), /^ {2}pull_request(_target)?:/m, 'no pull request trigger')
  for (const [name, job] of Object.entries(j)) if (name !== 'observe') assert.doesNotMatch(job, /secrets\./, `${name} holds no secret`)
  // Project code runs as the sandbox user (scripts/ci/sandbox-setup.sh), never as the runner user.
  assert.match(j.execute, /sandbox-setup\.sh[\s\S]*--execute/)
  assert.match(j.observe, /cache\/save@[0-9a-f]{40}\n {8}if: github\.ref == 'refs\/heads\/main' && github\.event_name != 'pull_request'/, 'only main writes the shared state cache')
  assert.match(j.observe, /retention-days: 30/)
  assert.match(j.prepare, /if: github\.event_name == 'workflow_dispatch' && inputs\.mode == 'prepare'/)
  assert.doesNotMatch(j.prepare, /secrets\./)
  for (const m of wf('engineering.yml').matchAll(/uses: ([^\s]+)/g)) assert.match(m[1], /@[0-9a-f]{40}$/, `${m[1]} is pinned to a commit`)
})

test('remediation.yml: manual only, from main, gated, token only in the step that opens the PR', () => {
  const t = wf('remediation.yml')
  assert.match(t, /^on:\n {2}workflow_dispatch:/m)
  assert.doesNotMatch(t, /schedule:|pull_request|push:/)
  assert.match(t, /if: github\.ref == 'refs\/heads\/main' && vars\.REMEDIATION_WRITE_ENABLED == 'true' && inputs\.confirm == 'create one draft remediation PR'/)
  assert.match(t, /cancel-in-progress: false/)
  const steps = t.split(/\n {6}- /)
  const withToken = steps.filter(s => /REMEDIATION_TOKEN: \$\{\{ secrets/.test(s))
  assert.equal(withToken.length, 1)
  assert.match(withToken[0], /^name: Open the draft PR/)
  assert.match(steps.find(s => /Prepare the proposal again/.test(s)), /prepare --project/)
  assert.doesNotMatch(steps.find(s => /Prepare the proposal again/.test(s)), /--execute|secrets\./)
})

test('verify.yml no longer schedules its own collection (engineering.yml does, incrementally)', () => {
  assert.doesNotMatch(wf('verify.yml'), /^\s+schedule:/m)
  assert.match(wf('verify.yml'), /^permissions: \{\}$/m)
})
