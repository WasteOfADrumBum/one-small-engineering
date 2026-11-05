#!/usr/bin/env node
// Change-aware job selection for the merge gate, with a broad fallback (docs/ci-cd.md).
// Only a pull_request whose diff could be computed may narrow the work; every other event
// (push, merge_group, workflow_dispatch on sync branches) and any doubt run everything.
// Writes isolation=true|false and files=<count> to GITHUB_OUTPUT.

import { spawnSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const SHA = /^[0-9a-f]{40}$/

// Paths whose change can affect how project code is executed or isolated, or how CI itself runs.
export const ISOLATION_PATHS = [/^scripts\/verify\//, /^scripts\/engineering\//, /^scripts\/ci\//, /^ci\//, /^\.github\//, /^package(-lock)?\.json$/]

export function classify({ event, files }) {
  if (event !== 'pull_request') return { isolation: true, reason: `${event} always runs every job` }
  if (!Array.isArray(files)) return { isolation: true, reason: 'the diff could not be computed; running everything' }
  if (files.length === 0) return { isolation: true, reason: 'an empty diff is unexpected; running everything' }
  const hit = files.find(f => ISOLATION_PATHS.some(re => re.test(f)))
  return hit ? { isolation: true, reason: `${hit} affects execution or CI` } : { isolation: false, reason: `${files.length} changed file(s), none affecting execution or CI` }
}

export function changedFiles({ base, head, git = (args) => spawnSync('git', args, { encoding: 'utf8', shell: false }) }) {
  if (!SHA.test(base || '') || !SHA.test(head || '')) return null
  const res = git(['diff', '--name-only', '-z', `${base}...${head}`])
  if (res.status !== 0) return null
  return res.stdout.split('\0').filter(Boolean)
}

function main() {
  const event = process.env.EVENT_NAME || 'unknown'
  const files = event === 'pull_request' ? changedFiles({ base: process.env.BASE_SHA, head: process.env.HEAD_SHA }) : null
  const c = classify({ event, files })
  console.log(`changes: isolation=${c.isolation} (${c.reason})`)
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `isolation=${c.isolation}\nfiles=${files ? files.length : 'all'}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main()
