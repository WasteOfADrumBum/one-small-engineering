// Staged activation. One repository variable, SYNC_STAGE, decides what a run may do:
//
//   A (default, unset)  read-only: collect, plan and validate; the report goes to the job
//                       summary only. No write permission is granted (the workflow runs the
//                       read-only report job), and scheduled runs do not start.
//   B                   controlled writes: a manual run with "Dry run" unticked may open or
//                       refresh draft sync PRs in this repository and updates the status
//                       issue. Scheduled runs still do not start.
//   C                   scheduled operation: the six-hour schedule runs and writes too.
//
// The legacy variable SYNC_WRITE_ENABLED=true (Phase 1) means stage C. Any other value of
// SYNC_STAGE is refused, so a typo can never widen what a run does. Writes only ever come
// from main. Pure: the workflow passes everything in as environment variables.

export const STAGES = ['A', 'B', 'C']

export class StageError extends Error {}

export function effectiveStage({ stage = '', legacyWriteEnabled = '' } = {}) {
  const s = String(stage).trim().toUpperCase()
  if (!s) return legacyWriteEnabled === 'true' ? 'C' : 'A'
  if (!STAGES.includes(s)) throw new StageError(`SYNC_STAGE must be A, B or C (or unset for A); refusing to run with an unknown stage`)
  return s
}

// What this run may do. dryRunInput is the workflow_dispatch "dry_run" input as text
// ('true', 'false', or '' when the run was not started by hand).
export function resolveRun({ stage, legacyWriteEnabled, event, dryRunInput = '', ref }) {
  const s = effectiveStage({ stage, legacyWriteEnabled })
  const onMain = ref === 'refs/heads/main'
  const scheduled = event === 'schedule'
  const manual = event === 'workflow_dispatch'
  if (!scheduled && !manual) throw new StageError(`registry sync runs only on schedule or workflow_dispatch, not ${event || 'an unknown event'}`)
  const run = (mode, statusIssue, reason) => ({ stage: s, mode, statusIssue, reason, skip: false })
  if (scheduled && s !== 'C') return { stage: s, mode: 'dry-run', statusIssue: false, reason: `stage ${s}: scheduled runs start at stage C`, skip: true }
  if (s === 'A') return run('dry-run', false, 'stage A: read-only, report in the job summary only')
  if (!onMain) return run('dry-run', false, 'writes only run from main')
  if (manual && dryRunInput !== 'false') return run('dry-run', true, `stage ${s}: manual dry run`)
  if (manual) return run('write', true, `stage ${s}: manual run with writes`)
  return run('write', true, 'stage C: scheduled run with writes')
}
