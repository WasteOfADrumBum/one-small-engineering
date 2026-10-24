// Deterministic collection: read-only GitHub API calls for one registry project,
// normalized into an observation (schemas/observation.schema.json). No AI, no
// project code: the hub only reads API JSON. Validation fails closed.

import { validateAgainstSchema } from '../validate-registry.mjs'
import { expectArray, expectObject } from './github.mjs'
import {
  CONFIG_PATH, TEMPLATE_WORKFLOW_PATH, MAX_CONFIG_BYTES, SHA, OWNER,
  readJson, repoFromUrl, isoSeconds, cleanText, effectiveConfig, workflowFile, slugify, withholdValues
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
const MAX_OPEN = 100

const MAX_CLOSED = 50
const MAX_FILES = 300

const enc = encodeURIComponent

// GitHub's own URL shapes for the records the registry cites. A URL that is not exactly
// one of these (another repository, or extra text after the id) makes the record malformed.
const URL_SHAPES = {
  pull: '/pull/\\d+',
  actions: '/actions/runs/\\d+(?:/attempts/\\d+)?',
  releases: '/releases/tag/[A-Za-z0-9._/-]{1,100}'
}
export function isEvidenceUrl(project, kind, url) {
  const base = project.repository.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return typeof url === 'string' && new RegExp(`^${base}${URL_SHAPES[kind]}$`, 'i').test(url)
}
// Fail closed on a record that is not GitHub's documented shape; the record is not echoed.
const malformed = what => new SyncError('malformed-response', `${what}: malformed response`)
const isObject = v => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
const isId = n => Number.isInteger(n) && n > 0
const isTime = t => typeof t === 'string' && !Number.isNaN(Date.parse(t))

function decodeContent(file) {
  if (!file || file.type !== 'file' || file.encoding !== 'base64') throw new SyncError('config-invalid', `${CONFIG_PATH} is not a regular file`)
  if (file.size > MAX_CONFIG_BYTES) throw new SyncError('config-invalid', `${CONFIG_PATH} is larger than ${MAX_CONFIG_BYTES} bytes`)
  return Buffer.from(file.content, 'base64').toString('utf8')
}

export function validateConfig(value, projectId) {
  const errors = validateAgainstSchema(value, configSchema)
  // The config is external data: diagnostics name the failing path, never the value.
  if (errors.length) throw new SyncError('config-invalid', `${CONFIG_PATH}: ${errors.slice(0, 5).map(withholdValues).join('; ')}`)
  // The config's value is withheld here too: a slug-shaped secret passes the schema.
  if (value.projectId !== projectId) throw new SyncError('project-mismatch', `${CONFIG_PATH} has a different projectId (value withheld) but the registry maps this repository to "${projectId}"`)
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
  for (let i = 0; obj && obj.type === 'tag' && i < 3; i++) {
    if (!SHA.test(obj.sha || '')) throw malformed(`tag ${tag}`)
    obj = expectObject(await client.get(`${base}/git/tags/${obj.sha}`), `tag ${tag}`, ['object']).object
  }
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
  expectObject(repo, 'repository', ['id', 'owner', 'full_name', 'default_branch', 'html_url'])
  if (repo.id !== sync.repositoryId) throw new SyncError('repo-id-mismatch', `repository id ${repo.id} does not match the pinned id ${sync.repositoryId}; the repository may have been deleted and recreated or transferred`)
  if (!repo.owner || repo.owner.login !== OWNER) throw new SyncError('owner-mismatch', `repository owner is ${repo.owner && repo.owner.login}, expected ${OWNER}`)
  if (repo.full_name.toLowerCase() !== `${owner}/${name}`.toLowerCase()) throw new SyncError('repo-renamed', `repository is now ${repo.full_name}; update the registry URL by hand before syncing`)

  const defaultBranch = repo.default_branch
  const branch = expectObject(await client.get(`${base}/branches/${enc(defaultBranch)}`), 'default branch', ['commit'])
  const headSha = branch.commit && branch.commit.sha
  if (!SHA.test(headSha || '')) throw new SyncError('malformed-response', 'default branch: malformed response (no head commit SHA)')

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

  if (typeof repo.html_url !== 'string' || repo.html_url.toLowerCase() !== project.repository.toLowerCase()) throw malformed('repository (html_url)')
  const repoUrl = repo.html_url
  // Records the registry cites must be well formed. A record GitHub returns in an unexpected
  // shape fails the collection; it is never dropped, which would read as "not there".
  const checkPr = (pr, what) => {
    if (!isObject(pr) || !isId(pr.number) || !isEvidenceUrl(project, 'pull', pr.html_url)) throw malformed(what)
    return pr
  }
  // Anything not fully read is a gap, and any gap marks the collection incomplete.
  const gaps = []

  const open = await client.paginate(`${base}/pulls?state=open&sort=created&direction=asc`, { max: MAX_OPEN })
  // openPullRequests replaces the registry's list, so a partial list would silently drop PRs.
  if (open.truncated) throw new SyncError('incomplete-collection', `more than ${MAX_OPEN} open pull requests; the list would be incomplete, so nothing is proposed`)
  const openPullRequests = open
    .map(pr => checkPr(pr, 'open pull requests'))
    .map(pr => {
      if (!isObject(pr.head) || !SHA.test(pr.head.sha || '')) throw malformed('open pull requests (head)')
      return { number: pr.number, url: pr.html_url, title: cleanText(pr.title), headSha: pr.head.sha, draft: Boolean(pr.draft) }
    })
    .sort((a, b) => a.number - b.number)

  const since = now.getTime() - config.lookbackDays * 86400_000
  const closed = expectArray(await client.get(`${base}/pulls?state=closed&base=${enc(defaultBranch)}&sort=updated&direction=desc&per_page=${MAX_CLOSED}`), 'closed pull requests')
  // Newest update first: a full page whose last entry is still inside the window may hide more merges.
  if (closed.length >= MAX_CLOSED) {
    const last = closed[closed.length - 1]
    if (!isObject(last) || !isTime(last.updated_at)) throw malformed('closed pull requests (updated_at)')
    if (Date.parse(last.updated_at) >= since) gaps.push(`more than ${MAX_CLOSED} pull requests closed within the ${config.lookbackDays}-day look-back; older merges in the window were not read`)
  }
  const mergedPullRequests = []
  for (const pr of closed) {
    checkPr(pr, 'closed pull requests')
    if (!pr.merged_at) continue
    if (!isTime(pr.merged_at) || !SHA.test(pr.merge_commit_sha || '')) throw malformed(`pull request #${pr.number}`)
    if (Date.parse(pr.merged_at) < since) continue
    if (mergedPullRequests.length >= MAX_MERGED) {
      gaps.push(`more than ${MAX_MERGED} pull requests merged within the ${config.lookbackDays}-day look-back; only ${MAX_MERGED} were read`)
      break
    }
    if (pr.labels !== undefined && !Array.isArray(pr.labels)) throw malformed(`pull request #${pr.number} (labels)`)
    const labels = (pr.labels || []).map(l => {
      if (!isObject(l) || typeof l.name !== 'string') throw malformed(`pull request #${pr.number} (labels)`)
      return cleanText(l.name, 100)
    })
    // File lists are only fetched when they can change the outcome.
    let files = null
    if (config.materialPaths.length && !labels.includes(config.evidenceLabel)) {
      const list = await client.paginate(`${base}/pulls/${pr.number}/files`, { max: MAX_FILES })
      if (list.truncated) gaps.push(`pull request #${pr.number} changes more than ${MAX_FILES} files; its material-path check is incomplete`)
      files = list.map(f => {
        if (!isObject(f) || typeof f.filename !== 'string') throw malformed(`pull request #${pr.number} (files)`)
        return cleanText(f.filename, 500)
      })
    }
    mergedPullRequests.push({ number: pr.number, url: pr.html_url, title: cleanText(pr.title), mergeCommitSha: pr.merge_commit_sha, mergedAt: isoSeconds(pr.merged_at), labels, files })
  }
  mergedPullRequests.sort((a, b) => a.number - b.number)

  // All runs for the head commit, in any status: a newer attempt still running supersedes
  // the last completed one, so it must be seen, not filtered out.
  const runs = expectObject(await client.get(`${base}/actions/runs?branch=${enc(defaultBranch)}&head_sha=${headSha}&per_page=100`), 'workflow runs', ['total_count', 'workflow_runs'])
  const runList = expectArray(runs.workflow_runs, 'workflow runs')
  // The count is what proves the list is whole: without a usable one the list cannot be trusted.
  if (!Number.isInteger(runs.total_count) || runs.total_count < runList.length) throw malformed('workflow runs (total_count)')
  if (runs.total_count > runList.length) gaps.push(`GitHub reports ${runs.total_count} runs for ${headSha.slice(0, 7)} but returned ${runList.length}; later pages were not read`)
  const latest = new Map()
  for (const run of runList) {
    if (!isObject(run) || !isId(run.id) || typeof run.path !== 'string' || run.head_sha !== headSha || !isEvidenceUrl(project, 'actions', run.html_url) ||
      (run.run_attempt !== undefined && !isId(run.run_attempt))) throw malformed('workflow runs')
    const wf = workflowFile(run.path)
    // Runs without a workflow file (GitHub Pages and other dynamic runs) are not project CI.
    if (!/^[A-Za-z0-9._-]+\.ya?ml$/.test(wf)) continue
    if (config.workflows.length && !config.workflows.includes(wf)) continue
    // The newest run wins; for the same run, the newest attempt (a re-run keeps the id).
    const prev = latest.get(wf)
    const attempt = run.run_attempt || 1
    if (!prev || run.id > prev.id || (run.id === prev.id && attempt > (prev.run_attempt || 1))) latest.set(wf, run)
  }
  for (const [wf, run] of latest) {
    if (run.status !== 'completed' || !run.conclusion) {
      gaps.push(`${wf} run ${run.id} attempt ${run.run_attempt || 1} is ${run.status ? cleanText(run.status, 40) : 'in an unknown state'}`)
      latest.delete(wf)
    }
  }
  for (const wf of config.workflows) if (!latest.has(wf) && !gaps.some(g => g.startsWith(`${wf} `))) gaps.push(`${wf} is configured but has no completed run on ${headSha.slice(0, 7)}`)
  for (const run of latest.values()) {
    // GitHub event names are lower-case words; anything else is not a GitHub run record.
    if (typeof run.event !== 'string' || !/^[a-z_]{1,50}$/.test(run.event) || !isTime(run.updated_at)) throw malformed('workflow runs')
  }
  const workflowRuns = [...latest.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([wf, run]) => ({
    workflow: wf,
    name: cleanText(run.name || wf),
    runId: run.id,
    attempt: run.run_attempt || 1,
    url: run.html_url,
    headSha: run.head_sha,
    event: run.event,
    conclusion: run.conclusion,
    completedAt: isoSeconds(run.updated_at)
  }))

  const known = new Set(project.evidence.map(e => e.eventKey).filter(Boolean))
  const releaseList = expectArray(await client.get(`${base}/releases?per_page=${MAX_RELEASES}`), 'releases')
  const releases = []
  for (const rel of releaseList) {
    if (!isObject(rel)) throw malformed('releases')
    if (rel.draft || !rel.published_at) continue
    if (!isTime(rel.published_at) || typeof rel.tag_name !== 'string') throw malformed('releases')
    // A tag name outside this set cannot become an evidence id; it is not a release to record.
    if (!/^[A-Za-z0-9._/-]{1,100}$/.test(rel.tag_name)) continue
    if (!isEvidenceUrl(project, 'releases', rel.html_url)) throw malformed('releases')
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
    releases,
    collection: { complete: gaps.length === 0, gaps }
  }
  checkObservation(project, observation)
  return observation
}

// Re-checks an observation against the registry entry. The planner calls this too,
// so an observation handed over between jobs (or by a future event trigger) is never trusted blindly.
export function checkObservation(project, obs) {
  const errors = validateAgainstSchema(obs, observationSchema)
  if (errors.length) throw new SyncError('observation-invalid', errors.slice(0, 5).map(withholdValues).join('; '))
  if (obs.projectId !== project.id) throw new SyncError('project-mismatch', `observation is for ${obs.projectId}, not ${project.id}`)
  if (!project.sync || obs.repo.id !== project.sync.repositoryId) throw new SyncError('repo-id-mismatch', 'observation repository id does not match the pinned id')
  if (obs.repo.owner !== OWNER) throw new SyncError('owner-mismatch', 'observation owner is not the registry owner')
  if (obs.repo.url.toLowerCase() !== project.repository.toLowerCase()) throw new SyncError('evidence-outside-repo', `observation repository URL is outside ${project.repository}`)
  const urls = [
    ...obs.openPullRequests.map(p => ['pull', p.url]),
    ...obs.mergedPullRequests.map(p => ['pull', p.url]),
    ...obs.workflowRuns.map(r => ['actions', r.url]),
    ...obs.releases.map(r => ['releases', r.url])
  ]
  // The URL itself is not echoed: anything after the expected shape is untrusted text.
  for (const [kind, u] of urls) if (!isEvidenceUrl(project, kind, u)) throw new SyncError('evidence-outside-repo', `a ${kind} URL in the observation is outside ${project.repository} or not in GitHub's form`)
  // "complete" is a claim the gaps must back: complete with gaps, or incomplete without any, is invalid.
  if (obs.collection.complete !== (obs.collection.gaps.length === 0)) throw new SyncError('observation-invalid', 'collection.complete does not match collection.gaps')
  if (obs.config.value) validateConfig(obs.config.value, project.id)
  return obs
}
