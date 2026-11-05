import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classify, changedFiles } from './changes.mjs'
import { testCounts } from './run-check.mjs'

test('only a pull request with a computed, non-empty diff may narrow the work', () => {
  for (const event of ['push', 'merge_group', 'workflow_dispatch', 'schedule']) assert.equal(classify({ event, files: ['README.md'] }).isolation, true, event)
  assert.equal(classify({ event: 'pull_request', files: null }).isolation, true)
  assert.equal(classify({ event: 'pull_request', files: [] }).isolation, true)
  assert.equal(classify({ event: 'pull_request', files: ['docs/x.md', 'projects/registry.json'] }).isolation, false)
})

test('changes to execution, CI scripts, workflows, the gate policy or the manifest run the isolation test', () => {
  for (const f of ['scripts/verify/exec.mjs', 'scripts/engineering/cli.mjs', 'scripts/ci/gate.mjs', 'ci/gate-policy.json', '.github/workflows/validate.yml', '.github/dependabot.yml', 'package.json', 'package-lock.json']) {
    assert.equal(classify({ event: 'pull_request', files: ['docs/a.md', f] }).isolation, true, f)
  }
})

test('a diff that cannot be computed falls back to running everything', () => {
  assert.equal(changedFiles({ base: 'short', head: 'a'.repeat(40) }), null)
  assert.equal(changedFiles({ base: 'a'.repeat(40), head: 'b'.repeat(40), git: () => ({ status: 128, stdout: '' }) }), null)
  assert.deepEqual(changedFiles({ base: 'a'.repeat(40), head: 'b'.repeat(40), git: () => ({ status: 0, stdout: 'a.md\0b c.md\0' }) }), ['a.md', 'b c.md'])
})

test('test counts come from the final node --test summary; a missing summary is null, not zero', () => {
  assert.deepEqual(testCounts('# pass 3\n# fail 0\n...\n# pass 472\n# fail 0\n'), { passed: '472', failed: '0' })
  assert.deepEqual(testCounts('npm ERR! nothing ran'), { passed: null, failed: null })
})
