// Deterministic collection: read-only GitHub API calls for one registry project,
// normalized into an observation (schemas/observation.schema.json). No AI, no
// project code: the hub only reads API JSON. Validation fails closed.

import { validateAgainstSchema } from '../validate-registry.mjs'
import {
  CONFIG_PATH, TEMPLATE_WORKFLOW_PATH, MAX_CONFIG_BYTES, SHA, OWNER,
  readJson, repoFromUrl, isoSeconds, cleanText, effectiveConfig, workflowFile, slugify
} from './lib.mjs'

export class SyncError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

const observationSchema = readJson('schemas/observation.schema.json')
const configSchema = readJson('schemas/project-config.schema.json')
const MAX_MERGED = 30
const MAX_RELEASES = 20

const enc = encodeURIComponent

function decodeContent(file) {
  if (!file || file.type !== 'file' || file.encoding !== 'base64') throw new SyncError('config-invalid', `${CONFIG_PATH} is not a regular file`)
  if (file.size > MAX_CONFIG_BYTES) throw new SyncError('config-invalid', `${CONFIG_PATH} is larger than ${MAX_CONFIG_BYTES} bytes`)
  return Buffer.from(file.content, 'base64').toString('utf8')
}

export function validateConfig(value, projectId) {
  const errors = validateAgainstSchema(value, configSchema)
  if (errors.length) throw new SyncError('config-invalid', `${CONFIG_PATH}: ${errors.slice(0, 5).join('; ')}`)
  if (value.projectId !== projectId) throw new SyncError('project-mismatch', `${CONFIG_PATH} says projectId "${value.projectId}" but the registry maps this repository to "${projectId}"`)
  try {
    new RegExp(effectiveConfig(value).releaseTagPattern)
  } catch {
    throw new SyncError('config-invalid', `${CONFIG_PATH}: releaseTagPattern is not a valid regular expression`)
  }
  return value
}

// Resolve a tag to the commit it points at (lightweight or annotated).
async function tagCommit(client, base, tag) {
  const ref = await client.get(`${base}/git/ref/tags/${enc(tag)}`, { allow404: true })
  if (!ref || !ref.object) return null
  let obj = ref.object
  for (let i = 0; obj && obj.type === 'tag' && i < 3; i++) obj = (await client.get(`${base}/git/tags/${obj.sha}`)).object
  return obj && obj.type === 'commit' && SHA.test(obj.sha) ? obj.sha : null
}

export async function collect({ project, client, now = new Date() }) {
  const sync = project.sync
  if (!sync || !sync.enabled) throw new SyncError('not-enabled', 'sync is not enabled for this project in the registry')
  const { owner, name } = repoFromUrl(project.repository)
  const base = `/repos/${owner}/${name}`

  // Identity first: everything else is only read once the repository is proven to be the registered one.
  const repo = await client.get(base, { allow404: true })
  if (!repo) throw new SyncError('repo-unreachable', `${owner}/${name} was not found or is not readable with the current token`)
  if (repo.id !== sync.repositoryId) throw new SyncError('repo-id-mismatch', `repository id ${repo.id} does not match the pinned id ${sync.repositoryId}; the repository may have been deleted and recreated or transferred`)
  if (!repo.owner || repo.owner.login !== OWNER) throw new SyncError('owner-mismatch', `repository owner is ${repo.owner && repo.owner.login}, expected ${OWNER}`)
  if (repo.full_name.toLowerCase() !== `${owner}/${name}`.toLowerCase()) throw new SyncError('repo-renamed', `repository is now ${repo.full_name}; update the registry URL by hand before syncing`)

  const defaultBranch = repo.default_branch
  const branch = await client.get(`${base}/branches/${enc(defaultBranch)}`)
  const headSha = branch.commit.sha

  // Config at the exact head commit, so config and facts describe the same revision.
  const file = await client.get(`${base}/contents/${CONFIG_PATH}?ref=${headSha}`, { allow404: true })
  let configValue = null
  if (file) {
    let parsed
    try {
      parsed = JSON.parse(decodeContent(file))
    } catch (e) {
      if (e instanceof SyncError) throw e
      throw new SyncError('config-invalid', `${CONFIG_PATH} is not valid JSON`)
    }
    configValue = validateConfig(parsed, project.id)
  } else if (sync.mode === 'integrated') {
    throw new SyncError('config-missing', `mode is integrated but ${CONFIG_PATH} is missing on ${defaultBranch}`)
  }
  const config = effectiveConfig(configValue)

  const templateFile = await client.get(`${base}/contents/${TEMPLATE_WORKFLOW_PATH}?ref=${headSha}`, { allow404: true })
  let templateVersion = null
  if (templateFile && templateFile.type === 'file' && templateFile.size < 20000) {
    const m = /one-small-report template v(\d+)/.exec(Buffer.from(templateFile.content || '', 'base64').toString('utf8').split('\n')[0])
    templateVersion = m ? +m[1] : null
  }

  const repoUrl = repo.html_url
  const inRepo = (url, kind) => typeof url === 'string' && url.toLowerCase().startsWith(`${project.repository.toLowerCase()}/${kind}/`)

  const open = await client.paginate(`${base}/pulls?state=open&sort=created&direction=asc`, { max: 100 })
  const openPullRequests = open
    .filter(pr => inRepo(pr.html_url, 'pull') && SHA.test(pr.head.sha))
    .map(pr => ({ number: pr.number, url: pr.html_url, title: cleanText(pr.title), headSha: pr.head.sha, draft: Boolean(pr.draft) }))
    .sort((a, b) => a.number - b.number)

  const since = now.getTime() - config.lookbackDays * 86400_000
  const closed = await client.get(`${base}/pulls?state=closed&base=${enc(defaultBranch)}&sort=updated&direction=desc&per_page=50`)
  const mergedPullRequests = []
  for (const pr of closed) {
    if (mergedPullRequests.length >= MAX_MERGED) break
    if (!pr.merged_at || Date.parse(pr.merged_at) < since || !inRepo(pr.html_url, 'pull') || !SHA.test(pr.merge_commit_sha || '')) continue
    const labels = (pr.labels || []).map(l => l.name)
    // File lists are only fetched when they can change the outcome.
    let files = null
    if (config.materialPaths.length && !labels.includes(config.evidenceLabel)) {
      files = (await client.paginate(`${base}/pulls/${pr.number}/files`, { max: 300 })).map(f => f.filename)
    }
    mergedPullRequests.push({ number: pr.number, url: pr.html_url, title: cleanText(pr.title), mergeCommitSha: pr.merge_commit_sha, mergedAt: isoSeconds(pr.merged_at), labels, files })
  }
  mergedPullRequests.sort((a, b) => a.number - b.number)

  const runs = await client.get(`${base}/actions/runs?branch=${enc(defaultBranch)}&head_sha=${headSha}&status=completed&per_page=100`)
  const latest = new Map()
  for (const run of runs.workflow_runs || []) {
    const wf = workflowFile(run.path)
    if (run.head_sha !== headSha || !inRepo(run.html_url, 'actions') || !/^[A-Za-z0-9._-]+\.ya?ml$/.test(wf)) continue
    if (config.workflows.length && !config.workflows.includes(wf)) continue
    // The newest run wins; for the same run, the newest attempt (a re-run keeps the id).
    const prev = latest.get(wf)
    const attempt = run.run_attempt || 1
    if (!prev || run.id > prev.id || (run.id === prev.id && attempt > (prev.run_attempt || 1))) latest.set(wf, run)
  }
  const workflowRuns = [...latest.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([wf, run]) => ({
    workflow: wf,
    name: cleanText(run.name || wf),
    runId: run.id,
    attempt: run.run_attempt || 1,
    url: run.html_url,
    headSha: run.head_sha,
    event: String(run.event),
    conclusion: run.conclusion,
    completedAt: isoSeconds(run.updated_at)
  }))

  const known = new Set(project.evidence.map(e => e.eventKey).filter(Boolean))
  const releaseList = await client.get(`${base}/releases?per_page=${MAX_RELEASES}`)
  const releases = []
  for (const rel of releaseList) {
    if (rel.draft || !rel.published_at || !inRepo(rel.html_url, 'releases') || !/^[A-Za-z0-9._/-]{1,100}$/.test(rel.tag_name)) continue
    // Already recorded releases are not re-resolved; the planner skips them by eventKey.
    const recorded = known.has(`${project.id}:release:${slugify(rel.tag_name)}`)
    let commitSha = null
    let onDefaultBranch = null
    if (!recorded) {
      commitSha = await tagCommit(client, base, rel.tag_name)
      if (commitSha) {
        const cmp = await client.get(`${base}/compare/${commitSha}...${headSha}`, { allow404: true })
        onDefaultBranch = cmp ? ['ahead', 'identical'].includes(cmp.status) : false
      }
    }
    releases.push({ tag: rel.tag_name, url: rel.html_url, prerelease: Boolean(rel.prerelease), publishedAt: isoSeconds(rel.published_at), commitSha, onDefaultBranch })
  }
  releases.sort((a, b) => a.publishedAt.localeCompare(b.publishedAt) || a.tag.localeCompare(b.tag))

  const observation = {
    observationVersion: 1,
    projectId: project.id,
    collectedAt: isoSeconds(now),
    repo: { id: repo.id, fullName: repo.full_name, owner: repo.owner.login, private: Boolean(repo.private), archived: Boolean(repo.archived), defaultBranch, url: repoUrl },
    head: { sha: headSha },
    config: { source: configValue ? 'repository' : 'defaults', value: configValue, commitSha: headSha },
    template: { present: Boolean(templateFile), version: templateVersion },
    openPullRequests,
    mergedPullRequests,
    workflowRuns,
    releases
  }
  checkObservation(project, observation)
  return observation
}

// Re-checks an observation against the registry entry. The planner calls this too,
// so an observation handed over between jobs (or by a future event trigger) is never trusted blindly.
export function checkObservation(project, obs) {
  const errors = validateAgainstSchema(obs, observationSchema)
  if (errors.length) throw new SyncError('observation-invalid', errors.slice(0, 5).join('; '))
  if (obs.projectId !== project.id) throw new SyncError('project-mismatch', `observation is for ${obs.projectId}, not ${project.id}`)
  if (!project.sync || obs.repo.id !== project.sync.repositoryId) throw new SyncError('repo-id-mismatch', 'observation repository id does not match the pinned id')
  if (obs.repo.owner !== OWNER) throw new SyncError('owner-mismatch', `observation owner is ${obs.repo.owner}`)
  const prefix = project.repository.toLowerCase() + '/'
  const urls = [
    obs.repo.url + '/',
    ...obs.openPullRequests.map(p => p.url),
    ...obs.mergedPullRequests.map(p => p.url),
    ...obs.workflowRuns.map(r => r.url),
    ...obs.releases.map(r => r.url)
  ]
  for (const u of urls) if (!u.toLowerCase().startsWith(prefix)) throw new SyncError('evidence-outside-repo', `URL ${u} is outside ${project.repository}`)
  if (obs.config.value) validateConfig(obs.config.value, project.id)
  return obs
}
