// Install plan for the continuity contract in a governed project repository.
// Pure: takes the existing file contents and returns the files to write. It never removes
// or rewrites existing instructions; it adds or refreshes one marked block, and creates
// the .engineering/ files only when they do not exist (an existing state is never reset).

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ROOT, repoFromUrl } from '../sync/lib.mjs'
import { initialState, serializeState, renderStatus, renderHandoff, validateState, STATE_PATHS } from './lib.mjs'

export const INSTRUCTION_FILES = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.github/copilot-instructions.md']
const START = '<!-- one-small-engineering:continuity v1 -->'
const END = '<!-- /one-small-engineering:continuity -->'
const BLOCK_RE = /<!-- one-small-engineering:continuity v\d+ -->[\s\S]*?<!-- \/one-small-engineering:continuity -->\n?/

export const blockText = () => readFileSync(resolve(ROOT, 'templates/project/continuity/block.md'), 'utf8')

export function withBlock(existing, block = blockText()) {
  if (existing === null || existing === undefined) return block
  const eol = existing.includes('\r\n') ? '\r\n' : '\n'
  const text = existing.replace(/\r\n/g, '\n')
  const b = block.replace(/\n$/, '') + '\n'
  let out
  if (BLOCK_RE.test(text)) out = text.replace(BLOCK_RE, b)
  else if (text.includes(START) || text.includes(END)) throw new Error('an unterminated continuity block exists; fix it by hand')
  else out = text.replace(/\n*$/, '\n\n') + b
  return eol === '\r\n' ? out.replace(/\n/g, '\r\n') : out
}

// existing: { [path]: string | null }. Returns { files: { [path]: content }, unchanged: [paths] }.
export function installPlan({ project, defaultBranch, existing }) {
  const files = {}
  const unchanged = []
  for (const path of INSTRUCTION_FILES) {
    const next = withBlock(existing[path] ?? null)
    if (next === (existing[path] ?? null)) unchanged.push(path)
    else files[path] = next
  }
  if (existing[STATE_PATHS.state] == null) {
    repoFromUrl(project.repository)
    const state = initialState({ projectId: project.id, repository: project.repository, branch: defaultBranch })
    const problems = validateState(state, { projectId: project.id })
    if (problems.length) throw new Error(`initial state invalid: ${problems.join('; ')}`)
    files[STATE_PATHS.state] = serializeState(state)
    files[STATE_PATHS.status] = renderStatus(state)
    files[STATE_PATHS.handoff] = renderHandoff(state)
  } else {
    unchanged.push(STATE_PATHS.state)
    // The views are generated from the state; refresh them if they drifted, never the state.
    // A malformed or unsupported state file is reported with its path, never rendered
    // (GitHub Copilot review of PR #31, 2026-11-02). The installer never rewrites it.
    let state
    try {
      state = JSON.parse(existing[STATE_PATHS.state])
    } catch (e) {
      throw new Error(`${STATE_PATHS.state} is not valid JSON (${e.message}); fix it with a checkpoint before installing`)
    }
    const problems = validateState(state, { projectId: project.id })
    if (problems.length) throw new Error(`${STATE_PATHS.state} is invalid: ${problems.slice(0, 5).join('; ')}`)
    for (const [path, render] of [[STATE_PATHS.status, renderStatus], [STATE_PATHS.handoff, renderHandoff]]) {
      const view = render(state)
      if (existing[path] !== view) files[path] = view
    }
  }
  return { files, unchanged }
}
