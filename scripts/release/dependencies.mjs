// Cross-project dependency checks over explicit registry declarations (project.dependencies).
// Pure. Nothing is inferred from repository names, package names or prose: a dependency exists
// only when the registry declares it with evidence. Only a dependency declared requiredForRelease
// can block a release; anything else is reported for information.

import { dependencyCycles } from '../validate-registry.mjs'

const DAY = 24 * 3600 * 1000

function compareVersions(a, b) {
  const pa = String(a).split(/[.-]/).slice(0, 3).map(Number)
  const pb = String(b).split(/[.-]/).slice(0, 3).map(Number)
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1
  return 0
}

export function dependencyFindings(registry, ctx) {
  const projects = new Map(registry.projects.map(p => [p.id, p]))
  const byProject = new Map(registry.projects.map(p => [p.id, []]))
  const cycles = dependencyCycles(registry.projects)

  for (const p of registry.projects) {
    const out = byProject.get(p.id)
    const deps = Array.isArray(p.dependencies) ? p.dependencies : []
    const seen = new Set()
    for (const d of deps) {
      const base = { project: d.project, relationship: d.relationship, requiredForRelease: d.requiredForRelease === true, minVersion: d.minVersion || null }
      const push = (kind, blocking, message, rule) => out.push({ ...base, kind, blocking, message, rule })
      if (seen.has(d.project)) { push('duplicate', false, `Dependency on ${d.project} is declared more than once.`, 'declare each dependency once'); continue }
      seen.add(d.project)
      const target = projects.get(d.project)
      if (d.project === p.id) { push('self', base.requiredForRelease, `${p.id} declares a dependency on itself.`, 'a project cannot depend on itself'); continue }
      if (!target) { push('missing', base.requiredForRelease, `Dependency ${d.project} is not a project in the registry.`, 'dependencies must name registry projects'); continue }

      // Evidence for the declaration itself.
      const byId = new Map(p.evidence.map(e => [e.id, e]))
      const refs = (d.evidenceRefs || []).map(r => byId.get(r)).filter(Boolean)
      if (!refs.length) push('unsupported', false, `The dependency on ${d.project} has no evidence for the relationship.`, 'a declared dependency cites evidence')
      else {
        const newest = refs.reduce((m, e) => (e.verifiedAt > m ? e.verifiedAt : m), refs[0].verifiedAt)
        const age = Math.floor((ctx.asOf.getTime() - new Date(newest).getTime()) / DAY)
        if (age > ctx.staleDays) push('stale', base.requiredForRelease, `Evidence for the dependency on ${d.project} is ${age} days old (window ${ctx.staleDays} days); re-confirm the relationship.`, 'dependency evidence must be inside the staleness window')
      }

      if (!base.requiredForRelease) {
        push('informational', false, `${d.relationship} ${d.project}; not required for this release.`, 'only requiredForRelease dependencies block')
        continue
      }
      // Required: the dependency must already have released minVersion (or any version).
      const current = target.release.currentVersion
      const satisfied = current && (!d.minVersion || compareVersions(current, d.minVersion) >= 0)
      if (satisfied) push('satisfied', false, `${d.project} has released ${current}${d.minVersion ? ` (needs ${d.minVersion} or later)` : ''}.`, 'required dependency released')
      else push('blocked', true, `Requires ${d.project} ${d.minVersion ? `${d.minVersion} or later` : 'to be released'}; its current version is ${current || 'none'} (release status ${target.release.releaseStatus}).`, 'a requiredForRelease dependency must be released at minVersion or later first')
    }
  }
  for (const cycle of cycles) {
    for (const id of new Set(cycle)) {
      const p = projects.get(id)
      const next = cycle[cycle.indexOf(id) + 1]
      const d = (p.dependencies || []).find(x => x.project === next)
      byProject.get(id).push({ project: next, relationship: d ? d.relationship : null, requiredForRelease: Boolean(d && d.requiredForRelease), minVersion: d ? d.minVersion || null : null, kind: 'cycle', blocking: Boolean(d && d.requiredForRelease), message: `Circular dependency: ${cycle.join(' -> ')}.`, rule: 'dependencies must not form a cycle' })
    }
  }
  for (const list of byProject.values()) list.sort((a, b) => `${a.project}:${a.kind}`.localeCompare(`${b.project}:${b.kind}`))
  return { byProject, cycles }
}
