# One Small Engineering Phase 6: Completion Report

As of 2026-10-31, Hub main `8d8397a`. Supersedes the open items in `phase-6-final-report.md`.

## Executive summary

All eight repositories now carry the continuity contract on `main`, the Hub aggregates all eight, registry sync merges unattended, and a safe near-real-time sync path is live. The one thing not done is the real two-vendor handoff: no Codex runtime was available, so it is **pending**, with the Claude half and an exact run kit ready. Phase 6 is ready for operational acceptance on everything except that one test and the owner items below.

## Repository matrix

| Project | Contract on main | State read by Hub | CI status |
| --- | --- | --- | --- |
| one-small-mods-pack | yes (#4, 4522380) | ok, initial | green; candidate c747cbd unchanged |
| one-small-ui | yes | ok, initial | green; Playwright fixed by #30 (5c5bfe7) |
| joshsmall-site | yes | ok, initial | green at merge |
| one-small-studio | yes (#18, ea33857) | ok, initial | green; d6854de attestation untouched |
| one-small-photography | yes | ok, initial | green at merge |
| TaskForge | yes (#45, d1cc560) | ok, initial | green after #46 (fc69d2b) |
| cortex-brain-task | yes | ok, initial | green at merge |
| one-small-ai-workforce | yes (private) | ok, initial | green at merge |

Aggregation: workflow run 41204353642 reported `ok` for 8 of 8. All eight records are the initial all-unknown kind (flag `never-checkpointed`), so this proves the pipeline reads and validates every repository, **not** that real project continuation has happened.

## Handoff demonstration

Not completed live. Done: throwaway branch `handoff-test/claude-to-codex` with task H-1 (`slugify` done, `uniqueSlugs` stub; 1 pass, 2 fail) and a Claude checkpoint, revision 1, `cp-claude-h1-0001`, at work commit 2370fcf. That checkpoint was written with the state library (`persistedBy: local-file`) because this session had no repository write token for the GitHub-API CLI. Pending: a fresh Codex session given only "Continue this project using its Engineering Hub continuity contract." Steps and six pass criteria are in `docs/handoff-acceptance/codex-task.md`. The producer/consumer test in `scripts/state/handoff.test.mjs` uses two simulated agents and is supporting evidence only.

## Automation status

- Scheduled sync (6 h, Stage C): live, unchanged fallback.
- Auto-merge: live. This session's run: after the watch dispatch, sync PRs #46 to #49 merged without intervention.
- Change watch (new, hub #45): hourly read-only comparison of live heads and open PRs with the registry; dispatches Registry sync only on change. First run 41205229190 correctly reported ModsPack, UI, Studio and TaskForge as changed (and not the other four). Worst case latency about one hour.
- Push events (`events.yml`, notify template): implemented, tested with fixtures, **disabled and not recommended**; no real event has been delivered. Immediate delivery is pending a GitHub App decision (needs a receiver or relay).

## Tests and CI

Hub suite: 449 pass, 0 fail on main. Main integrity: success at ab67ba7. TaskForge: `npm audit` 0, lint, typecheck, 852 tests, build pass locally and in CI. Historical results from earlier phases are not re-asserted here.

## Security

No Hub credential was added anywhere. Rejected: Contents-write token in eight repos. TaskForge fix used no `--force`, no audit bypass: follow-redirects lockfile update, plus dev-only overrides minimatch ^11.0.1 and glob ^14.0.2. No release gate was marked verified, no ModsPack publish, no deploy. Merging the contract PRs does not move ModsPack's candidate (the engine treats a candidate as moved only while its PR is open) or Studio's evidence (bound to its own commit).

## Unresolved, owner only

1. Start Codex on the throwaway branch and record the result (kit ready).
2. Joshua's Studio `documentation-accurate` verification at d6854de, and the final sign-off.
3. Optional: decide on a GitHub App for immediate events.
4. Cleanup: delete branch `handoff-test/claude-to-codex` after the test. Record that TaskForge override pins may be removable once upstream eslint/jest tooling ships patched ranges.

## How to use it

Any agent: "Continue `<project>`. Follow the Engineering Hub continuity contract." Claude Code and Codex read the repository and checkpoint with `node scripts/state/cli.mjs checkpoint` (needs a token with contents write on that repo). ChatGPT and Grok cannot reach the repository: paste `.engineering/HANDOFF.md` and the resume prompt from `docs/agent-continuity.md`, have them return a JSON patch, and apply it with Claude Code or Codex.

## Final recommendation

Ready for operational acceptance of the Hub, sync, auto-merge, state contract and aggregation. Not claimable as fully accepted until the live Codex handoff has been run and Joshua has made the Studio attestation and sign-off.
