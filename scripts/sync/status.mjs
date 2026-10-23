// Accessible sync status report: last successful sync, detected changes, errors and
// outstanding registry PRs. Rendered as plain Markdown (job summary and the single
// "Registry sync status" issue). Status is always written in words, never color or
// symbols alone. Per-project history is carried in a hidden comment so the report
// needs no extra file or storage.

import { safeOutput } from './lib.mjs'

const STATE_MARK = 'registry-sync-state:'
const OUTCOME_TEXT = {
  changed: 'Changes found',
  unchanged: 'No material change',
  paused: 'Paused by repository config',
  error: 'Error',
  skipped: 'Skipped'
}

export function parseState(body) {
  const m = new RegExp(`<!-- ${STATE_MARK}([A-Za-z0-9+/=]+) -->`).exec(body || '')
  if (!m) return { projects: {} }
  try {
    const s = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'))
    return s && typeof s.projects === 'object' ? s : { projects: {} }
  } catch {
    return { projects: {} }
  }
}

export function nextState(previous, results, runAt) {
  const projects = structuredClone(previous.projects || {})
  for (const r of results) {
    const s = projects[r.projectId] || { lastSuccessAt: null, lastErrorAt: null, lastError: null, consecutiveFailures: 0 }
    if (r.outcome === 'error') {
      s.lastErrorAt = runAt
      // The hidden state is base64, but anyone can decode it: it is redacted like visible text.
      s.lastError = safeOutput(r.errors[0] || 'unknown error')
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

export function renderStatus({ runAt, trigger, mode, results, previous = { projects: {} }, openSyncPrs = [], runUrl = null }) {
  const state = nextState(previous, results, runAt)
  const lines = []
  lines.push('# Registry sync status', '')
  lines.push(`Last run: ${runAt}. Trigger: ${trigger}. Mode: ${mode === 'write' ? 'write (draft PRs allowed)' : 'dry run (no branches or PRs)'}.${runUrl ? ` [Workflow run log](${runUrl}).` : ''}`, '')
  lines.push('Automation records facts only. It never verifies a gate, resolves a blocker, changes release status or records approval; every registry PR needs Joshua Small\'s review and merge.', '')

  const errors = results.filter(r => r.outcome === 'error')
  lines.push('## Summary', '')
  lines.push(`${results.length} project(s) checked: ${results.filter(r => r.outcome === 'changed').length} with changes, ${results.filter(r => r.outcome === 'unchanged').length} unchanged, ${errors.length} with errors.`, '')
  lines.push('| Project | Result | Last successful sync | Consecutive failures | Registry PR |')
  lines.push('| --- | --- | --- | --- | --- |')
  for (const r of results) {
    const s = state.projects[r.projectId]
    const pr = r.pr ? `${prLink(r.pr)} (${r.prAction || 'open'})` : 'None'
    lines.push(`| ${cell(r.projectId)} | ${OUTCOME_TEXT[r.outcome] || r.outcome} | ${s.lastSuccessAt || 'Never'} | ${s.consecutiveFailures} | ${pr} |`)
  }
  lines.push('')

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

  // Redact the visible text before the state comment is appended, so the base64 is never altered.
  const visible = safeOutput(lines.join('\n'))
  return { markdown: `${visible}\n<!-- ${STATE_MARK}${Buffer.from(JSON.stringify(state)).toString('base64')} -->\n`, state }
}

// Body of a project's sync PR: the template sections, filled from the plan.
export function renderPrBody({ projectId, result, observation, registryUrl }) {
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
  if (registryUrl) lines.push('', `Registry on main: ${registryUrl}`)
  lines.push('', '---', '_Generated by One Small Engineering Sync_')
  return safeOutput(lines.join('\n') + '\n')
}
