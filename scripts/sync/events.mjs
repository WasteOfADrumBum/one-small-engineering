#!/usr/bin/env node
// Event-driven sync, trusted half (Phase 6 stage 4).
//
// A project repository tells the hub "something changed" with a repository_dispatch event.
// The payload is a hint, never data: this script only decides whether the hint is
// acceptable (right sender, a repository the registry syncs, a known event kind, sane
// shape). It then asks the existing Registry sync workflow to run a full sync, which
// rereads actual GitHub state through the existing collector, planner, writer and
// validator, and Stage 1 auto-merge lands the result. Nothing in the payload reaches the
// registry. Duplicates, bursts and out-of-order delivery are harmless because each sync
// reads current state and a pending sync already covers every project.
//
// CLI (workflow): EVENT_ACTOR, EVENT_PAYLOAD (JSON) -> prints "accepted <project-id>" or
// "rejected <reason>" and exits 0/1. It makes no network calls.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT, OWNER, REGISTRY_PATH, SLUG, safeOutput, repoFromUrl } from './lib.mjs'

export const EVENT_TYPE = 'onesmall-project-event'
export const KINDS = Object.freeze(['pull_request', 'push', 'check_suite', 'workflow_run', 'release', 'create'])
const MAX_PAYLOAD_BYTES = 4096
const DELIVERY = /^[A-Za-z0-9._-]{1,64}$/
const FULL_NAME = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/

// Returns { ok: true, projectId, kind, delivery } or { ok: false, reason }.
export function checkEvent({ actor, payload, registry, owner = OWNER }) {
  const no = reason => ({ ok: false, reason })
  if (actor !== owner) return no(`sender ${String(actor).slice(0, 40)} is not the repository owner; only the owner's token may dispatch events`)
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return no('payload is not an object')
  // Measured in UTF-8 bytes, not characters (GitHub Copilot review of PR #30, 2026-11-02).
  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > MAX_PAYLOAD_BYTES) return no('payload is too large')
  const { repository, kind, delivery } = payload
  if (typeof repository !== 'string' || !FULL_NAME.test(repository)) return no('repository is missing or malformed')
  if (!KINDS.includes(kind)) return no(`event kind ${JSON.stringify(String(kind).slice(0, 30))} is not one of ${KINDS.join(', ')}`)
  if (typeof delivery !== 'string' || !DELIVERY.test(delivery)) return no('delivery id is missing or malformed')
  const match = registry.projects.find(p => {
    try {
      const { owner: o, name } = repoFromUrl(p.repository)
      return p.sync && p.sync.enabled && `${o}/${name}`.toLowerCase() === repository.toLowerCase()
    } catch {
      return false
    }
  })
  if (!match) return no(`${repository} is not a sync-enabled project in the registry`)
  if (!SLUG.test(match.id)) return no('registry project id is malformed')
  return { ok: true, projectId: match.id, kind, delivery }
}

function main() {
  const registry = JSON.parse(readFileSync(resolve(ROOT, REGISTRY_PATH), 'utf8'))
  let payload
  try {
    payload = JSON.parse(process.env.EVENT_PAYLOAD || 'null')
  } catch {
    console.log('rejected payload is not JSON')
    return 1
  }
  const r = checkEvent({ actor: process.env.EVENT_ACTOR, payload, registry })
  console.log(safeOutput(r.ok ? `accepted ${r.projectId} (${r.kind}, delivery ${r.delivery})` : `rejected ${r.reason}`))
  return r.ok ? 0 : 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = main()
