// Cross-project dependency intelligence (Phase 5, docs/engineering.md).
//
// A relationship is CONFIRMED only when it is written down somewhere checkable:
//   declared  the registry's project.dependencies entry, with evidence (Phase 3 rules)
//   manifest  a package.json dependency on a package another registry project publishes, or a
//             git dependency on another project's repository
//   ci        a workflow file that uses another project's repository
// A registry declaration without evidence is reported as SUSPECTED. Nothing is inferred from
// names, descriptions or prose. Shared third-party packages are reported separately: they are
// not dependencies between projects, but one upgrade can touch several projects at once.
//
// Pure: inputs are the registry, manifests and what changed since the last run.

import { packageNames, dependencyList, majorOf } from './manifest.mjs'
import { dependencyFindings } from '../release/dependencies.mjs'

const repoKey = url => String(url || '').replace(/^https:\/\/github\.com\//i, '').toLowerCase()

export function relationships(registry, manifests) {
  const active = registry.projects.filter(p => p.tier !== 'legacy')
  const byPackage = new Map()
  for (const p of active) for (const n of packageNames(manifests.get(p.id))) if (!byPackage.has(n)) byPackage.set(n, p.id)
  const byRepo = new Map(active.map(p => [repoKey(p.repository), p.id]))
  const edges = []
  const add = e => { if (e.from !== e.to && !edges.some(x => x.from === e.from && x.to === e.to && x.kind === e.kind)) edges.push(e) }
  for (const p of active) {
    for (const d of p.dependencies || []) {
      const evidenced = (d.evidenceRefs || []).some(r => p.evidence.some(e => e.id === r))
      add({ from: p.id, to: d.project, kind: 'declared', confirmed: evidenced, requiredForRelease: d.requiredForRelease === true, relationship: d.relationship, basis: evidenced ? `registry declaration with evidence ${d.evidenceRefs.join(', ')}` : 'registry declaration without evidence (suspected until evidenced)' })
    }
    const m = manifests.get(p.id)
    for (const dep of dependencyList(m)) {
      const to = byPackage.get(dep.name)
      if (to && to !== p.id) add({ from: p.id, to, kind: 'manifest', confirmed: true, requiredForRelease: false, relationship: dep.kind === 'devDependencies' ? 'develops-with' : 'consumes', basis: `${dep.path} ${dep.kind} ${dep.name}@${dep.spec} at ${String(m.commitSha).slice(0, 7)}` })
    }
    for (const r of (m && m.repoRefs) || []) {
      const to = byRepo.get(r)
      if (to && to !== p.id) add({ from: p.id, to, kind: 'ci', confirmed: true, requiredForRelease: false, relationship: 'references', basis: `workflow or git dependency names ${r} at ${String(m.commitSha).slice(0, 7)}` })
    }
  }
  return edges.sort((a, b) => `${a.from}:${a.to}:${a.kind}`.localeCompare(`${b.from}:${b.to}:${b.kind}`))
}

// Third-party packages used by two or more projects, with locked versions and advisories.
export function sharedPackages(registry, manifests, advisories = new Map()) {
  const users = new Map()
  for (const p of registry.projects.filter(p => p.tier !== 'legacy')) {
    const m = manifests.get(p.id)
    const own = new Set(packageNames(m))
    for (const d of dependencyList(m)) {
      if (own.has(d.name)) continue
      if (!users.has(d.name)) users.set(d.name, new Map())
      const u = users.get(d.name)
      if (!u.has(p.id)) u.set(p.id, { spec: d.spec, locked: (m.locked || {})[d.name] || null, dev: d.kind === 'devDependencies' })
    }
  }
  const out = []
  for (const [name, u] of users) {
    if (u.size < 2) continue
    const majors = [...new Set([...u.values()].map(x => majorOf(x.locked || x.spec)).filter(x => x !== null))].sort((a, b) => a - b)
    const adv = [...u.keys()].map(id => ({ project: id, advisory: (advisories.get(id) || []).find(a => a.name === name) })).filter(x => x.advisory)
    out.push({ name, projects: Object.fromEntries([...u.entries()].sort(([a], [b]) => a.localeCompare(b))), majors, divergent: majors.length > 1, advisories: adv.map(x => ({ project: x.project, severity: x.advisory.severity, production: x.advisory.production, fix: x.advisory.fix })) })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

// Node engine floors per project, for runtime compatibility notes.
export function runtimeFloors(registry, manifests) {
  const out = {}
  for (const p of registry.projects.filter(p => p.tier !== 'legacy')) {
    const m = manifests.get(p.id)
    const root = m && m.packages.find(x => x.path === 'package.json')
    out[p.id] = root && root.engines.node ? root.engines.node : null
  }
  return out
}

// Release order from confirmed requiredForRelease edges (dependencies first). Cycles are left
// to the Phase 3 checks, which already report them.
export function releaseOrder(ids, edges) {
  const req = edges.filter(e => e.confirmed && e.requiredForRelease)
  const order = []
  const seen = new Set()
  const visit = (id, stack = new Set()) => {
    if (seen.has(id) || stack.has(id)) return
    stack.add(id)
    for (const e of req.filter(e => e.from === id)) visit(e.to, stack)
    seen.add(id)
    order.push(id)
  }
  for (const id of [...ids].sort()) visit(id)
  return order
}

// The dependency impact report.
//   changed: Map(projectId -> { from, to }) of revisions that moved since the last run.
export function dependencyImpact({ registry, manifests, changed = new Map(), advisories = new Map(), asOf, staleDays = 30 }) {
  const edges = relationships(registry, manifests)
  const shared = sharedPackages(registry, manifests, advisories)
  const floors = runtimeFloors(registry, manifests)
  const phase3 = dependencyFindings(registry, { asOf, staleDays })
  const followUps = []
  for (const [id, c] of [...changed.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const dependents = edges.filter(e => e.to === id && e.confirmed)
    for (const e of dependents) followUps.push({ project: e.from, because: id, from: c.from, to: c.to, kind: e.kind, requiredForRelease: e.requiredForRelease, action: `Re-verify ${e.from}: ${id} moved ${String(c.from).slice(0, 7)} -> ${String(c.to).slice(0, 7)} and ${e.from} ${e.relationship} it (${e.kind}).` })
  }
  const risks = []
  for (const s of shared) {
    const affected = s.advisories.filter(a => ['critical', 'high'].includes(a.severity))
    // Cross-project only when the same vulnerable package affects two or more projects.
    if (affected.length > 1) risks.push({ kind: 'shared-advisory', package: s.name, projects: affected.map(a => a.project), severity: affected.some(a => a.severity === 'critical') ? 'critical' : 'high', message: `${s.name} has ${affected.map(a => `${a.severity} (${a.project}${a.production ? ', production' : a.production === false ? ', dev only' : ''})`).join(', ')} advisories; upgrade it once across ${affected.length} project(s) and re-verify each.` })
    if (s.divergent && affected.length === 0 && !Object.values(s.projects).every(x => x.dev)) risks.push({ kind: 'version-divergence', package: s.name, projects: Object.keys(s.projects), severity: 'low', message: `${s.name} is on major versions ${s.majors.join(', ')} across ${Object.keys(s.projects).length} projects; a shared upgrade needs per-project testing.` })
  }
  const blocked = [...phase3.byProject.entries()].flatMap(([id, list]) => list.filter(f => f.blocking).map(f => ({ project: id, ...f })))
  for (const b of blocked) risks.push({ kind: 'release-dependency', package: null, projects: [b.project], severity: 'high', message: b.message })
  for (const e of edges.filter(e => !e.confirmed)) risks.push({ kind: 'suspected', package: null, projects: [e.from], severity: 'low', message: `${e.from} -> ${e.to} is declared without evidence; confirm or remove the declaration.` })
  risks.sort((a, b) => ['critical', 'high', 'medium', 'low'].indexOf(a.severity) - ['critical', 'high', 'medium', 'low'].indexOf(b.severity) || `${a.kind}:${a.package}:${a.projects}`.localeCompare(`${b.kind}:${b.package}:${b.projects}`))
  return {
    edges,
    confirmed: edges.filter(e => e.confirmed),
    suspected: edges.filter(e => !e.confirmed),
    sharedPackages: shared.filter(s => s.divergent || s.advisories.length),
    sharedPackageCount: shared.length,
    runtimeFloors: floors,
    releaseOrder: releaseOrder(registry.projects.filter(p => p.tier !== 'legacy').map(p => p.id), edges),
    followUps,
    risks,
    manifestsMissing: registry.projects.filter(p => p.tier !== 'legacy' && !manifests.get(p.id)).map(p => p.id)
  }
}
