// Writing: one bot-owned branch sync/<project-id> and one draft PR per project.
//
// Branch protection is not available for this private repository on GitHub Free, so the
// write token itself could reach main. Three code-level controls stand in for it:
//   1. restrictWrites() wraps the client and refuses every non-GET call that is not on a
//      short allowlist: no ref other than refs/heads/sync/<slug>, no merges, no contents
//      API, no deletes, PRs only as drafts into main.
//   2. The commit is built through the Git Data API from a tree with exactly one changed
//      path, projects/registry.json, on top of the current main commit.
//   3. Before anything is sent, the new registry must pass the field-ownership guard and
//      the full validator. main-integrity.yml then flags any commit on main that did not
//      arrive through a merged PR.

import { createHash } from 'node:crypto'
import { OWNER, HUB_REPO, HUB_DEFAULT_BRANCH, REGISTRY_PATH, SLUG, SYNC_RECORDER, serializeRegistry } from './lib.mjs'
import { guardPaths, guardRegistryChange } from './guard.mjs'
import { materialView } from './plan.mjs'

export class WriteRefused extends Error {}

const HUB = `/repos/${OWNER}/${HUB_REPO}`
const SYNC_REF = /^refs\/heads\/sync\/[a-z0-9]+(?:-[a-z0-9]+)*$/
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const H = esc(HUB)
const SYNC_REF_PATH = new RegExp(`^${H}/git/refs/heads/sync/[a-z0-9]+(?:-[a-z0-9]+)*$`)

export const BOT_AUTHOR = { name: SYNC_RECORDER, email: '41898282+github-actions[bot]@users.noreply.github.com' }

// Every write the sync job may make, with a check on its body. Anything else throws.
const WRITE_RULES = [
  ['POST', new RegExp(`^${H}/git/blobs$`), b => b.encoding === 'utf-8'],
  ['POST', new RegExp(`^${H}/git/trees$`), b => Array.isArray(b.tree) && b.tree.length === 1 && b.tree[0].path === REGISTRY_PATH && b.tree[0].mode === '100644' && b.tree[0].type === 'blob'],
  ['POST', new RegExp(`^${H}/git/commits$`), b => Array.isArray(b.parents) && b.parents.length === 1 && b.author && b.author.name === BOT_AUTHOR.name],
  ['POST', new RegExp(`^${H}/git/refs$`), b => SYNC_REF.test(b.ref || '')],
  ['PATCH', SYNC_REF_PATH, b => typeof b.sha === 'string'],
  ['POST', new RegExp(`^${H}/pulls$`), b => b.base === HUB_DEFAULT_BRANCH && /^sync\/[a-z0-9-]+$/.test(b.head || '') && b.draft === true],
  ['PATCH', new RegExp(`^${H}/pulls/\\d+$`), b => Object.keys(b).every(k => ['title', 'body', 'state'].includes(k)) && (b.state === undefined || b.state === 'closed')],
  ['POST', new RegExp(`^${H}/issues/\\d+/comments$`), b => typeof b.body === 'string'],
  ['POST', new RegExp(`^${H}/issues$`), b => Object.keys(b).every(k => ['title', 'body'].includes(k))],
  ['PATCH', new RegExp(`^${H}/issues/\\d+$`), b => Object.keys(b).every(k => k === 'body')],
  ['POST', new RegExp(`^${H}/actions/workflows/validate\\.yml/dispatches$`), b => /^sync\/[a-z0-9-]+$/.test(b.ref || '')]
]

export function restrictWrites(client) {
  const request = (method, path, options = {}) => {
    if (method !== 'GET') {
      const bare = path.split('?')[0]
      const rule = WRITE_RULES.find(([m, re]) => m === method && re.test(bare))
      if (!rule) throw new WriteRefused(`refused ${method} ${bare}: not an allowed sync write`)
      if (!rule[2](options.body || {})) throw new WriteRefused(`refused ${method} ${bare}: request body is outside what sync may send`)
    }
    return client.request(method, path, options)
  }
  return { request, get: (p, o) => request('GET', p, o), paginate: client.paginate }
}

export function gitBlobSha(text) {
  const buf = Buffer.from(text, 'utf8')
  return createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex')
}

export function syncBranch(projectId) {
  if (!SLUG.test(projectId)) throw new WriteRefused(`invalid project id ${projectId}`)
  return `sync/${projectId}`
}

async function findSyncPr(client, branch) {
  const prs = await client.get(`${HUB}/pulls?state=open&head=${OWNER}:${encodeURIComponent(branch)}&per_page=10`)
  return prs.find(pr => pr.head && pr.head.ref === branch) || null
}

export async function listSyncPrs(client) {
  const prs = await client.paginate(`${HUB}/pulls?state=open&base=${HUB_DEFAULT_BRANCH}`, { max: 100 })
  return prs.filter(pr => pr.head && /^sync\/[a-z0-9-]+$/.test(pr.head.ref))
    .map(pr => ({ number: pr.number, url: pr.html_url, title: pr.title, branch: pr.head.ref, draft: Boolean(pr.draft), updatedAt: pr.updated_at }))
    .sort((a, b) => a.number - b.number)
}

// Pre-push checks that do not depend on GitHub: paths, field ownership, full validation.
export function checkProposal({ baseRegistry, nextRegistry, projectId, validate }) {
  const errors = [...guardPaths([REGISTRY_PATH]), ...guardRegistryChange(baseRegistry, nextRegistry, projectId)]
  if (validate) errors.push(...validate(nextRegistry))
  if (errors.length) throw new WriteRefused(`proposal for ${projectId} rejected:\n  - ${errors.join('\n  - ')}`)
}

// Reconciles three things separately, so a run that failed half-way is repaired by the next:
//   1. the branch sync/<id> holds the proposal on top of the current main;
//   2. an open draft PR exists for it (unless the owner closed one for this exact commit);
//   3. Validate registry has run, or been dispatched, for the branch head.
// Each step checks the current state before writing, so re-running is always safe.
export async function writeSync({ client: raw, projectId, baseRegistry, nextRegistry, mainSha, title, body, validate }) {
  const client = restrictWrites(raw)
  const branch = syncBranch(projectId)
  checkProposal({ baseRegistry, nextRegistry, projectId, validate })

  // The plan was made against the checked-out main; refuse if main has moved since.
  const main = await client.get(`${HUB}/git/ref/heads/${HUB_DEFAULT_BRANCH}`)
  if (main.object.sha !== mainSha) return { action: 'skipped', reason: `main moved to ${main.object.sha.slice(0, 7)} after this run started; the next run will rebuild from it`, steps: {} }

  const steps = {}
  const text = serializeRegistry(nextRegistry)
  const existing = await client.get(`${HUB}/git/ref/heads/${branch}`, { allow404: true })

  // 1. Branch.
  let headSha = null
  if (existing) {
    const head = await client.get(`${HUB}/git/commits/${existing.object.sha}`)
    // Never overwrite work someone else pushed to the bot branch.
    if (!head.author || head.author.name !== BOT_AUTHOR.name || head.parents.length !== 1) {
      const pr = await findSyncPr(client, branch)
      return { action: 'skipped', reason: `${branch} has a commit not made by sync (${existing.object.sha.slice(0, 7)}); leaving it alone`, pr: pr && { number: pr.number, url: pr.html_url }, steps }
    }
    // Same base and same material facts: the branch is already right.
    if (head.parents[0].sha === mainSha) {
      const file = await client.get(`${HUB}/contents/${REGISTRY_PATH}?ref=${encodeURIComponent(branch)}`)
      let same = file.sha === gitBlobSha(text)
      if (!same) {
        const current = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'))
        const before = current.projects.find(p => p.id === projectId)
        const after = nextRegistry.projects.find(p => p.id === projectId)
        same = Boolean(before) && JSON.stringify(materialView(before)) === JSON.stringify(materialView(after))
      }
      if (same) {
        headSha = existing.object.sha
        steps.branch = 'unchanged'
      }
    }
  }
  if (!headSha) {
    const baseCommit = await client.get(`${HUB}/git/commits/${mainSha}`)
    const blob = await client.request('POST', `${HUB}/git/blobs`, { body: { content: text, encoding: 'utf-8' } })
    const tree = await client.request('POST', `${HUB}/git/trees`, { body: { base_tree: baseCommit.tree.sha, tree: [{ path: REGISTRY_PATH, mode: '100644', type: 'blob', sha: blob.sha }] } })
    const commit = await client.request('POST', `${HUB}/git/commits`, {
      body: { message: `${title}\n\nAutomated registry sync. Changes only automation-owned fields; see sync/field-ownership.json.`, tree: tree.sha, parents: [mainSha], author: BOT_AUTHOR, committer: BOT_AUTHOR }
    })
    if (existing) await client.request('PATCH', `${HUB}/git/refs/heads/${branch}`, { body: { sha: commit.sha, force: true } })
    else await client.request('POST', `${HUB}/git/refs`, { body: { ref: `refs/heads/${branch}`, sha: commit.sha } })
    headSha = commit.sha
    steps.branch = existing ? 'updated' : 'created'
  }

  // 2. Pull request.
  let pr = await findSyncPr(client, branch)
  if (pr) {
    if (steps.branch !== 'unchanged') {
      await client.request('PATCH', `${HUB}/pulls/${pr.number}`, { body: { title, body } })
      steps.pr = 'updated'
    } else steps.pr = 'unchanged'
  } else {
    // An owner who closed the PR for this exact commit has declined it; a new commit reopens the question.
    const closed = await client.get(`${HUB}/pulls?state=closed&head=${OWNER}:${encodeURIComponent(branch)}&per_page=10`)
    const declined = closed.find(c => c.head && c.head.ref === branch && c.head.sha === headSha && !c.merged_at)
    if (declined) {
      steps.pr = 'declined'
      return { action: 'declined', reason: `PR #${declined.number} for ${headSha.slice(0, 7)} was closed without merging; waiting for new facts`, pr: { number: declined.number, url: declined.html_url }, steps }
    }
    pr = await client.request('POST', `${HUB}/pulls`, { body: { title, head: branch, base: HUB_DEFAULT_BRANCH, body, draft: true } })
    steps.pr = 'created'
  }

  // 3. Validation. PRs pushed with GITHUB_TOKEN do not trigger pull_request workflows; workflow_dispatch does.
  const runs = await client.get(`${HUB}/actions/workflows/validate.yml/runs?branch=${encodeURIComponent(branch)}&head_sha=${headSha}&per_page=1`)
  if (runs && runs.total_count > 0) steps.validation = 'already-ran'
  else {
    await client.request('POST', `${HUB}/actions/workflows/validate.yml/dispatches`, { body: { ref: branch } })
    steps.validation = 'dispatched'
  }

  const action = steps.branch !== 'unchanged' ? (steps.pr === 'created' ? 'created' : 'updated') : (steps.pr === 'created' || steps.validation === 'dispatched' ? 'repaired' : 'unchanged')
  return { action, commitSha: headSha, pr: { number: pr.number, url: pr.html_url }, steps }
}

// main already holds these facts: close the now-redundant sync PR, if any.
export async function closeStale({ client: raw, projectId }) {
  const client = restrictWrites(raw)
  const pr = await findSyncPr(client, syncBranch(projectId))
  if (!pr) return { action: 'none' }
  await client.request('POST', `${HUB}/issues/${pr.number}/comments`, { body: { body: 'Closing: main already reflects the current GitHub state for this project, so this sync PR has nothing left to propose. The next material change opens a fresh one.\n\n---\n_Generated by One Small Engineering Sync_' } })
  await client.request('PATCH', `${HUB}/pulls/${pr.number}`, { body: { state: 'closed' } })
  return { action: 'closed', pr: { number: pr.number, url: pr.html_url } }
}

const STATUS_TITLE = 'Registry sync status'

export async function upsertStatusIssue({ client: raw, body }) {
  const client = restrictWrites(raw)
  const issues = await client.get(`${HUB}/issues?state=open&creator=${encodeURIComponent('github-actions[bot]')}&per_page=100`)
  const issue = issues.find(i => i.title === STATUS_TITLE && !i.pull_request)
  if (issue) {
    await client.request('PATCH', `${HUB}/issues/${issue.number}`, { body: { body } })
    return { action: 'updated', number: issue.number, url: issue.html_url }
  }
  const created = await client.request('POST', `${HUB}/issues`, { body: { title: STATUS_TITLE, body } })
  return { action: 'created', number: created.number, url: created.html_url }
}

export async function readStatusIssueBody(client) {
  const issues = await client.get(`${HUB}/issues?state=open&creator=${encodeURIComponent('github-actions[bot]')}&per_page=100`)
  const issue = issues.find(i => i.title === STATUS_TITLE && !i.pull_request)
  return issue ? issue.body || '' : ''
}
