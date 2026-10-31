# Live cross-vendor handoff: Claude to Codex (ready to run)

Status: **Run once, 2026-10-31, through the ChatGPT/Codex GitHub connector. Passes criteria 1 to 6 with the qualifications below. The isolated Codex CLI path (own clone, `cli.mjs checkpoint` with a token) is still untested.**

## Setup already done (Agent A, Claude Code, Sonnet 5.5)

- Throwaway branch `handoff-test/claude-to-codex` in `WasteOfADrumBum/one-small-engineering`. Never merge it.
- Task H-1 in `handoff-fixture/`: `slugify()` implemented; `uniqueSlugs()` is a stub that throws. `node --test handoff-fixture/slug.test.mjs` currently gives 1 pass, 2 fail.
- `.engineering/state.json` revision 1, checkpoint `cp-claude-h1-0001`, recorded work commit `2370fcfc0acf7f8be59bb363e3e888ae5c8475ce`, written with the state library (`persistedBy: local-file`, not the GitHub-API CLI, because the preparing session had no write token).

## Run (Agent B, Codex)

Start a fresh Codex session on a clone of the repository, no prior conversation, checked out at `handoff-test/claude-to-codex`. Give it exactly this and nothing else:

> Continue this project using its Engineering Hub continuity contract.

Do not add hints. Codex must find `AGENTS.md`, `.engineering/HANDOFF.md`, `state.json`, verify the branch and commit on GitHub, implement `uniqueSlugs()`, run `node --test handoff-fixture/slug.test.mjs`, and checkpoint:

```
GITHUB_TOKEN=<token with contents:write on this repo> node scripts/state/cli.mjs checkpoint WasteOfADrumBum/one-small-engineering --branch handoff-test/claude-to-codex --patch <patch.json> --expected-revision 1 --agent Codex --model <model>
```

## Pass criteria (check each)

1. Codex named task H-1 and the next action without being told.
2. It resumed at commit `2370fcf` (or a descendant), did not redo `slugify()`.
3. Checkpoint revision went 1 to 2, `lastAgent.tool` is Codex, its test result is attributed to Codex with the commit it ran on.
4. `provenance.independentVerification` is still `none`.
5. `node scripts/state/cli.mjs show WasteOfADrumBum/one-small-engineering --ref handoff-test/claude-to-codex` shows revision 2 and a next action reflecting completion.
6. A stale re-run of Claude with `--expected-revision 1` is refused with a conflict.

## Evidence (recorded 2026-10-31)

Run by Joshua through ChatGPT/Codex ("Worked for 3m 39s", screenshot reviewed). Result commits on `handoff-test/claude-to-codex`: `50f4d49` (uniqueSlugs) and `2ff95e1` (checkpoint r2). Nothing merged. Checked by Claude from the pushed branch, not from the Codex transcript.

| Criterion | Result | How checked |
| --- | --- | --- |
| 1 Found H-1 and next action unaided | Pass, qualified | Checkpoint says it reconciled recorded 2370fcf with live d3a2027. The prompt named the branch (a small hint); the transcript was not reviewed. |
| 2 Resumed at the right commit, no duplicated work | Pass | `git diff d3a2027 50f4d49` touches only `uniqueSlugs()`; `slugify()` untouched. |
| 3 Revision 1 to 2, attributed to Codex | Pass | `revision 2`, `cp-codex-h1-0002`, `lastAgent` Codex, test `node --test handoff-fixture/slug.test.mjs` pass recorded at 50f4d49. Model name is self-reported. |
| 4 No independent verification claimed | Pass | `provenance.independentVerification: none`; unverifiedChanges says local tests only. |
| 5 State shows completion | Pass, partial | `state.json` validates; activeTask null, nextAction null, nothing unfinished. Re-run by Claude: 3 of 3 tests pass at 2ff95e1. Hub aggregation was not run (it reads default branches only) and `cli.mjs show` was not run (no token). |
| 6 Stale revision-1 patch refused | Pass | Re-run by Claude with the state library against revision 2: `ConflictError`; replaying `cp-codex-h1-0002` is a no-op. |

Qualifications: connector path, not the isolated CLI; `persistedBy` reads `github-api` although the checkpoint was generated with the state library and committed through the connector; commits are authored as Joshua Small (the connector acts under his account), so attribution lives only in the checkpoint; no CI run or independent verification. Both halves of the test were run by agents under the owner's account, so this proves the contract and repository state carry work between vendors, not vendor-independent verification.
