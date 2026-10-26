// Shared test scenario: the committed registry plus a fake TaskForge repository.
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FakeGitHub, projectRepo, hubRepo, fakeSha } from './fake-github.mjs'
import { createClient } from '../../scripts/sync/github.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const NOW = new Date('2026-10-23T06:23:00Z')
export const registryText = () => readFileSync(resolve(ROOT, 'projects/registry.json'), 'utf8')
export const loadRegistry = () => JSON.parse(registryText())
export const TF_HEAD = '11975d0278c7f04db5033c0461295c734e3b4134'
export { fakeSha }

export function taskforgeState(overrides = {}) {
  return {
    name: 'TaskForge',
    repoId: 962181990,
    defaultBranch: 'main',
    headSha: TF_HEAD,
    config: null,
    template: null,
    pulls: [],
    prFiles: {},
    runs: [{ id: 101, name: 'CI', path: '.github/workflows/ci.yml', head_sha: TF_HEAD, event: 'push', conclusion: 'success', updated_at: '2026-10-09T19:10:23Z' }],
    releases: [],
    tags: {},
    // compare(<recorded head>...<new head>) is a fast-forward unless a test says otherwise.
    ancestry: { [TF_HEAD]: 'ahead' },
    ...overrides
  }
}

export function modspackState(overrides = {}) {
  return {
    name: 'one-small-mods-pack',
    repoId: 1413933787,
    defaultBranch: 'main',
    headSha: '367cede6ffba17de9bf2d3a20968a3e1cd1b3371',
    pulls: [{ number: 3, state: 'open', draft: true, title: 'One Small ModsPack 2.0 (draft): toolkit and pre-release verification', headSha: '80cc269ebb7c20aca5f6ca03214954726fb494f7' }],
    runs: [],
    releases: [],
    ancestry: { '367cede6ffba17de9bf2d3a20968a3e1cd1b3371': 'ahead' },
    ...overrides
  }
}

// The other public sync-enabled projects, as the committed registry records them: no PRs,
// runs, releases or tags. AI Workforce is private and needs the reader credential.
export function otherStates(registry = loadRegistry()) {
  return registry.projects
    .filter(p => p.sync && p.sync.enabled && p.visibility === 'public' && !['taskforge', 'one-small-mods-pack'].includes(p.id))
    .map(p => ({
      name: p.repository.split('/').pop(),
      repoId: p.sync.repositoryId,
      defaultBranch: p.repositorySnapshot.defaultBranch,
      headSha: p.repositorySnapshot.headSha,
      pulls: [],
      runs: [],
      releases: [],
      ancestry: { [p.repositorySnapshot.headSha]: 'ahead' }
    }))
}

// Every public project repository in the registry, wired into one fake GitHub.
export function allProjectRepos(gh, { tf = taskforgeState(), mp = modspackState(), others = otherStates() } = {}) {
  return { tf: projectRepo(gh, tf), mp: projectRepo(gh, mp), others: others.map(o => projectRepo(gh, o)) }
}

// A fake GitHub with TaskForge (and optionally the hub) wired to the real client.
export function world({ tf = taskforgeState(), withHub = false, mainSha } = {}) {
  const gh = new FakeGitHub()
  const state = projectRepo(gh, tf)
  const hub = withHub ? hubRepo(gh, { registryText: registryText(), mainSha }) : null
  const client = createClient({ token: 'test', fetchImpl: gh.fetch, sleep: async () => {}, random: () => 0 })
  return { gh, state, hub, client }
}
