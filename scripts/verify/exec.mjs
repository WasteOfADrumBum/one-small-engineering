// Running commands for collectors: argument arrays (never a shell), a time limit, a scrubbed
// environment and redacted, size-capped output.
//
// Project code (npm test, a build) is untrusted. It runs with an environment built from an
// allowlist, so GITHUB_TOKEN, ACTIONS_RUNTIME_TOKEN, READER_TOKEN and every other credential in
// the parent process never reach it. In GitHub Actions the job that runs it also holds no write
// permission (.github/workflows/verify.yml).

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

// { status, stdout, stderr, timedOut, error } — never throws for a failing command.
export function createRunner({ spawn = spawnSync, parentEnv = process.env } = {}) {
  return function run(cmd, args, { cwd, timeoutMs = 300_000, env = {} } = {}) {
    if (!Array.isArray(args)) throw new Error('args must be an array')
    const res = spawn(cmd, args, { cwd, env: scrubbedEnv(parentEnv, env), encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, shell: false, windowsHide: true })
    const timedOut = Boolean(res.error && res.error.code === 'ETIMEDOUT') || res.signal === 'SIGTERM'
    return {
      status: typeof res.status === 'number' ? res.status : null,
      stdout: tail(res.stdout),
      stderr: tail(res.stderr),
      timedOut,
      error: res.error ? `${res.error.code || 'error'}` : null
    }
  }
}

// The last `n` non-empty lines of a command's output, for a check's detail.
export function lastLines(text, n = 5) {
  return String(text || '').split(/\r?\n/).filter(l => l.trim()).slice(-n).join('\n')
}
