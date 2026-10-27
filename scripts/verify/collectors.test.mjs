import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildTest, lintFormatTypes, ciResults, dependencyAudit, secretScan, accessibility, deploymentHealth, documentation, releasePackaging, compatibility, repoStructure, combine, scanText, brokenLinks, ciNodeVersions, plannedChecks, COLLECTORS } from './collectors.mjs'
import { memoryView, workspaceView, classifyGitFailure } from './workspace.mjs'
import { GitHubError } from '../sync/github.mjs'
import { fakeRunner, tempTree, realRegistry, policy, SHA } from '../../fixtures/verify/helpers.mjs'

const REPO = 'https://github.com/WasteOfADrumBum/one-small-mods-pack'
const registry = realRegistry()
const msp = registry.projects.find(p => p.id === 'one-small-mods-pack')
const PKG = JSON.stringify({ name: 'one-small-modspack', version: '2.0.0', license: 'MIT', bin: { modspack: 'dist/modspack.mjs' }, files: ['dist/modspack.mjs'], engines: { node: '>=20' }, repository: { url: 'x' }, scripts: { build: 'node b.mjs', test: 'node --test', lint: 'eslint .' }, devDependencies: { 'axe-core': '1' } })

function ctx(over = {}) {
  const view = over.view || memoryView({ 'package.json': PKG, 'package-lock.json': '{}', 'README.md': '# x\n' })
  let installed = null
  const run = over.run || fakeRunner()
  return {
    project: msp, registry, repository: REPO, commitSha: SHA, profile: {}, view, execute: true, run, github: null, fetch: null,
    install: () => installed || (installed = over.installResult || { ok: true }), tools: () => over.tools || {}, toolEnv: () => ({}), ...over
  }
}

test('policy: every collector named in verification/policy.json exists, and gates map to it', () => {
  const pol = policy()
  const names = COLLECTORS.map(c => c.name)
  for (const [gate, g] of Object.entries(pol.gates)) {
    for (const c of [...g.collectors, ...(g.supporting || [])]) {
      assert.ok(names.includes(c), `${gate}: ${c}`)
      assert.ok(COLLECTORS.find(x => x.name === c).gates.includes(gate), `${c} must declare ${gate}`)
    }
  }
})

test('combine: any failure fails, any unrun check is inconclusive, delegated checks are neutral', () => {
  assert.equal(combine([{ name: 'a', result: 'pass' }, { name: 'b', result: 'fail' }], 'x').result, 'fail')
  assert.equal(combine([{ name: 'a', result: 'pass' }, { name: 'b', result: 'not_run' }], 'x').result, 'inconclusive')
  assert.equal(combine([{ name: 'a', result: 'pass' }, { name: 'b', result: 'delegated' }], 'x').result, 'pass')
  assert.equal(combine([{ name: 'b', result: 'delegated' }], 'x').result, 'inconclusive')
  assert.equal(combine([], 'x').result, 'inconclusive')
})

test('build and test: no execution or no checkout is never a pass', () => {
  assert.equal(buildTest.collect(ctx({ execute: false })).result, 'inconclusive')
  const r = buildTest.collect(ctx({ view: null, accessReason: 'repository not found or not visible' }))
  assert.equal(r.result, 'unavailable')
  assert.match(r.failureReason, /not visible/)
})

test('build and test: runs the planned commands; a failing test fails; a missing harness is inconclusive', () => {
  let r = buildTest.collect(ctx({ run: fakeRunner({ commands: { 'npm test': { status: 1, stderr: 'not ok 3 - adds' } } }) }))
  assert.equal(r.result, 'fail')
  assert.match(r.failureReason, /test/)
  r = buildTest.collect(ctx())
  assert.equal(r.result, 'pass')
  assert.match(r.reproduce, /npm ci --ignore-scripts/)
  r = buildTest.collect(ctx({ profile: { checks: [{ name: 'mods', kind: 'test', cmd: ['npm', 'test'], needsTool: 'claude' }] } }))
  assert.equal(r.result, 'inconclusive')
  assert.match(r.failureReason, /needs claude/)
  r = buildTest.collect(ctx({ installResult: { ok: false, reason: 'npm ci exited 1' } }))
  assert.equal(r.result, 'inconclusive')
  r = buildTest.collect(ctx({ run: fakeRunner({ commands: { 'npm test': { status: null, timedOut: true } } }) }))
  assert.equal(r.result, 'inconclusive')
})

test('lint, format and types: none configured is inconclusive, not a pass', () => {
  const view = memoryView({ 'package.json': JSON.stringify({ name: 'x', scripts: { test: 'node --test' } }) })
  assert.equal(lintFormatTypes.collect(ctx({ view })).result, 'inconclusive')
  assert.deepEqual(plannedChecks(memoryView({ 'package.json': JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }) })), [])
})

test('CI results: missing credentials, inaccessible, rate limited, malformed, failing and passing', async () => {
  assert.equal((await ciResults.collect(ctx())).result, 'unavailable')
  const gh = data => ({ get: async () => { if (data instanceof Error) throw data; return data } })
  let r = await ciResults.collect(ctx({ github: gh(new GitHubError('x', 404, '')) }))
  assert.equal(r.result, 'unavailable')
  assert.match(r.failureReason, /not found or not visible/)
  r = await ciResults.collect(ctx({ github: gh(new GitHubError('x', 429, '')) }))
  assert.match(r.failureReason, /rate limited/)
  r = await ciResults.collect(ctx({ github: gh(new GitHubError('x', 0, '')) }))
  assert.match(r.failureReason, /network error/)
  r = await ciResults.collect(ctx({ github: gh(new GitHubError('x', 401, '')) }))
  assert.match(r.failureReason, /token was rejected/)
  assert.equal((await ciResults.collect(ctx({ github: gh({ nope: 1 }) }))).result, 'inconclusive')
  assert.equal((await ciResults.collect(ctx({ github: gh({ check_runs: [] }) }))).result, 'inconclusive')
  r = await ciResults.collect(ctx({ github: gh({ check_runs: [{ name: 'cli', status: 'completed', conclusion: 'success', html_url: 'https://github.com/x/y/runs/1' }, { name: 'windows', status: 'completed', conclusion: 'failure' }] }) }))
  assert.equal(r.result, 'fail')
  r = await ciResults.collect(ctx({ github: gh({ check_runs: [{ name: 'cli', status: 'in_progress', conclusion: null }] }) }))
  assert.equal(r.result, 'inconclusive')
  r = await ciResults.collect(ctx({ github: gh({ check_runs: [{ name: 'cli', status: 'completed', conclusion: 'success', html_url: 'https://github.com/x/y/runs/1' }] }) }))
  assert.equal(r.result, 'pass')
  assert.deepEqual(ciResults.gates, ['automated-checks'], 'CI success speaks only for automated checks')
})

test('dependency audit: parses npm audit; high advisories fail; malformed or network failure is unavailable', () => {
  const audit = (meta, extra = {}) => fakeRunner({ commands: { 'npm audit --json --package-lock-only --fetch-retries=2 --fetch-timeout=120000': { status: 0, stdout: JSON.stringify({ metadata: { vulnerabilities: meta, dependencies: { total: 3 } }, ...extra }) } } })
  assert.equal(dependencyAudit.collect(ctx({ run: audit({ critical: 0, high: 0, moderate: 2, low: 0, info: 0, total: 2 }) })).result, 'pass')
  const r = dependencyAudit.collect(ctx({ run: audit({ critical: 0, high: 1, moderate: 0, low: 0, info: 0, total: 1 }, { vulnerabilities: { lodash: { name: 'lodash', severity: 'high' } } }) }))
  assert.equal(r.result, 'fail')
  assert.match(r.failureReason, /lodash/)
  assert.equal(dependencyAudit.collect(ctx({ run: fakeRunner({ commands: { 'npm audit --json --package-lock-only --fetch-retries=2 --fetch-timeout=120000': { status: 1, stdout: 'npm ERR! network' } } }) })).result, 'unavailable')
  assert.equal(dependencyAudit.collect(ctx({ run: fakeRunner({ commands: { 'npm audit --json --package-lock-only --fetch-retries=2 --fetch-timeout=120000': { status: 1, stdout: '{"error":{"code":"ENOAUDIT"}}' } } }) })).result, 'unavailable')
  assert.equal(dependencyAudit.collect(ctx({ run: audit(null) })).result, 'inconclusive')
  assert.equal(dependencyAudit.collect(ctx({ view: memoryView({ 'package.json': '{}' }) })).result, 'inconclusive')
  assert.equal(dependencyAudit.collect(ctx({ view: memoryView({ 'README.md': 'x' }) })).result, 'not_applicable')
})

test('secret scan: real credentials fail with location only; placeholders are ignored; test fixtures need review', () => {
  const token = 'ghp_' + 'Z9y8X7w6V5u4T3s2R1q0P9o8N7m6L5k4J3i2'
  const r = secretScan.collect(ctx({ view: memoryView({ 'src/config.js': `const t = "${token}"`, 'docs/a.md': 'use AKIAIOSFODNN7EXAMPLE', 'test/hook.test.mjs': 'const k = "AKIAJ7Q2M4X9B5N3R6TW"', '.env': 'X=1', '.env.example': 'X=' }) }))
  assert.equal(r.result, 'fail')
  assert.ok(!JSON.stringify(r).includes(token), 'value never stored')
  assert.ok(!JSON.stringify(r).includes('AKIAJ7Q2M4X9B5N3R6TW'))
  assert.match(JSON.stringify(r.checks), /src\/config\.js:1 \(GitHub token\)/)
  assert.match(JSON.stringify(r.checks), /\.env\b/)
  const review = secretScan.collect(ctx({ view: memoryView({ 'test/hook.test.mjs': 'const k = "AKIAJ7Q2M4X9B5N3R6TW"' }) }))
  assert.equal(review.result, 'inconclusive')
  assert.equal(secretScan.collect(ctx({ view: memoryView({ 'a.js': 'const k = "AKIAIOSFODNN7EXAMPLE"' }) })).result, 'pass')
  assert.deepEqual(scanText('x.js', 'postgres://user:hunter22@db/x').map(f => f.kind), ['credentials in URL'])
})

test('accessibility: tooling alone never passes; manual review is always listed', () => {
  const r = accessibility.collect(ctx())
  assert.equal(r.result, 'inconclusive')
  assert.match(r.failureReason, /manual review/)
  const auto = accessibility.collect(ctx({ profile: { accessibility: { automated: [{ name: 'contrast', cmd: ['npm', 'run', 'contrast'] }], manual: 'Keyboard review.' } }, run: fakeRunner({ commands: { 'npm run contrast': { status: 1, stderr: 'contrast 2.1:1' } } }) }))
  assert.equal(auto.result, 'fail')
})

test('deployment health: library without URL is not applicable; reachable passes; errors fail or are unavailable', async () => {
  assert.equal((await deploymentHealth.collect(ctx())).result, 'not_applicable')
  const app = { ...registry.projects.find(p => p.id === 'taskforge') }
  const view = memoryView({ 'render.yaml': 'x' })
  assert.equal((await deploymentHealth.collect(ctx({ project: app, view }))).result, 'unavailable')
  let r = await deploymentHealth.collect(ctx({ project: app, view, fetch: async () => ({ status: 200 }) }))
  assert.equal(r.result, 'inconclusive', 'reachable, but the deployed revision is not confirmed')
  r = await deploymentHealth.collect(ctx({ project: app, view, fetch: async () => ({ status: 503 }) }))
  assert.equal(r.result, 'fail')
  r = await deploymentHealth.collect(ctx({ project: app, view, fetch: async () => { throw new Error('ECONNRESET') } }))
  assert.equal(r.result, 'unavailable')
})

test('documentation: broken relative links and missing upgrade docs fail; accuracy stays manual', () => {
  const view = memoryView({ 'README.md': '# Tool\n\n## Install\n' + 'line\n'.repeat(12) + '[guide](docs/guide.md) [gone](docs/missing.md) [web](https://x.y) [anchor](#install)', 'docs/guide.md': 'Upgrade and uninstall. [back](../README.md)', 'CHANGELOG.md': '## 1.0.0' })
  const r = documentation.collect(ctx({ view }))
  assert.equal(r.result, 'fail')
  assert.deepEqual(brokenLinks(view, 'README.md'), ['README.md -> docs/missing.md'])
  assert.match(JSON.stringify(r.checks), /no mention of rollback/)
  assert.equal(r.checks.find(c => c.name === 'accuracy against behaviour').result, 'not_run')
})

test('release packaging: version, changelog and publish workflow are checked against the registry target', () => {
  const view = memoryView({ 'package.json': PKG.replace('"2.0.0"', '"1.9.0"'), 'CHANGELOG.md': '# Changelog\n\n## 2.0.0 (unreleased)\n' })
  const r = releasePackaging.collect(ctx({ view, execute: false }))
  assert.equal(r.result, 'fail')
  const failed = r.checks.filter(c => c.result === 'fail').map(c => c.name)
  assert.deepEqual(failed.sort(), ['CHANGELOG top entry matches the version', 'publish workflow', 'version matches the registry target'])
  assert.equal(r.checks.find(c => c.name === 'npm pack contents').result, 'not_run')
  const pack = fakeRunner({ commands: { 'npm pack --dry-run --json --ignore-scripts': { status: 0, stdout: JSON.stringify([{ files: [{ path: 'package.json' }, { path: 'test/a.test.mjs' }] }]) } } })
  const r2 = releasePackaging.collect(ctx({ run: pack, view: memoryView({ 'package.json': PKG, 'CHANGELOG.md': '## 2.0.0', '.github/workflows/release.yml': 'run: npm publish --provenance' }) }))
  assert.match(r2.checks.find(c => c.name === 'npm pack contents').detail, /entry points missing: dist\/modspack\.mjs; should not ship: test\/a\.test\.mjs/)
  assert.equal(releasePackaging.collect(ctx({ view: memoryView({ 'package.json': '{oops' }) })).result, 'fail')
})

test('compatibility: the engines floor must be tested in CI', () => {
  const view = memoryView({ 'package.json': PKG, '.github/workflows/ci.yml': 'jobs:\n  a:\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 22\n' })
  assert.deepEqual(ciNodeVersions(view), [22])
  const r = compatibility.collect(ctx({ view }))
  assert.equal(r.result, 'fail')
  assert.match(r.failureReason, /engines floor/)
  const ok = memoryView({ 'package.json': PKG, '.github/workflows/ci.yml': 'strategy:\n  matrix:\n    node: [20, 22]\n' })
  assert.equal(compatibility.collect(ctx({ view: ok })).result, 'pass')
})

test('repo structure and workspace views read only inside the checkout', () => {
  const dir = tempTree({ 'package.json': PKG, 'package-lock.json': '{}', 'README.md': 'x', LICENSE: 'MIT', '.github/workflows/ci.yml': 'x', 'node_modules/a/index.js': 'x' })
  const view = workspaceView(dir)
  assert.ok(!view.files().some(f => f.path.startsWith('node_modules')))
  assert.throws(() => view.read('../../etc/passwd'), /escapes the checkout/)
  assert.equal(repoStructure.collect(ctx({ view })).result, 'pass')
  assert.equal(classifyGitFailure("fatal: could not read Username for 'https://github.com'").code, 'not-visible')
  assert.equal(classifyGitFailure('Could not resolve host: github.com').code, 'network-error')
})
