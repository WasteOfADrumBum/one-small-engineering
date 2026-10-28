import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, cpSync, readdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { main, parseArgs, UsageError, checkPolicy, loadState } from './cli.mjs'
import { ev, fixtureRegistry, realRegistry, policy, read, SHA } from '../../fixtures/verify/helpers.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

// A throwaway copy of the inputs the CLI reads, with an optional registry and ledger.
function sandbox({ registry = realRegistry(), ledger = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ose-cli-'))
  for (const p of ['projects/registry.schema.json', 'standards/definition-of-done.md', 'verification/policy.json', 'verification/projects.json']) { mkdirSync(dirname(join(dir, p)), { recursive: true }); cpSync(join(ROOT, p), join(dir, p)) }
  writeFileSync(join(dir, 'projects/registry.json'), JSON.stringify(registry, null, 2))
  if (ledger) { mkdirSync(join(dir, 'verification/evidence'), { recursive: true }); writeFileSync(join(dir, 'verification/evidence/one-small-mods-pack.json'), JSON.stringify({ project: 'one-small-mods-pack', evidence: ledger })) }
  return dir
}
const capture = () => { const out = []; const err = []; return { out, err, log: s => out.push(s), error: s => err.push(s) } }
const NOW = () => new Date('2026-10-27T02:00:00Z')
const LOCAL = { PATH: process.env.PATH }

test('usage errors exit 2', async () => {
  assert.throws(() => parseArgs(['nope']), UsageError)
  assert.throws(() => parseArgs(['run', '--collector', 'magic']), /unknown collector/)
  assert.throws(() => parseArgs(['run', '--as-of', 'tomorrow']), /UTC time/)
  assert.throws(() => parseArgs(['record', '--project', 'x']), /record needs/)
  assert.throws(() => parseArgs(['remediate', '--plan', 'p.json']), /needs --plan and --repository/)
  const c = capture()
  assert.equal(await main(['run', '--project', 'no-such-project', '--no-network'], { ...c, root: sandbox(), env: LOCAL }), 2)
})

test('policy completeness: every catalog gate has a policy entry', () => {
  assert.deepEqual(checkPolicy(policy(), realRegistry()), [])
  const p = policy()
  delete p.gates['wcag-22-aa']
  p.gates['scope-complete'] = { automation: 'none', collectors: ['build-test'] }
  const errs = checkPolicy(p, realRegistry()).join(';')
  assert.match(errs, /no entry for gate wcag-22-aa/)
  assert.match(errs, /non-automatable gate lists collectors/)
})

test('record is refused in CI: automation never records verification', async () => {
  const dir = sandbox({ registry: fixtureRegistry(), ledger: [ev('release-packaging', 'pass', { gates: ['package-metadata-exports'] })] })
  for (const env of [{ CI: 'true' }, { GITHUB_ACTIONS: 'true' }]) {
    const c = capture()
    const code = await main(['record', '--project', 'one-small-mods-pack', '--gate', 'package-metadata-exports', '--verifier', 'Joshua Small', '--kind', 'human', '--method', 're-executed', '--result', 'pass', '--attestation', 'https://github.com/x/y/pull/1', '--notes', 'Re-ran npm pack at the candidate commit.'], { ...c, root: dir, env, now: NOW })
    assert.equal(code, 1)
    assert.match(c.err.join(''), /refused in CI/)
  }
  assert.ok(!existsSync(join(dir, 'verification/verifications')))
})

test('record refuses a verification that would not count, and writes nothing (real registry: Claude is not the named verifier)', async () => {
  const pack = ev('release-packaging', 'pass', { gates: ['package-metadata-exports'], commitSha: realRegistry().projects[0].release.candidate.headSha })
  const dir = sandbox({ ledger: [pack] })
  const c = capture()
  const code = await main(['record', '--project', 'one-small-mods-pack', '--gate', 'package-metadata-exports', '--verifier', 'Claude Code', '--kind', 'ai', '--tool', 'Claude Code', '--method', 're-executed', '--result', 'pass', '--evidence', pack.id, '--attestation', 'https://github.com/x/y/pull/1', '--notes', 'I checked my own work and it is fine.', '--verified-at', '2026-10-27T01:30:00Z'], { ...c, root: dir, env: LOCAL, now: NOW })
  assert.equal(code, 1)
  assert.match(c.err.join(''), /is not the verifier named in the registry \(Joshua Small\)/)
  assert.match(c.err.join(''), /not permitted/)
  assert.ok(!existsSync(join(dir, 'verification/verifications')))
})

test('end to end (fixture): a valid verification is recorded, raises readiness by one gate, and check tracks the reports', async () => {
  const pack = ev('release-packaging', 'pass', { gates: ['package-metadata-exports'] })
  const dir = sandbox({ registry: fixtureRegistry(), ledger: [pack] })
  let c = capture()
  assert.equal(await main(['report', '--as-of', '2026-10-27T02:00:00Z'], { ...c, root: dir, env: LOCAL }), 0)
  assert.match(c.out.join('\n'), /one-small-mods-pack: 0% \(0\/21 verified\)/)
  c = capture()
  assert.equal(await main(['record', '--project', 'one-small-mods-pack', '--gate', 'package-metadata-exports', '--verifier', 'Joshua Small', '--kind', 'human', '--method', 're-executed', '--result', 'pass', '--evidence', pack.id, '--attestation', 'https://github.com/x/y/pull/1#pullrequestreview-1', '--notes', 'Re-ran npm pack and read package.json at the candidate commit.', '--verified-at', '2026-10-27T01:30:00Z'], { ...c, root: dir, env: LOCAL, now: NOW }), 0, c.err.join('\n'))
  const file = JSON.parse(readFileSync(join(dir, 'verification/verifications/one-small-mods-pack.json'), 'utf8'))
  assert.equal(file.verifications.length, 1)
  // Recording the same thing twice is a no-op.
  assert.equal(await main(['record', '--project', 'one-small-mods-pack', '--gate', 'package-metadata-exports', '--verifier', 'Joshua Small', '--kind', 'human', '--method', 're-executed', '--result', 'pass', '--evidence', pack.id, '--attestation', 'https://github.com/x/y/pull/1#pullrequestreview-1', '--notes', 'Re-ran npm pack and read package.json at the candidate commit.', '--verified-at', '2026-10-27T01:30:00Z'], { ...capture(), root: dir, env: LOCAL, now: NOW }), 0)
  assert.equal(JSON.parse(readFileSync(join(dir, 'verification/verifications/one-small-mods-pack.json'), 'utf8')).verifications.length, 1)
  c = capture()
  assert.equal(await main(['report', '--as-of', '2026-10-27T02:00:00Z'], { ...c, root: dir, env: LOCAL }), 0)
  assert.match(c.out.join('\n'), /one-small-mods-pack: 4\.7% \(1\/21 verified\)/)
  assert.equal(await main(['check'], { ...capture(), root: dir, env: LOCAL }), 0)
  // A hand edit or a stray file makes check fail.
  const md = join(dir, 'reports/verification/dashboard.md')
  writeFileSync(md, readFileSync(md, 'utf8').replace('4.7%', '100%'))
  c = capture()
  assert.equal(await main(['check'], { ...c, root: dir, env: LOCAL }), 1)
  assert.match(c.err.join(''), /dashboard\.md/)
})

test('forged ledgers stop report generation instead of being read', async () => {
  const forged = { ...ev('release-packaging', 'fail', { gates: ['package-metadata-exports'] }), result: 'pass', failureReason: null }
  const dir = sandbox({ registry: fixtureRegistry(), ledger: [forged] })
  const c = capture()
  assert.equal(await main(['report', '--as-of', '2026-10-27T02:00:00Z'], { ...c, root: dir, env: LOCAL }), 1)
  assert.match(c.err.join(''), /digest does not match/)
})

test('remediate: an invalid plan is refused; a valid plan writes nothing without every gate open', async () => {
  const dir = sandbox()
  const planFile = join(dir, 'plan.json')
  const plan = { repository: 'https://github.com/WasteOfADrumBum/one-small-ui', baseRef: 'main', baseSha: SHA, branch: 'verify/remediation/x', title: 't', body: 'b', findings: [{ kind: 'defect', proposedFix: 'x', repository: 'https://github.com/WasteOfADrumBum/one-small-ui', commitSha: SHA }], files: [{ path: 'README.md', content: 'x' }] }
  writeFileSync(planFile, JSON.stringify({ ...plan, branch: 'main' }))
  let c = capture()
  assert.equal(await main(['remediate', '--plan', planFile, '--repository', plan.repository, '--confirm'], { ...c, root: dir, env: { REMEDIATION_WRITE_ENABLED: 'true', REMEDIATION_TOKEN: 'x' } }), 1)
  assert.match(c.err.join(''), /plan refused/)
  writeFileSync(planFile, JSON.stringify(plan))
  const fetchImpl = () => { throw new Error('network must not be used') }
  c = capture()
  assert.equal(await main(['remediate', '--plan', planFile, '--repository', plan.repository], { ...c, root: dir, env: {}, fetchImpl }), 0)
  assert.match(c.out.join(''), /nothing written/)
  for (const env of [{ REMEDIATION_TOKEN: 'x' }, { REMEDIATION_WRITE_ENABLED: 'true', REMEDIATION_TOKEN: 'x', GITHUB_EVENT_NAME: 'schedule' }]) {
    c = capture()
    assert.equal(await main(['remediate', '--plan', planFile, '--repository', plan.repository, '--confirm'], { ...c, root: dir, env, fetchImpl }), 1, JSON.stringify(env))
  }
  c = capture()
  assert.equal(await main(['remediate', '--plan', planFile, '--repository', plan.repository, '--confirm'], { ...c, root: dir, env: { REMEDIATION_WRITE_ENABLED: 'true' }, fetchImpl }), 1)
  assert.match(c.err.join(''), /REMEDIATION_TOKEN is not set/)
})

test('workflows: verification is read-only, scheduled runs never execute or write, remediation is manual and gated', () => {
  const verify = read('.github/workflows/verify.yml')
  const remediation = read('.github/workflows/remediation.yml')
  assert.match(verify, /^permissions: \{\}$/m)
  assert.ok(!/:\s*write\b/.test(verify), 'no write permission in verify.yml')
  assert.ok(!/secrets\./.test(verify), 'verify.yml uses no secrets')
  assert.ok(!/pull_request_target/.test(verify + remediation))
  assert.match(verify, /persist-credentials: false/)
  assert.match(verify, /github\.event_name == 'schedule' && 'false'/)
  assert.match(verify, /retention-days: 30/)
  assert.ok(!/remediate/.test(verify), 'verify.yml never opens remediation PRs')
  assert.match(remediation, /^on:\n  workflow_dispatch:/m)
  assert.ok(!/schedule:|pull_request|push:/.test(remediation))
  assert.match(remediation, /github\.ref == 'refs\/heads\/main' && vars\.REMEDIATION_WRITE_ENABLED == 'true' && inputs\.confirm == 'create one draft remediation PR'/)
  assert.ok(!/:\s*write\b/.test(remediation), 'the job token stays read-only; writes use the scoped secret')
  for (const f of readdirSync(join(ROOT, '.github/workflows'))) assert.ok(!/pull_request_target/.test(read(`.github/workflows/${f}`)), f)
})

test('the committed state loads cleanly', () => {
  const s = loadState(ROOT)
  assert.deepEqual(s.problems, [])
  assert.deepEqual(checkPolicy(s.policy, s.registry), [])
})
