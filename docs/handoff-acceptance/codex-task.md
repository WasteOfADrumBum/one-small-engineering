# Live cross-vendor handoff: Claude to Codex (ready to run)

Status: **Codex completed H-1; acceptance is qualified.** The fixture and checkpoint checks passed in ChatGPT Work Codex using the GitHub connector. The standalone CLI, clean clone and no-prior-context setup were not exercised. This is agent-reported evidence, not independent verification.

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

## Evidence (fill in after the run)

| Item | Result |
| --- | --- |
| Codex session/run reference | ChatGPT Work Codex; code commit [50f4d49](https://github.com/WasteOfADrumBum/one-small-engineering/commit/50f4d497b3a7e8ef1332189663cbe81e7aba0140); no session URL exposed |
| 1 | Found H-1 and uniqueSlugs next action from state.json before reading this run kit |
| 2 | Resumed from descendant d3a2027; slugify unchanged |
| 3 | Revision 1 to 2, Codex, 3 passing fixture tests attributed to code commit 50f4d49 |
| 4 | independentVerification remains none |
| 5 | State library generated revision 2 and completion (activeTask and nextAction null); GitHub connector used instead of standalone CLI |
| 6 | applyCheckpoint with expectedRevision 1 against revision 2 throws ConflictError; live stale CLI write was not attempted |

### Runtime limits

- Direct git clone lacked credentials. Relevant files were fetched at the exact GitHub commit and tested locally; pushed helper content was compared with the tested copy.
- Standalone CLI had no write token. The existing state library validated the patch and generated both views; GitHub connector committed all three files atomically with a branch-head lease.
- Node v24.22.1: directory-form node --test handoff-fixture/ failed to resolve the directory. Explicit node --test handoff-fixture/slug.test.mjs reproduced the baseline (1 pass, 2 fail) and then passed all 3 tests.
- No workflow run existed at takeover. Full npm run check was not run. No PR opened because this is a throwaway branch that must never merge.
- The session received prior project context from ChatGPT, so the strict no-prior-conversation criterion is not established. An isolated CLI run remains necessary for unqualified acceptance.
