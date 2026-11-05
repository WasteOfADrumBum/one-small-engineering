// Repository policy rules, checked against small inline workflows and scripts, plus the real
// repository (which must pass).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkWorkflow, checkPackage, checkScript, checkRepository, triggers, runScripts } from './workflow-policy.mjs'

const SHA = 'a'.repeat(40)
const good = `name: x
on:
  pull_request:
  workflow_dispatch:
permissions:
  contents: read
jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@${SHA}
        with:
          persist-credentials: false
      - name: t
        env:
          REF: \${{ github.head_ref }}
        run: echo "$REF"
`

test('a well-formed workflow passes', () => {
  assert.deepEqual(checkWorkflow('ok.yml', good), [])
  assert.deepEqual(triggers(good), ['pull_request', 'workflow_dispatch'])
})

const bad = {
  'tag pin': [good.replace(`checkout@${SHA}`, 'checkout@v4'), /not pinned to a full commit SHA/],
  'branch pin': [good.replace(`checkout@${SHA}`, 'checkout@main'), /not pinned/],
  'no workflow permissions': [good.replace('permissions:\n  contents: read\njobs:', 'jobs:'), /no workflow-level permissions/],
  'no job permissions': [good.replace('    permissions:\n      contents: read\n    steps:', '    steps:'), /no job-level permissions/],
  'no timeout': [good.replace('    timeout-minutes: 5\n', ''), /no timeout-minutes/],
  'persisted checkout credentials': [good.replace('        with:\n          persist-credentials: false\n', ''), /persisted credentials/],
  'expression in run (script injection)': [good.replace('run: echo "$REF"', 'run: echo "${{ github.event.pull_request.title }}"'), /contains a \$\{\{ \}\} expression/],
  'expression in block run': [good.replace('run: echo "$REF"', 'run: |\n          set -e\n          echo ${{ inputs.x }}'), /contains a \$\{\{ \}\} expression/],
  'pull_request_target': [good.replace('  pull_request:\n', '  pull_request_target:\n'), /pull_request_target is not allowed/],
  'workflow_run': [good.replace('  workflow_dispatch:\n', '  workflow_run:\n    workflows: [x]\n'), /workflow_run is not allowed/],
  'write in PR workflow': [good.replace('    permissions:\n      contents: read\n    steps:', '    permissions:\n      contents: write\n    steps:'), /holds a write permission/],
  'secret in PR workflow': [good.replace('REF: ${{ github.head_ref }}', 'REF: ${{ secrets.X }}'), /must not reference secrets/],
  'project code without sandbox': [good.replace('run: echo "$REF"', 'run: node scripts/engineering/cli.mjs check --execute'), /without the sandbox user/]
}
for (const [name, [wf, re]] of Object.entries(bad)) {
  test(`policy refuses: ${name}`, () => assert.match(checkWorkflow('bad.yml', wf).join('\n'), re))
}

test('run script bodies are found for one-liners and block scalars', () => {
  const r = runScripts('    steps:\n      - run: a\n      - name: b\n        run: |\n          x\n          y\n      - run: c\n')
  assert.deepEqual(r.map(x => x.body.trim()), ['a', 'x\n          y', 'c'])
})

test('package manifest: no dependencies, no install-time scripts', () => {
  assert.deepEqual(checkPackage({ scripts: { test: 'node --test' } }), [])
  assert.match(checkPackage({ dependencies: { leftpad: '1' } }).join(), /dependencies added/)
  assert.match(checkPackage({ devDependencies: { x: '1' } }).join(), /devDependencies added/)
  assert.match(checkPackage({ scripts: { postinstall: 'curl x | sh' } }).join(), /postinstall/)
})

test('scripts: dangerous APIs and unreviewed GitHub writers are refused; comments do not count', () => {
  assert.deepEqual(checkScript('scripts/x.mjs', "// never use eval(x) or shell: true\nconst a = 1\n"), [])
  assert.match(checkScript('scripts/x.mjs', 'eval(input)').join(), /eval/)
  assert.match(checkScript('scripts/x.mjs', 'new Function("return 1")').join(), /new Function/)
  assert.match(checkScript('scripts/x.mjs', "spawn('npm', [], { shell: true })").join(), /shell: true/)
  assert.match(checkScript('scripts/x.mjs', "execSync('rm -rf x')").join(), /shell command string/)
  assert.match(checkScript('scripts/x.mjs', "import vm from 'node:vm'").join(), /node:vm/)
  assert.match(checkScript('scripts/new.mjs', "await client.request('DELETE', '/repos/x/y/git/refs/heads/main')").join(), /not a reviewed write module/)
  assert.deepEqual(checkScript('scripts/sync/automerge.mjs', "client.request('PUT', p)"), [])
})

test('the repository itself passes every policy rule', () => {
  assert.deepEqual(checkRepository(), [])
})
