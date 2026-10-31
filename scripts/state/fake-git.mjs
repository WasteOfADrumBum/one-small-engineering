// In-memory GitHub git-hosting fake for state tests (refs, commits, trees, contents). No network.
import { createHash } from 'node:crypto'
import { GitHubError } from '../sync/github.mjs'

const sha = s => createHash('sha1').update(s).digest('hex')

// Minimal git hosting fake: branches -> commit; commits -> {tree files, parent}.
export function fakeGit({ files = null, branches = ['main'], extra = {} } = {}) {
  const commits = {}; const trees = {}; const refs = {}; let n = 0
  const mk = (fs, parent) => { const id = sha(`c${n++}`); commits[id] = { files: fs, parent }; return id }
  const start = mk(files || {}, null)
  for (const b of branches) refs[b] = start
  const st = { commits, refs, failRefUpdate: 0, openPrs: [], defaultBranch: 'main', ...extra }
  const request = async (method, path, { body } = {}) => {
    const p = path.split('?')[0]
    let m
    if ((m = p.match(/\/git\/ref\/heads\/(.+)$/))) { const b = decodeURIComponent(m[1]); return refs[b] ? { object: { sha: refs[b] } } : null }
    if ((m = p.match(/\/contents\/(.+)$/))) {
      const ref = decodeURIComponent(path.split('ref=')[1]); const id = refs[ref] || ref
      const c = commits[id]; const f = c && c.files[decodeURIComponent(m[1])]
      return f === undefined ? null : { content: Buffer.from(f).toString('base64'), size: f.length }
    }
    if ((m = p.match(/\/git\/commits\/([0-9a-f]{40})$/)) && method === 'GET') return { tree: { sha: m[1] } }
    if (p.endsWith('/git/trees')) { const id = sha(`t${n++}`); trees[id] = { base: body.base_tree, entries: body.tree }; return { sha: id } }
    if (p.endsWith('/git/commits')) {
      const t = trees[body.tree]; const parent = body.parents[0]
      const fs = { ...commits[t.base].files }
      for (const e of t.entries) fs[e.path] = e.content
      return { sha: mk(fs, parent) }
    }
    if ((m = p.match(/\/git\/refs\/heads\/(.+)$/)) && method === 'PATCH') {
      if (st.failRefUpdate > 0) { st.failRefUpdate--; throw new GitHubError('x', 422, '') }
      const b = decodeURIComponent(m[1]); if (commits[body.sha].parent !== refs[b]) throw new GitHubError('not ff', 422, '')
      refs[b] = body.sha; return {}
    }
    if (p === '/repos/WasteOfADrumBum/cortex-brain-task') return { default_branch: st.defaultBranch }
    throw new Error(`unexpected ${method} ${path}`)
  }
  const client = { request, get: (p, o) => request('GET', p, o), paginate: async () => st.openPrs.map(number => ({ number })) }
  return { st, client }
}

