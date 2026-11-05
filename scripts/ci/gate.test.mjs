// Merge gate decisions: every required job must succeed with evidence, or be skipped exactly where
// the policy allows it. Fixtures only; no network.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decide, loadGatePolicy, render } from './gate.mjs'

const policy = loadGatePolicy()
const ok = () => ({
  changes: { result: 'success', outputs: { isolation: 'true', files: '3' } },
  validate: { result: 'success', outputs: { 'tests-passed': '519', 'tests-failed': '0' } },
  security: { result: 'success', outputs: { scanners: 'actionlint,zizmor,gitleaks,policy' } },
  isolation: { result: 'success', outputs: {} }
})

test('all required jobs green with evidence: pass', () => {
  const d = decide({ needs: ok(), policy, event: 'pull_request' })
  assert.equal(d.ok, true, d.problems.join('; '))
  assert.ok(d.rows.every(r => r.verdict === 'pass'))
})

for (const result of ['failure', 'cancelled', null, 'neutral', 'timed_out']) {
  test(`a required job that ended ${result} fails the gate`, () => {
    const n = ok(); n.validate.result = result
    const d = decide({ needs: n, policy, event: 'pull_request' })
    assert.equal(d.ok, false)
    assert.match(d.problems.join('\n'), /required job "validate" ended/)
  })
}

test('the allowed skip: isolation on a pull request the change classifier excluded', () => {
  const n = ok(); n.changes.outputs.isolation = 'false'; n.isolation = { result: 'skipped', outputs: {} }
  const d = decide({ needs: n, policy, event: 'pull_request' })
  assert.equal(d.ok, true, d.problems.join('; '))
  assert.equal(d.rows.find(r => r.job === 'isolation').verdict, 'allowed-skip')
})

test('unexpected skips fail: wrong event, classifier said run, classifier failed, job never allowed to skip', () => {
  const cases = [
    ['push', n => { n.changes.outputs.isolation = 'false'; n.isolation.result = 'skipped' }, /allowed only for pull_request/],
    ['workflow_dispatch', n => { n.changes.outputs.isolation = 'false'; n.isolation.result = 'skipped' }, /allowed only for pull_request/],
    ['pull_request', n => { n.isolation.result = 'skipped' }, /changes\.isolation is "true"/],
    ['pull_request', n => { n.changes = { result: 'failure', outputs: {} }; n.isolation.result = 'skipped' }, /changes\.isolation is null/],
    ['pull_request', n => { n.security.result = 'skipped' }, /allows no skip/]
  ]
  for (const [event, edit, re] of cases) {
    const n = ok(); edit(n)
    const d = decide({ needs: n, policy, event })
    assert.equal(d.ok, false, `${event}`)
    assert.match(d.problems.join('\n'), re)
  }
})

test('a required job missing from needs, or an unknown extra dependency, fails the gate', () => {
  let n = ok(); delete n.security
  assert.match(decide({ needs: n, policy, event: 'push' }).problems.join('\n'), /"security" is not a dependency/)
  n = ok(); n.surprise = { result: 'success', outputs: {} }
  assert.match(decide({ needs: n, policy, event: 'push' }).problems.join('\n'), /"surprise" is a dependency of ci-gate but not in/)
})

test('a green job without evidence of work is refused (no-op validation)', () => {
  const cases = [
    [n => { n.validate.outputs['tests-passed'] = '0' }, /tests-passed=/],
    [n => { n.validate.outputs['tests-passed'] = '' }, /tests-passed=/],
    [n => { n.validate.outputs = {} }, /tests-passed=null/],
    [n => { n.validate.outputs['tests-failed'] = '2' }, /tests-failed/],
    [n => { n.security.outputs.scanners = 'actionlint,policy' }, /scanners/],
    [n => { n.changes.outputs.isolation = 'maybe' }, /isolation/]
  ]
  for (const [edit, re] of cases) {
    const n = ok(); edit(n)
    const d = decide({ needs: n, policy, event: 'pull_request' })
    assert.equal(d.ok, false)
    assert.match(d.problems.join('\n'), re)
  }
})

test('the summary separates gate result from verification and approval, and states protection is not enforced', () => {
  const d = decide({ needs: ok(), policy, event: 'pull_request' })
  const md = render({ decision: d, ctx: { event: 'pull_request', ref: 'x', evaluatedSha: 'a'.repeat(40), headSha: 'b'.repeat(40), baseSha: 'c'.repeat(40), runId: '1', runAttempt: '2', policyVersion: 1 } })
  assert.match(md, /Run \/ attempt \| 1 \/ 2/)
  assert.match(md, /not enforced by GitHub/)
  assert.match(md, /not project verification, independent review or release approval/)
  assert.match(md, /`aaaaaaaaaaaa`/)
})

test('the policy requires the jobs the gate depends on and allows only the isolation skip', () => {
  assert.deepEqual(policy.required, ['changes', 'validate', 'security', 'isolation'])
  assert.deepEqual(Object.keys(policy.allowedSkips), ['isolation'])
  assert.deepEqual(policy.allowedSkips.isolation.events, ['pull_request'])
})
