// Hub aggregation of per-project development state. Read-only. A project without a
// .engineering/state.json (observe mode) is reported as such, never as an error.

import { OWNER, repoFromUrl, cleanText } from '../sync/lib.mjs'
import { GitHubError, describeAccess } from '../sync/github.mjs'
import { validateState, UnsupportedVersion, assess, StateError, STATE_PATHS, renderStatus, renderHandoff, viewDigest } from './lib.mjs'
import { readState } from './push.mjs'

async function viewsInSync(client, owner, repo, ref, state) {
  const get = async path => {
    const f = await client.get(`/repos/${owner}/${repo}/contents/${path}?ref=${ref}`, { allow404: true })
    return f && f.content ? Buffer.from(f.content, 'base64').toString('utf8') : null
  }
  const [status, handoff] = [await get(STATE_PATHS.status), await get(STATE_PATHS.handoff)]
  if (status === null || handoff === null) return false
  return viewDigest(status) === viewDigest(renderStatus(state)) && viewDigest(handoff) === viewDigest(renderHandoff(state))
}

export async function collectProject({ project, client, now = new Date() }) {
  const { owner, name } = repoFromUrl(project.repository)
  const out = { projectId: project.id, repository: project.repository, status: 'no-checkpoint', problems: [], flags: [], state: null, github: null }
  try {
    const repoInfo = await client.get(`/repos/${owner}/${name}`)
    const branch = repoInfo.default_branch
    const head = (await client.get(`/repos/${owner}/${name}/git/ref/heads/${encodeURIComponent(branch)}`)).object.sha
    let state
    try {
      state = await readState({ client, owner, repo: name, ref: head })
    } catch (e) {
      if (e instanceof StateError) { out.status = 'invalid'; out.problems = [e.message]; return out }
      throw e
    }
    if (!state) return out
    let problems
    try {
      problems = validateState(state, { projectId: project.id })
    } catch (e) {
      if (e instanceof UnsupportedVersion) { out.status = 'unsupported-version'; out.problems = [e.message]; return out }
      throw e
    }
    if (problems.length) { out.status = 'invalid'; out.problems = problems.slice(0, 5).map(p => cleanText(p, 200)); return out }
    const working = state.development.workingBranch
    const branchExists = working ? Boolean(await client.get(`/repos/${owner}/${name}/git/ref/heads/${encodeURIComponent(working)}`, { allow404: true })) : null
    const prs = await client.paginate(`/repos/${owner}/${name}/pulls?state=open`, { max: 100 })
    out.github = { defaultBranch: branch, head, branchExists, openPrs: prs.map(p => p.number) }
    out.state = state
    out.status = 'ok'
    const a = assess(state, out.github, now)
    out.flags = a.flags
    out.ageDays = a.ageDays
    if (!(await viewsInSync(client, owner, name, head, state))) out.flags.push('views-out-of-sync')
  } catch (e) {
    const d = e instanceof GitHubError ? describeAccess(e, `${project.id} state`) : null
    out.status = 'unavailable'
    out.problems = [d ? d.message : cleanText(e.message, 200)]
  }
  return out
}

export async function aggregate({ registry, client, now = new Date() }) {
  const projects = []
  for (const p of registry.projects) projects.push(await collectProject({ project: p, client, now }))
  return { generatedAt: now.toISOString(), projects }
}

export function renderAggregate({ generatedAt, projects }) {
  const rows = projects.map(p => {
    const s = p.state
    const cell = x => (x ? cleanText(x, 80).replace(/\|/g, '\\|') : '—')
    return `| ${p.projectId} | ${p.status} | ${cell(s && s.development.milestone)} | ${cell(s && s.development.activeTask && s.development.activeTask.title)} | ${cell(s && s.handoff.lastAgent && s.handoff.lastAgent.tool)} | ${s ? s.handoff.checkpointedAt || '—' : '—'} | ${s && s.handoff.blockers.length ? s.handoff.blockers.length : 0} | ${cell(s && s.development.nextAction)} | ${[...p.flags, ...p.problems.map(x => cleanText(x, 60))].join(', ') || '—'} |`
  })
  return `# Development state across projects

Generated ${generatedAt}. Agent-reported state read from each repository's \`.engineering/state.json\`, compared with live GitHub. Not independent verification.

| Project | State | Milestone | Active task | Last agent | Last checkpoint | Blockers | Next action | Flags |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
${rows.join('\n')}

${projects.filter(p => p.status === 'no-checkpoint').length} of ${projects.length} projects have no checkpoint file yet (still observe-only).
`
}
