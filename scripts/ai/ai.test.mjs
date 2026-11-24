// Tests for the AI engineering standards system (scripts/ai, docs/ai-standards.md).
// Every scenario runs against temporary fixture repositories; nothing touches a real repository.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, win32 } from 'node:path'
import { run } from './cli.mjs'
import { SOURCE_DIR, extractBlock, writeBlock, removeBlock, normalizeUserPath, repoSlug, sha256, renderTemplate, coreRules, compareVersions, bumpVersion, BLOCK_START, BLOCK_END } from './lib.mjs'
import { loadSource, requireValidSource, renderBlock, renderChatgpt, resolveAdapters } from './source.mjs'
import { planSync, projectText } from './plan.mjs'
import { applyPlan, readTarget, transact, nodeIo, acquireLock, listSnapshots } from './apply.mjs'
import { discoverRepos } from './discover.mjs'
import { validateSource, validateTarget, importCycles, references } from './validate.mjs'
import { resolveWorkspace, recordInstallation, newEntry, validateRegistryData } from './registry.mjs'

// ---------------------------------------------------------------- fixtures

function tempDir(prefix = 'ose ai ') {
  // A space in every temp path, so Windows-style "01 Development" folders are always exercised.
  return mkdtempSync(join(tmpdir(), prefix))
}

function makeRepo(dir, files = {}, remote = 'https://github.com/Example/demo.git') {
  mkdirSync(join(dir, '.git'), { recursive: true })
  writeFileSync(join(dir, '.git', 'config'), `[core]\n\tbare = false\n[remote "origin"]\n\turl = ${remote}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`)
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true })
    writeFileSync(join(dir, rel), text)
  }
  return dir
}

function snapshotTree(dir) {
  const out = {}
  const walk = d => {
    for (const name of readdirSync(d, { withFileTypes: true })) {
      if (name.name === '.git') continue
      const full = join(d, name.name)
      if (name.isDirectory()) walk(full)
      else out[relative(dir, full).split('\\').join('/')] = readFileSync(full, 'utf8')
    }
  }
  walk(dir)
  return out
}

// A private copy of the real source, so tests can change policies without touching the hub.
function copySource() {
  const dir = join(tempDir('ose source '), 'ai-standards')
  cpSync(SOURCE_DIR, dir, { recursive: true })
  writeFileSync(join(dir, 'registry.json'), JSON.stringify({ registryVersion: 1, discovery: { maxDepth: 3, exclude: [] }, repositories: [] }, null, 2) + '\n')
  return dir
}

function cli(argv, { sourceDir, workspace, registry } = {}) {
  const env = { OSE_SOURCE_DIR: sourceDir || copySource(), OSE_WORKSPACE: workspace || tempDir() }
  env.OSE_REGISTRY = registry || join(env.OSE_SOURCE_DIR, 'registry.json')
  return { ...run(argv, env), env }
}

const PROJECT_CLAUDE = '# Demo project\r\n\r\nUse pnpm. Never touch the legacy/ folder.\r\n'

function demoRepo(extra = {}) {
  const ws = tempDir('ose ws ')
  const root = makeRepo(join(ws, '01 Development', 'Demo Repo'), {
    'CLAUDE.md': PROJECT_CLAUDE,
    'AGENTS.md': '# Agents\n\nRun npm test before finishing.\n',
    'package.json': JSON.stringify({ name: 'demo', scripts: { test: 'node --test', lint: 'eslint .' }, devDependencies: { typescript: '5.0.0' } }),
    ...extra
  })
  return { ws, root }
}

function install(source, root, options = {}) {
  const plan = planSync(source, readTarget(root, source), options)
  const applied = plan.conflicts.length ? null : applyPlan(root, plan, options)
  return { plan, applied }
}

const source = requireValidSource()

// ---------------------------------------------------------------- source

test('the committed policy source is valid, checksummed and renders every adapter', () => {
  const v = validateSource()
  assert.deepEqual(v.problems, [])
  for (const a of v.source.manifest.adapters) assert.ok(a.id)
  assert.ok(source.policies.length >= 9)
  for (const p of source.policies) assert.ok(p.rules.length > 0, `${p.id} has core rules`)
})

test('source integrity: a changed policy without a version bump is rejected', () => {
  const dir = copySource()
  writeFileSync(join(dir, 'policies/testing.md'), readFileSync(join(dir, 'policies/testing.md'), 'utf8') + '\n- sneaky rule\n')
  const s = loadSource(dir)
  assert.ok(s.problems.some(p => p.includes('testing') && p.includes('checksum')))
  assert.throws(() => requireValidSource(dir), /policy source is invalid/)
})

test('missing source policy file is reported', () => {
  const dir = copySource()
  rmSync(join(dir, 'policies/security.md'))
  assert.ok(loadSource(dir).problems.some(p => p.includes('missing source file policies/security.md')))
})

test('malformed source manifest is reported by schema', () => {
  const dir = copySource()
  const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
  m.policyVersion = 'one'
  delete m.adapters
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(m))
  const s = loadSource(dir)
  assert.ok(s.problems.some(p => p.includes('policyVersion')))
  assert.ok(s.problems.some(p => p.includes('adapters')))
})

test('a secret placed in a policy fails source validation', () => {
  const dir = copySource()
  // Assembled at run time so this repository never contains a credential-shaped literal (gitleaks).
  const assignment = `${['api', 'key'].join('_')} = "${'abcdef'}${'123456'}"`
  writeFileSync(join(dir, 'policies/testing.md'), readFileSync(join(dir, 'policies/testing.md'), 'utf8') + `\n${assignment}\n`)
  assert.equal(run(['ai', 'bump', '--level', 'patch'], { OSE_SOURCE_DIR: dir, OSE_REGISTRY: join(dir, 'registry.json') }).code, 0)
  assert.ok(loadSource(dir).problems.some(p => p.includes('sensitive')))
})

test('bump records new checksums and version; content changes are then accepted', () => {
  const dir = copySource()
  writeFileSync(join(dir, 'policies/testing.md'), readFileSync(join(dir, 'policies/testing.md'), 'utf8') + '\nExtra detail.\n')
  const r = run(['ai', 'bump', '--level', 'minor'], { OSE_SOURCE_DIR: dir, OSE_REGISTRY: join(dir, 'registry.json') })
  assert.equal(r.code, 0, r.stderr)
  const s = requireValidSource(dir)
  assert.equal(s.manifest.policyVersion, bumpVersion(source.manifest.policyVersion, 'minor'))
})

// ---------------------------------------------------------------- generation

test('agent instructions: every block adapter renders markers, version and resolvable references', () => {
  for (const a of source.manifest.adapters.filter(x => x.kind === 'block')) {
    const block = renderBlock(source, a.id)
    assert.ok(block.startsWith(BLOCK_START) && block.endsWith(BLOCK_END), a.id)
    assert.match(block, new RegExp(`policy ${source.manifest.policyVersion.replace(/\./g, '\\.')}`))
    for (const p of source.policies) assert.ok(block.includes(`.ai/shared/${p.id}.md`), `${a.id} references ${p.id}`)
    assert.ok(!/\{\{|\}\}/.test(block))
    assert.ok(!block.includes('@.ai'), 'no Claude @imports: blocks never pull files in automatically')
  }
})

test('ChatGPT file carries project rules and is self-contained', () => {
  const text = renderChatgpt(source, { projectName: 'Demo', projectMd: '# Project rules: Demo\n\n## Project-specific rules\n\n- Use pnpm.\n' })
  assert.match(text, /^# Demo: ChatGPT Project instructions/)
  assert.match(text, /- Use pnpm\./)
  assert.match(text, /does not read this repository/)
  assert.ok(!/\{\{/.test(text))
})

test('unsupported agent adapters are rejected with the supported list', () => {
  assert.throws(() => resolveAdapters(source, ['claude', 'cursor']), /unsupported agent adapter\(s\): cursor\. Supported: claude/)
  const { root } = demoRepo()
  assert.throws(() => planSync(source, readTarget(root, source), { adapters: ['windsurf'] }), /unsupported/)
})

test('template rendering refuses unknown variables', () => {
  assert.throws(() => renderTemplate('a {{nope}}', {}), /unknown template variable/)
  assert.deepEqual(coreRules('# T\n\n## Core rules\n\n- one\n- two\n  continued\n\n## Details\n\n- not me\n'), ['one', 'two continued'])
})

// ---------------------------------------------------------------- blocks

test('blocks: insert, replace and remove leave every byte outside the block untouched (CRLF kept)', () => {
  const block = `${BLOCK_START}\n\nbody\n\n${BLOCK_END}`
  const once = writeBlock(PROJECT_CLAUDE, block)
  assert.ok(once.startsWith(PROJECT_CLAUDE))
  assert.ok(once.includes('\r\n') && !/[^\r]\n/.test(once), 'CRLF preserved throughout')
  const twice = writeBlock(once, block.replace('body', 'new body'))
  assert.equal(extractBlock(twice).block, block.replace('body', 'new body'))
  assert.equal(removeBlock(twice), PROJECT_CLAUDE)
  assert.equal(extractBlock('x <!-- one-small-engineering:ai-standards v1 --> no end').state, 'malformed')
  assert.equal(extractBlock(`${block}\n${block}`).state, 'malformed')
  assert.equal(projectText(`${block}\n<!-- one-small-engineering:continuity v1 -->\nx\n<!-- /one-small-engineering:continuity -->`), '')
})

// ---------------------------------------------------------------- install and sync

test('fresh install: managed files, blocks appended, project instructions preserved, project seed written', () => {
  const { root } = demoRepo()
  const before = snapshotTree(root)
  const { plan, applied } = install(source, root)
  assert.equal(plan.conflicts.length, 0)
  assert.ok(applied.written > 10)
  const after = snapshotTree(root)
  assert.ok(after['CLAUDE.md'].startsWith(before['CLAUDE.md']), 'existing CLAUDE.md text kept byte for byte')
  assert.ok(after['AGENTS.md'].startsWith(before['AGENTS.md']))
  assert.ok(after['.github/copilot-instructions.md'].startsWith(BLOCK_START), 'missing Copilot file created')
  assert.equal(after['GEMINI.md'], undefined, 'GEMINI.md is only updated when it already exists')
  for (const p of source.policies) assert.ok(after[`.ai/shared/${p.id}.md`])
  assert.match(after['.ai/project.md'], /`CLAUDE\.md`: project text/)
  assert.match(after['.ai/project.md'], /`npm test`: tests/)
  assert.match(after['.ai/project.md'], /TypeScript/)
  assert.ok(after['.ai/chatgpt-project-instructions.md'])
  const v = validateTarget(root, source)
  assert.equal(v.status, 'pass', v.problems.join('; '))
})

test('repeated install and sync are idempotent: nothing is rewritten', () => {
  const { root } = demoRepo()
  install(source, root)
  const first = snapshotTree(root)
  const again = install(source, root)
  assert.equal(again.plan.changed, false)
  assert.equal(again.applied.written, 0)
  assert.deepEqual(snapshotTree(root), first)
})

test('CRLF checkouts (core.autocrlf) are not mistaken for local edits', () => {
  const { root } = demoRepo()
  install(source, root)
  const p = join(root, '.ai/shared/testing.md')
  writeFileSync(p, readFileSync(p, 'utf8').replace(/\n/g, '\r\n'))
  const again = planSync(source, readTarget(root, source))
  assert.equal(again.conflicts.length, 0)
  assert.equal(again.changed, false)
  assert.equal(validateTarget(root, source).status, 'pass')
})

test('existing GEMINI.md gets the block; a project-owned .ai/project.md is never overwritten', () => {
  const { root } = demoRepo({ 'GEMINI.md': '# Gemini\n', '.ai/project.md': '# Project rules: Mine\n\n- keep me\n' })
  install(source, root)
  assert.ok(readFileSync(join(root, 'GEMINI.md'), 'utf8').startsWith('# Gemini\n'))
  assert.equal(readFileSync(join(root, '.ai/project.md'), 'utf8'), '# Project rules: Mine\n\n- keep me\n')
  assert.match(readFileSync(join(root, '.ai/chatgpt-project-instructions.md'), 'utf8'), /^# Mine: ChatGPT/)
})

test('dry run reports the plan and writes nothing', () => {
  const { root, ws } = demoRepo()
  const before = snapshotTree(root)
  const r = cli(['ai', 'install', '--target', root, '--dry-run'], { workspace: ws })
  assert.equal(r.code, 0, r.stderr)
  assert.match(r.stdout, /dry run, nothing written/)
  assert.match(r.stdout, /\+ create {4}\.ai\/shared\/autonomy\.md/)
  assert.deepEqual(snapshotTree(root), before)
  assert.equal(JSON.parse(readFileSync(r.env.OSE_REGISTRY, 'utf8')).repositories.length, 0, 'dry run does not register')
})

test('version upgrade updates clean managed files and blocks, keeps project text', () => {
  const dir = copySource()
  const { root } = demoRepo()
  install(requireValidSource(dir), root)
  writeFileSync(join(dir, 'policies/testing.md'), readFileSync(join(dir, 'policies/testing.md'), 'utf8').replace('## Details', '## Details\n\n- Upgrade marker.'))
  assert.equal(run(['ai', 'bump', '--level', 'minor'], { OSE_SOURCE_DIR: dir, OSE_REGISTRY: join(dir, 'registry.json') }).code, 0)
  const v2 = requireValidSource(dir)
  const { plan } = install(v2, root)
  assert.equal(plan.fromVersion, source.manifest.policyVersion)
  assert.equal(plan.toVersion, v2.manifest.policyVersion)
  assert.match(readFileSync(join(root, '.ai/shared/testing.md'), 'utf8'), /Upgrade marker/)
  assert.ok(readFileSync(join(root, 'CLAUDE.md'), 'utf8').startsWith(PROJECT_CLAUDE))
  assert.match(readFileSync(join(root, 'CLAUDE.md'), 'utf8'), new RegExp(`policy ${v2.manifest.policyVersion.replace(/\./g, '\\.')}`))
  assert.equal(JSON.parse(readFileSync(join(root, '.ai/manifest.json'), 'utf8')).policyVersion, v2.manifest.policyVersion)
  // Downgrading is refused unless explicitly allowed.
  assert.throws(() => planSync(source, readTarget(root, source)), /older than the installed/)
  assert.doesNotThrow(() => planSync(source, readTarget(root, source), { allowDowngrade: true }))
})

test('policies removed from the source are removed from targets when unmodified', () => {
  const dir = copySource()
  const { root } = demoRepo()
  install(requireValidSource(dir), root)
  const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
  m.policies = m.policies.filter(p => p.id !== 'learning')
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(m, null, 2))
  assert.equal(run(['ai', 'bump', '--level', 'major'], { OSE_SOURCE_DIR: dir, OSE_REGISTRY: join(dir, 'registry.json') }).code, 0)
  const v2 = requireValidSource(dir)
  install(v2, root)
  assert.equal(existsSync(join(root, '.ai/shared/learning.md')), false)
  assert.equal(validateTarget(root, v2).status, 'pass')
})

// ---------------------------------------------------------------- conflicts and checksums

test('a locally modified managed file is a conflict: nothing is written until --overwrite', () => {
  const { root, ws } = demoRepo()
  const reg = join(copySource(), 'registry.json')
  const srcDir = join(reg, '..')
  assert.equal(cli(['ai', 'install', '--target', root, '--no-register'], { sourceDir: srcDir, workspace: ws }).code, 0)
  const p = join(root, '.ai/shared/testing.md')
  writeFileSync(p, readFileSync(p, 'utf8') + 'my local rule\n')
  assert.equal(validateTarget(root, source).status, 'fail')
  assert.ok(validateTarget(root, source).problems.includes('managed file modified locally: .ai/shared/testing.md'))
  // Force a pending change elsewhere so the conflict actually blocks something.
  const c = join(root, 'CLAUDE.md')
  writeFileSync(c, readFileSync(c, 'utf8').replace(/<!-- one-small-engineering:ai-standards v1 -->[\s\S]*$/, ''))
  const before = snapshotTree(root)
  const r = cli(['ai', 'sync', '--target', root], { sourceDir: srcDir, workspace: ws })
  assert.equal(r.code, 1)
  assert.match(r.stdout, /! conflict {2}\.ai\/shared\/testing\.md {2}\(modified locally since the last sync\)/)
  assert.match(r.stdout, /--overwrite \.ai\/shared\/testing\.md/)
  assert.deepEqual(snapshotTree(root), before, 'a conflict blocks the whole repository: no partial update')
  const ok = cli(['ai', 'sync', '--target', root, '--overwrite', '.ai/shared/testing.md', '--overwrite', 'CLAUDE.md'], { sourceDir: srcDir, workspace: ws })
  assert.equal(ok.code, 0, ok.stdout + ok.stderr)
  assert.doesNotMatch(readFileSync(p, 'utf8'), /my local rule/)
  assert.ok(readFileSync(c, 'utf8').startsWith(PROJECT_CLAUDE))
})

test('unowned files at managed paths and edited or removed blocks are conflicts', () => {
  const { root } = demoRepo({ '.ai/shared/testing.md': 'someone else wrote this\n' })
  let plan = planSync(source, readTarget(root, source))
  assert.ok(plan.conflicts.some(c => c.path === '.ai/shared/testing.md' && /not written by ose ai/.test(c.reason)))
  rmSync(join(root, '.ai'), { recursive: true })
  install(source, root)
  const c = join(root, 'AGENTS.md')
  writeFileSync(c, readFileSync(c, 'utf8').replace('- Own the task', '- Own SOME of the task'))
  plan = planSync(source, readTarget(root, source))
  assert.ok(plan.conflicts.some(x => x.path === 'AGENTS.md' && /modified locally/.test(x.reason)))
  writeFileSync(c, '# Agents only\n')
  plan = planSync(source, readTarget(root, source))
  assert.ok(plan.conflicts.some(x => x.path === 'AGENTS.md' && /removed locally/.test(x.reason)))
})

test('a manifest from a different source, or unreadable, is refused', () => {
  const { root } = demoRepo({ '.ai/manifest.json': JSON.stringify({ source: { id: 'someone/else' }, policyVersion: '1.0.0' }) })
  assert.throws(() => planSync(source, readTarget(root, source)), /different source/)
  writeFileSync(join(root, '.ai/manifest.json'), '{ not json')
  assert.throws(() => planSync(source, readTarget(root, source)), /not valid JSON/)
})

// ---------------------------------------------------------------- atomicity and locking

test('atomic update: a failure part-way restores every file that was already changed', () => {
  const { root } = demoRepo()
  install(source, root)
  const dir = copySource()
  for (const id of ['testing', 'security']) writeFileSync(join(dir, `policies/${id}.md`), readFileSync(join(dir, `policies/${id}.md`), 'utf8') + '\nChanged.\n')
  run(['ai', 'bump', '--level', 'patch'], { OSE_SOURCE_DIR: dir, OSE_REGISTRY: join(dir, 'registry.json') })
  const v2 = requireValidSource(dir)
  const before = snapshotTree(root)
  const plan = planSync(v2, readTarget(root, v2))
  let renames = 0
  const flaky = { ...nodeIo, rename: (a, b) => { if (++renames === 4) throw new Error('disk full (simulated)'); return nodeIo.rename(a, b) } }
  assert.throws(() => applyPlan(root, plan, { io: flaky }), /rolled back .*disk full/)
  assert.deepEqual(snapshotTree(root), before, 'tree identical to before the failed run, no temp files left')
  assert.equal(existsSync(join(root, '.ai/.lock')), false, 'lock released')
})

test('transact restores deleted and created files on failure', () => {
  const dir = tempDir()
  writeFileSync(join(dir, 'keep.txt'), 'original')
  const flaky = { ...nodeIo, writeFile: (p, d, o) => { if (p.endsWith('boom.txt.ose-tmp')) throw new Error('boom'); return nodeIo.writeFile(p, d, o) } }
  assert.throws(() => transact(dir, [{ path: 'keep.txt', content: null }, { path: 'new/a.txt', content: 'a' }, { path: 'boom.txt', content: 'x' }], flaky), /boom/)
  assert.equal(readFileSync(join(dir, 'keep.txt'), 'utf8'), 'original')
  assert.equal(existsSync(join(dir, 'new/a.txt')), false)
  assert.throws(() => transact(dir, [{ path: '../escape.txt', content: 'x' }]), /escapes the repository/)
})

test('a second concurrent run is refused by the lock', () => {
  const { root } = demoRepo()
  const release = acquireLock(root)
  const plan = planSync(source, readTarget(root, source))
  assert.throws(() => applyPlan(root, plan), /another ose ai run holds/)
  release()
  assert.doesNotThrow(() => applyPlan(root, plan))
})

// ---------------------------------------------------------------- rollback

test('rollback of an install restores the repository byte for byte', () => {
  const { root, ws } = demoRepo()
  const before = snapshotTree(root)
  const src = copySource()
  assert.equal(cli(['ai', 'install', '--target', root, '--no-register'], { sourceDir: src, workspace: ws }).code, 0)
  const r = cli(['ai', 'rollback', '--target', root], { sourceDir: src, workspace: ws })
  assert.equal(r.code, 0, r.stdout + r.stderr)
  assert.deepEqual(snapshotTree(root), before)
  assert.equal(existsSync(join(root, '.ai')), false)
  assert.equal(cli(['ai', 'rollback', '--target', root], { sourceDir: src, workspace: ws }).code, 1, 'nothing left to roll back')
})

test('rollback after an upgrade returns to the previous version and keeps project edits', () => {
  const dir = copySource()
  const { root } = demoRepo()
  install(requireValidSource(dir), root)
  writeFileSync(join(root, '.ai/project.md'), readFileSync(join(root, '.ai/project.md'), 'utf8') + '\n- my project rule\n')
  writeFileSync(join(dir, 'policies/testing.md'), readFileSync(join(dir, 'policies/testing.md'), 'utf8') + '\nV2.\n')
  run(['ai', 'bump', '--level', 'minor'], { OSE_SOURCE_DIR: dir, OSE_REGISTRY: join(dir, 'registry.json') })
  install(requireValidSource(dir), root)
  const r = run(['ai', 'rollback', '--target', root], { OSE_SOURCE_DIR: dir, OSE_REGISTRY: join(dir, 'registry.json'), OSE_WORKSPACE: tempDir() })
  assert.equal(r.code, 0, r.stdout + r.stderr)
  assert.equal(JSON.parse(readFileSync(join(root, '.ai/manifest.json'), 'utf8')).policyVersion, source.manifest.policyVersion)
  assert.doesNotMatch(readFileSync(join(root, '.ai/shared/testing.md'), 'utf8'), /V2\./)
  assert.match(readFileSync(join(root, '.ai/project.md'), 'utf8'), /my project rule/)
})

test('rollback refuses when a managed file changed after the sync (no partial rollback)', () => {
  const { root } = demoRepo()
  install(source, root)
  const c = join(root, 'CLAUDE.md')
  writeFileSync(c, readFileSync(c, 'utf8').replace('Own the task', 'Own it'))
  const before = snapshotTree(root)
  const r = run(['ai', 'rollback', '--target', root], { OSE_SOURCE_DIR: copySource(), OSE_WORKSPACE: tempDir(), OSE_REGISTRY: join(copySource(), 'registry.json') })
  assert.equal(r.code, 1)
  assert.match(r.stdout, /conflict CLAUDE\.md/)
  assert.deepEqual(snapshotTree(root), before)
})

test('history keeps only the configured number of snapshots', () => {
  const dir = copySource()
  const { root } = demoRepo()
  for (let i = 0; i < 4; i++) {
    writeFileSync(join(dir, 'policies/testing.md'), readFileSync(join(dir, 'policies/testing.md'), 'utf8') + `\nRound ${i}.\n`)
    run(['ai', 'bump', '--level', 'patch'], { OSE_SOURCE_DIR: dir, OSE_REGISTRY: join(dir, 'registry.json') })
    install(requireValidSource(dir), root, { keep: 2, now: new Date(Date.UTC(2026, 0, 1, 0, 0, i)) })
  }
  assert.equal(listSnapshots(root).length, 2)
})

// ---------------------------------------------------------------- validation

test('validation finds missing files, broken references and @import cycles', () => {
  const { root } = demoRepo()
  install(source, root)
  rmSync(join(root, '.ai/shared/accessibility.md'))
  const v = validateTarget(root, source)
  assert.equal(v.status, 'fail')
  assert.ok(v.problems.includes('missing managed file: .ai/shared/accessibility.md'))
  assert.ok(v.problems.some(p => p.includes('broken reference to .ai/shared/accessibility.md')))
  const files = { 'CLAUDE.md': 'see @docs/a.md', 'docs/a.md': 'and @b.md', 'docs/b.md': 'back to @../CLAUDE.md' }
  const read = p => files[p] ?? null
  assert.ok(importCycles('', 'CLAUDE.md', read).some(p => p.startsWith('circular @import')))
  assert.deepEqual(importCycles('', 'CLAUDE.md', p => ({ 'CLAUDE.md': 'mail me@example.dev, code `@x.md`' })[p] ?? null), [])
  assert.deepEqual(references('read `.ai/shared/x.md` and [y](.ai/project.md), not `.ai/shared/`'), ['.ai/shared/x.md', '.ai/project.md'])
})

test('an installed manifest that fails its schema is reported, not trusted', () => {
  const { root } = demoRepo()
  install(source, root)
  const p = join(root, '.ai/manifest.json')
  const m = JSON.parse(readFileSync(p, 'utf8'))
  m.policyVersion = 'latest'
  writeFileSync(p, JSON.stringify(m))
  const v = validateTarget(root, source)
  assert.equal(v.status, 'fail')
  assert.ok(v.problems.some(x => x.includes('policyVersion')))
})

// ---------------------------------------------------------------- discovery and registry

test('discovery finds repo roots, skips excluded and dependency folders, never double-counts nested repos', () => {
  const ws = tempDir('ose discover ')
  makeRepo(join(ws, 'Alpha Project'), {}, 'git@github.com:Owner/Alpha.git')
  makeRepo(join(ws, 'Alpha Project', 'packages', 'nested'), {}, 'https://github.com/Owner/nested')
  makeRepo(join(ws, 'group', 'Beta'), {}, 'https://github.com/Owner/beta.git')
  makeRepo(join(ws, 'node_modules', 'dep'), {})
  makeRepo(join(ws, 'archive', 'Old'), {}, 'https://github.com/Owner/old.git')
  makeRepo(join(ws, 'a', 'b', 'c', 'too-deep'), {})
  mkdirSync(join(ws, 'Gamma'))
  writeFileSync(join(ws, 'Gamma', '.git'), 'gitdir: ../.worktrees/gamma\n')
  makeRepo(join(ws, '.worktrees', 'gamma'), {}, 'https://github.com/Owner/gamma.git')
  writeFileSync(join(ws, '.worktrees', 'gamma', 'config'), '[remote "origin"]\n\turl = https://github.com/Owner/gamma.git\n')
  const found = discoverRepos(ws, { maxDepth: 3, exclude: ['archive', '.worktrees'] })
  const slugs = found.map(f => f.slug).sort()
  assert.deepEqual(slugs, ['owner/alpha', 'owner/beta', 'owner/gamma'])
  assert.equal(repoSlug('https://github.com/Owner/Repo.git/'), 'owner/repo')
  assert.equal(repoSlug('git@github.com:Owner/Repo'), 'owner/repo')
  assert.equal(repoSlug('https://gitlab.com/x/y'), null)
})

test('install registers the repository; sync --all uses the registry and updates it only on change', () => {
  const { root, ws } = demoRepo()
  const src = copySource()
  const r1 = cli(['ai', 'install', '--target', root], { sourceDir: src, workspace: ws })
  assert.equal(r1.code, 0, r1.stderr)
  const regPath = join(src, 'registry.json')
  const reg = JSON.parse(readFileSync(regPath, 'utf8'))
  assert.equal(reg.repositories[0].id, 'demo')
  assert.equal(reg.repositories[0].installation.status, 'installed')
  assert.equal(reg.repositories[0].installation.validation, 'pass')
  assert.deepEqual(validateRegistryData(reg), [])
  const regText = readFileSync(regPath, 'utf8')
  const all = cli(['ai', 'sync', '--all'], { sourceDir: src, workspace: ws })
  assert.equal(all.code, 0, all.stdout + all.stderr)
  assert.match(all.stdout, /demo: policy .* up to date/s)
  assert.equal(readFileSync(regPath, 'utf8'), regText, 'idempotent: registry unchanged when nothing changed')
  const st = cli(['ai', 'status', '--json'], { sourceDir: src, workspace: ws })
  assert.equal(JSON.parse(st.stdout).repositories[0].validation, 'pass')
  const byId = cli(['ai', 'validate', '--target', 'demo'], { sourceDir: src, workspace: ws })
  assert.equal(byId.code, 0, byId.stdout + byId.stderr)
})

test('sync --all keeps going past a conflicted or missing repository', () => {
  const ws = tempDir('ose all ')
  const src = copySource()
  const a = makeRepo(join(ws, 'A'), {}, 'https://github.com/Owner/a.git')
  const b = makeRepo(join(ws, 'B'), {}, 'https://github.com/Owner/b.git')
  for (const r of [a, b]) assert.equal(cli(['ai', 'install', '--target', r], { sourceDir: src, workspace: ws }).code, 0)
  const reg = JSON.parse(readFileSync(join(src, 'registry.json'), 'utf8'))
  reg.repositories.push(newEntry({ id: 'gone', repository: 'Owner/gone', adapters: ['claude'] }))
  writeFileSync(join(src, 'registry.json'), JSON.stringify(reg, null, 2))
  writeFileSync(join(a, '.ai/shared/testing.md'), 'edited\n')
  const dir = join(src)
  writeFileSync(join(dir, 'policies/security.md'), readFileSync(join(dir, 'policies/security.md'), 'utf8') + '\nNew.\n')
  run(['ai', 'bump', '--level', 'patch'], { OSE_SOURCE_DIR: dir, OSE_REGISTRY: join(dir, 'registry.json') })
  const r = cli(['ai', 'sync', '--all'], { sourceDir: src, workspace: ws })
  assert.equal(r.code, 1)
  assert.match(r.stdout, /summary: 1 changed, 0 up to date, 1 conflict, 0 error, 1 skipped/)
  assert.match(readFileSync(join(b, '.ai/shared/security.md'), 'utf8'), /New\./)
})

test('recordInstallation reports a change only when a value changes', () => {
  const e = newEntry({ id: 'x', repository: 'O/x', adapters: ['claude'] })
  assert.equal(recordInstallation(e, { status: 'installed', policyVersion: '1.0.0', validation: 'pass' }), true)
  assert.equal(recordInstallation(e, { status: 'installed', policyVersion: '1.0.0', validation: 'pass' }), false)
})

test('the policy source repository itself is never installed into', () => {
  const ws = tempDir()
  const hub = makeRepo(join(ws, 'hub'), {}, 'https://github.com/Owner/hub.git')
  cpSync(SOURCE_DIR, join(hub, 'ai-standards'), { recursive: true })
  const r = cli(['ai', 'install', '--target', hub], { workspace: ws })
  assert.equal(r.code, 0)
  assert.match(r.stdout, /policy source/)
  assert.equal(existsSync(join(hub, '.ai')), false)
})

// ---------------------------------------------------------------- paths and CLI

test('Windows paths: quotes from "Copy as path", spaces and drive letters resolve', () => {
  const p = normalizeUserPath('  "C:\\Workspace\\01 Development\\Projects\\Cortex"  ', { platform: 'win32', cwd: 'C:\\Users\\me' })
  assert.equal(p, 'C:\\Workspace\\01 Development\\Projects\\Cortex')
  assert.equal(normalizeUserPath('.\\Cortex', { platform: 'win32', cwd: 'C:\\Workspace\\01 Development\\Projects' }), 'C:\\Workspace\\01 Development\\Projects\\Cortex')
  assert.equal(win32.basename(p), 'Cortex')
  assert.equal(resolveWorkspace({ flag: '"D:\\My Projects"', platform: 'win32', env: {} }), 'D:\\My Projects')
  assert.equal(resolveWorkspace({ env: { OSE_WORKSPACE: '/srv/work space' }, platform: 'linux' }), '/srv/work space')
  assert.equal(resolveWorkspace({ env: {}, hubRoot: '/w/Projects/one-small-engineering' }), '/w/Projects')
})

test('relative and absolute targets (with spaces) both work from the CLI', () => {
  const { root, ws } = demoRepo()
  const src = copySource()
  const cwd = process.cwd()
  try {
    process.chdir(join(root, '..'))
    const rel = cli(['ai', 'install', '--target', './Demo Repo', '--no-register', '--dry-run'], { sourceDir: src, workspace: ws })
    assert.equal(rel.code, 0, rel.stderr)
  } finally { process.chdir(cwd) }
  const abs = cli(['ai', 'install', '--target', `"${root}"`, '--no-register'], { sourceDir: src, workspace: ws })
  assert.equal(abs.code, 0, abs.stderr)
})

test('CLI: usage errors exit 2, unknown targets and options are explained', () => {
  assert.equal(run(['ai', 'sync']).code, 2)
  assert.equal(run(['ai', 'sync', '--target', 'x', '--all']).code, 2)
  assert.equal(run(['ai', 'frobnicate']).code, 2)
  assert.equal(run(['ai', 'status', '--bogus']).code, 2)
  assert.match(run(['ai', 'install', '--target', '/definitely/not/here']).stderr, /no such folder and no registry id/)
  assert.equal(run(['ai', 'help']).code, 0)
  assert.equal(run(['ai', 'render', '--adapter', 'cursor']).code, 2)
  const r = run(['ai', 'render', '--adapter', 'chatgpt'])
  assert.equal(r.code, 0)
  assert.match(r.stdout, /ChatGPT Project instructions/)
})

test('version helpers', () => {
  assert.equal(compareVersions('1.2.0', '1.10.0'), -1)
  assert.equal(bumpVersion('1.2.3', 'major'), '2.0.0')
  assert.equal(sha256('a\r\nb'), sha256('a\nb'))
})

test('snapshots taken in the same second are ordered by sequence', () => {
  const root = tempDir()
  mkdirSync(join(root, '.ai/history'), { recursive: true })
  for (const f of ['20260101-000000-2.json', '20260101-000000.json', '20251231-235959.json', '20260101-000000-10.json']) writeFileSync(join(root, '.ai/history', f), '{}')
  assert.deepEqual(listSnapshots(root), ['20251231-235959.json', '20260101-000000.json', '20260101-000000-2.json', '20260101-000000-10.json'])
})

test('generated JSON uses the layout Prettier expects (short primitive arrays inline, objects expanded)', async () => {
  const { serializeJson } = await import('./lib.mjs')
  assert.equal(serializeJson({ adapters: ['claude', 'codex'], files: {}, list: [], nested: { a: 1 } }), '{\n  "adapters": ["claude", "codex"],\n  "files": {},\n  "list": [],\n  "nested": {\n    "a": 1\n  }\n}\n')
  const long = Array.from({ length: 12 }, (_, i) => `adapter-number-${i}`)
  assert.match(serializeJson({ long }), /"long": \[\n {4}"adapter-number-0",/)
})
