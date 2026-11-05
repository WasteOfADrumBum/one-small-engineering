#!/usr/bin/env node
// Runs `npm run check` (registry validation + the full test suite) and reports how many tests
// passed and failed as step outputs, so the merge gate can refuse a green run that ran no tests.

import { spawn } from 'node:child_process'
import { appendFileSync } from 'node:fs'

export function testCounts(text) {
  const all = [...String(text).matchAll(/^# (pass|fail) (\d+)$/gm)]
  const last = k => { const m = all.filter(x => x[1] === k).pop(); return m ? m[2] : null }
  return { passed: last('pass'), failed: last('fail') }
}

if (process.argv[1] && process.argv[1].endsWith('run-check.mjs')) {
  const child = spawn('npm', ['run', 'check'], { stdio: ['ignore', 'pipe', 'inherit'], shell: false })
  let out = ''
  child.stdout.on('data', d => { out += d; process.stdout.write(d) })
  child.on('close', code => {
    const { passed, failed } = testCounts(out)
    console.log(`run-check: exit ${code}, ${passed ?? 'no'} passed, ${failed ?? 'unknown'} failed`)
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `tests-passed=${passed ?? ''}\ntests-failed=${failed ?? ''}\n`)
    process.exitCode = code === 0 && passed !== null && failed === '0' ? 0 : 1
  })
}
