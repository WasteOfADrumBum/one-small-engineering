#!/usr/bin/env node
// The final merge gate (docs/ci-cd.md). Reads the results of every job ci-gate depends on
// (toJSON(needs)) and the gate policy, and fails unless each required job succeeded, or was
// skipped exactly where the policy allows it, and each job produced the evidence that it did its
// work. Deterministic, no network, no AI.
//
// CLI: node scripts/ci/gate.mjs [--out <dir>]
// Env: NEEDS_JSON, EVENT_NAME, EVALUATED_SHA, HEAD_SHA, BASE_SHA, RUN_ID, RUN_ATTEMPT, REF_NAME,
//      GITHUB_STEP_SUMMARY

import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const GATE_VERSION = 1

export function loadGatePolicy(path = join(ROOT, 'ci/gate-policy.json')) {
  const p = JSON.parse(readFileSync(path, 'utf8'))
  if (p.version !== 1) throw new Error(`unsupported ci/gate-policy.json version ${p.version}`)
  if (!Array.isArray(p.required) || !p.required.length) throw new Error('ci/gate-policy.json: required must list at least one job')
  return p
}

function parseNeeds(text) {
  let needs
  try { needs = JSON.parse(text || '') } catch { throw new Error('NEEDS_JSON is not JSON') }
  if (!needs || typeof needs !== 'object' || Array.isArray(needs)) throw new Error('NEEDS_JSON is not an object of job results')
  return needs
}

function checkEvidence(rule, value) {
  if ('atLeast' in rule) return /^\d+$/.test(value || '') && Number(value) >= rule.atLeast
  if ('equals' in rule) return value === rule.equals
  if ('oneOf' in rule) return rule.oneOf.includes(value)
  if ('includesAll' in rule) { const have = new Set(String(value || '').split(',').map(s => s.trim()).filter(Boolean)); return rule.includesAll.every(x => have.has(x)) }
  return false
}

// { ok, rows: [{ job, result, verdict, detail }], problems: [string] }
export function decide({ needs, policy, event }) {
  const problems = []
  const rows = []
  const required = new Set(policy.required)
  for (const job of Object.keys(needs)) if (!required.has(job)) problems.push(`job "${job}" is a dependency of ci-gate but not in ci/gate-policy.json required (add it, or remove it from needs)`)
  for (const job of policy.required) {
    const n = needs[job]
    if (!n || typeof n !== 'object') { problems.push(`required job "${job}" is not a dependency of ci-gate, so its result was never seen`); rows.push({ job, result: 'missing', verdict: 'fail', detail: 'not in needs' }); continue }
    const result = n.result
    const outputs = n.outputs && typeof n.outputs === 'object' ? n.outputs : {}
    if (result === 'success') {
      const bad = (policy.evidence[job] || []).filter(rule => !checkEvidence(rule, outputs[rule.output]))
      if (bad.length) {
        for (const rule of bad) problems.push(`job "${job}" succeeded without its evidence: output ${rule.output}=${JSON.stringify(outputs[rule.output] ?? null)} (${rule.reason})`)
        rows.push({ job, result, verdict: 'fail', detail: 'no evidence that it did its work' })
      } else rows.push({ job, result, verdict: 'pass', detail: (policy.evidence[job] || []).map(r => `${r.output}=${outputs[r.output]}`).join(', ') })
      continue
    }
    if (result === 'skipped') {
      const allow = policy.allowedSkips[job]
      const why = []
      if (!allow) why.push('the policy allows no skip for this job')
      else {
        if (!allow.events.includes(event)) why.push(`a skip is allowed only for ${allow.events.join(', ')} events, this is ${event}`)
        const src = needs[allow.when.job]
        const v = src && src.result === 'success' && src.outputs ? src.outputs[allow.when.output] : undefined
        if (v !== allow.when.equals) why.push(`${allow.when.job}.${allow.when.output} is ${JSON.stringify(v ?? null)}, not ${JSON.stringify(allow.when.equals)}`)
      }
      if (why.length) { problems.push(`required job "${job}" was skipped unexpectedly: ${why.join('; ')}`); rows.push({ job, result, verdict: 'fail', detail: 'unexpected skip' }) }
      else rows.push({ job, result, verdict: 'allowed-skip', detail: allow.reason })
      continue
    }
    // failure, cancelled, or anything GitHub adds later: never a pass.
    problems.push(`required job "${job}" ended ${JSON.stringify(result ?? null)}`)
    rows.push({ job, result: result ?? 'unknown', verdict: 'fail', detail: result === 'cancelled' ? 'cancelled or timed out' : 'did not succeed' })
  }
  return { ok: problems.length === 0, rows, problems }
}

export function render({ decision, ctx }) {
  const short = s => (s ? String(s).slice(0, 12) : 'n/a')
  const lines = [
    '## ci-gate',
    '',
    decision.ok ? '**Result: pass.** Every required job succeeded or was skipped as the gate policy allows.' : '**Result: FAIL.**',
    '',
    `| Field | Value |`,
    `| --- | --- |`,
    `| Event | ${ctx.event} |`,
    `| Ref | \`${ctx.ref}\` |`,
    `| Evaluated revision (\`github.sha\`) | \`${short(ctx.evaluatedSha)}\` |`,
    `| Head | \`${short(ctx.headSha)}\` |`,
    `| Base | \`${short(ctx.baseSha)}\` |`,
    `| Run / attempt | ${ctx.runId} / ${ctx.runAttempt} |`,
    `| Gate policy | ci/gate-policy.json v${ctx.policyVersion}, gate v${GATE_VERSION} |`,
    `| Third-party project code executed | no (the hub validates its own code; the isolation job runs only the hub's own hostile fixture) |`,
    `| Merge protection | not enforced by GitHub (private repository on GitHub Free: branch protection and rulesets return HTTP 403); main is monitored after the fact by Main integrity |`,
    '',
    '| Job | Result | Verdict | Detail |',
    '| --- | --- | --- | --- |',
    ...decision.rows.map(r => `| ${r.job} | ${r.result} | ${r.verdict} | ${String(r.detail || '').replace(/\|/g, '\\|')} |`)
  ]
  if (decision.problems.length) lines.push('', '### Why it failed', '', ...decision.problems.map(p => `- ${p}`))
  lines.push('', 'This check says the hub\'s own validation passed for this revision. It is not project verification, independent review or release approval.')
  return lines.join('\n') + '\n'
}

function main(argv) {
  const i = argv.indexOf('--out')
  const out = i === -1 ? null : argv[i + 1]
  const env = process.env
  const policy = loadGatePolicy()
  const ctx = { event: env.EVENT_NAME || 'unknown', ref: env.REF_NAME || '', evaluatedSha: env.EVALUATED_SHA, headSha: env.HEAD_SHA, baseSha: env.BASE_SHA, runId: env.RUN_ID || 'local', runAttempt: env.RUN_ATTEMPT || '1', policyVersion: policy.version }
  let decision
  try {
    decision = decide({ needs: parseNeeds(env.NEEDS_JSON), policy, event: ctx.event })
  } catch (e) {
    decision = { ok: false, rows: [], problems: [e.message] }
  }
  const md = render({ decision, ctx })
  console.log(md)
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, md)
  if (out) {
    mkdirSync(out, { recursive: true })
    writeFileSync(join(out, 'gate.json'), JSON.stringify({ gateVersion: GATE_VERSION, ...ctx, ...decision }, null, 2) + '\n')
    writeFileSync(join(out, 'gate.md'), md)
  }
  for (const p of decision.problems) console.log(`::error title=ci-gate::${p.replace(/[\r\n]+/g, ' ')}`)
  return decision.ok ? 0 : 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = main(process.argv.slice(2))
