// Package manifests for dependency analysis (Phase 5, docs/engineering.md).
//
// Reads, never executes: the root package.json, workspace package.json files under packages/ and
// apps/, top-level versions from package-lock.json, and the workflow files. The result is small
// and deterministic, and is kept in engineering/state.json per commit so an unchanged project is
// not read again.

import { sha256 } from '../verify/evidence.mjs'

const OWNER = 'wasteofadrumbum'
const WORKSPACE_MANIFEST = /^(packages|apps)\/[^/]+\/package\.json$/
const WORKFLOW = /^\.github\/workflows\/[^/]+\.ya?ml$/
const DEP_KINDS = ['dependencies', 'devDependencies', 'peerDependencies']

const pick = (obj = {}) => Object.fromEntries(Object.entries(obj && typeof obj === 'object' ? obj : {}).filter(([k, v]) => typeof k === 'string' && typeof v === 'string').sort(([a], [b]) => a.localeCompare(b)))

function readPackage(view, path) {
  const j = view.json(path)
  if (!j || j.__malformed) return j && j.__malformed ? { path, malformed: true } : null
  const out = { path, name: typeof j.name === 'string' ? j.name : null, version: typeof j.version === 'string' ? j.version : null, private: j.private === true, engines: pick(j.engines) }
  for (const k of DEP_KINDS) out[k] = pick(j[k])
  return out
}

// Repositories on the owner's account named in a text (workflow `uses:`, git dependency specs).
export function ownerRepoRefs(text) {
  const out = new Set()
  for (const m of String(text || '').matchAll(/(?:github\.com[/:]|github:|uses:\s*)([\w.-]+)\/([\w.-]+?)(?:\.git)?(?=[@/#\s"']|$)/gim)) if (m[1].toLowerCase() === OWNER) out.add(`${m[1]}/${m[2]}`.toLowerCase())
  return [...out].sort()
}

export function readManifest(view, commitSha) {
  const files = view.files().map(f => f.path)
  const packages = []
  const root = readPackage(view, 'package.json')
  if (root) packages.push(root)
  for (const p of files.filter(f => WORKSPACE_MANIFEST.test(f)).sort()) { const x = readPackage(view, p); if (x) packages.push(x) }
  const locked = {}
  const lock = view.json('package-lock.json')
  if (lock && !lock.__malformed && lock.packages) {
    const names = new Set(packages.flatMap(p => DEP_KINDS.flatMap(k => Object.keys(p[k] || {}))))
    for (const n of [...names].sort()) { const e = lock.packages[`node_modules/${n}`]; if (e && typeof e.version === 'string') locked[n] = e.version }
  }
  const workflows = files.filter(f => WORKFLOW.test(f)).sort()
  const refs = new Set()
  for (const w of workflows) for (const r of ownerRepoRefs(view.read(w))) refs.add(r)
  for (const p of packages) for (const k of DEP_KINDS) for (const spec of Object.values(p[k] || {})) for (const r of ownerRepoRefs(spec)) refs.add(r)
  const m = { commitSha, packages, locked, workflows, repoRefs: [...refs].sort(), lockfile: Boolean(lock && !lock.__malformed) }
  m.digest = sha256(JSON.stringify(m))
  return m
}

// The names a project publishes or is known by: every non-null package name in its manifests.
export const packageNames = m => (m ? m.packages.map(p => p.name).filter(Boolean) : [])

// Every dependency of a manifest as { name, spec, kind, path }.
export function dependencyList(m) {
  if (!m) return []
  return m.packages.flatMap(p => DEP_KINDS.flatMap(k => Object.entries(p[k] || {}).map(([name, spec]) => ({ name, spec, kind: k, path: p.path }))))
}

export const majorOf = v => { const m = /(\d+)(?:\.\d+){0,2}/.exec(String(v || '')); return m ? Number(m[1]) : null }
