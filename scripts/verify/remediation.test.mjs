import { test } from 'node:test'
import assert from 'node:assert/strict'
import { guardedClient, checkPlan, openDraftPR, issueReport, groupByRepository, RemediationRefused } from './remediation.mjs'
import { policy, SHA } from '../../fixtures/verify/helpers.mjs'

const pol = policy()
const REPO = 'https://github.com/WasteOfADrumBum/one-small-ui'
const finding = (over = {}) => ({ id: 'f1', project: 'one-small-ui', repository: REPO, commitSha: SHA, collector: 'documentation', evidenceId: 'ev-x', kind: 'defect', severity: 'low', gates: ['documentation-accurate'], releaseImpact: 'blocks verification of documentation-accurate', title: 'documentation: 1 failed', reproduction: 'node scripts/verify/cli.mjs run', rootCause: 'README links docs/missing.md', failureReason: 'failed: relative links resolve', proposedFix: 'Point the link at docs/guide.md.', acceptance: 'collector passes', verification: ['documentation-accurate: manual review'], ...over })
const plan = (over = {}) => ({ repository: REPO, baseRef: 'main', baseSha: SHA, branch: 'verify/remediation/docs-links', title: 'Fix broken documentation link', body: 'Fixes the broken link found by the documentation collector.', findings: [finding()], files: [{ path: 'README.md', content: '# fixed\n' }], ...over })
const AUTH = { repository: REPO, confirmed: true, scheduled: false }

function fakeClient({ branchExists = false } = {}) {
  const calls = []
  return {
    calls,
    async request(method, path, opts = {}) {
      calls.push({ method, path, body: opts.body })
      if (path.includes('/git/ref/heads/')) return branchExists ? { object: { sha: SHA } } : null
      if (path.includes('/git/commits/')) return { sha: SHA, tree: { sha: 't'.repeat(40) } }
      if (path.endsWith('/git/blobs')) return { sha: 'b1' }
      if (path.endsWith('/git/trees')) return { sha: 't2' }
      if (path.endsWith('/git/commits')) return { sha: 'c'.repeat(40) }
      if (path.endsWith('/git/refs')) return { ref: opts.body.ref }
      if (path.endsWith('/pulls')) return { number: 12, html_url: `${REPO}/pull/12`, draft: opts.body.draft }
      return {}
    }
  }
}

test('unauthorized writes: the guarded client refuses merge, approval, deletion, settings and release calls', async () => {
  const gh = guardedClient(fakeClient())
  const forbidden = [
    ['PUT', '/repos/o/r/pulls/3/merge'],
    ['POST', '/repos/o/r/pulls/3/reviews'],
    ['PATCH', '/repos/o/r'],
    ['DELETE', '/repos/o/r/git/refs/heads/main'],
    ['PATCH', '/repos/o/r/git/refs/heads/main'],
    ['POST', '/repos/o/r/releases'],
    ['PUT', '/repos/o/r/contents/README.md'],
    ['POST', '/repos/o/r/merges'],
    ['PATCH', '/repos/o/r/pulls/3']
  ]
  for (const [m, p] of forbidden) assert.throws(() => gh.request(m, p), RemediationRefused, `${m} ${p}`)
})

test('plans are refused for protected refs, workflow files, unsafe paths, non-defects and approval claims', () => {
  const cases = [
    [{ branch: 'main' }, /must start with verify\/remediation\//],
    [{ branch: 'verify/remediation/../main' }, /not a safe git ref/],
    [{ files: [{ path: '.github/workflows/ci.yml', content: 'x' }] }, /workflow files are never changed/],
    [{ files: [{ path: '../secrets', content: 'x' }] }, /unsafe path/],
    [{ files: [{ path: 'a', content: 'x' }, { path: 'a', content: 'y' }] }, /listed twice/],
    [{ files: [] }, /must list the files/],
    [{ findings: [finding({ kind: 'evidence-gap' })] }, /only confirmed defects/],
    [{ findings: [finding({ proposedFix: null })] }, /only confirmed defects/],
    [{ findings: [] }, /at least one finding/],
    [{ findings: [finding({ repository: 'https://github.com/WasteOfADrumBum/TaskForge' })] }, /one PR per repository/],
    [{ findings: [finding({ commitSha: 'c'.repeat(40) })] }, /re-collect on the current base/],
    [{ baseSha: 'main' }, /exact base commit/],
    [{ body: 'Approved by the owner, LGTM' }, /must not claim approval/],
    [{ files: Array.from({ length: 21 }, (_, i) => ({ path: `f${i}`, content: 'x' })) }, /at most 20 files/]
  ]
  for (const [over, re] of cases) assert.match(checkPlan(plan(over), pol).join(';'), re, JSON.stringify(over))
  assert.deepEqual(checkPlan(plan(), pol), [])
  const protectedPolicy = { ...pol, remediation: { ...pol.remediation, protectedRepositories: ['WasteOfADrumBum/one-small-ui'] } }
  assert.match(checkPlan(plan(), protectedPolicy).join(';'), /protected from automated writes/)
})

test('no authorization, scheduled runs and a mismatched repository write nothing', async () => {
  for (const auth of [null, { ...AUTH, confirmed: false }, { ...AUTH, scheduled: true }, { ...AUTH, repository: 'https://github.com/WasteOfADrumBum/TaskForge' }]) {
    const c = fakeClient()
    const res = await openDraftPR(c, plan(), pol, auth)
    assert.equal(res.created, false)
    assert.equal(c.calls.length, 0, JSON.stringify(auth))
  }
})

test('an authorized plan creates a new branch and a draft PR, and nothing else', async () => {
  const c = fakeClient()
  const res = await openDraftPR(c, plan(), pol, AUTH)
  assert.equal(res.created, true)
  assert.deepEqual(res.pullRequest, { number: 12, url: `${REPO}/pull/12`, draft: true })
  assert.deepEqual(c.calls.map(x => `${x.method} ${x.path.replace('/repos/WasteOfADrumBum/one-small-ui', '')}`), [
    'GET /git/ref/heads/verify/remediation/docs-links', `GET /git/commits/${SHA}`, 'POST /git/blobs', 'POST /git/trees', 'POST /git/commits', 'POST /git/refs', 'POST /pulls'
  ])
  const pr = c.calls.at(-1).body
  assert.equal(pr.draft, true)
  assert.equal(pr.base, 'main')
  assert.equal(c.calls.find(x => x.path.endsWith('/git/refs')).body.ref, 'refs/heads/verify/remediation/docs-links')
  assert.deepEqual(c.calls.find(x => x.path.endsWith('/git/commits')).body.parents, [SHA])
})

test('idempotent: an existing branch is never rewritten', async () => {
  const c = fakeClient({ branchExists: true })
  const res = await openDraftPR(c, plan(), pol, AUTH)
  assert.equal(res.created, false)
  assert.match(res.refused[0], /never rewritten/)
  assert.deepEqual(c.calls.map(x => x.method), ['GET'])
})

test('issue reports carry every required field and redact secrets; findings group one PR per repository', () => {
  const token = 'ghp_' + 'Q1w2E3r4T5y6U7i8O9p0A1s2D3f4G5h6J7k8'
  const text = issueReport(finding({ rootCause: `leaked ${token}` }))
  for (const h of ['Reproduction', 'Root cause', 'Proposed fix', 'Acceptance criteria', 'Verification required', 'Severity', 'Gate(s)', 'one-small-ui']) assert.ok(text.includes(h), h)
  assert.ok(!text.includes(token))
  const g = groupByRepository([finding(), finding({ id: 'f2' }), finding({ id: 'f3', kind: 'access' }), finding({ id: 'f4', repository: 'https://github.com/WasteOfADrumBum/TaskForge' })])
  assert.equal(g.size, 2)
  assert.equal(g.get(REPO.toLowerCase()).length, 2)
})
