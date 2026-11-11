# Cortex 1.0: closeout package

Prepared 2026-11-11 by Claude Code for Joshua Small's review. Status: **owner attestation pending**. Nothing here records approval or a verification pass until Joshua Small posts his own attestation on the pull request that adds this file.

Joshua Small chose to ship the live Cortex as 1.0 on 2026-11-11 (project chat, "Ship as 1.0"). This follows [the showcase closeout](final-closeout-2026-11-03.md) and [the UI 0.6.0 closeout](ui-0.6.0-final-closeout.md): Joshua Small, the assigned human verifier, reviews the linked evidence, does the few manual checks listed below, and records one attestation. Builder evidence keeps its provenance; no test is represented as newly run.

## Release identity

- Scope: the tabs as described in [README.md](https://github.com/WasteOfADrumBum/cortex-brain-task/blob/main/README.md): Home, Planner, Vault, the Ops Second Brain checklist and the `/demo` portfolio version. Finances, News, Ops project cards and the Assistant are labeled "coming later" and listed in [ROADMAP.md](https://github.com/WasteOfADrumBum/cortex-brain-task/blob/main/ROADMAP.md) ([cortex-brain-task#37](https://github.com/WasteOfADrumBum/cortex-brain-task/pull/37)).
- Version 1.0.0 (package.json and the page footer). No git tag or GitHub release until Joshua Small signs off.
- CI: [cortex-brain-task#36](https://github.com/WasteOfADrumBum/cortex-brain-task/pull/36) added the first workflow: type check, 17 tests and a production dependency audit (0 vulnerabilities) behind one `CI gate` check.
- Hosting: Vercel production at https://cortex.onesmall.company (registry evidence `cortex-vercel-head`).

## Gate evidence map (20 application gates)

### Evidence for review (builder evidence; verified only by Joshua Small's attestation)

| Gate | Evidence |
| --- | --- |
| scope-complete | 1.0 scope above; Joshua Small's "Ship as 1.0" decision; ROADMAP.md for the rest |
| automated-checks | CI on #36 and #37: type check, 17 node:test tests, production audit |
| security-privacy-review | Builder review in this page (below) |
| production-deployment | Vercel production deployment of main (`cortex-vercel-head`) |
| documentation-accurate | README tab table updated for 1.0 in #37 |
| no-release-blockers | No open blocker once the hub's `no-ci-workflow` (fixed by #36), `v2-phases-incomplete` and `spec-open-questions` (both moved to ROADMAP.md by owner decision) are resolved |
| authentication | Pages show only a sign-in screen until the owner signs in with Google; every `/api` function returns 401 without the dashboard key (`api/tasks.js`, `api/checks.js`, `api/calendar.js`) |
| authorization-boundaries | Single owner: the dashboard key gates every function; Drive access is the owner's own read-only grant |
| sensitive-data-handling | Browser asks only for `drive.readonly`; the Todoist token and calendar feed URLs live only in Vercel environment variables; nothing is stored server side; the demo never calls Drive, Todoist, Calendar or weather |
| api-integration-security | Functions call Todoist and the calendar feeds server side with secrets from the environment; errors return a message without the secret |
| integration-failure-handling | Each source fails on its own panel (README); function errors name the missing setting instead of failing silently |
| deployment-rollback | Vercel keeps every deployment; a bad release is rolled back by promoting the previous deployment in the Vercel dashboard |

### Proposed not applicable for 1.0 (owner decision, with reasons)

| Gate | Reason |
| --- | --- |
| backup-recovery | Cortex has no data store of its own. Notes, tasks and events live in Google Drive, Todoist and Google Calendar, which Cortex only reads; there is nothing of Cortex's to back up |
| audit-logging | Cortex 1.0 makes no changes on the owner's behalf; all integrations are read-only. An audit log arrives with the Assistant's approvals inbox (ROADMAP.md) |
| user-data-isolation | Single-user app with one owner; there are no other users' data to isolate |

### Needs Joshua Small's own check (about 10 minutes, on the live site)

| Gate | Check |
| --- | --- |
| wcag-22-aa | No automated axe scan runs yet (ROADMAP.md). Check that text is readable, focus is always visible and nothing is cut off at 200% zoom on Home, Planner and Vault |
| keyboard-screen-reader | Tab through Home and Planner from page load: the skip link comes first, every control is reachable and nothing traps focus |
| responsive-layouts | Open Home, Planner and Vault on the phone: nothing overflows sideways and the menu button opens the tabs |
| critical-workflows | Sign in, see today's schedule and tasks on Home, open the Planner, open a note in the Vault |
| e2e-critical-workflows | Open `/demo` signed out and visit every tab: sample data shows and nothing real appears |

## Builder security review (Claude Code, 2026-11-11)

- No secrets in the repository; tokens and feed URLs are Vercel environment variables.
- All three functions refuse requests without the dashboard key (401) and report a missing configuration as 500 with the setting's name only.
- Google access is `drive.readonly`; Cortex cannot change Drive.
- Demo routes send `X-Robots-Tag: noindex`, and signed-out real routes show no data.
- Finding (low): the dashboard key is compared with `!==`, not in constant time. Listed under "Hardening" in ROADMAP.md; not a release blocker for a single-user app behind sign-in.

## Proposed owner attestation

To close 1.0, Joshua Small posts this (or his own wording) as a comment on this pull request:

> I reviewed and accept the Cortex 1.0 closeout package. I did the manual checks listed for the five gates that need my own check, and they passed. I accept the linked evidence for the twelve evidence gates and agree that backup-recovery, audit-logging and user-data-isolation do not apply to 1.0 for the reasons given. I approve Cortex 1.0. Record my verification and approval, move it to maintenance, and merge once checks pass.

If a manual check fails, say which one instead; it becomes a fix before 1.0 closes.

After that comment, the registry gates cite it as his verifier attestation, the three blockers are resolved, approval is recorded with its date, reports are regenerated, and this PR merges. The 1.0 tag on cortex-brain-task is then his to create (or to ask for).
