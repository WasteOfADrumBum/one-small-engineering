// Test helpers for scripts/verify (fixture-only: nothing here touches the network or GitHub).

import { readFileSync, mkdirSync, writeFileSync, mkdtempSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { makeEvidence } from '../../scripts/verify/evidence.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const read = p => readFileSync(join(ROOT, p), 'utf8')
export const policy = () => JSON.parse(read('verification/policy.json'))
export const schema = () => JSON.parse(read('projects/registry.schema.json'))
export const dodText = () => read('standards/definition-of-done.md')
export const realRegistry = () => JSON.parse(read('projects/registry.json'))

export const SHA = 'a'.repeat(40)
export const SHA2 = 'b'.repeat(40)
export const T0 = '2026-10-27T01:00:00Z'
export const AS_OF = new Date('2026-10-27T02:00:00Z')

// Clock for tests that run against the live registry: collection, verification and assessment
// half an hour apart, starting at T0 or at the first hour after the registry's lastUpdatedAt,
// whichever is later. A registry dated after "now" is invalid, so a fixed clock would break
// every time the registry is updated.
const iso = ms => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')
const START = Math.max(Date.parse(T0), Math.ceil(Date.parse(realRegistry().lastUpdatedAt) / 3600_000) * 3600_000)
export const LIVE = { collectedAt: iso(START), verifiedAt: iso(START + 1800_000), asOf: iso(START + 3600_000) }

// The real registry with ModsPack given a builder and an independent verifier (fixture only:
// the real registry has neither), and the candidate moved to SHA so evidence can match it.
export function fixtureRegistry({ builder = 'Claude Code', verifier = 'Joshua Small', candidate = SHA } = {}) {
  const r = realRegistry()
  const p = r.projects.find(x => x.id === 'one-small-mods-pack')
  p.ownership.builder = builder
  p.ownership.verifier = verifier
  if (candidate) {
    p.release.candidate = { ...p.release.candidate, headSha: candidate }
    p.openPullRequests = p.openPullRequests.map(x => (x.number === p.release.candidate.pullRequest ? { ...x, headSha: candidate } : x))
  }
  return r
}

export function ev(collector, result = 'pass', { commitSha = SHA, at = T0, project = 'one-small-mods-pack', gates = null, pol = policy(), execute = true } = {}) {
  const c = typeof collector === 'string' ? { name: collector, version: '1.0.0', gates: gates || [] } : collector
  return makeEvidence({
    project, repository: 'https://github.com/WasteOfADrumBum/one-small-mods-pack', commitSha, ref: 'modspack-2-0', collector: c, gates: gates || c.gates,
    outcome: { result, summary: `${c.name} ${result}`, failureReason: result === 'pass' ? null : `${c.name} ${result} reason`, checks: [{ name: 'x', result: result === 'pass' ? 'pass' : 'fail' }] },
    executedAt: new Date(at), provenance: { executor: 'fixture', invokedBy: 'test' }, policy: pol, policyHash: 'f'.repeat(64), execute
  })
}

export function verification(over = {}) {
  return {
    schema: 1,
    id: 'vr-one-small-mods-pack-package-metadata-exports-aaaaaaa-00000001',
    project: 'one-small-mods-pack',
    gate: 'package-metadata-exports',
    commitSha: SHA,
    evidence: [],
    verifier: { name: 'Joshua Small', kind: 'human' },
    method: 're-executed',
    result: 'pass',
    verifiedAt: '2026-10-27T01:30:00Z',
    attestation: 'https://github.com/WasteOfADrumBum/one-small-engineering/pull/99#pullrequestreview-1',
    notes: 'Re-ran npm pack and read package.json at the candidate commit.',
    ...over
  }
}

// ev() and verification() on the live-registry clock.
export const liveEv = (collector, result = 'pass', opts = {}) => ev(collector, result, { at: LIVE.collectedAt, ...opts })
export const liveVerification = (over = {}) => verification({ verifiedAt: LIVE.verifiedAt, ...over })

// A temporary directory holding `files` ({ path: content }).
export function tempTree(files) {
  const dir = mkdtempSync(join(tmpdir(), 'ose-verify-test-'))
  for (const [p, c] of Object.entries(files)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), c) }
  return dir
}

// A fake command runner. `git` is simulated against `repos` ({ url: { sha, files, private } });
// other commands answer from `commands` ({ 'npm test': { status, stdout, stderr } }).
export function fakeRunner({ repos = {}, commands = {} } = {}) {
  const calls = []
  const run = (cmd, args, opts = {}) => {
    calls.push({ cmd, args, cwd: opts.cwd, env: opts.env })
    const line = `${cmd} ${args.join(' ')}`
    if (cmd === 'git') {
      if (args[0] === 'ls-remote') {
        const url = args[2]
        const r = repos[url]
        if (!r || r.private) return { status: 128, stdout: '', stderr: "fatal: could not read Username for 'https://github.com': terminal prompts disabled", timedOut: false }
        if (r.network) return { status: 128, stdout: '', stderr: 'fatal: unable to access: Could not resolve host: github.com', timedOut: false }
        return { status: 0, stdout: `${r.sha}\tHEAD\n`, stderr: '', timedOut: false }
      }
      if (args[0] === 'remote') { run.remote = args[3]; return { status: 0, stdout: '', stderr: '' } }
      if (args[0] === 'fetch') {
        const r = repos[run.remote]
        if (!r || r.sha !== args[args.length - 1]) return { status: 128, stdout: '', stderr: 'fatal: remote error: upload-pack: not our ref' }
        for (const [p, c] of Object.entries(r.files || {})) { mkdirSync(dirname(join(opts.cwd, p)), { recursive: true }); writeFileSync(join(opts.cwd, p), c) }
        run.head = r.sha
        return { status: 0, stdout: '', stderr: '' }
      }
      if (args[0] === 'rev-parse') return run.head ? { status: 0, stdout: `${run.head}\n`, stderr: '' } : { status: 128, stdout: '', stderr: 'not a git repository' }
      return { status: 0, stdout: '', stderr: '' }
    }
    const answer = commands[line]
    if (typeof answer === 'function') return answer(opts)
    if (answer) return { stdout: '', stderr: '', timedOut: false, ...answer }
    return { status: 0, stdout: '', stderr: '', timedOut: false }
  }
  run.calls = calls
  return run
}
