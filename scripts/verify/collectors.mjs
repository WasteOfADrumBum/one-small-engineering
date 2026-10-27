// Automated evidence collectors (Phase 4, docs/verification.md).
//
// Each collector looks at one project at one exact commit and returns an outcome:
//   { result: pass | fail | inconclusive | unavailable | not_applicable, summary, failureReason,
//     checks: [{ name, result, detail }], artifacts: [{ name, sha256, ref }], reproduce }
// The orchestrator turns the outcome into a digested evidence record (evidence.mjs).
//
// Rules every collector keeps:
// - Fail safe. Anything it cannot reach is `unavailable`; anything it cannot decide is
//   `inconclusive`. Neither is ever reported as a pass.
// - Stay in scope. A collector only speaks for the gates policy.json maps to it; CI success says
//   nothing about accessibility, security or documentation.
// - Never echo secrets. Output is redacted (exec.mjs), and the secret scan reports file, line and
//   kind, never the matched value.
// - Project code runs only when execution is enabled, with a scrubbed environment (exec.mjs).

import { lastLines } from './exec.mjs'
import { sha256 } from './evidence.mjs'
import { describeAccess } from '../sync/github.mjs'
import { repoParts } from './workspace.mjs'

const V = '1.0.0'
const pass = (summary, extra = {}) => ({ result: 'pass', summary, ...extra })
const fail = (summary, failureReason, extra = {}) => ({ result: 'fail', summary, failureReason, ...extra })
const inconclusive = (summary, failureReason, extra = {}) => ({ result: 'inconclusive', summary, failureReason, ...extra })
const unavailable = (summary, failureReason, extra = {}) => ({ result: 'unavailable', summary, failureReason, ...extra })
const notApplicable = (summary, extra = {}) => ({ result: 'not_applicable', summary, ...extra })

// Combines check results: any fail fails; otherwise any unrun or inconclusive check leaves the
// whole result inconclusive; a pass needs at least one passing check.
// A `delegated` check is covered by another named collector's evidence (for example a CI-only
// platform job, reported by ci-results); it neither passes nor blocks this collector.
export function combine(checks, label) {
  const failed = checks.filter(c => c.result === 'fail')
  const open = checks.filter(c => c.result !== 'pass' && c.result !== 'fail' && c.result !== 'delegated')
  if (failed.length) return fail(`${label}: ${failed.length} of ${checks.length} check(s) failed`, `failed: ${failed.map(c => c.name).join(', ')}`, { checks })
  if (open.length) return inconclusive(`${label}: ${checks.length - open.length} of ${checks.length} check(s) passed; ${open.length} not run or inconclusive`, `not run or inconclusive: ${open.map(c => `${c.name} (${c.detail || c.result})`).join('; ')}`, { checks })
  if (!checks.some(c => c.result === 'pass')) return inconclusive(`${label}: nothing to check`, 'no checks are configured for this project', { checks })
  const delegated = checks.filter(c => c.result === 'delegated').length
  return pass(`${label}: ${checks.length - delegated} check(s) passed${delegated ? `; ${delegated} delegated to other collectors` : ''}`, { checks })
}

const scripts = view => {
  const pkg = view.json('package.json')
  return pkg && !pkg.__malformed && pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {}
}
const realScript = (s, name) => typeof s[name] === 'string' && !/no test specified/.test(s[name])

// The checks a profile (verification/projects.json) or, by default, package.json declares.
export function plannedChecks(view, profile = {}) {
  if (Array.isArray(profile.checks)) return profile.checks
  const s = scripts(view)
  const out = []
  if (realScript(s, 'build')) out.push({ name: 'build', kind: 'build', cmd: ['npm', 'run', 'build'] })
  if (realScript(s, 'test')) out.push({ name: 'test', kind: 'test', cmd: ['npm', 'test'] })
  if (realScript(s, 'lint')) out.push({ name: 'lint', kind: 'lint', cmd: ['npm', 'run', 'lint'] })
  for (const t of ['typecheck', 'check']) if (realScript(s, t) && /tsc|astro check|typecheck/.test(s[t])) { out.push({ name: t, kind: 'typecheck', cmd: ['npm', 'run', t] }); break }
  if (realScript(s, 'format:check')) out.push({ name: 'format:check', kind: 'format', cmd: ['npm', 'run', 'format:check'] })
  return out
}

// One project command, as a check. Installs first (once per project, memoized by the caller).
function runCheck(ctx, c) {
  const inst = ctx.install()
  if (!inst.ok) return { name: c.name, result: 'not_run', detail: `dependencies not installed: ${inst.reason}` }
  if (c.needsTool && !ctx.tools()[c.needsTool]) return { name: c.name, result: 'not_run', detail: `needs ${c.needsTool}, which is not installed here` }
  const res = ctx.run(c.cmd[0], c.cmd.slice(1), { cwd: ctx.view.dir, timeoutMs: c.timeoutMs || 900_000, env: ctx.toolEnv() })
  if (res.timedOut) return { name: c.name, result: 'inconclusive', detail: 'timed out' }
  if (res.status === null) return { name: c.name, result: 'inconclusive', detail: `could not start (${res.error || 'unknown'})` }
  return { name: c.name, result: res.status === 0 ? 'pass' : 'fail', detail: res.status === 0 ? lastLines(res.stdout, 3) : `exit ${res.status}: ${lastLines(res.stderr || res.stdout, 4)}`, cmd: c.cmd.join(' ') }
}

function executionGate(ctx, label) {
  if (!ctx.view) return unavailable(`${label}: no checkout`, ctx.accessReason || 'the repository could not be checked out')
  if (!ctx.execute) return inconclusive(`${label}: project code was not executed`, 'execution is disabled for this run (pass --execute in an isolated job to run project commands)')
  return null
}

const reproduceFor = (ctx, cmds) => `git clone ${ctx.repository} && git -C <dir> checkout ${ctx.commitSha} && ${[...(ctx.profile.install ? [ctx.profile.install.join(' ')] : ['npm ci --ignore-scripts']), ...cmds].join(' && ')}`

export const repoStructure = {
  name: 'repo-structure', version: V, gates: [],
  collect(ctx) {
    if (!ctx.view) return unavailable('repository not readable', ctx.accessReason || 'no checkout')
    const v = ctx.view
    const pkg = v.json('package.json')
    const files = v.files()
    const workflows = files.filter(f => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f.path)).map(f => f.path.split('/').pop())
    const checks = [
      { name: 'package.json', result: pkg === null ? 'not_run' : pkg.__malformed ? 'fail' : 'pass', detail: pkg === null ? 'absent' : pkg.__malformed ? 'not valid JSON' : `${pkg.name || '(no name)'}@${pkg.version || '(no version)'}${pkg.private ? ' (private)' : ''}` },
      { name: 'lockfile', result: v.exists('package-lock.json') ? 'pass' : v.exists('pnpm-lock.yaml') || v.exists('yarn.lock') ? 'inconclusive' : 'fail', detail: v.exists('package-lock.json') ? 'package-lock.json' : 'no npm lockfile' },
      { name: 'readme', result: v.exists('README.md') ? 'pass' : 'fail', detail: v.exists('README.md') ? 'README.md' : 'absent' },
      { name: 'license', result: v.exists('LICENSE') || v.exists('LICENSE.md') ? 'pass' : 'inconclusive', detail: v.exists('LICENSE') || v.exists('LICENSE.md') ? 'present' : 'absent' },
      { name: 'workflows', result: workflows.length ? 'pass' : 'inconclusive', detail: workflows.length ? workflows.join(', ') : 'no GitHub Actions workflows' }
    ]
    const r = combine(checks, 'repository structure')
    r.artifacts = [{ name: 'file-list', sha256: sha256(files.map(f => `${f.path}\t${f.size}`).join('\n')), ref: `${files.length} files` }]
    return r
  }
}

export const buildTest = {
  name: 'build-test', version: '1.1.0', gates: ['automated-checks', 'critical-workflows', 'e2e-critical-workflows'],
  collect(ctx) {
    const gate = executionGate(ctx, 'build and test')
    if (gate) return gate
    const planned = plannedChecks(ctx.view, ctx.profile).filter(c => c.kind === 'build' || c.kind === 'test')
    if (!planned.length) return inconclusive('build and test: no build or test command', 'the project declares no build or test script; automated checks cannot be shown')
    // Results under a Node older than the project's engines floor do not show the project works.
    const pkg = ctx.view.json('package.json') || {}
    const floor = Number((/(\d+)/.exec((pkg.engines && pkg.engines.node) || '') || [])[1]) || null
    const local = Number(process.versions.node.split('.')[0])
    if (floor && local < floor) return inconclusive(`build and test: collector Node ${process.versions.node} is below the project's engines floor ${floor}`, `run the collector on Node ${floor} or later; results on an unsupported runtime are not evidence`)
    const checks = planned.map(c => runCheck(ctx, c))
    for (const n of ctx.profile.notRun || []) if (!n.collector || n.collector === 'build-test') checks.push({ name: n.name, result: n.coveredBy ? 'delegated' : 'not_run', detail: n.coveredBy ? `covered by the ${n.coveredBy} collector: ${n.reason}` : n.reason })
    return { ...combine(checks, 'build and test'), reproduce: reproduceFor(ctx, planned.map(c => c.cmd.join(' '))) }
  }
}

export const lintFormatTypes = {
  name: 'lint-format-types', version: V, gates: ['automated-checks'],
  collect(ctx) {
    const gate = executionGate(ctx, 'lint, format and types')
    if (gate) return gate
    const planned = plannedChecks(ctx.view, ctx.profile).filter(c => ['lint', 'format', 'typecheck'].includes(c.kind))
    if (!planned.length) return inconclusive('lint, format and types: none configured', 'the project declares no lint, format check or type check script')
    const checks = planned.map(c => runCheck(ctx, c))
    return { ...combine(checks, 'lint, format and types'), reproduce: reproduceFor(ctx, planned.map(c => c.cmd.join(' '))) }
  }
}

// CI results for the exact commit, from GitHub's check runs. A green run is evidence for
// automated-checks only, and only as a builder-side signal.
export const ciResults = {
  name: 'ci-results', version: V, gates: ['automated-checks'],
  async collect(ctx) {
    if (!ctx.github) return unavailable('CI results: no GitHub API access', 'no GitHub API client for this run (set GITHUB_TOKEN; the session proxy may block api.github.com)')
    let owner, repo
    try { ({ owner, repo } = repoParts(ctx.repository)) } catch (e) { return unavailable('CI results: bad repository', e.message) }
    let runs
    try {
      const data = await ctx.github.get(`/repos/${owner}/${repo}/commits/${ctx.commitSha}/check-runs?per_page=100`)
      if (!data || !Array.isArray(data.check_runs)) return inconclusive('CI results: malformed response', 'check-runs response is not the documented shape')
      runs = data.check_runs
    } catch (e) {
      const d = describeAccess(e, 'check runs')
      return unavailable('CI results: not readable', d ? d.message : 'request failed')
    }
    if (!runs.length) return inconclusive('CI results: no check runs on this commit', `no CI ran on ${ctx.commitSha.slice(0, 7)}`)
    const checks = runs.map(r => ({
      name: String(r.name).slice(0, 100),
      result: r.status !== 'completed' ? 'inconclusive' : ['success', 'neutral', 'skipped'].includes(r.conclusion) ? 'pass' : 'fail',
      detail: `${r.status}${r.conclusion ? `/${r.conclusion}` : ''}`
    })).sort((a, b) => a.name.localeCompare(b.name))
    const out = combine(checks, 'CI check runs')
    out.artifacts = runs.filter(r => typeof r.html_url === 'string' && r.html_url.startsWith('https://github.com/')).map(r => ({ name: String(r.name).slice(0, 100), sha256: null, ref: r.html_url })).sort((a, b) => a.name.localeCompare(b.name))
    return out
  }
}

// npm audit against the committed lockfile. Reads the registry's advisory service; runs no
// project code (--ignore-scripts is implied by audit, which does not install).
// Advisory detail for triage (Phase 5): severity, whether the package is a direct dependency,
// whether it is reachable from production dependencies (absent from an --omit=dev audit means
// development only) and what kind of fix npm offers. Package names and severities only.
export function advisoryDetails(report, prodReport) {
  const prod = prodReport && prodReport.vulnerabilities ? new Set(Object.keys(prodReport.vulnerabilities)) : null
  return Object.values(report.vulnerabilities || {})
    .filter(x => x && ['critical', 'high', 'moderate'].includes(x.severity))
    .map(x => {
      const f = x.fixAvailable
      const fix = f === true ? 'available' : f && typeof f === 'object' ? (f.isSemVerMajor ? 'major' : 'available') : 'none'
      return { name: String(x.name), severity: x.severity, direct: Boolean(x.isDirect), production: prod ? prod.has(x.name) : null, fix, ...(f && typeof f === 'object' && f.name ? { fixVia: `${f.name}@${f.version}` } : {}) }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

export const dependencyAudit = {
  name: 'dependency-audit', version: '1.1.0', gates: ['supply-chain-review', 'security-privacy-review'],
  collect(ctx) {
    if (!ctx.view) return unavailable('dependency audit: no checkout', ctx.accessReason || 'no checkout')
    if (!ctx.view.exists('package.json')) return notApplicable('dependency audit: no npm package')
    if (!ctx.view.exists('package-lock.json')) return inconclusive('dependency audit: no lockfile', 'npm audit needs package-lock.json; dependencies are not pinned')
    const res = ctx.run('npm', ['audit', '--json', '--package-lock-only', '--fetch-retries=2', '--fetch-timeout=120000'], { cwd: ctx.view.dir, timeoutMs: 300_000 })
    let report
    try { report = JSON.parse(res.stdout) } catch { return unavailable('dependency audit: no readable response', res.timedOut ? 'npm audit timed out' : `npm audit gave no JSON (exit ${res.status})`) }
    if (report.error) return unavailable('dependency audit: advisory service error', `npm audit error ${String(report.error.code || 'unknown').slice(0, 40)}`)
    const v = report.metadata && report.metadata.vulnerabilities
    if (!v || typeof v.total !== 'number') return inconclusive('dependency audit: malformed report', 'npm audit JSON has no metadata.vulnerabilities')
    const counts = ['critical', 'high', 'moderate', 'low', 'info'].map(k => `${k} ${v[k] || 0}`).join(', ')
    const deps = report.metadata.dependencies ? report.metadata.dependencies.total : null
    const checks = [{ name: 'npm audit', result: (v.critical || 0) + (v.high || 0) > 0 ? 'fail' : 'pass', detail: `${counts}${deps !== null ? ` across ${deps} packages` : ''}` }]
    const advisories = Object.values(report.vulnerabilities || {}).filter(x => ['critical', 'high'].includes(x.severity)).map(x => x.name).sort()
    const out = (v.critical || 0) + (v.high || 0) > 0
      ? fail(`dependency audit: ${counts}`, `critical or high advisories: ${advisories.join(', ') || 'see report'}`, { checks })
      : pass(`dependency audit: ${counts}`, { checks })
    // A second, production-only audit separates exposure in shipped code from tooling.
    let prodReport = null
    if (out.result === 'fail' || v.moderate) {
      const prodRes = ctx.run('npm', ['audit', '--json', '--package-lock-only', '--omit=dev', '--fetch-retries=2', '--fetch-timeout=120000'], { cwd: ctx.view.dir, timeoutMs: 300_000 })
      try { prodReport = JSON.parse(prodRes.stdout); if (prodReport.error) prodReport = null } catch { prodReport = null }
    }
    out.details = { advisories: advisoryDetails(report, prodReport), productionAudit: prodReport ? 'ran' : 'not run' }
    out.artifacts = [{ name: 'npm-audit.json', sha256: sha256(res.stdout), ref: null }]
    out.reproduce = `npm audit --json --package-lock-only (at ${ctx.commitSha.slice(0, 7)})`
    return out
  }
}

// High-confidence credential patterns. The value is never stored: only file, line and kind.
const SECRET_RULES = [
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['GitHub fine-grained token', /\bgithub_pat_[A-Za-z0-9_]{60,}\b/],
  ['npm token', /\bnpm_[A-Za-z0-9]{36}\b/],
  ['AWS access key ID', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['Anthropic API key', /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ['OpenAI API key', /\bsk-(?:proj-)?[A-Za-z0-9]{32,}\b/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['private key block', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/],
  ['credentials in URL', /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@'"]+:[^/\s@'"]{6,}@/]
]
const PLACEHOLDER = /EXAMPLE|example|placeholder|dummy|fake|xxxx|redacted|<[^>]+>|\$\{/
const TEST_PATH = /(^|\/)(test|tests|__tests__|fixtures?|spec|e2e|docs?|examples?)(\/|$)|\.(test|spec)\.[a-z]+$|\.md$/i
const BINARY = /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|woff2?|ttf|eot|mp[34]|mov|wasm|lock|svg)$/i

export function scanText(path, text) {
  const findings = []
  const lines = text.split(/\r?\n/)
  lines.forEach((line, i) => {
    if (line.length > 20_000) return
    for (const [kind, re] of SECRET_RULES) {
      const m = re.exec(line)
      if (!m) continue
      const placeholder = PLACEHOLDER.test(m[0]) || PLACEHOLDER.test(line)
      // A credential in a URL to localhost is a throwaway CI or test service, not a leaked secret;
      // it still goes to human review rather than passing silently.
      const local = kind === 'credentials in URL' && /@(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])[:/]/.test(line)
      findings.push({ path, line: i + 1, kind, placeholder, inTestOrDocs: TEST_PATH.test(path) || local })
    }
  })
  return findings
}

export const secretScan = {
  name: 'secret-scan', version: V, gates: ['security-privacy-review', 'sensitive-data-handling'],
  collect(ctx) {
    if (!ctx.view) return unavailable('secret scan: no checkout', ctx.accessReason || 'no checkout')
    const files = ctx.view.files().filter(f => !BINARY.test(f.path) && f.size <= 1_000_000)
    const findings = []
    // A committed .env file fails only when it assigns a non-empty value to a sensitive-looking
    // key (SECRET, TOKEN, KEY, PASSWORD, ...); other committed .env files are listed for review.
    const SENSITIVE_KEY = /^\s*(?:export\s+)?[A-Z0-9_]*(SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|PRIVATE|CREDENTIAL|AUTH)[A-Z0-9_]*\s*=\s*\S+/im
    const envAll = files.filter(f => /(^|\/)\.env(\.[a-z]+)?$/i.test(f.path) && !/\.(example|sample|template)$/i.test(f.path)).map(f => f.path)
    const envFiles = envAll.filter(p => SENSITIVE_KEY.test(ctx.view.read(p) || ''))
    const envOther = envAll.filter(p => !envFiles.includes(p))
    for (const f of files) {
      const text = ctx.view.read(f.path)
      if (text === null || text.includes('\u0000')) continue
      findings.push(...scanText(f.path, text))
    }
    const real = findings.filter(x => !x.placeholder && !x.inTestOrDocs)
    const review = findings.filter(x => !x.placeholder && x.inTestOrDocs)
    const fmt = x => `${x.path}:${x.line} (${x.kind})`
    const checks = [
      { name: 'credential patterns outside tests and docs', result: real.length ? 'fail' : 'pass', detail: real.length ? real.slice(0, 20).map(fmt).join('; ') : `${files.length} files scanned` },
      { name: 'committed .env files with sensitive keys', result: envFiles.length ? 'fail' : 'pass', detail: envFiles.length ? envFiles.join(', ') : envOther.length ? `none; committed without sensitive keys (names only checked): ${envOther.join(', ')}` : 'none' },
      { name: 'credential-shaped values in tests and docs', result: review.length ? 'inconclusive' : 'pass', detail: review.length ? `needs human review (often deliberate fixtures): ${review.slice(0, 20).map(fmt).join('; ')}` : 'none' }
    ]
    const out = combine(checks, 'secret scan')
    out.artifacts = [{ name: 'secret-scan-locations', sha256: sha256(findings.map(fmt).join('\n')), ref: `${findings.length} location(s), values withheld` }]
    out.reproduce = 'node scripts/verify/cli.mjs collect --project <id> --collector secret-scan'
    return out
  }
}

// Automated accessibility checks the project declares; manual review is always still needed for
// WCAG 2.2 AA, so a pass here never covers keyboard or screen reader review.
export const accessibility = {
  name: 'accessibility', version: V, gates: ['wcag-22-aa'],
  collect(ctx) {
    if (!ctx.view) return unavailable('accessibility: no checkout', ctx.accessReason || 'no checkout')
    const a11y = ctx.profile.accessibility || {}
    const pkg = ctx.view.json('package.json') || {}
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }
    const tooling = ['axe-core', '@axe-core/playwright', 'pa11y', 'jest-axe', 'vitest-axe', 'eslint-plugin-jsx-a11y', 'lighthouse'].filter(d => d in deps)
    const checks = [{ name: 'automated accessibility tooling', result: tooling.length ? 'pass' : 'inconclusive', detail: tooling.length ? tooling.join(', ') : 'none declared in package.json' }]
    const auto = Array.isArray(a11y.automated) ? a11y.automated : []
    if (auto.length) {
      if (!ctx.execute) checks.push({ name: 'automated accessibility run', result: 'not_run', detail: 'execution is disabled for this run' })
      else for (const c of auto) checks.push(runCheck(ctx, { ...c, kind: 'a11y' }))
    } else checks.push({ name: 'automated accessibility run', result: 'not_run', detail: 'no automated accessibility command is configured for this project' })
    for (const n of ctx.profile.notRun || []) if (n.collector === 'accessibility') checks.push({ name: n.name, result: 'not_run', detail: n.reason })
    checks.push({ name: 'manual review', result: 'not_run', detail: a11y.manual || 'Keyboard, screen reader, zoom and contrast review by a person is required for WCAG 2.2 AA.' })
    return combine(checks, 'accessibility')
  }
}

// Production health: the registry's productionUrl must answer. Reachability is not a
// deployment gate pass on its own; the verifier still checks the deployed revision.
export const deploymentHealth = {
  name: 'deployment-health', version: V, gates: ['production-deployment', 'deployment-rollback'],
  async collect(ctx) {
    const url = ctx.project.productionUrl
    const config = ctx.view ? ['vercel.json', 'netlify.toml', 'render.yaml', 'fly.toml', 'Dockerfile', 'CNAME'].filter(f => ctx.view.exists(f)) : []
    const checks = [{ name: 'deployment configuration', result: config.length ? 'pass' : 'inconclusive', detail: config.length ? config.join(', ') : ctx.view ? 'no deployment configuration file found' : 'no checkout' }]
    if (!url) {
      checks.push({ name: 'health check', result: 'not_run', detail: 'no productionUrl in the registry' })
      return ctx.project.tier === 'library' && !config.length ? notApplicable('deployment health: library with no production URL or deployment configuration', { checks }) : combine(checks, 'deployment health')
    }
    if (!ctx.fetch) { checks.push({ name: 'health check', result: 'not_run', detail: 'network checks disabled for this run' }); return { ...combine(checks, 'deployment health'), result: 'unavailable', failureReason: 'network checks disabled for this run' } }
    let res
    try {
      res = await ctx.fetch(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(20_000) })
    } catch (e) {
      checks.push({ name: 'health check', result: 'not_run', detail: `${url}: network error` })
      return { ...combine(checks, 'deployment health'), result: 'unavailable', failureReason: `could not reach ${url} from this runner` }
    }
    const ok = res.status >= 200 && res.status < 400
    checks.push({ name: 'health check', result: ok ? 'pass' : 'fail', detail: `${url} answered HTTP ${res.status}` })
    checks.push({ name: 'deployed revision matches the commit', result: 'not_run', detail: 'the deployed revision is not exposed to an anonymous check; the verifier confirms it in the hosting dashboard' })
    return combine(checks, 'deployment health')
  }
}

// Relative links in Markdown that point at files which do not exist.
export function brokenLinks(view, mdPath) {
  const text = view.read(mdPath) || ''
  const base = mdPath.includes('/') ? mdPath.slice(0, mdPath.lastIndexOf('/') + 1) : ''
  const out = []
  for (const m of text.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    let target = m[1]
    if (/^(?:[a-z]+:|#|\/\/)/i.test(target) || target.startsWith('<')) continue
    target = decodeURIComponent(target.split('#')[0].split('?')[0])
    if (!target) continue
    const parts = []
    for (const seg of (target.startsWith('/') ? target.slice(1) : base + target).split('/')) {
      if (seg === '..') parts.pop()
      else if (seg && seg !== '.') parts.push(seg)
    }
    const resolved = parts.join('/')
    if (!view.exists(resolved)) out.push(`${mdPath} -> ${m[1]}`)
  }
  return out
}

export const documentation = {
  name: 'documentation', version: V, gates: ['documentation-accurate', 'public-docs-accurate', 'upgrade-rollback-uninstall-docs'],
  collect(ctx) {
    if (!ctx.view) return unavailable('documentation: no checkout', ctx.accessReason || 'no checkout')
    const v = ctx.view
    const readme = v.read('README.md')
    const docs = v.files().filter(f => /\.md$/i.test(f.path) && !/(^|\/)(node_modules|CHANGELOG)/.test(f.path)).map(f => f.path)
    const broken = docs.flatMap(p => brokenLinks(v, p))
    const lib = ctx.project.tier === 'library'
    const all = docs.map(p => v.read(p) || '').join('\n')
    const checks = [
      { name: 'README', result: readme && readme.split('\n').filter(l => l.trim()).length >= 10 ? 'pass' : 'fail', detail: readme ? `${readme.split('\n').length} lines` : 'absent' },
      { name: 'README install or usage section', result: readme && /^#{1,3} .*(install|usage|getting started|quick ?start|setup|develop)/im.test(readme) ? 'pass' : 'fail', detail: 'heading naming install, usage, setup or getting started' },
      { name: 'relative links resolve', result: broken.length ? 'fail' : 'pass', detail: broken.length ? broken.slice(0, 15).join('; ') : `${docs.length} Markdown file(s)` }
    ]
    if (lib) {
      const changelog = ['CHANGELOG.md', ctx.profile.packageDir && `${ctx.profile.packageDir.replace(/\/$/, '')}/CHANGELOG.md`].filter(Boolean).find(p => v.exists(p))
      checks.push({ name: 'CHANGELOG', result: changelog ? 'pass' : 'fail', detail: changelog || 'absent' })
      checks.push({ name: 'upgrade, rollback and uninstall documented', result: /upgrad/i.test(all) && /rollback|roll back|downgrad/i.test(all) && /uninstall/i.test(all) ? 'pass' : 'fail', detail: ['upgrade', 'rollback', 'uninstall'].filter(w => !new RegExp(w === 'rollback' ? 'rollback|roll back|downgrad' : w, 'i').test(all)).map(w => `no mention of ${w}`).join(', ') || 'all three mentioned' })
    }
    checks.push({ name: 'accuracy against behaviour', result: 'not_run', detail: 'whether the documentation matches the product is a manual review' })
    return combine(checks, 'documentation')
  }
}

const semver = s => /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(s || '')

export const releasePackaging = {
  name: 'release-packaging', version: V, gates: ['package-metadata-exports', 'package-archive-inspection', 'versioning-changelog', 'clean-consumer-install', 'ci-release-pipeline'],
  collect(ctx) {
    if (!ctx.view) return unavailable('release packaging: no checkout', ctx.accessReason || 'no checkout')
    // A monorepo publishes from a workspace directory named in the profile (packageDir).
    const dir = ctx.profile.packageDir ? `${ctx.profile.packageDir.replace(/\/$/, '')}/` : ''
    const pkg = ctx.view.json(`${dir}package.json`)
    if (!pkg) return notApplicable('release packaging: no package.json')
    if (pkg.__malformed) return fail('release packaging: package.json is not valid JSON', 'package.json does not parse')
    const target = ctx.project.release && ctx.project.release.targetVersion
    const changelog = ctx.view.read(`${dir}CHANGELOG.md`) || ''
    const top = /^#{1,3}\s*\[?v?(\d+\.\d+\.\d+[^\]\s]*)/m.exec(changelog)
    const workflows = ctx.view.files().filter(f => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f.path))
    const publishWf = workflows.filter(f => /npm publish|changesets\/action|semantic-release/.test(ctx.view.read(f.path) || '')).map(f => f.path)
    const checks = [
      { name: 'name and version', result: pkg.name && semver(pkg.version) ? 'pass' : 'fail', detail: `${pkg.name || '(no name)'}@${pkg.version || '(no version)'}` },
      { name: 'license', result: pkg.license ? 'pass' : 'fail', detail: pkg.license || 'no license field' },
      { name: 'publishable', result: pkg.private ? 'inconclusive' : 'pass', detail: pkg.private ? 'private: true (not publishable as is)' : 'not private' },
      { name: 'entry points declared', result: pkg.exports || pkg.main || pkg.bin ? 'pass' : 'fail', detail: ['exports', 'main', 'bin'].filter(k => pkg[k]).join(', ') || 'no exports, main or bin' },
      { name: 'files allowlist', result: Array.isArray(pkg.files) && pkg.files.length ? 'pass' : 'fail', detail: Array.isArray(pkg.files) ? `${pkg.files.length} pattern(s)` : 'no files field (everything not ignored would ship)' },
      { name: 'engines and repository metadata', result: pkg.engines && pkg.engines.node && pkg.repository ? 'pass' : 'fail', detail: [!(pkg.engines && pkg.engines.node) && 'no engines.node', !pkg.repository && 'no repository'].filter(Boolean).join(', ') || 'present' },
      { name: 'version matches the registry target', result: !target ? 'not_run' : pkg.version === target ? 'pass' : 'fail', detail: target ? `package ${pkg.version}, target ${target}` : 'no target version in the registry' },
      { name: 'CHANGELOG top entry matches the version', result: !changelog ? 'fail' : top && top[1] === pkg.version ? 'pass' : 'fail', detail: changelog ? `top entry ${top ? top[1] : 'not found'}` : 'no CHANGELOG.md' },
      { name: 'publish workflow', result: publishWf.length ? 'pass' : 'fail', detail: publishWf.length ? publishWf.join(', ') : `no workflow runs npm publish (${workflows.length} workflow(s))` }
    ]
    if (!ctx.execute) checks.push({ name: 'npm pack contents', result: 'not_run', detail: 'execution is disabled for this run (pack runs the build)' })
    else {
      const s = scripts(ctx.view)
      const build = s.build ? runCheck(ctx, { name: 'build before pack', cmd: ['npm', 'run', 'build'] }) : null
      if (build && build.result !== 'pass') checks.push({ ...build, name: 'npm pack contents', result: build.result === 'fail' ? 'fail' : 'not_run' })
      else {
        const res = ctx.run('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: dir ? `${ctx.view.dir}/${dir}` : ctx.view.dir, timeoutMs: 300_000 })
        let listing = null
        try { listing = JSON.parse(res.stdout.slice(res.stdout.indexOf('['))) } catch { /* reported below */ }
        if (!Array.isArray(listing) || !listing[0] || !Array.isArray(listing[0].files)) checks.push({ name: 'npm pack contents', result: 'inconclusive', detail: `npm pack gave no listing (exit ${res.status})` })
        else {
          const files = new Set(listing[0].files.map(f => f.path))
          const entries = [pkg.main, ...(typeof pkg.bin === 'string' ? [pkg.bin] : Object.values(pkg.bin || {}))].filter(Boolean).map(p => p.replace(/^\.\//, ''))
          const missing = entries.filter(p => !files.has(p))
          const leaked = [...files].filter(p => /(^|\/)(\.env|node_modules\/|test\/|\.git\/)/.test(p))
          checks.push({ name: 'npm pack contents', result: missing.length || leaked.length ? 'fail' : 'pass', detail: `${files.size} files${missing.length ? `; entry points missing: ${missing.join(', ')}` : ''}${leaked.length ? `; should not ship: ${leaked.slice(0, 5).join(', ')}` : ''}` })
          return { ...combine(checks, 'release packaging'), artifacts: [{ name: 'npm-pack-listing', sha256: sha256([...files].sort().join('\n')), ref: `${files.size} files` }], reproduce: 'npm run build && npm pack --dry-run --json --ignore-scripts' }
        }
      }
    }
    return combine(checks, 'release packaging')
  }
}

// Node versions named in the project's workflows (node-version: 22, [20, 22], '22.x').
export function ciNodeVersions(view) {
  const out = new Set()
  for (const f of view.files().filter(f => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f.path))) {
    const text = view.read(f.path) || ''
    for (const m of text.matchAll(/node(?:-version|_version)?\s*:\s*\[?([^\n\]#]+)/g)) {
      for (const v of m[1].split(',')) { const n = /(\d{2})/.exec(v); if (n && !/\$\{\{/.test(v)) out.add(Number(n[1])) }
    }
  }
  return [...out].sort((a, b) => a - b)
}

export const compatibility = {
  name: 'compatibility', version: V, gates: ['runtime-compatibility'],
  collect(ctx) {
    if (!ctx.view) return unavailable('compatibility: no checkout', ctx.accessReason || 'no checkout')
    const pkg = ctx.view.json('package.json')
    if (!pkg || pkg.__malformed) return inconclusive('compatibility: no readable package.json', 'cannot read engines')
    const engines = pkg.engines && pkg.engines.node
    const floor = engines ? Number((/(\d+)/.exec(engines) || [])[1]) : null
    const tested = ciNodeVersions(ctx.view)
    const local = Number(process.versions.node.split('.')[0])
    const checks = [
      { name: 'engines.node declared', result: engines ? 'pass' : 'fail', detail: engines || 'no engines.node' },
      { name: 'CI tests the engines floor', result: !floor ? 'not_run' : tested.includes(floor) ? 'pass' : 'fail', detail: `floor ${floor || 'unknown'}, CI Node ${tested.join(', ') || 'not found'}` },
      { name: 'collector runtime satisfies engines', result: !floor ? 'not_run' : local >= floor ? 'pass' : 'inconclusive', detail: `collector Node ${process.versions.node}` }
    ]
    // Cross-project: a declared dependency on another registry project must be reflected here.
    for (const d of ctx.project.dependencies || []) {
      const other = (ctx.registry.projects || []).find(p => p.id === d.project)
      checks.push({ name: `dependency ${d.project} (${d.relationship})`, result: d.relationship === 'integrates' || d.relationship === 'hub-sync' ? 'pass' : 'not_run', detail: d.relationship === 'integrates' || d.relationship === 'hub-sync' ? `runtime integration${d.requiredForRelease ? ', required for release' : ''}; not a package dependency` : `package relationship with ${other ? other.name : d.project} needs a manual version check` })
    }
    return combine(checks, 'compatibility')
  }
}

export const COLLECTORS = [repoStructure, buildTest, lintFormatTypes, ciResults, dependencyAudit, secretScan, accessibility, deploymentHealth, documentation, releasePackaging, compatibility]
export const COLLECTOR_NAMES = COLLECTORS.map(c => c.name)
