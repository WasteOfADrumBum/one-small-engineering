# Cortex 2.0: release package

Prepared 2026-11-12 by Claude Code for Joshua Small's review; refreshed 2026-11-22 to match main at 42c8c7a, after Finances moved to reading the P&L sheet. Status: **prepared, not attested**. Nothing here is verified until Joshua Small signs off on the PR that refreshes this page. AI assistants never record approval on their own.

Joshua Small picked "Cortex 2.0 prep" on 2026-11-12 (project chat). This follows [the Cortex 1.0 closeout](cortex-1.0-closeout.md): Joshua Small, the assigned human verifier, reviews the linked evidence, does the checks listed below, and records one attestation. Builder evidence keeps its provenance; no test is represented as newly run.

## Release identity

- **Scope:** spec phases 3 to 6, which 1.0 deferred to ROADMAP.md:
  - Ops project cards ([#39](https://github.com/WasteOfADrumBum/cortex-brain-task/pull/39));
  - Finances ([#40](https://github.com/WasteOfADrumBum/cortex-brain-task/pull/40));
  - News ([#41](https://github.com/WasteOfADrumBum/cortex-brain-task/pull/41));
  - the Assistant: briefing, Top 3 and approvals ([#42](https://github.com/WasteOfADrumBum/cortex-brain-task/pull/42)).
- **Also in this release (merged after the first package):**
  - the Ops Connections panel ([#45](https://github.com/WasteOfADrumBum/cortex-brain-task/pull/45));
  - the privacy page Google needs ([#47](https://github.com/WasteOfADrumBum/cortex-brain-task/pull/47));
  - same-tab Google sign-in ([#48](https://github.com/WasteOfADrumBum/cortex-brain-task/pull/48));
  - Finances rebuilt to read the J&M P&L Google Sheet in the browser, with every figure labelled Recorded plan, Estimate, Confirmed, Unknown or Conflict ([#49](https://github.com/WasteOfADrumBum/cortex-brain-task/pull/49), [#50](https://github.com/WasteOfADrumBum/cortex-brain-task/pull/50)). This replaces the paste import and the saved Drive months from #40;
  - News summaries and pictures, Ops site previews and a Trends panel (#49).
  - The full list is in the [changelog](https://github.com/WasteOfADrumBum/cortex-brain-task/blob/main/CHANGELOG.md): the 2.0.0 section plus Unreleased, which folds into 2.0.0 on release.
- **Version:** 2.0.0, in package.json and the page footer, live since [cortex-brain-task#44](https://github.com/WasteOfADrumBum/cortex-brain-task/pull/44) merged on 2026-11-14 on Joshua Small's instruction.
  - No git tag or GitHub release until Joshua Small signs off.
- **Code on main:** every 2.0 feature is on main at [42c8c7a](https://github.com/WasteOfADrumBum/cortex-brain-task/commit/42c8c7a7966509052f9ee7a27b577976775211ef), deployed to Vercel production on 2026-11-20.
  - The Vercel settings (Google client, refresh token, GitHub token) were added on 2026-11-18. Cortex created `/Cortex/finance` in Drive that day, which only the server token can do.
- **CI on main:** [run 44671742563](https://github.com/WasteOfADrumBum/cortex-brain-task/actions/runs/44671742563):
  - a type check and 95 tests;
  - axe (WCAG 2.0 to 2.2 A and AA rules) on every `/demo` tab at desktop and phone width, failing on page script errors;
  - a Checkpoint contract job.
- **Known limits:**
  - Enterprise AI and Small Business & SaaS headlines wait for owner-chosen sources.
  - The Vault type legend waits for the owner's wording.
  - Both are roadmap items, not 2.0 scope.

## What changes about access

- **Browser:** asks only for `drive.readonly`, now through a same-tab redirect with a checked `state` value (#48). Finances reads the P&L sheet with this same access; its numbers never reach the Cortex server, a log or storage, and account digits and note columns are never read into the page.
- **New and server side,** set by the owner in Vercel. Without them, the matching features say they are not set up:
  - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GOOGLE_REFRESH_TOKEN`, with two scopes:
    - `drive.file`: Cortex sees and changes only files it creates (finance months, approval state, logs).
    - `calendar.events`: used only for an approved Calendar proposal.
  - `GITHUB_TOKEN`: read-only, for Ops.
- **New outside service:** Ops card previews ask Microlink's free screenshot API for a picture of each project's public site (`/api/preview`, cached a day). Only public site addresses are sent.
- **What Cortex may change:** only five actions, and only on Approve:
  - add, reschedule or complete a Todoist task;
  - add or move a Calendar event.
- **Never:** Cortex never deletes anything. Recurring tasks and all-day events are refused.

## Gate evidence map (20 application gates)

### Evidence for review (builder evidence; verified only by Joshua Small's attestation)

| Gate | Evidence |
| --- | --- |
| scope-complete | Phases 3 to 6 in #39 to #42, with Finances rebuilt in #49 and #50; #45, #47 and #48; the changelog on main; the two news categories and the Vault legend are roadmap items |
| automated-checks | CI on main at 42c8c7a (run above): type check, 95 tests, axe on every demo tab, checkpoint check |
| security-privacy-review | Builder review below |
| production-deployment | Vercel production deployment of main at 42c8c7a, 2026-11-20 |
| documentation-accurate | README, ROADMAP and CHANGELOG for 2.0 on #44; `docs/briefing-routine.md` for the routine |
| authentication | Every new `/api` route (`ops`, `news`, `finance`, `approvals`, `setup`) returns 401 without the dashboard key (constant-time compare); the ingest route needs its own bearer token; browser sign-in checks the returned `state` and the Drive scope (#48) |
| authorization-boundaries | Single owner. Approvals re-check every proposal against the five-action allowlist on the server, whatever the page sends; Undo reverses the server's own copy of what ran |
| sensitive-data-handling | Finances reads the sheet in the browser only: no server copy, account digits and note columns skipped, notes scrubbed of long numbers and links (#49, #50); the audit log keeping times, ids and results only (no titles, reasons or amounts); Gmail staying inside the Claude routine, never reaching Cortex |
| api-integration-security | Todoist, Google and GitHub tokens live only in Vercel; errors name the service and status, never a token or request body |
| integration-failure-handling | Each tab and Home panel fails on its own; broken feeds are skipped and named; a changed task or event is refused as "Stale, review again" instead of overwritten |
| deployment-rollback | Vercel keeps every deployment; promote the previous one to roll back |
| e2e-critical-workflows | Axe and page-error checks load every `/demo` tab, `/demo/briefing` included, in CI |

### Needs Joshua Small's own check (about 15 minutes)

| Gate | Check |
| --- | --- |
| wcag-22-aa | At 200% zoom on Home, Finances, News, Ops and Briefing, text is readable, focus is always visible and nothing is cut off. Axe passes in CI, but it can't judge everything |
| keyboard-screen-reader | Tab through Home and the Briefing page: the skip link comes first, Approve, Reject and Undo are reachable, and focus lands sensibly after each one |
| responsive-layouts | Open Home, Finances, News, Ops and Briefing on the phone: nothing overflows sideways |
| critical-workflows | Open Finances: the overview and Needs attention panel load from your P&L sheet, and each figure says Recorded plan, Estimate, Confirmed, Unknown or Conflict. Open Ops: the Connections panel shows three connections ready. Open News. Approve one proposal from a morning briefing and press Undo (needs one briefing in `/Cortex/briefings`) |
| audit-logging | After the approval above, `/Cortex/logs/audit-YYYY-MM.jsonl` in Drive has one line for it and one for the Undo. Blocked until the Vercel settings exist |
| backup-recovery | Proposed not applicable since #49: Cortex no longer stores finance data. The P&L sheet stays in your Drive with Drive's own version history, Cortex's own files are the approval state (rewritten on each decision) and the audit log (only added to); Drive keeps recent earlier versions of both. Write "backup-recovery not applicable" in your sign-off if you agree |

### Not applicable (unchanged from 1.0)

| Gate | Reason |
| --- | --- |
| user-data-isolation | Single-user app with one owner; there are no other users' data to isolate |

`no-release-blockers` turns verified once the blocker `live-config-pending` is resolved: the Vercel settings exist since 2026-11-18, and the checks above confirm them.

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
- Finances (#49, #50): the sheet is read in the browser with the existing read-only access; `/api/finance` and `/api/ingest/finance` stay deployed behind their keys but no page uses them.
- Ops previews send only public site addresses to Microlink; the image is cached a day on Vercel's CDN.
- Not done: no independent (Codex) review yet; Joshua Small's rule is a Codex review at major versions, so 2.0 qualifies if he wants one. Codex work is on hold by his choice.

## Proposed owner attestation

Comment on the PR that refreshes this page, once the checks above are done:

> I reviewed the Cortex 2.0 release package and its linked evidence, did the checks listed under "Needs Joshua Small's own check", and approve Cortex 2.0.0 for release.

If a check fails, say which; it becomes a blocker and nothing is recorded as verified.

## After sign-off (agent steps)

1. Record the approval and the verified gates in `projects/registry.json`, citing the sign-off comment.
2. Fold the changelog's Unreleased section into 2.0.0 with the release date (a small cortex-brain-task PR).
3. Set `currentVersion` 2.0.0 and `releaseStatus` released, back to maintenance.
4. The `v2.0.0` tag stays the owner's to create, or to ask for.
