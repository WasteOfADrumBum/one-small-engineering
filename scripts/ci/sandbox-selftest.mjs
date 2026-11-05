#!/usr/bin/env node
// Proves on a real runner that the project-code sandbox holds (docs/ci-cd.md#project-code-isolation).
// A hostile "project" script tries what a compromised dependency would: read a token from any
// process environment, read the hub checkout and runner files, use sudo or docker, and leave a
// process behind. It runs through the same runner the collectors use (scripts/verify/exec.mjs).
//
// A control run of the same script as the runner user, without the sandbox, must find the canary.
// That proves the probe can detect a leak, so a passing sandbox result is not a no-op.
//
// Env: ONE_SMALL_SANDBOX_USER, ONE_SMALL_WORK, ISOLATION_CANARY (set by the workflow).

import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRunner } from '../verify/exec.mjs'

const HOSTILE = `
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { connect } from 'node:net'
const [canary, workspace, home] = process.argv.slice(2)
const r = { envLeak: false, procLeak: false, procReadable: 0, workspaceReadable: false, homeReadable: false, sudo: false, docker: false }
r.envLeak = Object.entries(process.env).some(([k, v]) => /TOKEN|SECRET/i.test(k) || String(v).includes(canary))
for (const pid of readdirSync('/proc').filter(d => /^\\d+$/.test(d))) {
  try { const e = readFileSync('/proc/' + pid + '/environ', 'latin1'); r.procReadable++; if (e.includes(canary) || /(^|\\0)(GITHUB_TOKEN|ACTIONS_RUNTIME_TOKEN|ACTIONS_ID_TOKEN_REQUEST_TOKEN)=/.test(e)) r.procLeak = true } catch {}
}
try { readFileSync(workspace + '/package.json'); r.workspaceReadable = true } catch {}
try { readdirSync(home); r.homeReadable = true } catch {}
r.sudo = spawnSync('sudo', ['-n', 'true'], { stdio: 'ignore' }).status === 0
await new Promise(res => { const s = connect('/var/run/docker.sock'); s.on('connect', () => { r.docker = true; s.destroy(); res() }); s.on('error', () => res()) })
// A process that outlives this one, as a dependency's postinstall might leave behind.
spawn('sleep', ['300'], { detached: true, stdio: 'ignore' }).unref()
console.log('HOSTILE-REPORT ' + JSON.stringify(r))
`

const env = process.env
const user = env.ONE_SMALL_SANDBOX_USER
const work = env.ONE_SMALL_WORK
const canary = env.ISOLATION_CANARY
if (!user || !work || !canary) { console.error('sandbox-selftest: needs ONE_SMALL_SANDBOX_USER, ONE_SMALL_WORK and ISOLATION_CANARY (run scripts/ci/sandbox-setup.sh first)'); process.exit(2) }
if (!env.GITHUB_TOKEN) { console.error('sandbox-selftest: the job token must be in this process for the test to mean anything'); process.exit(2) }

process.umask(0)
const dir = join(work, 'selftest')
mkdirSync(dir, { recursive: true })
writeFileSync(join(dir, 'hostile.mjs'), HOSTILE)
const args = [join(dir, 'hostile.mjs'), canary, env.GITHUB_WORKSPACE || process.cwd(), env.HOME]
const parse = res => { const line = String(res.stdout).split('\n').find(l => l.startsWith('HOSTILE-REPORT ')); return line ? JSON.parse(line.slice(15)) : null }

const problems = []
// 1. Sandboxed, through the collectors' runner.
const sandboxed = createRunner()(process.execPath, args, { cwd: dir, timeoutMs: 60_000 })
const s = parse(sandboxed)
if (!s) problems.push(`the hostile script produced no report (status ${sandboxed.status}, error ${sandboxed.error}): ${sandboxed.stderr.slice(-300)}`)
else {
  for (const k of ['envLeak', 'procLeak', 'workspaceReadable', 'homeReadable', 'sudo', 'docker']) if (s[k]) problems.push(`sandboxed project code could ${k}`)
}
if (sandboxed.error === 'sandbox-survivors') problems.push('a sandbox process survived the command')
const left = spawnSync('ps', ['-o', 'pid=,stat=', '-u', user], { encoding: 'utf8' })
const alive = String(left.stdout).split('\n').filter(l => l.trim() && !/\sZ/.test(l))
if (alive.length) problems.push(`processes of ${user} are still running after the command: ${alive.join(', ')}`)
if (String(sandboxed.stdout).includes(canary) || String(sandboxed.stderr).includes(canary)) problems.push('the canary appeared in sandbox output')

// 2. Control: the same probe as the runner user without the sandbox must see the leak.
const control = createRunner({ parentEnv: { ...env, ONE_SMALL_SANDBOX_USER: '' } })(process.execPath, args, { cwd: dir, timeoutMs: 60_000 })
const c = parse(control)
spawnSync('pkill', ['-KILL', '-f', '^sleep 300$'])
if (!c) problems.push('the control run produced no report')
else if (!c.procLeak) problems.push('control run did not detect the canary in its parent environment, so the probe proves nothing')

console.log(`sandbox-selftest: sandboxed ${JSON.stringify(s)}`)
console.log(`sandbox-selftest: control (no sandbox) ${JSON.stringify(c)}`)
for (const p of problems) console.log(`::error title=isolation::${p}`)
console.log(problems.length ? `isolation: FAIL (${problems.length})` : 'isolation: project code cannot read the job token, reach the runner home, use sudo or docker, or outlive its command; the control run proves the probe detects a leak')
process.exitCode = problems.length ? 1 : 0
