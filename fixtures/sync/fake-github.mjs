// In-memory GitHub REST API for tests. Response shapes follow GitHub's documented
// formats for the fields the sync code reads; nothing here is live data.

import { createHash } from 'node:crypto'

export const OWNER = 'WasteOfADrumBum'
const sha = seed => createHash('sha1').update(String(seed)).digest('hex')
export { sha as fakeSha }

const json = (status, body, headers = {}) => new Response(status === 204 || body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
const b64 = text => Buffer.from(text, 'utf8').toString('base64')
const blobSha = text => {
  const buf = Buffer.from(text, 'utf8')
  return createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex')
}

export class FakeGitHub {
  constructor() {
    this.routes = []
    this.calls = []
    this.failures = []
    this.fetch = this.fetch.bind(this)
  }

  on(method, re, handler) {
    this.routes.push({ method, re, handler })
    return this
  }

  // Queue failures for the next matching calls: [{ match: RegExp, status, headers, body }].
  failNext(match, status, { headers = {}, body = { message: 'fake failure' }, times = 1 } = {}) {
    for (let i = 0; i < times; i++) this.failures.push({ match, status, headers, body })
  }

  async fetch(url, init = {}) {
    const u = new URL(url)
    const path = u.pathname + u.search
    const method = init.method || 'GET'
    const body = init.body ? JSON.parse(init.body) : undefined
    this.calls.push({ method, path, body })
    const f = this.failures.findIndex(x => x.match.test(path))
    if (f !== -1) {
      const [x] = this.failures.splice(f, 1)
      return json(x.status, x.body, x.headers)
    }
    for (const r of this.routes) {
      if (r.method !== method) continue
      const m = r.re.exec(u.pathname)
      if (m) {
        const out = r.handler({ m, q: u.searchParams, body, path })
        if (out === undefined || out === null) return json(404, { message: 'Not Found' })
        if (out instanceof Response) return out
        return json(200, out)
      }
    }
    return json(404, { message: `no fake route for ${method} ${path}` })
  }

  writes() {
    return this.calls.filter(c => c.method !== 'GET')
  }
}

// A project repository whose state tests can mutate between runs.
export function projectRepo(gh, state) {
  const base = `/repos/${OWNER}/${state.name}`
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const B = esc(base)
  const html = `https://github.com/${OWNER}/${state.name}`
  const R = re => new RegExp(`^${B}${re}$`)
  gh.on('GET', R(''), () => (state.missing ? null : {
    id: state.repoId, full_name: state.fullName || `${OWNER}/${state.name}`, owner: { login: state.owner || OWNER },
    private: Boolean(state.private), archived: Boolean(state.archived), default_branch: state.defaultBranch, html_url: html
  }))
  gh.on('GET', R('/branches/([^/]+)'), ({ m }) => (decodeURIComponent(m[1]) === state.defaultBranch ? { name: state.defaultBranch, commit: { sha: state.headSha } } : null))
  gh.on('GET', R('/contents/\\.github/one-small-engineering\\.json'), () => {
    if (state.configText === undefined && !state.config) return null
    const text = state.configText ?? JSON.stringify(state.config)
    return { type: 'file', encoding: 'base64', size: Buffer.byteLength(text), content: b64(text), sha: blobSha(text) }
  })
  gh.on('GET', R('/contents/\\.github/workflows/one-small-report\\.yml'), () => {
    if (!state.template) return null
    return { type: 'file', encoding: 'base64', size: state.template.length, content: b64(state.template), sha: blobSha(state.template) }
  })
  // Tags: a list of { name, sha } (default none); state.tagsError makes the call fail.
  gh.on('GET', R('/tags'), ({ q }) => {
    if (state.tagsError) return json(state.tagsError, { message: 'fake tags failure' })
    const all = (state.tagList || []).map(t => ({ name: t.name, commit: { sha: t.sha } }))
    const page = +(q.get('page') || 1)
    return all.slice((page - 1) * 100, page * 100)
  })
  // Root package.json: state.packageJson is an object, raw text, or absent (404).
  gh.on('GET', R('/contents/package\\.json'), () => {
    if (state.packageError) return json(state.packageError, { message: 'fake package failure' })
    if (state.packageJson === undefined || state.packageJson === null) return null
    const text = typeof state.packageJson === 'string' ? state.packageJson : JSON.stringify(state.packageJson)
    return { type: 'file', encoding: 'base64', size: Buffer.byteLength(text), content: b64(text), sha: blobSha(text) }
  })
  gh.on('GET', R('/pulls'), ({ q }) => {
    const all = state.pulls || []
    const page = +(q.get('page') || 1)
    if (q.get('state') === 'open') return page === 1 ? all.filter(p => p.state === 'open').map(p => pr(p)) : []
    return all.filter(p => p.state === 'closed').map(p => pr(p))
  })
  gh.on('GET', R('/pulls/(\\d+)/files'), ({ m, q }) => (+(q.get('page') || 1) === 1 ? ((state.prFiles || {})[m[1]] || []).map(filename => ({ filename })) : []))
  gh.on('GET', R('/actions/runs'), ({ q }) => {
    const runs = (state.runs || []).filter(r => r.head_sha === q.get('head_sha')).map(r => ({ html_url: `${html}/actions/runs/${r.id}`, head_branch: state.defaultBranch, status: 'completed', ...r }))
    return { total_count: state.runsTotal ?? runs.length, workflow_runs: runs }
  })
  gh.on('GET', R('/releases'), () => (state.releases || []).map(r => ({ html_url: `${html}/releases/tag/${r.tag_name}`, draft: false, prerelease: false, ...r })))
  gh.on('GET', R('/git/ref/tags/(.+)'), ({ m }) => {
    const t = (state.tags || {})[decodeURIComponent(m[1])]
    return t ? { ref: `refs/tags/${m[1]}`, object: t } : null
  })
  gh.on('GET', R('/git/tags/([0-9a-f]{40})'), ({ m }) => ({ object: (state.annotated || {})[m[1]] }))
  gh.on('GET', R('/compare/([0-9a-f]{40})\\.\\.\\.([0-9a-f]{40})'), ({ m }) => ({ status: ((state.ancestry || {})[m[1]] || 'diverged') }))

  function pr(p) {
    return {
      number: p.number, html_url: `${html}/pull/${p.number}`, title: p.title, draft: Boolean(p.draft), state: p.state,
      head: { sha: p.headSha, ref: `feature-${p.number}` }, base: { ref: state.defaultBranch },
      labels: (p.labels || []).map(name => ({ name })), merged_at: p.mergedAt || null, merge_commit_sha: p.mergeCommitSha || null
    }
  }
  return state
}

// The hub repository: refs, commits, blobs, PRs, issues and dispatches, in memory.
export function hubRepo(gh, { registryText, mainSha = sha('main-0') }) {
  const base = `/repos/${OWNER}/one-small-engineering`
  const B = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const R = re => new RegExp(`^${B}${re}$`)
  const html = `https://github.com/${OWNER}/one-small-engineering`
  const hub = {
    refs: { 'heads/main': mainSha },
    commits: { [mainSha]: { tree: sha('tree-0'), parents: [], author: { name: 'Joshua Small' }, registryText } },
    trees: { [sha('tree-0')]: registryText },
    blobs: {},
    pulls: [],
    issues: [],
    comments: [],
    dispatches: [],
    validateRuns: [],
    n: 0
  }
  let counter = 0
  gh.on('GET', R('/git/ref/(heads/.+)'), ({ m }) => (hub.refs[m[1]] ? { ref: `refs/${m[1]}`, object: { type: 'commit', sha: hub.refs[m[1]] } } : null))
  gh.on('GET', R('/git/commits/([0-9a-f]{40})'), ({ m }) => {
    const c = hub.commits[m[1]]
    return c ? { sha: m[1], tree: { sha: c.tree }, parents: c.parents.map(s => ({ sha: s })), author: c.author, message: c.message || '' } : null
  })
  gh.on('GET', R('/contents/projects/registry\\.json'), ({ q }) => {
    const ref = q.get('ref')
    const c = hub.commits[hub.refs[`heads/${ref}`]]
    if (!c) return null
    return { type: 'file', encoding: 'base64', sha: blobSha(c.registryText), content: b64(c.registryText), size: c.registryText.length }
  })
  gh.on('POST', R('/git/blobs'), ({ body }) => {
    const s = blobSha(body.content)
    hub.blobs[s] = body.content
    return json(201, { sha: s })
  })
  gh.on('POST', R('/git/trees'), ({ body }) => {
    const s = sha(`tree-${++counter}`)
    hub.trees[s] = hub.blobs[body.tree[0].sha]
    return json(201, { sha: s })
  })
  gh.on('POST', R('/git/commits'), ({ body }) => {
    const s = sha(`commit-${++counter}`)
    hub.commits[s] = { tree: body.tree, parents: body.parents, author: body.author, message: body.message, registryText: hub.trees[body.tree] }
    return json(201, { sha: s })
  })
  gh.on('POST', R('/git/refs'), ({ body }) => {
    const k = body.ref.replace(/^refs\//, '')
    if (hub.refs[k]) return json(422, { message: 'Reference already exists' })
    hub.refs[k] = body.sha
    return json(201, { ref: body.ref })
  })
  gh.on('PATCH', R('/git/refs/(heads/.+)'), ({ m, body }) => {
    hub.refs[m[1]] = body.sha
    return { ref: `refs/${m[1]}` }
  })
  const pull = p => ({ number: p.number, html_url: `${html}/pull/${p.number}`, title: p.title, body: p.body, draft: p.draft, state: p.state, head: { ref: p.head, sha: p.state === 'open' ? hub.refs[`heads/${p.head}`] : p.closedHeadSha }, base: { ref: p.base }, merged_at: p.mergedAt || null, updated_at: '2026-10-23T00:00:00Z' })
  gh.on('GET', R('/pulls'), ({ q }) => {
    const head = q.get('head')
    const page = +(q.get('page') || 1)
    if (page > 1) return []
    const state = q.get('state') || 'open'
    return hub.pulls.filter(p => p.state === state && (!head || `${OWNER}:${p.head}` === head)).map(pull)
  })
  gh.on('POST', R('/pulls'), ({ body }) => {
    const p = { number: ++hub.n, ...body, state: 'open' }
    hub.pulls.push(p)
    return json(201, pull(p))
  })
  gh.on('PATCH', R('/pulls/(\\d+)'), ({ m, body }) => {
    const p = hub.pulls.find(x => x.number === +m[1])
    if (body.state === 'closed' && p.state === 'open') p.closedHeadSha = hub.refs[`heads/${p.head}`]
    Object.assign(p, body)
    return pull(p)
  })
  gh.on('GET', R('/issues'), () => hub.issues.filter(i => i.state === 'open').map(i => ({ ...i, html_url: `${html}/issues/${i.number}` })))
  gh.on('POST', R('/issues'), ({ body }) => {
    const i = { number: ++hub.n, title: body.title, body: body.body, state: 'open', user: { login: 'github-actions[bot]' } }
    hub.issues.push(i)
    return json(201, { ...i, html_url: `${html}/issues/${i.number}` })
  })
  gh.on('PATCH', R('/issues/(\\d+)'), ({ m, body }) => {
    const i = hub.issues.find(x => x.number === +m[1])
    Object.assign(i, body)
    return { ...i, html_url: `${html}/issues/${i.number}` }
  })
  gh.on('POST', R('/issues/(\\d+)/comments'), ({ m, body }) => {
    hub.comments.push({ issue: +m[1], body: body.body })
    return json(201, { id: hub.comments.length })
  })
  gh.on('POST', R('/actions/workflows/validate\\.yml/dispatches'), ({ body }) => {
    hub.dispatches.push(body.ref)
    // GitHub queues a run for the branch head; record it so later runs can see it.
    hub.validateRuns.push({ branch: body.ref, head_sha: hub.refs[`heads/${body.ref}`] })
    return json(204, undefined)
  })
  gh.on('GET', R('/actions/workflows/validate\\.yml/runs'), ({ q }) => {
    const runs = hub.validateRuns.filter(r => r.branch === q.get('branch') && r.head_sha === q.get('head_sha'))
    return { total_count: runs.length, workflow_runs: runs }
  })
  return hub
}
