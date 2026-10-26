#!/usr/bin/env node
// One-command onboarding.
//
//   npm run onboard -- <project-id> [--mode observe|integrated] [--repository-id <n>]
//   npm run onboard -- <project-id> --new --name "<name>" --repository <url> --tier showcase|library|application --visibility public|private
//       [--reclassify]   (required when the repository is currently listed as legacy or unclassified)
//
// Updates projects/registry.json in this checkout (enables sync and pins the repository
// ID; for --new, scaffolds the entry with every tier gate not_verified and builder and
// verifier null) and writes the two files for the project repository to
// out/onboard/<project-id>/. It never touches the project repository itself: those
// files go in through a PR the owner approves. The registry change goes through a hub PR.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { validateRegistry, parseDefinitionOfDone } from '../validate-registry.mjs'
import { createClient } from './github.mjs'
import { ROOT, REGISTRY_PATH, CONFIG_PATH, TEMPLATE_WORKFLOW_PATH, SLUG, OWNER, readJson, serializeRegistry, repoFromUrl, isoSeconds } from './lib.mjs'

export class OnboardError extends Error {}

const TIERS = ['showcase', 'library', 'application']

export function scaffoldProject({ id, name, repository, tier, visibility, gateCatalog, now, defaultBranch = 'main', archived = null }) {
  if (!TIERS.includes(tier)) throw new OnboardError(`--tier must be one of ${TIERS.join(', ')}`)
  if (!['public', 'private'].includes(visibility)) throw new OnboardError('--visibility must be public or private')
  if (!name || !name.trim()) throw new OnboardError('--name is required for a new project')
  return {
    id, name, repository, tier, visibility,
    lifecycle: 'active',
    productionUrl: null,
    repositorySnapshot: { defaultBranch, headSha: null, archived, observedAt: now },
    openPullRequests: [],
    release: {
      currentVersion: null,
      currentVersionSource: null,
      targetVersion: null,
      releaseStatus: 'not_started',
      scopeDocument: null,
      blockers: [{ id: 'scope-document-missing', description: 'No committed release scope document yet.', status: 'open', evidenceRefs: [] }],
      nextAction: 'Write and commit a release scope document, then assign builder and verifier.',
      enhancements: []
    },
    ownership: { builder: null, verifier: null, approvalOwner: 'Joshua Small' },
    approval: { status: 'pending', approvedBy: null, approvedAt: null, evidenceRefs: [] },
    lastVerifiedAt: null,
    evidence: [],
    releaseGates: gateCatalog[tier].map(g => ({ id: g, status: 'not_verified', evidenceRefs: [], verifiedAt: null, notes: null })),
    modsPack: { installedVersion: null, integrationStatus: 'not_installed', adapters: [], capabilities: [], evidenceRefs: [], limitations: [] },
    missingEvidence: ['Release scope document', 'Builder and verifier assignment']
  }
}

export function projectFiles({ projectId, defaultBranch }) {
  const config = readFileSync(resolve(ROOT, 'templates/project/one-small-engineering.json'), 'utf8').replace('__PROJECT_ID__', projectId)
  const workflow = readFileSync(resolve(ROOT, 'templates/project/one-small-report.yml'), 'utf8').replace('__DEFAULT_BRANCH__', defaultBranch)
  return { [CONFIG_PATH]: config, [TEMPLATE_WORKFLOW_PATH]: workflow }
}

// Pure registry update; repo is GitHub's repository JSON (or the subset tests supply).
export function onboard(registry, { projectId, mode = 'observe', isNew = false, name, repository, tier, visibility, reclassify = false, repo, now }) {
  if (!SLUG.test(projectId || '')) throw new OnboardError('project id must be a lowercase slug, for example my-project')
  if (!['observe', 'integrated'].includes(mode)) throw new OnboardError('--mode must be observe or integrated')
  const next = structuredClone(registry)
  let p = next.projects.find(x => x.id === projectId)

  if (isNew) {
    if (p) throw new OnboardError(`project ${projectId} already exists; omit --new`)
    if (!repository) throw new OnboardError('--repository is required for a new project')
    repoFromUrl(repository)
    const key = repository.toLowerCase()
    if (next.projects.some(x => x.repository.toLowerCase() === key)) throw new OnboardError(`${repository} already belongs to another project`)
    for (const list of ['legacyRepositories', 'otherRepositories']) {
      const i = next[list].findIndex(r => r.repository.toLowerCase() === key)
      if (i === -1) continue
      if (!reclassify) throw new OnboardError(`${repository} is listed in ${list} (${next[list][i].classification}); pass --reclassify to move it to active projects, which the owner approves in the PR`)
      next[list].splice(i, 1)
    }
    p = scaffoldProject({ id: projectId, name, repository, tier, visibility, gateCatalog: next.gateCatalog, now, defaultBranch: repo ? repo.default_branch : 'main', archived: repo ? Boolean(repo.archived) : null })
    next.projects.push(p)
  } else if (!p) {
    throw new OnboardError(`project ${projectId} is not in the registry; pass --new with --name, --repository, --tier and --visibility`)
  }

  if (!repo) throw new OnboardError('the repository ID could not be determined; pass --repository-id')
  const { owner, name: repoName } = repoFromUrl(p.repository)
  if (repo.owner && repo.owner.login !== OWNER) throw new OnboardError(`repository owner is ${repo.owner.login}, expected ${OWNER}`)
  if (repo.full_name && repo.full_name.toLowerCase() !== `${owner}/${repoName}`.toLowerCase()) throw new OnboardError(`GitHub reports ${repo.full_name}; fix the registry URL first`)
  // An unpinned (null) id is pinned here; a pinned id is never silently replaced.
  if (p.sync && p.sync.repositoryId !== null && p.sync.repositoryId !== repo.id) throw new OnboardError(`registry pins repository id ${p.sync.repositoryId} but GitHub reports ${repo.id}; investigate before re-pinning`)

  p.sync = {
    enabled: true,
    mode,
    repositoryId: repo.id,
    lastSyncedAt: p.sync ? p.sync.lastSyncedAt : null,
    lastSyncedHead: p.sync ? p.sync.lastSyncedHead : null,
    configSource: p.sync ? p.sync.configSource : null
  }
  if (now > next.lastUpdatedAt) next.lastUpdatedAt = now
  return { registry: next, project: p, files: projectFiles({ projectId, defaultBranch: (repo && repo.default_branch) || p.repositorySnapshot.defaultBranch }) }
}

function parseArgs(argv) {
  const a = { projectId: argv[0] }
  for (let i = 1; i < argv.length; i++) {
    const k = argv[i]
    if (k === '--new') a.isNew = true
    else if (k === '--reclassify') a.reclassify = true
    else if (['--mode', '--name', '--repository', '--tier', '--visibility', '--repository-id', '--out'].includes(k)) a[k.slice(2).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = argv[++i]
    else throw new OnboardError(`unknown option ${k}`)
  }
  return a
}

async function main(argv) {
  const args = parseArgs(argv)
  const registry = JSON.parse(readFileSync(resolve(ROOT, REGISTRY_PATH), 'utf8'))
  const url = args.repository || (registry.projects.find(p => p.id === args.projectId) || {}).repository
  let repo = null
  if (args.repositoryId) repo = { id: Number(args.repositoryId) }
  else if (url) {
    const { owner, name } = repoFromUrl(url)
    repo = await createClient({ token: process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '' }).get(`/repos/${owner}/${name}`)
  }
  const now = isoSeconds(new Date())
  const result = onboard(registry, { ...args, repo, now })
  const schema = readJson('projects/registry.schema.json')
  const errors = validateRegistry(result.registry, schema, { dod: parseDefinitionOfDone(readFileSync(resolve(ROOT, 'standards/definition-of-done.md'), 'utf8')) })
  if (errors.length) throw new OnboardError(`the updated registry would be invalid:\n  - ${errors.join('\n  - ')}`)
  writeFileSync(resolve(ROOT, REGISTRY_PATH), serializeRegistry(result.registry))
  const outDir = resolve(ROOT, args.out || `out/onboard/${args.projectId}`)
  for (const [path, text] of Object.entries(result.files)) {
    mkdirSync(dirname(resolve(outDir, path)), { recursive: true })
    writeFileSync(resolve(outDir, path), text)
  }
  console.log(`onboard: ${args.projectId} sync enabled (mode ${result.project.sync.mode}, repository id ${result.project.sync.repositoryId}).`)
  console.log(`onboard: project files written to ${outDir}`)
  console.log('Next steps:')
  console.log('  1. Open a hub PR with the projects/registry.json change; Joshua Small reviews and merges it.')
  if (result.project.visibility !== 'public') console.log('  2. Private repository: add it to the read-only reader credential (docs/sync-setup.md) or it will report needs-reader-token.')
  console.log(`  ${result.project.visibility !== 'public' ? 3 : 2}. Optional for observe mode, required for integrated: with the owner's go-ahead, open a PR in ${result.project.repository} adding ${CONFIG_PATH} and ${TEMPLATE_WORKFLOW_PATH} from ${outDir}.`)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code }, e => { console.error(`onboard: ${e.message}`); process.exitCode = 1 })
}
