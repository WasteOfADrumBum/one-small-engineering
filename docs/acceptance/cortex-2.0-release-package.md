# Cortex 2.0: release package

Prepared 2026-11-12 by Claude Code for Joshua Small's review. Status: **prepared, not attested**. Nothing here is verified until Joshua Small signs off on the PR that adds this page. AI assistants never record approval on their own.

Joshua Small picked "Cortex 2.0 prep" on 2026-11-12 (project chat). This follows [the Cortex 1.0 closeout](cortex-1.0-closeout.md): Joshua Small, the assigned human verifier, reviews the linked evidence, does the checks listed below, and records one attestation. Builder evidence keeps its provenance; no test is represented as newly run.

## Release identity

- **Scope:** spec phases 3 to 6, which 1.0 deferred to ROADMAP.md:
  - Ops project cards ([#39](https://github.com/WasteOfADrumBum/cortex-brain-task/pull/39));
  - Finances ([#40](https://github.com/WasteOfADrumBum/cortex-brain-task/pull/40));
  - News ([#41](https://github.com/WasteOfADrumBum/cortex-brain-task/pull/41));
  - the Assistant: briefing, Top 3 and approvals ([#42](https://github.com/WasteOfADrumBum/cortex-brain-task/pull/42)).
  - The full list is in the [2.0.0 changelog](https://github.com/WasteOfADrumBum/cortex-brain-task/blob/claude/release-2.0.0/CHANGELOG.md).
- **Version:** 2.0.0, in package.json and the page footer, on [cortex-brain-task#44](https://github.com/WasteOfADrumBum/cortex-brain-task/pull/44).
  - #44 is a draft held for approval, because merging it deploys the 2.0 labels to production.
  - No git tag or GitHub release until Joshua Small signs off.
- **Code on main:** every 2.0 feature is already on main at [87e7723](https://github.com/WasteOfADrumBum/cortex-brain-task/commit/87e77238ed18e7ca094f1aa5275bafe7cd495888) and deployed to Vercel production.
  - The features that need new settings say "not set up" until those settings exist.
  - Until then they change nothing.
- **CI on main:** [run 43140003846](https://github.com/WasteOfADrumBum/cortex-brain-task/actions/runs/43140003846):
  - a type check and 52 tests;
  - axe (WCAG 2.0 to 2.2 A and AA rules) on every `/demo` tab at desktop and phone width, failing on page script errors;
  - a Checkpoint contract job.
- **Known limits:**
  - Enterprise AI and Small Business & SaaS headlines wait for owner-chosen sources.
  - The Vault type legend waits for the owner's wording.
  - Both are roadmap items, not 2.0 scope.

## What changes about access

- **Browser:** unchanged. It asks only for `drive.readonly`.
- **New and server side,** set by the owner in Vercel. Without them, the matching features say they are not set up:
  - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GOOGLE_REFRESH_TOKEN`, with two scopes:
    - `drive.file`: Cortex sees and changes only files it creates (finance months, approval state, logs).
    - `calendar.events`: used only for an approved Calendar proposal.
  - `GITHUB_TOKEN`: read-only, for Ops.
- **What Cortex may change:** only five actions, and only on Approve:
  - add, reschedule or complete a Todoist task;
  - add or move a Calendar event.
- **Never:** Cortex never deletes anything. Recurring tasks and all-day events are refused.

## Gate evidence map (20 application gates)

### Evidence for review (builder evidence; verified only by Joshua Small's attestation)

| Gate | Evidence |
| --- | --- |
| scope-complete | Phases 3 to 6 in #39 to #42; the 2.0.0 changelog on #44; the two news categories and the Vault legend are roadmap items |
| automated-checks | CI on main (run above): type check, 52 tests, axe on every demo tab, checkpoint check |
| security-privacy-review | Builder review below |
| production-deployment | Vercel production deployment of main at 87e7723 reported success on 2026-11-12 (`cortex-vercel-prod-87e7723`) |
| documentation-accurate | README, ROADMAP and CHANGELOG for 2.0 on #44; `docs/briefing-routine.md` for the routine |
| authentication | Every new `/api` route (`ops`, `news`, `finance`, `approvals`) returns 401 without the dashboard key (constant-time compare); the ingest route needs its own bearer token |
| authorization-boundaries | Single owner. Approvals re-check every proposal against the five-action allowlist on the server, whatever the page sends; Undo reverses the server's own copy of what ran |
| sensitive-data-handling | Finance input refusing any 8-digit or longer number (account-number guard); the audit log keeping times, ids and results only (no titles, reasons or amounts); Gmail staying inside the Claude routine, never reaching Cortex |
| api-integration-security | Todoist, Google and GitHub tokens live only in Vercel; errors name the service and status, never a token or request body |
| integration-failure-handling | Each tab and Home panel fails on its own; broken feeds are skipped and named; a changed task or event is refused as "Stale, review again" instead of overwritten |
| deployment-rollback | Vercel keeps every deployment; promote the previous one to roll back. Merging #44 only changes labels and docs |
| e2e-critical-workflows | Axe and page-error checks load every `/demo` tab, `/demo/briefing` included, in CI |

### Needs Joshua Small's own check (about 15 minutes; the last two need the Vercel settings first)

| Gate | Check |
| --- | --- |
| wcag-22-aa | At 200% zoom on Home, Finances, News, Ops and Briefing, text is readable, focus is always visible and nothing is cut off. Axe passes in CI, but it can't judge everything |
| keyboard-screen-reader | Tab through Home and the Briefing page: the skip link comes first, Approve, Reject and Undo are reachable, and focus lands sensibly after each one |
| responsive-layouts | Open Home, Finances, News, Ops and Briefing on the phone: nothing overflows sideways |
| critical-workflows | Save a month in Finances; approve one sample reschedule and press Undo; open News and Ops. Blocked until the Vercel settings exist (blocker `live-config-pending`) |
| audit-logging | After the approval above, `/Cortex/logs/audit-YYYY-MM.jsonl` in Drive has one line for it and one for the Undo. Blocked until the Vercel settings exist |
| backup-recovery | Save the same month twice: `/Cortex/finance/YYYY-MM.prev.json` holds the earlier copy. Blocked until the Vercel settings exist |

### Not applicable (unchanged from 1.0)

| Gate | Reason |
| --- | --- |
| user-data-isolation | Single-user app with one owner; there are no other users' data to isolate |

`no-release-blockers` turns verified once the blocker `live-config-pending` is resolved by the checks above.

## Builder security review (Claude Code, 2026-11-12)

- No secrets in the repository. Every new token is a Vercel environment variable, documented in `.env.example` with no values.
- `drive.file` limits the server to files Cortex itself created; the briefing (written by the routine) is read in the browser with the existing read-only link.
- Approvals:
  - Proposals come from the briefing file, which a Claude routine writes; the server treats each one as untrusted input.
  - The server re-validates each proposal's fields against the allowlist, re-reads the task or event before acting, and refuses a stale one.
  - Decisions are stored so a card cannot run twice.
  - At most 60 decisions an hour per instance.
- Finance ingest: bearer token compared in constant time, 100 KB body cap, schema check that names the bad field without echoing values, and a rate limit.
- Low finding: Undo is allowed up to 60 seconds on the server (10 on the page) so a slow network can still undo. It reverses only what the server recorded as run.
- Not done: no independent (Codex) review yet; Joshua Small's rule is a Codex review at major versions, so 2.0 qualifies if he wants one.

## Proposed owner attestation

Comment on the PR that adds this page, once the checks above are done:

> I reviewed the Cortex 2.0 release package and its linked evidence, did the checks listed under "Needs Joshua Small's own check", and approve Cortex 2.0.0 for release.

If a check fails, say which; it becomes a blocker and nothing is recorded as verified.

## After sign-off (agent steps)

1. Record the approval and the verified gates in `projects/registry.json`, citing the sign-off comment.
2. Mark cortex-brain-task#44 ready and merge it (deploys the 2.0 labels).
3. Set `currentVersion` 2.0.0 and `releaseStatus` released, back to maintenance.
4. The `v2.0.0` tag stays the owner's to create, or to ask for.
