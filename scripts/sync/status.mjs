// Accessible sync status report: last successful sync, detected changes, errors and
// outstanding registry PRs. Rendered as plain Markdown (job summary and the single
// "Registry sync status" issue). Status is always written in words, never color or
// symbols alone. Per-project history is carried in a hidden comment so the report
// needs no extra file or storage.

import { safeOutput, withholdValues, SLUG } from './lib.mjs'
import { renderReadiness } from '../readiness.mjs'
import { runVerdict } from './verdict.mjs'

const STATE_MARK = 'registry-sync-state:'
const OUTCOME_TEXT = {
  changed: 'Changes found',
  unchanged: 'No material change',
  paused: 'Paused by repository config',
  error: 'Error',
  skipped: 'Skipped'
}

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/
const MAX_ERROR = 500

// One project's persisted history, rebuilt from known fields only. The hidden state is read
// back from an issue anyone with write access can edit, and older runs wrote it before
// redaction existed, so nothing in it is trusted: unknown fields are dropped, bad dates and
// counts are cleared, and the stored error is withheld and redacted again before it is kept.
function cleanEntry(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null
  const date = v => (typeof v === 'string' && TIMESTAMP.test(v) ? v : null)
  const n = s.consecutiveFailures
  return {
    lastSuccessAt: date(s.lastSuccessAt),
    lastErrorAt: date(s.lastErrorAt),
    lastError: typeof s.lastError === 'string' ? withholdValues(s.lastError).slice(0, MAX_ERROR) : null,
    consecutiveFailures: Number.isInteger(n) && n >= 0 ? n : 0
  }
}

function cleanProjects(projects) {
  const out = {}
  if (!projects || typeof projects !== 'object' || Array.isArray(projects)) return out
  for (const [id, entry] of Object.entries(projects)) {
    const e = SLUG.test(id) ? cleanEntry(entry) : null
    if (e) out[id] = e
  }
  return out
}

export function parseState(body) {
  const m = new RegExp(`<!-- ${STATE_MARK}([A-Za-z0-9+/=]+) -->`).exec(body || '')
  if (!m) return { projects: {} }
  try {
    const s = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'))
    return { projects: cleanProjects(s && s.projects) }
  } catch {
    return { projects: {} }
  }
}

export function nextState(previous, results, runAt) {
  const projects = cleanProjects(previous && previous.projects)
  for (const r of results) {
    const s = projects[r.projectId] || { lastSuccessAt: null, lastErrorAt: null, lastError: null, consecutiveFailures: 0 }
    if (r.outcome === 'error') {
      s.lastErrorAt = runAt
      // The hidden state is base64, but anyone can decode it: it is redacted like visible text.
      s.lastError = withholdValues(r.errors[0] || 'unknown error').slice(0, MAX_ERROR)
      s.consecutiveFailures += 1
    } else {
      s.lastSuccessAt = runAt
      s.consecutiveFailures = 0
    }
    projects[r.projectId] = s
  }
  return { projects }
}

const cell = s => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ')
const prLink = pr => `[PR #${pr.number}](${pr.url})`

const evidenceText = r => (r.outcome === 'error' ? 'Not collected' : r.unavailable && r.unavailable.length ? `Unavailable: ${r.unavailable.join(', ')}` : r.gaps && r.gaps.length ? 'Incomplete' : 'Complete')

export function renderStatus({ runAt, trigger, mode, results, previous = { projects: {} }, openSyncPrs = [], runUrl = null, registry = null }) {
  const state = nextState(previous, results, runAt)
  const lines = []
  lines.push('# Registry sync status', '')
  lines.push(`Last run: ${runAt}. Trigger: ${trigger}. Mode: ${mode === 'write' ? 'write (draft PRs allowed)' : 'dry run (no branches or PRs)'}.${runUrl ? ` [Workflow run log](${runUrl}).` : ''}`, '')
  lines.push('Automation records facts only. It never verifies a gate, resolves a blocker, changes release status or records approval; routine sync PRs merge only through Auto-merge after every safety check passes, and any other registry change needs Joshua Small\'s review and merge.', '')

  const errors = results.filter(r => r.outcome === 'error')
  lines.push('## Summary', '')
  lines.push(`Run result: ${runVerdict(results).summary}`, '')
  lines.push(`${results.length} project(s) checked: ${results.filter(r => r.outcome === 'changed').length} with changes, ${results.filter(r => r.outcome === 'unchanged').length} unchanged, ${errors.length} with errors.`, '')
  lines.push('| Project | Result | Evidence collected | Last successful sync | Consecutive failures | Registry PR |')
  lines.push('| --- | --- | --- | --- | --- | --- |')
  for (const r of results) {
    const s = state.projects[r.projectId]
    const pr = r.pr ? `${prLink(r.pr)} (${r.prAction || 'open'})` : 'None'
    lines.push(`| ${cell(r.projectId)} | ${OUTCOME_TEXT[r.outcome] || r.outcome} | ${evidenceText(r)} | ${s.lastSuccessAt || 'Never'} | ${s.consecutiveFailures} | ${pr} |`)
  }
  lines.push('')
  const incomplete = results.filter(r => r.outcome !== 'error' && r.gaps && r.gaps.length)
  if (incomplete.length) {
    lines.push('## Incomplete evidence', '')
    lines.push('Nothing positive is concluded from an incomplete collection, and values GitHub could not return are kept as they were.', '')
    for (const r of incomplete) lines.push(`- **${r.projectId}**: ${r.gaps.join('; ')}`)
    lines.push('')
  }

  lines.push('## Detected changes', '')
  const changed = results.filter(r => r.changes && r.changes.length)
  if (!changed.length) lines.push('None.', '')
  for (const r of changed) {
    lines.push(`### ${r.projectId}`, '')
    for (const c of r.changes) lines.push(`- ${c}`)
    lines.push('')
  }

  lines.push('## Errors', '')
  if (!errors.length) lines.push('None.', '')
  for (const r of errors) {
    const s = state.projects[r.projectId]
    lines.push(`- **${r.projectId}** (${s.consecutiveFailures} consecutive): ${r.errors.join('; ')}`)
  }
  if (errors.length) lines.push('')
  const persistent = Object.entries(state.projects).filter(([, s]) => s.consecutiveFailures >= 3)
  if (persistent.length) lines.push(`Attention: ${persistent.map(([id]) => id).join(', ')} failed three or more runs in a row.`, '')

  lines.push('## Outstanding registry PRs', '')
  if (!openSyncPrs.length) lines.push('None.', '')
  else {
    lines.push('| PR | Branch | Draft | Last updated |', '| --- | --- | --- | --- |')
    for (const pr of openSyncPrs) lines.push(`| ${prLink(pr)}: ${cell(pr.title)} | ${cell(pr.branch)} | ${pr.draft ? 'Yes' : 'No'} | ${pr.updatedAt || 'Unknown'} |`)
    lines.push('')
  }
  if (openSyncPrs.truncated) lines.push(`Incomplete: more than ${openSyncPrs.length} open registry sync PRs exist; only the first ${openSyncPrs.length} are listed.`, '')

  const suggestions = results.filter(r => r.suggestions && r.suggestions.length)
  lines.push('## Suggested manual updates', '')
  lines.push('Automation will not make these changes. A builder, verifier or Joshua Small decides.', '')
  if (!suggestions.length) lines.push('None.', '')
  for (const r of suggestions) {
    lines.push(`### ${r.projectId}`, '')
    for (const s of r.suggestions) lines.push(`- ${s}`)
    lines.push('')
  }

  const notes = results.filter(r => r.notes && r.notes.length)
  if (notes.length) {
    lines.push('## Notes', '')
    for (const r of notes) for (const n of r.notes) lines.push(`- ${r.projectId}: ${n}`)
    lines.push('')
  }

  if (registry) lines.push(renderReadiness(registry, { heading: '##' }), '')

  // Redact the visible text before the state comment is appended, so the base64 is never altered.
  const visible = safeOutput(lines.join('\n'))
  return { markdown: `${visible}\n<!-- ${STATE_MARK}${Buffer.from(JSON.stringify(state)).toString('base64')} -->\n`, state }
}

// Body of a project's sync PR: the template sections, filled from the plan.
export function renderPrBody({ projectId, result, observation, registryUrl, registry = null }) {
  const o = observation
  const lines = [
    '## Summary', '',
    `Automated registry sync for \`${projectId}\` from [${o.repo.fullName}](${o.repo.url}) at \`${o.head.sha.slice(0, 7)}\` (collected ${o.collectedAt}).`, '',
    '## Reason for change', '',
    'Material GitHub changes since the registry on main was last updated.', '',
    '## Files / areas affected', '',
    '- [x] `projects/registry.json` (automation-owned fields only; see `sync/field-ownership.json`)', '',
    '## Projects affected', '', `\`${projectId}\``, '',
    '## Registry entries modified', ''
  ]
  for (const c of result.changes) lines.push(`- ${c}`)
  lines.push('', '## Verification evidence', '',
    'Every new record is `origin: sync` with result `informational` or `builder_reported`. None of them can verify a gate; no gate, blocker, ownership, approval or release status is changed.', '',
    '## Automated tests performed', '',
    '- The sync job ran the field-ownership guard and `npm run validate` on this exact registry before pushing.',
    '- `Validate registry` is dispatched on this branch and re-runs the guard.', '',
    '## Security and privacy considerations', '',
    '- Read-only API data only; no project code was checked out or run. External text is cleaned and scanned for sensitive data.', '',
    '## Builder and independent reviewer', '',
    '- Builder: One Small Engineering Sync (automation). It is never a project builder or verifier.',
    '- Reviewer: Joshua Small.', '',
    '## Human approval requirement', '',
    '- [x] Not applicable: no approval or release-status change. Merging still needs Joshua Small.', '',
    '## Suggested manual updates', '')
  if (result.suggestions.length) for (const s of result.suggestions) lines.push(`- ${s}`)
  else lines.push('None.')
  lines.push('', '## Unresolved findings', '')
  if (result.notes.length) for (const n of result.notes) lines.push(`- ${n}`)
  else lines.push('None.')
  if (registry) lines.push('', renderReadiness(registry, { only: projectId, heading: '##' }).trimEnd(), '', 'This PR changes no gate, blocker, ownership, approval or release status, so readiness is the same before and after it merges.')
  if (registryUrl) lines.push('', `Registry on main: ${registryUrl}`)
  lines.push('', '---', '_Generated by One Small Engineering Sync_')
  return safeOutput(lines.join('\n') + '\n')
}
