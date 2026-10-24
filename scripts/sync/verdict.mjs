// The run-level result shared by the job exit code and the status report.

// One verdict for the whole run. Complete success needs every project collected with no
// gap. Evidence still pending (a run in progress, a list cut off at its cap) is incomplete:
// reported, never called complete. An error, or a section that could not be read at all,
// fails the run, so missing data never passes as an empty result.
export function runVerdict(results) {
  const failed = results.filter(r => r.outcome === 'error' || (r.unavailable || []).length)
  const incomplete = results.filter(r => !failed.includes(r) && (r.gaps || []).length)
  const ok = results.length - failed.length - incomplete.length
  const list = rs => rs.map(r => r.projectId).join(', ')
  if (failed.length) return { result: 'failed', exitCode: 1, summary: `FAILED: ${failed.length} of ${results.length} project(s) not fully observed (${list(failed)}); ${ok} complete${incomplete.length ? `, ${incomplete.length} incomplete (${list(incomplete)})` : ''}.` }
  if (incomplete.length) return { result: 'incomplete', exitCode: 0, summary: `INCOMPLETE: ${incomplete.length} of ${results.length} project(s) have evidence still pending (${list(incomplete)}); ${ok} complete. No positive CI conclusion was drawn for them.` }
  return { result: 'complete', exitCode: 0, summary: `COMPLETE: all ${results.length} project(s) observed with no gaps.` }
}
