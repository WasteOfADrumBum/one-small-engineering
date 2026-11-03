import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, readdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { main, parseArgs, UsageError } from './cli.mjs'
import { prepareOne, executeRefusals, executeProposal, proposalDigest, selectForPrepare, branchFor } from './prepare.mjs'
import { liveEv as ev, fixtureRegistry, realRegistry, policy, fakeRunner, SHA, SHA2, LIVE } from '../../fixtures/verify/helpers.mjs'
import { digestOf } from '../verify/evidence.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const R = 'https://github.com/WasteOfADrumBum/'
const T = LIVE.asOf
const NOW = () => new Date(T)
const LOCAL = { PATH: process.env.PATH }
const capture = () => { const out = []; const err = []; return { out, err, log: s => out.push(s), error: s => err.push(s) } }

function sandbox({ registry = realRegistry(), ledgers = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ose-eng-cli-'))
  for (const p of ['projects/registry.schema.json', 'standards/definition-of-done.md', 'verification/policy.json', 'verification/projects.json', 'engineering/remediation-prs.json']) { mkdirSync(dirname(join(dir, p)), { recursive: true }); cpSync(join(ROOT, p), join(dir, p)) }
  writeFileSync(join(dir, 'projects/registry.json'), JSON.stringify(registry, null, 2))
  mkdirSync(join(dir, 'verification/evidence'), { recursive: true })
  for (const [id, evidence] of Object.entries(ledgers)) writeFileSync(join(dir, `verification/evidence/${id}.json`), JSON.stringify({ project: id, evidence }))
  return dir
}
const files = dir => readdirSync(join(dir, 'reports/engineering')).sort().map(f => [f, readFileSync(join(dir, 'reports/engineering', f), 'utf8')])

test('usage: unknown commands and options exit 2; execute needs a reviewed digest', async () => {
  assert.throws(() => parseArgs(['merge']), UsageError)
  assert.throws(() => parseArgs(['check', '--force']), /unknown option/)
  assert.throws(() => parseArgs(['execute', '--proposal', 'p.json']), /--digest/)
  assert.throws(() => parseArgs(['execute', '--proposal', 'p.json', '--digest', 'abc']), /sha256/)
  const c = capture()
  assert.equal(await main(['check', '--no-network', '--project', 'nope'], { ...c, root: sandbox(), env: LOCAL, now: NOW }), 2)
})

test('observe run without network is idempotent: same inputs, same state and reports', async () => {
  const dir = sandbox()
  const c = capture()
  assert.equal(await main(['check', '--no-network'], { ...c, root: dir, env: LOCAL, now: NOW }), 0)
  const first = files(dir)
  const state1 = readFileSync(join(dir, 'engineering/state.json'), 'utf8')
  assert.equal(await main(['check', '--no-network'], { ...c, root: dir, env: LOCAL, now: NOW }), 0)
  assert.deepEqual(files(dir), first.map(([f, t]) => [f, t]))
  assert.equal(readFileSync(join(dir, 'engineering/state.json'), 'utf8'), state1)
  assert.deepEqual(first.map(([f]) => f), ['dashboard.json', 'dashboard.md', 'dependencies.md', 'queue.md', 'releases.md'])
  assert.equal(await main(['report', '--check'], { ...c, root: dir, env: LOCAL, now: NOW }), 0, 'an observe run is reproducible offline from what it saved')
  const d = JSON.parse(first[0][1])
  assert.equal(d.overview.activeProjects, 8)
  const verified = realRegistry().projects.filter(p => p.tier !== 'legacy')
    .flatMap(p => p.releaseGates).filter(g => g.status === 'verified').length
  assert.equal(d.overview.verificationCoverage.verified, verified, 'offline observation preserves recorded owner verification without inventing new passes')
  assert.equal(d.projects.length, 8)
  assert.ok(d.queue.every((i, n) => i.rank === n + 1))
  assert.equal(new Set(d.queue.map(i => i.id)).size, d.queue.length, 'the queue has no duplicate issues')
})

test('deterministic reports: report --check passes on fresh output and fails on any edit or extra file', async () => {
  const dir = sandbox()
  const c = capture()
  assert.equal(await main(['report', '--as-of', T], { ...c, root: dir, env: LOCAL, now: NOW }), 0)
  assert.equal(await main(['report', '--check'], { ...c, root: dir, env: LOCAL, now: () => new Date('2030-01-01T00:00:00Z') }), 0, 'check uses the recorded time, not the clock')
  writeFileSync(join(dir, 'reports/engineering/queue.md'), 'edited')
  assert.equal(await main(['report', '--check'], { ...c, root: dir, env: LOCAL, now: NOW }), 1)
  assert.equal(await main(['report', '--as-of', T], { ...c, root: dir, env: LOCAL, now: NOW }), 0)
  writeFileSync(join(dir, 'reports/engineering/old.md'), 'x')
  assert.equal(await main(['report', '--check'], { ...c, root: dir, env: LOCAL, now: NOW }), 1)
})

test('secret redaction: a credential that reached the evidence ledger never reaches a report', async () => {
  const reg = realRegistry()
  const tf = reg.projects.find(p => p.id === 'taskforge')
  const token = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'
  const rec = ev({ name: 'build-test', version: '1.1.0', gates: ['automated-checks'] }, 'fail', { project: 'taskforge', commitSha: tf.repositorySnapshot.headSha })
  rec.summary = `build failed: ${token}`
  rec.digest = digestOf(rec)
  const dir = sandbox({ registry: reg, ledgers: { taskforge: [rec] } })
  const c = capture()
  assert.equal(await main(['report', '--as-of', T], { ...c, root: dir, env: LOCAL, now: NOW }), 0)
  const all = files(dir).map(([, t]) => t).join('\n')
  assert.ok(all.includes('build failed'), 'the finding is reported')
  assert.ok(!all.includes(token), 'but the token is not')
})

test('scheduled runs only observe: execute, prepare and project-code execution are refused', async () => {
  const dir = sandbox()
  const env = { ...LOCAL, GITHUB_EVENT_NAME: 'schedule' }
  const c = capture()
  assert.equal(await main(['check', '--execute', '--no-network'], { ...c, root: dir, env, now: NOW }), 1)
  assert.equal(await main(['prepare'], { ...c, root: dir, env, now: NOW }), 1)
  assert.match(c.err.join('\n'), /scheduled runs never execute project code/)
  assert.match(c.err.join('\n'), /prepare is refused on scheduled runs/)
})

// ---- prepare and execute ----

const lockV1 = JSON.stringify({ name: 'taskforge', lockfileVersion: 3, packages: { '': { dependencies: { zod: '^3.0.0' } }, 'node_modules/zod': { version: '3.0.0' } } })
const lockV2 = JSON.stringify({ name: 'taskforge', lockfileVersion: 3, packages: { '': { dependencies: { zod: '^3.0.0' } }, 'node_modules/zod': { version: '3.22.3' } } })
const auditJson = names => JSON.stringify({ metadata: { vulnerabilities: { critical: 0, high: names.length, moderate: 0 } }, vulnerabilities: Object.fromEntries(names.map(n => [n, { name: n, severity: 'high', isDirect: true, fixAvailable: true }])) })

function prepFixture({ fixChanges = true, testsPass = true } = {}) {
  const reg = realRegistry()
  const p = reg.projects.find(x => x.id === 'taskforge')
  const repos = { [p.repository]: { sha: SHA, files: { 'package.json': JSON.stringify({ name: 'taskforge', scripts: { build: 'tsc', test: 'vitest' }, dependencies: { zod: '^3.0.0' } }), 'package-lock.json': lockV1 } } }
  let fixed = false
  const run = fakeRunner({ repos, commands: {
    'npm audit --json --package-lock-only': () => ({ status: 1, stdout: auditJson(fixed ? [] : ['zod']), stderr: '' }),
    'npm audit fix --package-lock-only --ignore-scripts --no-fund': opts => { if (fixChanges) { writeFileSync(join(opts.cwd, 'package-lock.json'), lockV2); fixed = true } return { status: 0, stdout: '', stderr: '' } },
    'npm ci --ignore-scripts': { status: 0 },
    'npm run build': { status: 0 },
    'npm test': { status: testsPass ? 0 : 1, stderr: 'FAIL' }
  } })
  const issue = { id: 'taskforge:advisory:high-production', project: 'taskforge', repository: p.repository, revision: SHA, title: '1 high advisories in production dependencies: zod', priorityText: 'High-severity vulnerability', severity: 'high', confidence: 'high', evidence: ['ev-x'], autoFix: { type: 'npm-audit-fix', packages: ['zod'] }, relatedPRs: [], priority: 4 }
  return { p, run, issue, deps: { run, workRoot: mkdtempSync(join(tmpdir(), 'ose-prep-')), execute: false, now: () => T, policy: policy(), profiles: { projects: {} } } }
}

test('prepare: a deterministic lockfile fix becomes a digested proposal with validation and rollback; nothing is written to GitHub', () => {
  const f = prepFixture()
  const r = prepareOne(f.issue, f.p, f.deps)
  assert.equal(r.prepared, true, r.reason)
  const pr = r.proposal
  assert.deepEqual(pr.files.map(x => x.path), ['package-lock.json'])
  assert.equal(pr.branch, 'verify/remediation/taskforge-advisory-high-production')
  assert.equal(pr.baseSha, SHA)
  assert.equal(pr.digest, proposalDigest(pr))
  assert.match(pr.rollback, /git revert/)
  assert.match(pr.body, /## Rollback/)
  assert.doesNotMatch(pr.body, /\bapproved?\b/i)
  assert.ok(!f.run.calls.some(c => c.cmd === 'git' && c.args[0] === 'push'), 'no push')
  assert.ok(f.run.calls.every(c => c.cmd !== 'npm' || !c.args.includes('--force')), 'never npm audit fix --force')
})

test('prepare: no change, or failing project tests, leaves an issue report instead of a proposal', () => {
  const none = prepFixture({ fixChanges: false })
  assert.match(prepareOne(none.issue, none.p, none.deps).reason, /changed nothing/)
  const failing = prepFixture({ testsPass: false })
  const r = prepareOne(failing.issue, failing.p, { ...failing.deps, execute: true })
  assert.equal(r.prepared, false)
  assert.match(r.reason, /did not pass/)
})

test('prepare selection: protected repositories (ModsPack) and issues covered by an open PR are skipped', () => {
  const pol = policy()
  assert.ok(pol.remediation.protectedRepositories.map(x => x.toLowerCase()).includes('wasteofadrumbum/one-small-mods-pack'))
  const q = [
    { id: 'one-small-mods-pack:advisory:high-production', project: 'one-small-mods-pack', repository: `${R}one-small-mods-pack`, autoFix: { packages: ['x'] }, relatedPRs: [], priority: 4 },
    { id: 'taskforge:advisory:high-production', project: 'taskforge', repository: `${R}TaskForge`, autoFix: { packages: ['x'] }, relatedPRs: [{ url: `${R}TaskForge/pull/43`, status: 'draft' }], priority: 4 },
    { id: 'cortex:advisory:high-production', project: 'cortex', repository: `${R}cortex-brain-task`, autoFix: { packages: ['x'] }, relatedPRs: [], priority: 4 }
  ]
  const s = selectForPrepare(q, { protectedRepositories: pol.remediation.protectedRepositories })
  assert.deepEqual(s.candidates.map(i => i.id), ['cortex:advisory:high-production'])
  assert.match(s.skipped.map(x => x.reason).join(' '), /protected/)
  assert.match(s.skipped.map(x => x.reason).join(' '), /pull\/43/)
  assert.equal(branchFor('verify/remediation/', 'a:b:c'), 'verify/remediation/a-b-c')
})

function fakeWriteClient({ branchExists = false } = {}) {
  const calls = []
  return {
    calls,
    async request(method, path, opts = {}) {
      calls.push(`${method} ${path}`)
      if (method === 'GET' && path.includes('/git/ref/heads/')) return branchExists ? { ref: 'x' } : (opts.allow404 ? null : null)
      if (method === 'GET' && path.includes('/git/commits/')) return { tree: { sha: 't'.repeat(40) } }
      if (path.endsWith('/pulls')) return { number: 7, html_url: `${R}TaskForge/pull/7`, draft: true }
      return { sha: 'c'.repeat(40) }
    }
  }
}

test('execute: opens one draft PR only when every gate holds; refuses otherwise', async () => {
  const f = prepFixture()
  const proposal = prepareOne(f.issue, f.p, f.deps).proposal
  const okEnv = { REMEDIATION_WRITE_ENABLED: 'true', REMEDIATION_TOKEN: 'x', GITHUB_EVENT_NAME: 'workflow_dispatch' }
  const pol = policy()
  const client = fakeWriteClient()
  const res = await executeProposal({ proposal, reviewedDigest: proposal.digest, env: okEnv, confirm: true, policy: pol, coveredBy: [], client })
  assert.equal(res.created, true)
  assert.ok(client.calls.every(c => /^(GET|POST) /.test(c)), 'no PUT, PATCH or DELETE')
  assert.ok(client.calls.some(c => c.endsWith('/pulls')))
  assert.ok(!client.calls.some(c => /merge|reviews|releases/.test(c)))
  const reasons = env => executeRefusals({ proposal, reviewedDigest: proposal.digest, env: { ...okEnv, ...env }, confirm: true, policy: pol }).join(' | ')
  assert.match(reasons({ REMEDIATION_WRITE_ENABLED: '' }), /writes are disabled/)
  assert.match(reasons({ REMEDIATION_TOKEN: '' }), /REMEDIATION_TOKEN/)
  assert.match(reasons({ GITHUB_EVENT_NAME: 'schedule' }), /scheduled runs never write/)
  assert.match(reasons({ GITHUB_EVENT_NAME: 'pull_request' }), /pull request runs never write/)
  assert.match(executeRefusals({ proposal, reviewedDigest: 'f'.repeat(64), env: okEnv, confirm: true, policy: pol }).join(' '), /reviewed digest does not match/)
  assert.match(executeRefusals({ proposal, reviewedDigest: proposal.digest, env: okEnv, confirm: false, policy: pol }).join(' '), /--confirm/)
  assert.match(executeRefusals({ proposal, reviewedDigest: proposal.digest, env: okEnv, confirm: true, policy: pol, coveredBy: [`${R}TaskForge/pull/43`] }).join(' '), /no duplicate PR/)
  const tampered = { ...proposal, files: [{ path: 'package-lock.json', content: 'evil' }] }
  assert.match(executeRefusals({ proposal: tampered, reviewedDigest: proposal.digest, env: okEnv, confirm: true, policy: pol }).join(' '), /edited after preparation/)
  const merge = { ...proposal, action: 'merge' }
  merge.digest = proposalDigest(merge)
  assert.match(executeRefusals({ proposal: merge, reviewedDigest: merge.digest, env: okEnv, confirm: true, policy: pol }).join(' '), /not on the execute allowlist/)
  const wf = { ...proposal, files: [{ path: '.github/workflows/ci.yml', content: 'x' }] }
  wf.digest = proposalDigest(wf)
  assert.match(executeRefusals({ proposal: wf, reviewedDigest: wf.digest, env: okEnv, confirm: true, policy: pol }).join(' '), /workflow files are never changed/)
  const mods = { ...proposal, repository: `${R}one-small-mods-pack`, findings: proposal.findings.map(x => ({ ...x, repository: `${R}one-small-mods-pack` })) }
  mods.digest = proposalDigest(mods)
  assert.match(executeRefusals({ proposal: mods, reviewedDigest: mods.digest, env: okEnv, confirm: true, policy: pol }).join(' '), /protected from automated writes/)
  // Recovery: a branch left by an earlier attempt is never rewritten; the run stops and says so.
  const again = await executeProposal({ proposal, reviewedDigest: proposal.digest, env: okEnv, confirm: true, policy: pol, coveredBy: [], client: fakeWriteClient({ branchExists: true }) })
  assert.equal(again.created, false)
  assert.match(again.refused.join(' '), /already exists/)
})

test('execute via the CLI is refused without write enablement, and nothing is sent', async () => {
  const f = prepFixture()
  const proposal = prepareOne(f.issue, f.p, f.deps).proposal
  const dir = sandbox()
  const file = join(dir, 'proposal.json')
  writeFileSync(file, JSON.stringify(proposal))
  const c = capture()
  let fetched = 0
  const code = await main(['execute', '--proposal', file, '--digest', proposal.digest, '--confirm'], { ...c, root: dir, env: LOCAL, now: NOW, fetchImpl: async () => { fetched++; throw new Error('no') } })
  assert.equal(code, 1)
  assert.match(c.err.join('\n'), /writes are disabled/)
  assert.equal(fetched, 0)
})

test('mismatched commits: a proposal whose findings name another commit is refused', () => {
  const f = prepFixture()
  const proposal = prepareOne(f.issue, f.p, f.deps).proposal
  const moved = { ...proposal, findings: proposal.findings.map(x => ({ ...x, commitSha: SHA2 })) }
  moved.digest = proposalDigest(moved)
  assert.match(executeRefusals({ proposal: moved, reviewedDigest: moved.digest, env: { REMEDIATION_WRITE_ENABLED: 'true', REMEDIATION_TOKEN: 'x' }, confirm: true, policy: policy() }).join(' '), /re-collect on the current base/)
  assert.ok(fixtureRegistry())
})
