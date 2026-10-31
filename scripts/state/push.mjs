// GitHub-native checkpoint writer. One commit on top of the branch head containing
// state.json and both generated views; the branch ref moves with force:false, so if anyone
// pushed in between GitHub refuses the update (422) and nothing is overwritten. Together
// with the revision check in applyCheckpoint this stops two agents silently overwriting
// each other.

import { GitHubError } from '../sync/github.mjs'
import { StateError, ConflictError, STATE_PATHS, applyCheckpoint, renderStatus, renderHandoff, serializeState, validateState, initialState } from './lib.mjs'

const enc = s => encodeURIComponent(s)

export async function readState({ client, owner, repo, ref }) {
  const file = await client.get(`/repos/${owner}/${repo}/contents/${STATE_PATHS.state}?ref=${enc(ref)}`, { allow404: true })
  if (!file) return null
  if (!file.content || file.size > 200_000) throw new StateError('state file is missing content or too large')
  let state
  try {
    state = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'))
  } catch {
    throw new StateError(`${STATE_PATHS.state} is not valid JSON`)
  }
  return state
}

export async function pushCheckpoint({ client, owner, repo, branch, patch, expectedRevision, agent, now, projectId, message }) {
  const refPath = `/repos/${owner}/${repo}/git/ref/heads/${enc(branch)}`
  const ref = await client.get(refPath, { allow404: true })
  if (!ref) throw new StateError(`branch ${branch} does not exist in ${owner}/${repo}`)
  const headSha = ref.object.sha
  const current = await readState({ client, owner, repo, ref: headSha })
  if (!current) throw new StateError(`${owner}/${repo}@${branch} has no ${STATE_PATHS.state}; install the status contract first`)
  const problems = validateState(current, { projectId })
  if (problems.length) throw new StateError(`existing state is invalid:\n  - ${problems.join('\n  - ')}`)
  const result = applyCheckpoint(current, patch, { expectedRevision, agent, now, persistedBy: 'github-api' })
  if (!result.changed) return { action: 'unchanged', reason: result.reason, revision: current.revision, commit: headSha }

  const base = await client.get(`/repos/${owner}/${repo}/git/commits/${headSha}`)
  const tree = await client.request('POST', `/repos/${owner}/${repo}/git/trees`, {
    body: {
      base_tree: base.tree.sha,
      tree: [
        { path: STATE_PATHS.state, mode: '100644', type: 'blob', content: serializeState(result.state) },
        { path: STATE_PATHS.status, mode: '100644', type: 'blob', content: renderStatus(result.state) },
        { path: STATE_PATHS.handoff, mode: '100644', type: 'blob', content: renderHandoff(result.state) }
      ]
    }
  })
  const commit = await client.request('POST', `/repos/${owner}/${repo}/git/commits`, {
    body: { message: `${message || `chore(engineering): checkpoint r${result.state.revision}`}\n\nCheckpoint ${result.state.checkpointId} by ${agent.tool}.`, tree: tree.sha, parents: [headSha] }
  })
  try {
    await client.request('PATCH', `/repos/${owner}/${repo}/git/refs/heads/${enc(branch)}`, { body: { sha: commit.sha, force: false } })
  } catch (e) {
    if (e instanceof GitHubError && (e.status === 422 || e.status === 409)) throw new ConflictError(`${branch} moved while this checkpoint was prepared (not a fast-forward); re-read the state and re-apply`)
    throw e
  }
  return { action: 'written', revision: result.state.revision, commit: commit.sha }
}

export { initialState }
