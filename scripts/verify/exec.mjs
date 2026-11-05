// Running commands for collectors: argument arrays (never a shell), a time limit, a scrubbed
// environment and redacted, size-capped output.
//
// Project code (npm test, a build) is untrusted. It runs with an environment built from an
// allowlist, so GITHUB_TOKEN, ACTIONS_RUNTIME_TOKEN, READER_TOKEN and every other credential in
// the parent process never reach it. In GitHub Actions the job that runs it also holds no write
// permission (.github/workflows/verify.yml).
//
// An allowlisted environment alone is not a boundary: a child running as the same user can read
// its parent's environment from /proc/<pid>/environ and can leave a process behind that outlives
// the step and reads the next action's runtime token. So in CI every command runs as a separate,
// unprivileged sandbox user (ONE_SMALL_SANDBOX_USER, created by scripts/ci/sandbox-setup.sh), and
// every process that user still has is killed after each command. A credential is never passed
// into the sandbox. scripts/ci/sandbox-selftest.mjs proves this on a real runner.

import { spawnSync } from 'node:child_process'
import { redactSensitive } from '../validate-registry.mjs'

const SAFE_ENV = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR', 'TEMP', 'TMP', 'SYSTEMROOT', 'COMSPEC', 'PATHEXT', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'NODE_EXTRA_CA_CERTS', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'no_proxy', 'SSL_CERT_FILE']
const MAX_OUTPUT = 200_000

export function scrubbedEnv(parent = process.env, extra = {}) {
  const env = {}
  for (const k of SAFE_ENV) if (parent[k] !== undefined) env[k] = parent[k]
  // Non-interactive and quiet: no prompts, no telemetry, no update checks.
  Object.assign(env, { CI: 'true', GIT_TERMINAL_PROMPT: '0', npm_config_fund: 'false', npm_config_audit: 'false', npm_config_update_notifier: 'false' }, extra)
  return env
}

const tail = s => {
  const t = String(s || '')
  return redactSensitive(t.length > MAX_OUTPUT ? t.slice(-MAX_OUTPUT) : t)
}

export const SANDBOX_USER = /^[a-z_][a-z0-9_-]{0,31}$/
const CREDENTIAL_ENV = /^(GIT_CONFIG_(KEY|VALUE)_\d+|.*TOKEN.*|.*SECRET.*|.*PASSWORD.*|.*_KEY)$/i

export class SandboxError extends Error {}

const pause = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

// The sudo invocation that runs `cmd args` as `user` with exactly `env` (env -i: nothing inherited).
export function sandboxInvocation(user, cmd, args, env) {
  if (!SANDBOX_USER.test(user || '')) throw new SandboxError(`invalid sandbox user ${JSON.stringify(user)}`)
  const leaked = Object.keys(env).filter(k => CREDENTIAL_ENV.test(k))
  if (leaked.length) throw new SandboxError(`refused to pass ${leaked.join(', ')} into the sandbox`)
  const vars = Object.entries({ ...env, HOME: `/home/${user}`, TMPDIR: '/tmp', USER: user, LOGNAME: user }).map(([k, v]) => `${k}=${v}`)
  // umask 000: the hub (outside the sandbox) can still read and remove what project code writes.
  return { cmd: 'sudo', args: ['-n', '-u', user, '--', '/usr/bin/env', '-i', ...vars, '/bin/sh', '-c', 'umask 000 && exec "$@"', 'sandboxed', cmd, ...args] }
}

// { status, stdout, stderr, timedOut, error } — never throws for a failing command.
export function createRunner({ spawn = spawnSync, parentEnv = process.env } = {}) {
  const sandbox = parentEnv.ONE_SMALL_SANDBOX_USER || ''
  if (sandbox && !SANDBOX_USER.test(sandbox)) throw new SandboxError(`invalid ONE_SMALL_SANDBOX_USER ${JSON.stringify(sandbox)}`)
  // Kills every process the sandbox user still has; returns true when none is left.
  // Bounded: a killed process can take a moment to exit; zombies (state Z) hold nothing.
  const sweep = () => {
    for (let i = 0; i < 10; i++) {
      spawn('sudo', ['-n', 'pkill', '-KILL', '-u', sandbox], { encoding: 'utf8', shell: false, timeout: 30_000 })
      const left = spawn('ps', ['-o', 'stat=', '-u', sandbox], { encoding: 'utf8', shell: false, timeout: 30_000 })
      if (left.status === 1 || (left.status === 0 && String(left.stdout).split('\n').every(l => !l.trim() || l.trim().startsWith('Z')))) return true
      pause(200)
    }
    return false
  }
  return function run(cmd, args, { cwd, timeoutMs = 300_000, env = {} } = {}) {
    if (!Array.isArray(args)) throw new Error('args must be an array')
    const childEnv = scrubbedEnv(parentEnv, env)
    let call = { cmd, args }
    if (sandbox) {
      try { call = sandboxInvocation(sandbox, cmd, args, childEnv) } catch (e) { return { status: null, stdout: '', stderr: tail(e.message), timedOut: false, error: 'sandbox-refused' } }
    }
    const res = spawn(call.cmd, call.args, { cwd, env: sandbox ? { PATH: childEnv.PATH || '/usr/bin:/bin' } : childEnv, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, shell: false, windowsHide: true })
    const timedOut = Boolean(res.error && res.error.code === 'ETIMEDOUT') || res.signal === 'SIGTERM'
    const out = {
      status: typeof res.status === 'number' ? res.status : null,
      stdout: tail(res.stdout),
      stderr: tail(res.stderr),
      timedOut,
      error: res.error ? `${res.error.code || 'error'}` : null
    }
    // A process left behind could read the next step's credentials: kill it, and fail the command
    // if it cannot be killed.
    if (sandbox && !sweep()) return { ...out, status: null, error: 'sandbox-survivors' }
    return out
  }
}

// The last `n` non-empty lines of a command's output, for a check's detail.
export function lastLines(text, n = 5) {
  return String(text || '').split(/\r?\n/).filter(l => l.trim()).slice(-n).join('\n')
}
