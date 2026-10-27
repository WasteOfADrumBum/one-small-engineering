// Full pipeline: registry -> validation -> engine -> reports and release artifacts, through the
// CLI and generate(). Also the ModsPack pilot fixture, redaction, governance protection and
// line endings. Run: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, readdirSync, existsSync, writeFileSync, rmSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { resolve, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generate, loadInputs, parseArgs, sha256, UsageError } from './cli.mjs'
import { assessRegistry, ReadinessInputError } from './engine.mjs'
import { renderProjectReport, renderDashboard, toJson } from './render.mjs'
import { prepareRelease, changelogSection } from './prepare.mjs'
import { guardRegistryChange } from '../sync/guard.mjs'
import { validateRegistry, parseDefinitionOfDone } from '../validate-registry.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = p => readFileSync(resolve(ROOT, p), 'utf8')
const registryText = read('projects/registry.json')
const dodText = read('standards/definition-of-done.md')
const schema = JSON.parse(read('projects/registry.schema.json'))
const inputsText = read('release/inputs.json')
// Must not be earlier than the registry's lastUpdatedAt (a future registry is invalid).
const AS_OF = '2026-10-27T03:40:00Z'
const CLI = resolve(ROOT, 'scripts/release/cli.mjs')
const inputs = () => loadInputs(inputsText, p => read(p))
const gen = (over = {}) => generate({ registryText, schema, dodText, inputs: inputs(), asOf: AS_OF, ...over })
const pilot = JSON.parse(read('fixtures/release/modspack-pilot-2026-10-26.json'))
const pilotRegistry = () => ({ approvalOwner: pilot.approvalOwner, gateCatalog: structuredClone(pilot.gateCatalog), projects: [structuredClone(pilot.project)] })
const meta = { command: 'test', asOf: AS_OF, staleDays: 30, engineVersion: 1, registryHash: '0'.repeat(64) }

test('full pipeline: readiness reports for all eight projects, a dashboard row each, prep for scoped releases', () => {
  const { files, assessment } = gen()
  const ids = JSON.parse(registryText).projects.map(p => p.id)
  assert.equal(ids.length, 8)
  for (const id of ids) {
    assert.ok(files[`projects/${id}.md`], id)
    assert.equal(JSON.parse(files[`projects/${id}.json`]).project.id, id)
    assert.match(files['dashboard.md'], new RegExp(`\\(projects/${id}\\.md\\)`))
  }
  assert.equal(JSON.parse(files['dashboard.json']).projects.length, 8)
  const scoped = assessment.projects.filter(p => p.facts.targetVersion).map(p => p.id).sort()
  assert.deepEqual(scoped, ['one-small-mods-pack', 'one-small-ui'])
  for (const id of scoped) for (const name of ['release-prep.md', 'release-prep.json', 'checklist.md', 'release-notes.draft.md', 'CHANGELOG.draft.md']) {
    assert.ok(Object.keys(files).some(k => k.startsWith(`releases/${id}/`) && k.endsWith(name)), `${id} ${name}`)
  }
})

test('deterministic: the same registry and time give byte-identical output; LF and CRLF inputs agree', () => {
  const a = gen().files
  const b = gen().files
  assert.deepEqual(a, b)
  const crlf = generate({ registryText: registryText.replace(/\n/g, '\r\n'), schema, dodText: dodText.replace(/\n/g, '\r\n'), inputs: loadInputs(inputsText, p => read(p).replace(/\n/g, '\r\n')), asOf: AS_OF }).files
  assert.deepEqual(crlf, a)
  for (const [k, v] of Object.entries(a)) assert.doesNotMatch(v, /\r/, k)
  // Another time is another report; nothing depends on the wall clock otherwise.
  assert.notDeepEqual(gen({ asOf: '2026-12-31T00:00:00Z' }).files['dashboard.md'], a['dashboard.md'])
})

test('the committed reports match the registry they were generated from (npm run release:check)', () => {
  const recorded = JSON.parse(read('reports/dashboard.json'))
  if (recorded.registrySha256 !== sha256(registryText)) return // registry sync moved the registry since; release:check reports that
  const { files } = gen({ asOf: recorded.asOf })
  for (const [k, v] of Object.entries(files)) assert.equal(read(`reports/${k}`).replace(/\r\n/g, '\n'), v, k)
})

test('the registry must validate first: invalid or malformed input produces no report', () => {
  const r = JSON.parse(registryText)
  r.projects[0].releaseGates[0].status = 'verified'
  assert.throws(() => gen({ registryText: JSON.stringify(r) }), e => e instanceof ReadinessInputError && /registry is invalid/.test(e.message))
  assert.throws(() => gen({ registryText: '{"projects": [' }), ReadinessInputError)
  assert.throws(() => gen({ only: 'nope' }), UsageError)
})

test('CLI: usage errors exit 2, an unreadable registry exits 1, the registry is never written', () => {
  const run = (args, opts = {}) => spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: 'utf8', ...opts })
  assert.equal(run([]).status, 2)
  assert.equal(run(['publish']).status, 2)
  assert.equal(run(['assess', '--as-of', 'tomorrow']).status, 2)
  assert.equal(run(['assess', '--stale-days', '0']).status, 2)
  assert.equal(run(['prepare']).status, 2)
  assert.equal(run(['assess', '--project', 'nope', '--as-of', AS_OF]).status, 2)
  const before = sha256(registryText)
  const out = mkdtempSync(join(tmpdir(), 'release-'))
  try {
    const res = run(['reports', '--as-of', AS_OF, '--out', relative(ROOT, out)])
    assert.equal(res.status, 0, res.stderr)
    assert.equal(sha256(read('projects/registry.json')), before, 'the registry is read-only for this tool')
    assert.ok(existsSync(join(out, 'dashboard.md')))
    assert.equal(run(['check', '--out', relative(ROOT, out)]).status, 0)
    writeFileSync(join(out, 'projects', 'taskforge.md'), 'edited by hand\n')
    const stale = run(['check', '--out', relative(ROOT, out)])
    assert.equal(stale.status, 1)
    assert.match(stale.stderr, /projects\/taskforge\.md/)
  } finally { rmSync(out, { recursive: true, force: true }) }
  const assess = run(['assess', '--project', 'one-small-mods-pack', '--as-of', AS_OF, '--json'])
  assert.equal(assess.status, 0)
  assert.equal(JSON.parse(assess.stdout).projects[0].id, 'one-small-mods-pack')
})

test('parseArgs accepts only known options', () => {
  assert.deepEqual(parseArgs(['assess', '--as-of', AS_OF, '--stale-days', '14']).staleDays, 14)
  for (const bad of [['assess', '--write-registry'], ['assess', '--as-of'], ['assess', '--as-of', '2026-10-26']]) assert.throws(() => parseArgs(bad), UsageError, bad.join(' '))
})

test('changelog snapshots: sha256 guarded, paths kept inside the repository, sections extracted LF or CRLF', () => {
  assert.throws(() => loadInputs(inputsText, p => read(p) + 'tampered'), /does not match its recorded sha256/)
  const evil = JSON.stringify({ changelogs: { x: { path: '../../etc/passwd', commitSha: 'a'.repeat(40), sha256: 'b'.repeat(64) } } })
  assert.throws(() => loadInputs(evil, () => ''), /must stay inside the repository/)
  assert.throws(() => loadInputs('{', () => ''), /not valid JSON/)
  const text = '# Changelog\r\n\r\n## [2.0.0] - 2026-10-22\r\n### Added\r\n- A\r\n\r\n## 1.0.0\r\n- old\r\n'
  assert.deepEqual(changelogSection(text, '2.0.0'), { heading: '## [2.0.0] - 2026-10-22', body: '### Added\n- A' })
  assert.equal(changelogSection('## v1.2.3\nx', '1.2.3').body, 'x')
  assert.equal(changelogSection('## 1.2.30\nx', '1.2.3'), null, 'no prefix matches')
  assert.equal(changelogSection(text, null), null)
})

test('release preparation never claims approval, publication or verification', () => {
  const { files } = gen()
  const dir = 'releases/one-small-mods-pack/2.0.0/'
  const prep = files[`${dir}release-prep.md`]
  assert.match(prep, /Nothing was published, tagged, deployed, merged or approved/)
  assert.match(prep, /- \[ \] Joshua Small approves the release/)
  assert.match(prep, /- \[ \] Every applicable pre-publication gate independently verified on current evidence \(0\/18\)/)
  assert.match(prep, /- \[x\] Release candidate commit recorded and unchanged/)
  const json = JSON.parse(files[`${dir}release-prep.json`])
  assert.equal(json.derived.ownerChecklist.find(c => /approves/.test(c.item)).done, false)
  assert.equal(json.unverified.changelog.source.commitSha, '80cc269ebb7c20aca5f6ca03214954726fb494f7')
  assert.equal(json.unverified.changelog.stale, false)
  const notes = files[`${dir}release-notes.draft.md`]
  assert.match(notes, /\*\*Draft, not approved, not published\.\*\*/)
  assert.match(notes, /builder-authored, not independently verified/)
  assert.match(files[`${dir}CHANGELOG.draft.md`], /## 2\.0\.0 \(unreleased\)/)
  // Without a changelog the drafts are skeletons, not invented content.
  const ui = files['releases/one-small-ui/0.6.0/release-notes.draft.md']
  assert.match(ui, /Fill in from the approved scope document/)
})

test('a changelog snapshot older than the release candidate is labelled stale', () => {
  const reg = pilotRegistry()
  reg.projects[0].release.candidate.headSha = 'c'.repeat(40)
  reg.projects[0].openPullRequests[0].headSha = 'c'.repeat(40)
  const p = assessRegistry(reg, { dodText, asOf: new Date(AS_OF) }).projects[0]
  const c = inputs().get('one-small-mods-pack')
  const prep = prepareRelease(p, meta, { changelogText: c.text, changelogSource: c.source })
  assert.equal(prep.json.unverified.changelog.stale, true)
  assert.match(prep.files['release-prep.md'], /older than the release candidate/)
})

test('ModsPack pilot (frozen 2026-10-26 entry): accurate readiness, blockers and the minimum remaining work', () => {
  const a = assessRegistry(pilotRegistry(), { dodText, asOf: new Date(AS_OF) }).projects[0]
  const r = a.derived.readiness
  assert.equal(a.id, 'one-small-mods-pack')
  assert.equal(r.percentage, 0)
  assert.equal(r.verifiedGates, 0)
  assert.equal(r.applicableGates, 21)
  assert.equal(r.prePublication.applicable, 18)
  assert.deepEqual(r.byState, { verified: 0, in_progress: 13, not_started: 7, blocked: 1, not_applicable: 1, unknown_stale: 0 })
  assert.equal(r.eligibility, 'not-eligible')
  assert.equal(r.releaseReady, false)
  assert.equal(r.candidateMoved, false)
  assert.equal(r.registryBlockers, 8)
  assert.deepEqual(a.derived.blockers.merge.map(b => b.id), ['pr-description-stale'])
  assert.deepEqual(a.derived.blockers.release.filter(b => b.origin === 'derived').map(b => b.id), ['auto-critical-workflows-unverified', 'auto-missing-verification', 'auto-ownership'])
  // Builder-reported and pre-verifier passes are kept apart from verification.
  assert.equal(a.derived.gates.find(g => g.id === 'automated-checks').provenance, 'pass-without-independent-verifier')
  assert.equal(a.derived.gates.find(g => g.id === 'supply-chain-review').provenance, 'builder-reported')
  assert.equal(a.derived.gates.find(g => g.id === 'production-deployment').state, 'not_applicable')
  assert.ok(a.unverified.length >= 13)
  // The first action is naming an independent verifier; every registry blocker has an action.
  assert.equal(a.derived.nextActions[0].source, 'auto-ownership')
  for (const b of a.derived.blockers.release.filter(x => x.origin === 'registry' && x.category !== 'approval')) assert.ok(a.derived.nextActions.some(x => x.source === b.id), b.id)
  assert.ok(a.derived.nextActions.some(x => x.source === 'pr-description-stale'))
  assert.ok(a.derived.nextActions.some(x => x.source === 'publish-pipeline-missing'))
  const prep = prepareRelease(a, meta, {})
  assert.match(prep.files['checklist.md'], /Only after approval: publish or deploy, then verify distribution-verified, release-provenance, published-artifact-matches/)
})

test('ModsPack pilot: a moved PR head makes the candidate stale; a full verification reaches the owner decision only', () => {
  let reg = pilotRegistry()
  reg.projects[0].openPullRequests[0].headSha = 'd'.repeat(40)
  let a = assessRegistry(reg, { dodText, asOf: new Date(AS_OF) }).projects[0]
  assert.equal(a.derived.readiness.candidateMoved, true)
  assert.ok(a.derived.blockers.release.some(b => b.id === 'auto-candidate-moved'))

  reg = pilotRegistry()
  const p = reg.projects[0]
  const head = p.release.candidate.headSha
  p.ownership = { builder: 'Claude Code', verifier: 'ChatGPT Codex', approvalOwner: 'Joshua Small' }
  p.evidence.push({ id: 'msp-verifier', type: 'manual_test', url: `${p.repository}/pull/3`, commitSha: head, verifiedAt: '2026-10-26T01:50:00Z', result: 'pass', description: 'Fixture.', recordedBy: 'ChatGPT Codex' })
  for (const g of p.releaseGates) if (g.status !== 'not_applicable' && !['distribution-verified', 'release-provenance', 'published-artifact-matches'].includes(g.id)) Object.assign(g, { status: 'verified', evidenceRefs: ['msp-verifier'] })
  p.release.blockers = p.release.blockers.map(b => (b.category === 'approval' ? b : { ...b, status: 'resolved' }))
  a = assessRegistry(reg, { dodText, asOf: new Date(AS_OF) }).projects[0]
  assert.equal(a.derived.readiness.eligibility, 'awaiting-owner-decision')
  assert.equal(a.derived.readiness.prePublication.verified, 18)
  assert.equal(a.derived.readiness.percentage, 85.7)
  assert.equal(a.derived.readiness.releaseReady, false, 'the owner has not approved and nothing is published')
})

test('sensitive data is redacted from every report and artifact', () => {
  const reg = JSON.parse(registryText)
  const p = reg.projects.find(x => x.id === 'one-small-mods-pack')
  const token = 'ghp_' + 'z'.repeat(36)
  p.name = `ModsPack ${token}`
  p.release.blockers[0].description = `leaked ${token} and card 4111 1111 1111 1111`
  p.release.nextAction = 'mail someone@example.com'
  // The validator would refuse this registry; render directly to prove the renderers redact on their own.
  const a = assessRegistry(reg, { dodText, asOf: new Date(AS_OF) })
  const mp = a.projects.find(x => x.id === 'one-small-mods-pack')
  const outputs = [renderDashboard(a, meta), renderProjectReport(mp, meta), toJson(mp), ...Object.values(prepareRelease(mp, meta, {}).files)]
  for (const out of outputs) {
    assert.doesNotMatch(out, /ghp_z/)
    assert.doesNotMatch(out, /4111 1111 1111 1111/)
    assert.doesNotMatch(out, /someone@example\.com/)
  }
  assert.throws(() => gen({ registryText: JSON.stringify(reg) }), /registry is invalid/)
})

test('governance: sync cannot change the release candidate, blocker classification or dependencies', () => {
  const base = JSON.parse(registryText)
  const mutations = {
    'release.candidate': r => { r.projects[0].release.candidate.headSha = 'e'.repeat(40) },
    'blocker classification': r => { r.projects[0].release.blockers[0].blocks = 'merge' },
    'blocker severity': r => { r.projects[0].release.blockers[0].category = 'security'; r.projects[0].release.blockers[0].severity = 'low' },
    'remove a blocker': r => { r.projects[0].release.blockers.pop() },
    dependencies: r => { r.projects.find(p => p.id === 'cortex').dependencies[0].requiredForRelease = true }
  }
  for (const [name, mutate] of Object.entries(mutations)) {
    const head = structuredClone(base)
    mutate(head)
    const id = name === 'dependencies' ? 'cortex' : 'one-small-mods-pack'
    assert.ok(guardRegistryChange(base, head, id).some(e => /manual and cannot be changed by sync/.test(e)), name)
  }
})

test('schema 1.3.0: classification fields are typed and cross-checked', () => {
  const dod = parseDefinitionOfDone(dodText)
  const check = mutate => {
    const r = JSON.parse(registryText)
    mutate(r)
    return validateRegistry(r, schema, { now: new Date('2030-01-01T00:00:00Z'), dod }).join('\n')
  }
  const mp = r => r.projects.find(p => p.id === 'one-small-mods-pack')
  assert.match(check(r => { mp(r).release.blockers[0].category = 'cosmetic' }), /category/)
  assert.match(check(r => { mp(r).release.blockers[0].blocks = 'deploy' }), /blocks/)
  assert.match(check(r => { mp(r).release.blockers[0].gates = ['authentication'] }), /"authentication" is not one of this project's gates/)
  assert.match(check(r => { mp(r).release.blockers[0].severity = 'high' }), /severity applies only to category security/)
  assert.match(check(r => { mp(r).release.candidate.headSha = 'abc' }), /headSha/)
  assert.match(check(r => { mp(r).release.candidate.observedAt = '2031-01-01T00:00:00Z' }), /observedAt is later than registry lastUpdatedAt/)
  assert.match(check(r => { mp(r).release.targetVersion = null }), /a release candidate needs a targetVersion/)
  assert.match(check(r => { mp(r).release.candidate.extra = 1 }), /unknown property "extra"/)
  assert.match(check(r => { r.projects.find(p => p.id === 'cortex').dependencies[0].relationship = 'guessed' }), /relationship/)
  assert.match(check(r => { r.projects.find(p => p.id === 'cortex').dependencies.push({ ...r.projects.find(p => p.id === 'cortex').dependencies[0] }) }), /declared twice/)
})

test('the readiness tooling holds no write permission in CI and makes no network calls', () => {
  const wf = read('.github/workflows/validate.yml')
  assert.match(wf, /^permissions:\n  contents: read$/m)
  assert.doesNotMatch(wf, /:\s*write\b/)
  for (const f of readdirSync(resolve(ROOT, 'scripts/release')).filter(f => f.endsWith('.mjs') && !f.endsWith('.test.mjs'))) {
    const src = read(`scripts/release/${f}`)
    assert.doesNotMatch(src, /\bfetch\(|node:https?|node:net|child_process|createClient/, f)
    assert.doesNotMatch(src, /writeFileSync\([^)]*registry/, f)
  }
})
