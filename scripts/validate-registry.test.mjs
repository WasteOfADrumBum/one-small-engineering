// Negative and positive tests for scripts/validate-registry.mjs. Run: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { validateRegistry, validateText, validateAgainstSchema, SchemaError, isUtcTimestamp, parseDefinitionOfDone } from './validate-registry.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const schema = JSON.parse(readFileSync(resolve(ROOT, 'projects/registry.schema.json'), 'utf8'))
const baseline = JSON.parse(readFileSync(resolve(ROOT, 'projects/registry.json'), 'utf8'))
const dodText = readFileSync(resolve(ROOT, 'standards/definition-of-done.md'), 'utf8')
const dod = parseDefinitionOfDone(dodText)
const NOW = new Date('2030-01-01T00:00:00Z')

const clone = () => structuredClone(baseline)
const project = (r, id) => r.projects.find(p => p.id === id)
const run = (r, options = {}) => validateRegistry(r, schema, { now: NOW, dod, ...options })

// Asserts the registry fails and at least one error contains `fragment`.
function rejects(r, fragment) {
  const errors = run(r)
  assert.ok(errors.length > 0, 'expected validation to fail')
  assert.ok(errors.some(e => e.includes(fragment)), `expected an error containing "${fragment}", got:\n${errors.join('\n')}`)
}

// A showcase project carried through a complete, correctly evidenced release.
function releasedFixture() {
  const r = clone()
  const p = project(r, 'one-small-studio')
  const T = '2026-10-22T16:00:00Z'
  p.evidence.push({ id: 'studio-qa-record', type: 'manual_test', url: 'https://github.com/WasteOfADrumBum/one-small-studio/pull/99', commitSha: 'a'.repeat(40), verifiedAt: T, result: 'pass', description: 'Fixture: committed QA record.', recordedBy: 'Fixture verifier' })
  p.evidence.push({ id: 'studio-owner-approval', type: 'pull_request', url: 'https://github.com/WasteOfADrumBum/one-small-studio/pull/99#pullrequestreview-1', commitSha: 'a'.repeat(40), verifiedAt: T, result: 'pass', description: 'Fixture: owner approving review.', recordedBy: 'Joshua Small' })
  p.releaseGates = p.releaseGates.map(g => ({ ...g, status: 'verified', evidenceRefs: ['studio-qa-record'], verifiedAt: T, notes: null }))
  p.release = { ...p.release, currentVersion: '1.0.0', targetVersion: '1.0.0', releaseStatus: 'released', scopeDocument: 'https://github.com/WasteOfADrumBum/one-small-studio/blob/main/docs/scope.md', blockers: [] }
  p.ownership = { builder: 'Claude Code', verifier: 'ChatGPT Codex', approvalOwner: 'Joshua Small' }
  p.approval = { status: 'approved', approvedBy: 'Joshua Small', approvedAt: T, evidenceRefs: ['studio-owner-approval'] }
  p.lastVerifiedAt = T
  return { r, p }
}

test('the committed registry is valid', () => {
  assert.deepEqual(run(clone()), [])
})

test('a fully evidenced, approved release is accepted', () => {
  assert.deepEqual(run(releasedFixture().r), [])
})

test('the CLI exits 0 on the committed registry', () => {
  const out = execFileSync(process.execPath, [resolve(ROOT, 'scripts/validate-registry.mjs')], { encoding: 'utf8' })
  assert.match(out, /validate-registry: OK/)
})

test('invalid JSON fails', () => {
  const errors = validateText('{"schemaVersion": "1.0.0",', schema)
  assert.match(errors[0], /invalid JSON/)
})

test('missing required project field fails', () => {
  const r = clone(); delete r.projects[0].tier
  rejects(r, 'missing required property "tier"')
})

test('unknown property fails', () => {
  const r = clone(); r.projects[0].percentComplete = 80
  rejects(r, 'unknown property "percentComplete"')
})

test('duplicate project IDs fail', () => {
  const r = clone(); r.projects[1].id = r.projects[0].id
  rejects(r, 'duplicate project id')
})

test('duplicate repository URLs fail, including across legacy lists and letter case', () => {
  const r = clone(); r.legacyRepositories[0].repository = r.projects[0].repository.toUpperCase().replace('HTTPS://GITHUB.COM/WASTEOFADRUMBUM', 'https://github.com/WasteOfADrumBum')
  rejects(r, 'is already listed')
})

test('invalid enum values fail', () => {
  const r1 = clone(); r1.projects[0].lifecycle = 'done'
  rejects(r1, 'is not one of active, maintenance, archived, planned')
  const r2 = clone(); r2.projects[0].release.releaseStatus = 'shipped'
  rejects(r2, 'is not one of not_started')
  const r3 = clone(); r3.projects[0].releaseGates[0].status = 'passed'
  rejects(r3, 'is not one of not_verified')
})

test('invalid timestamps fail', () => {
  assert.equal(isUtcTimestamp('2026-02-30T00:00:00Z'), false)
  assert.equal(isUtcTimestamp('2026-10-22T12:00:00-04:00'), false)
  assert.equal(isUtcTimestamp('2026-10-22T16:33:00Z'), true)
  const r = clone(); r.lastUpdatedAt = '2026-10-22 16:33'
  rejects(r, 'is not an ISO 8601 UTC timestamp')
})

test('non-https or malformed URLs fail', () => {
  const r1 = clone(); r1.projects[0].evidence[0].url = 'http://example.com/x'
  rejects(r1, 'does not match ^https://')
  const r2 = clone(); r2.projects[0].repository = 'https://gitlab.com/someone/repo'
  rejects(r2, 'does not match')
})

test('malformed evidence records fail', () => {
  const r1 = clone(); r1.projects[0].evidence[0].type = 'chat_summary'
  rejects(r1, 'is not one of pull_request')
  const r2 = clone(); r2.projects[0].evidence[0].commitSha = 'abc123'
  rejects(r2, 'does not match ^[0-9a-f]{40}$')
  const r3 = clone(); delete r3.projects[0].evidence[0].result
  rejects(r3, 'missing required property "result"')
})

test('evidence references must resolve', () => {
  const r = clone(); r.projects[0].releaseGates[0].evidenceRefs = ['does-not-exist']
  rejects(r, 'evidence reference "does-not-exist" does not match')
})

test('duplicate evidence IDs fail across projects', () => {
  const r = clone(); r.projects[1].evidence[0].id = r.projects[0].evidence[0].id
  rejects(r, 'duplicate evidence id')
})

test('a verified gate without evidence fails', () => {
  const r = clone(); Object.assign(r.projects[0].releaseGates[0], { status: 'verified', evidenceRefs: [], verifiedAt: '2026-10-22T16:00:00Z' })
  rejects(r, 'needs at least one evidence reference')
})

test('a verified gate backed only by metadata or builder-reported evidence fails', () => {
  const r1 = clone(); const p1 = project(r1, 'one-small-ui')
  Object.assign(p1.releaseGates[0], { status: 'verified', evidenceRefs: ['ui-repo-metadata'], verifiedAt: '2026-10-22T16:00:00Z' })
  rejects(r1, 'needs evidence with result "pass"')
  const r2 = clone(); const p2 = project(r2, 'one-small-mods-pack')
  Object.assign(p2.releaseGates.find(g => g.id === 'package-archive-inspection'), { status: 'verified', evidenceRefs: ['msp-release-verification'], verifiedAt: '2026-10-22T16:00:00Z' })
  rejects(r2, 'needs evidence with result "pass"')
})

test('a verified gate needs verifiedAt, and other gates must not carry one', () => {
  const r1 = clone(); const p1 = project(r1, 'one-small-ui')
  Object.assign(p1.releaseGates.find(g => g.id === 'automated-checks'), { status: 'verified', verifiedAt: null })
  rejects(r1, 'needs verifiedAt')
  const r2 = clone(); r2.projects[0].releaseGates[0].verifiedAt = '2026-10-22T16:00:00Z'
  rejects(r2, 'verifiedAt must be null unless the gate is verified')
})

test('not_applicable without an explicit rationale fails', () => {
  const r1 = clone(); Object.assign(r1.projects[0].releaseGates[0], { status: 'not_applicable', notes: '  ' })
  rejects(r1, 'not_applicable needs an explicit rationale')
  const r2 = clone(); Object.assign(r2.projects[0].releaseGates[0], { status: 'not_applicable', notes: 'n/a' })
  rejects(r2, 'not_applicable needs an explicit rationale')
})

test('every not_applicable gate in the committed registry has a rationale', () => {
  for (const p of baseline.projects) {
    for (const g of p.releaseGates.filter(g => g.status === 'not_applicable')) assert.ok(g.notes && g.notes.trim().length >= 20, `${p.id} ${g.id}`)
  }
})

test('a verified gate needs separate, assigned builder and verifier', () => {
  const { r: r1, p: p1 } = releasedFixture(); p1.ownership.builder = null
  rejects(r1, 'needs both ownership.builder and ownership.verifier assigned')
  const { r: r2, p: p2 } = releasedFixture(); p2.ownership.verifier = 'CLAUDE CODE '
  rejects(r2, 'needs a verifier different from the builder')
})

test('builder-recorded results cannot verify a gate', () => {
  const { r, p } = releasedFixture()
  p.evidence.find(e => e.id === 'studio-qa-record').recordedBy = 'Claude Code'
  rejects(r, 'recorded by someone other than the builder')
  const { r: r2, p: p2 } = releasedFixture()
  p2.evidence.find(e => e.id === 'studio-qa-record').result = 'builder_reported'
  rejects(r2, 'needs evidence with result "pass"')
})

test('a project must list exactly its tier gates', () => {
  const r1 = clone(); r1.projects[0].releaseGates.pop()
  rejects(r1, 'missing required library gate')
  const r2 = clone(); const p2 = project(r2, 'one-small-studio')
  p2.releaseGates.push({ id: 'authentication', status: 'not_verified', evidenceRefs: [], verifiedAt: null, notes: null })
  rejects(r2, 'is not part of the showcase tier')
})

test('released with unsatisfied gates fails', () => {
  const { r, p } = releasedFixture(); Object.assign(p.releaseGates[3], { status: 'not_verified', evidenceRefs: [], verifiedAt: null })
  rejects(r, 'gates are not satisfied: wcag-22-aa')
})

test('verified release status with open blockers fails', () => {
  const { r, p } = releasedFixture()
  p.release.blockers.push({ id: 'late-bug', description: 'Fixture blocker.', status: 'open', evidenceRefs: [] })
  rejects(r, 'with open blockers: late-bug')
  rejects(r, 'cannot be verified while 1 blocker(s) are open')
})

test('released without human approval fails', () => {
  const { r, p } = releasedFixture(); p.approval = { status: 'pending', approvedBy: null, approvedAt: null, evidenceRefs: [] }
  rejects(r, 'releaseStatus released needs human approval')
})

test('an AI assistant cannot record human approval', () => {
  const { r, p } = releasedFixture(); p.approval.approvedBy = 'Claude Code'
  rejects(r, 'only the human approval owner (Joshua Small) can approve')
})

test('approval without explicit evidence fails', () => {
  const { r, p } = releasedFixture(); p.approval.evidenceRefs = []
  rejects(r, 'approved needs explicit evidence')
})

test('approval before verification fails', () => {
  const r = clone(); const p = project(r, 'one-small-ui')
  p.approval = { status: 'approved', approvedBy: 'Joshua Small', approvedAt: '2026-10-22T16:00:00Z', evidenceRefs: ['ui-ci-main'] }
  rejects(r, 'approval recorded while releaseStatus is not_started')
})

test('builder and verifier must differ', () => {
  const { r, p } = releasedFixture(); p.ownership.verifier = 'claude code'
  rejects(r, 'builder and verifier must be different')
})

test('verified release needs a verifier', () => {
  const { r, p } = releasedFixture(); p.ownership.verifier = null
  rejects(r, 'needs both a builder and an independent verifier')
})

test('released version must match target version', () => {
  const { r, p } = releasedFixture(); p.release.currentVersion = '0.9.0'
  rejects(r, 'currentVersion does not equal targetVersion')
})

test('ModsPack installed without version or adapters fails', () => {
  const r = clone(); const p = project(r, 'one-small-studio')
  p.modsPack.integrationStatus = 'installed'
  rejects(r, 'needs installedVersion')
  rejects(r, 'needs at least one adapter')
})

test('credentials and financial data are rejected', () => {
  const r1 = clone(); r1.projects[0].release.nextAction = 'Use token ' + 'ghp_' + 'A1b2C3d4'.repeat(5)
  rejects(r1, 'possible sensitive data (GitHub token)')
  const r2 = clone(); r2.projects[0].missingEvidence.push('Card ' + ['4111', '1111', '1111', '1111'].join(' '))
  rejects(r2, 'payment card number')
  const r3 = clone(); r3.projects[0].missingEvidence.push('Checking account ' + '12345678' + '9')
  rejects(r3, 'possible account number')
  const r4 = clone(); r4.projects[0].release.nextAction = 'Contact someone' + '@' + 'example.com'
  rejects(r4, 'email address')
})

test('unsupported schema keywords are refused', () => {
  assert.throws(() => validateAgainstSchema({}, { type: 'object', oneOf: [] }), SchemaError)
})

test('the gate catalog equals the Definition of Done for every tier', () => {
  assert.equal(dod.showcase.length, 10)
  assert.equal(dod.library.length, 22)
  assert.equal(dod.application.length, 20)
  for (const tier of ['showcase', 'library', 'application']) assert.deepEqual([...baseline.gateCatalog[tier]].sort(), [...dod[tier]].sort(), tier)
})

test('a required gate cannot disappear from the catalog and every project together', () => {
  const r = clone()
  r.gateCatalog.application = r.gateCatalog.application.filter(id => id !== 'authentication')
  for (const p of r.projects.filter(p => p.tier === 'application')) p.releaseGates = p.releaseGates.filter(g => g.id !== 'authentication')
  rejects(r, '$.gateCatalog.application: missing gate "authentication" required by the application tier')
})

test('a catalog gate not defined for the tier fails', () => {
  const r = clone()
  r.gateCatalog.showcase.push('authentication')
  for (const p of r.projects.filter(p => p.tier === 'showcase')) p.releaseGates.push({ id: 'authentication', status: 'not_verified', evidenceRefs: [], verifiedAt: null, notes: null })
  rejects(r, '$.gateCatalog.showcase: gate "authentication" is not defined by the showcase tier')
})

// Runs on the file as checked out and on a CRLF copy, so a Windows checkout behaves the same.
for (const [eol, text] of [['LF', dodText.replace(/\r\n/g, '\n')], ['CRLF', dodText.replace(/\r?\n/g, '\r\n')]]) {
  test(`a gate removed from the Definition of Done is caught in the catalog and schema (${eol})`, () => {
    assert.deepEqual(parseDefinitionOfDone(text), dod, 'line endings do not change the parsed gate lists')
    const removed = text.replace(/^\| 11 \| `authentication` [^\r\n]*\r?\n/m, '')
    assert.equal(removed.length < text.length, true, 'the authentication row was actually removed')
    const trimmed = parseDefinitionOfDone(removed)
    assert.ok(!trimmed.application.includes('authentication'))
    assert.equal(trimmed.application.length, dod.application.length - 1)
    const errors = run(clone(), { dod: trimmed })
    assert.ok(errors.some(e => e.includes('gate "authentication" is not defined by the application tier')), errors.join('\n'))
    assert.ok(errors.some(e => e.startsWith('$schema.$defs.gateId: gate "authentication" is not defined')), errors.join('\n'))
  })
}

test('a resolved blocker needs evidence of the resolution', () => {
  const r1 = clone(); const b1 = project(r1, 'one-small-ai-workforce').release.blockers[0]
  Object.assign(b1, { status: 'resolved', evidenceRefs: [] })
  rejects(r1, 'a resolved blocker needs evidence of the resolution')
  const r2 = clone(); const b2 = project(r2, 'one-small-ai-workforce').release.blockers[0]
  Object.assign(b2, { status: 'resolved', evidenceRefs: ['aiw-repo-metadata'] })
  rejects(r2, 'a resolved blocker needs evidence of the resolution')
})

test('scope-document-missing cannot be resolved while the scope document is null', () => {
  const r = clone(); const p = project(r, 'one-small-ai-workforce')
  p.evidence.push({ id: 'aiw-scope-doc', type: 'document', url: 'https://github.com/WasteOfADrumBum/one-small-ai-workforce/blob/main/docs/scope.md', commitSha: null, verifiedAt: '2026-10-22T17:00:00Z', result: 'informational', description: 'Fixture: committed scope document.', recordedBy: 'Fixture verifier' })
  Object.assign(p.release.blockers[0], { status: 'resolved', evidenceRefs: ['aiw-scope-doc'] })
  rejects(r, 'scope-document-missing cannot be resolved while release.scopeDocument is null')
  p.release.scopeDocument = 'https://github.com/WasteOfADrumBum/one-small-ai-workforce/blob/main/docs/scope.md'
  assert.deepEqual(run(r), [])
})

// Schema 1.1.0: automated and AI records stay separate from independent verification.
const syncRecord = (over = {}) => ({
  id: 'sync-taskforge-run-ci-yml-11975d0-2t-1', type: 'workflow_run', url: 'https://github.com/WasteOfADrumBum/TaskForge/actions/runs/1',
  commitSha: '11975d0278c7f04db5033c0461295c734e3b4134', verifiedAt: '2026-10-09T19:10:23Z', result: 'builder_reported',
  description: 'Fixture: automated CI observation.', recordedBy: 'One Small Engineering Sync', origin: 'sync', eventKey: 'taskforge:workflow_run:ci.yml/11975d0/2t/1', ...over
}) // an override of undefined removes the field
const withEvidence = (...records) => {
  const r = clone()
  project(r, 'taskforge').evidence.push(...records.map(e => Object.fromEntries(Object.entries(e).filter(([, v]) => v !== undefined))))
  return r
}

test('a well-formed automated record is accepted', () => {
  assert.deepEqual(run(withEvidence(syncRecord())), [])
})

test('automated records can never be pass or fail', () => {
  rejects(withEvidence(syncRecord({ result: 'pass' })), 'origin sync can only record informational or builder_reported, not pass')
  rejects(withEvidence(syncRecord({ result: 'fail' })), 'not fail')
  rejects(withEvidence(syncRecord({ origin: 'builder-report', id: 'tf-builder-report', recordedBy: 'TaskForge CI', result: 'pass' })), 'origin builder-report can only record')
  rejects(withEvidence(syncRecord({ origin: 'ai-assessment', id: 'tf-ai', recordedBy: 'Claude Code', eventKey: undefined, result: 'pass' })), 'origin ai-assessment can only record')
})

test('an automated record cannot verify a gate even when cited', () => {
  const r = withEvidence(syncRecord())
  const p = project(r, 'taskforge')
  p.ownership = { builder: 'Claude Code', verifier: 'ChatGPT Codex', approvalOwner: 'Joshua Small' }
  Object.assign(p.releaseGates.find(g => g.id === 'automated-checks'), { status: 'verified', evidenceRefs: ['sync-taskforge-run-ci-yml-11975d0-2t-1'], verifiedAt: '2026-10-22T00:00:00Z' })
  rejects(r, 'a verified gate needs evidence with result "pass"')
})

test('automated records need a unique, project-scoped eventKey', () => {
  rejects(withEvidence(syncRecord({ eventKey: undefined })), 'origin sync needs an eventKey')
  rejects(withEvidence(syncRecord({ eventKey: 'cortex:workflow_run:ci.yml/1' })), 'eventKey must start with "taskforge:"')
  rejects(withEvidence(syncRecord(), syncRecord({ id: 'sync-taskforge-run-other' })), 'duplicate eventKey')
})

test('the sync recorder name and id prefix cannot be borrowed, and sync stays inside its repository', () => {
  rejects(withEvidence(syncRecord({ recordedBy: 'Claude Code' })), 'origin sync must be recordedBy "One Small Engineering Sync"')
  rejects(withEvidence(syncRecord({ id: 'tf-ci-auto' })), 'origin sync evidence ids start with "sync-"')
  rejects(withEvidence(syncRecord({ origin: undefined, eventKey: undefined })), 'only origin sync records may use the recorder name')
  rejects(withEvidence(syncRecord({ origin: 'manual', recordedBy: 'Claude Code', eventKey: undefined })), 'the "sync-" id prefix is reserved')
  rejects(withEvidence(syncRecord({ url: 'https://github.com/WasteOfADrumBum/cortex-brain-task/actions/runs/1' })), 'automated evidence must link inside')
  rejects(withEvidence(syncRecord({ commitSha: null })), 'automated evidence needs a commitSha')
})

test('the automated recorder can never be a builder or verifier', () => {
  const r = clone()
  project(r, 'taskforge').ownership.verifier = 'One Small Engineering Sync'
  rejects(r, 'verifier cannot be the automated recorder')
})

test('sync block: pinned positive repository id and known mode', () => {
  const r1 = clone(); project(r1, 'taskforge').sync.repositoryId = 0
  rejects(r1, '$.projects[5].sync.repositoryId: must be at least 1')
  const r2 = clone(); project(r2, 'taskforge').sync.mode = 'push'
  rejects(r2, 'is not one of observe, integrated')
  const r3 = clone(); project(r3, 'taskforge').sync.lastSyncedAt = '2031-01-01T00:00:00Z'
  rejects(r3, 'lastSyncedAt is later than registry lastUpdatedAt')
})

test('maxLength, maxItems and minimum keywords are enforced', () => {
  const s = { type: 'object', properties: { a: { type: 'string', maxLength: 3 }, b: { type: 'array', maxItems: 1 }, c: { type: 'integer', minimum: 2 } } }
  const errors = validateAgainstSchema({ a: 'long', b: [1, 2], c: 1 }, s)
  assert.equal(errors.length, 3, errors.join('\n'))
})
