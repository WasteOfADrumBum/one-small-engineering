import { test } from 'node:test'
import assert from 'node:assert/strict'
import { installPlan, withBlock, blockText, INSTRUCTION_FILES } from './install.mjs'
import { validateState } from './lib.mjs'

const project = { id: 'taskforge', repository: 'https://github.com/WasteOfADrumBum/TaskForge' }

test('fresh repository gets every instruction file and a valid all-unknown state', () => {
  const { files } = installPlan({ project, defaultBranch: 'main', existing: {} })
  for (const f of INSTRUCTION_FILES) assert.match(files[f], /Engineering Hub continuity \(v1\)/)
  const state = JSON.parse(files['.engineering/state.json'])
  assert.deepEqual(validateState(state, { projectId: 'taskforge' }), [])
  assert.equal(state.recorded.commit, null)
  assert.equal(state.development.nextAction, null)
  assert.ok(files['.engineering/HANDOFF.md'] && files['.engineering/STATUS.md'])
})

test('existing instructions are preserved verbatim; the block is appended once and refreshed in place', () => {
  const claude = '# TaskForge rules\n\nUse pnpm.\n'
  const once = withBlock(claude)
  assert.ok(once.startsWith(claude.trimEnd()))
  assert.equal(withBlock(once), once, 'idempotent')
  const edited = once.replace('Never:', 'Never (old):')
  assert.equal(withBlock(edited), once, 'a drifted block is refreshed, text outside it untouched')
  assert.ok(withBlock('# x\r\n').includes('\r\n') && !/[^\r]\n/.test(withBlock('# x\r\n')))
})

test('an existing state is never reset; a repo already installed plans nothing', () => {
  const first = installPlan({ project, defaultBranch: 'main', existing: {} })
  const existing = { ...first.files, '.engineering/state.json': first.files['.engineering/state.json'].replace('"revision": 0', '"revision": 5') }
  const again = installPlan({ project, defaultBranch: 'main', existing })
  assert.ok(!('.engineering/state.json' in again.files), 'state is never rewritten')
  assert.ok(!INSTRUCTION_FILES.some(f => f in again.files), 'instruction blocks already current')
  assert.ok(again.unchanged.includes('.engineering/state.json'))
  const clean = installPlan({ project, defaultBranch: 'main', existing: first.files })
  assert.deepEqual(clean.files, {}, 'a repo already installed plans nothing')
})

test('a broken marker is refused rather than guessed at', () => {
  assert.throws(() => withBlock('<!-- one-small-engineering:continuity v1 -->\nhalf'), /unterminated/)
  assert.ok(blockText().includes('Joshua Small'))
})

test('generated views are refreshed from an existing state; the state itself is not touched', () => {
  const first = installPlan({ project, defaultBranch: 'main', existing: {} })
  const existing = { ...first.files, '.engineering/STATUS.md': 'drifted\n' }
  const again = installPlan({ project, defaultBranch: 'main', existing })
  assert.deepEqual(Object.keys(again.files), ['.engineering/STATUS.md'])
  assert.equal(again.files['.engineering/STATUS.md'], first.files['.engineering/STATUS.md'])
})

test('generated content is Prettier-stable: blank line after a leading HTML comment and around the block markers', () => {
  const { files } = installPlan({ project, defaultBranch: 'main', existing: {} })
  assert.match(files['.engineering/STATUS.md'], /-->\n\n# /)
  assert.match(files['.engineering/HANDOFF.md'], /-->\n\n# /)
  assert.match(files['AGENTS.md'], /v1 -->\n\n## /)
  assert.match(files['AGENTS.md'], /\n\n<!-- \/one-small/)
})

test('an existing malformed or invalid state file is refused with its path, never rendered or rewritten', () => {
  // GitHub Copilot review of PR #31, 2026-11-02.
  const { files } = installPlan({ project, defaultBranch: 'main', existing: {} })
  assert.throws(() => installPlan({ project, defaultBranch: 'main', existing: { ...files, '.engineering/state.json': '{ not json' } }), /\.engineering\/state\.json is not valid JSON/)
  const wrong = JSON.stringify({ ...JSON.parse(files['.engineering/state.json']), projectId: 'someone-else' })
  assert.throws(() => installPlan({ project, defaultBranch: 'main', existing: { ...files, '.engineering/state.json': wrong } }), /\.engineering\/state\.json is invalid/)
})

test('an existing state with missing views gets only the views, never a new state', () => {
  // GitHub Copilot review of PR #29 (2026-11-02) asked for this; the installer already did it.
  const { files } = installPlan({ project, defaultBranch: 'main', existing: {} })
  const partial = { ...files }
  delete partial['.engineering/STATUS.md']
  delete partial['.engineering/HANDOFF.md']
  const plan = installPlan({ project, defaultBranch: 'main', existing: partial })
  assert.equal(plan.files['.engineering/STATUS.md'], files['.engineering/STATUS.md'])
  assert.equal(plan.files['.engineering/HANDOFF.md'], files['.engineering/HANDOFF.md'])
  assert.ok(!('.engineering/state.json' in plan.files))
})
