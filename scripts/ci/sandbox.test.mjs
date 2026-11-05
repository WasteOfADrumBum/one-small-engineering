// The project-code sandbox as the collectors' runner builds it. The real boundary is proven on a
// runner by scripts/ci/sandbox-selftest.mjs (validate.yml job "isolation"); these tests pin the
// command it runs, that no credential crosses into it, and that a survivor fails the command.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRunner, sandboxInvocation, SandboxError, scrubbedEnv } from '../verify/exec.mjs'

const parentEnv = { PATH: '/usr/bin:/bin', HOME: '/home/runner', GITHUB_TOKEN: 'ghs_secret', ACTIONS_RUNTIME_TOKEN: 'rt', ONE_SMALL_SANDBOX_USER: 'osrun' }

function fakeSpawn({ survivors = 0 } = {}) {
  const calls = []
  let left = survivors
  const spawn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts })
    if (cmd === 'ps') { const alive = left-- > 0; return { status: alive ? 0 : 1, stdout: alive ? 'S\n' : '' } }
    if (cmd === 'sudo' && args[1] === 'pkill') return { status: 0, stdout: '' }
    return { status: 0, stdout: 'ok', stderr: '' }
  }
  return { spawn, calls }
}

test('sandboxed commands run as the sandbox user through sudo with env -i and no inherited credential', () => {
  const { spawn, calls } = fakeSpawn()
  const res = createRunner({ spawn, parentEnv })('npm', ['ci', '--ignore-scripts'], { cwd: '/tmp/one-small-work/p' })
  assert.equal(res.status, 0)
  const c = calls[0]
  assert.equal(c.cmd, 'sudo')
  assert.deepEqual(c.args.slice(0, 6), ['-n', '-u', 'osrun', '--', '/usr/bin/env', '-i'])
  assert.deepEqual(c.args.slice(-3), ['sandboxed', 'npm', 'ci', '--ignore-scripts'].slice(-3))
  const all = JSON.stringify(c)
  assert.doesNotMatch(all, /ghs_secret|ACTIONS_RUNTIME_TOKEN|GITHUB_TOKEN/)
  assert.ok(c.args.includes('HOME=/home/osrun'))
  assert.deepEqual(Object.keys(c.opts.env), ['PATH'], 'sudo itself gets only PATH')
  assert.equal(c.opts.shell, false)
})

test('every process the sandbox user left behind is killed after each command', () => {
  const { spawn, calls } = fakeSpawn({ survivors: 2 })
  const res = createRunner({ spawn, parentEnv })('node', ['x.js'])
  assert.equal(res.status, 0)
  assert.equal(calls.filter(c => c.cmd === 'sudo' && c.args[1] === 'pkill').length, 3)
})

test('a process that cannot be killed fails the command instead of passing', () => {
  const { spawn } = fakeSpawn({ survivors: 99 })
  const res = createRunner({ spawn, parentEnv })('node', ['x.js'])
  assert.equal(res.status, null)
  assert.equal(res.error, 'sandbox-survivors')
})

test('a credential is never passed into the sandbox, even when a caller asks', () => {
  assert.throws(() => sandboxInvocation('osrun', 'git', ['fetch'], { GIT_CONFIG_VALUE_0: 'AUTHORIZATION: basic x' }), SandboxError)
  assert.throws(() => sandboxInvocation('osrun', 'x', [], { NPM_TOKEN: 'x' }), SandboxError)
  const { spawn, calls } = fakeSpawn()
  const res = createRunner({ spawn, parentEnv })('git', ['fetch'], { env: { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.extraheader', GIT_CONFIG_VALUE_0: 'AUTHORIZATION: basic x' } })
  assert.equal(res.error, 'sandbox-refused')
  assert.equal(calls.length, 0, 'nothing was run')
})

test('an invalid sandbox user name is refused before anything runs', () => {
  assert.throws(() => createRunner({ spawn: () => { throw new Error('ran') }, parentEnv: { ...parentEnv, ONE_SMALL_SANDBOX_USER: 'root; rm -rf /' } }), SandboxError)
})

test('without a sandbox user the runner keeps the scrubbed environment and runs directly', () => {
  const { spawn, calls } = fakeSpawn()
  createRunner({ spawn, parentEnv: { ...parentEnv, ONE_SMALL_SANDBOX_USER: '' } })('npm', ['test'])
  assert.equal(calls[0].cmd, 'npm')
  assert.equal(calls[0].opts.env.GITHUB_TOKEN, undefined)
  assert.deepEqual(Object.keys(scrubbedEnv(parentEnv)).sort(), ['CI', 'GIT_TERMINAL_PROMPT', 'HOME', 'PATH', 'npm_config_audit', 'npm_config_fund', 'npm_config_update_notifier'])
})
