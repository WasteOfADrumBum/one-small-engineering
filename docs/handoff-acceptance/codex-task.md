# Live cross-vendor handoff: Claude to Codex (ready to run)

Status: **Claude half done and pushed; Codex half PENDING.** No Codex runtime was available in the session that prepared this, so nothing here may be reported as a passed cross-vendor test until the steps below are run and the evidence section is filled in.

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
| Codex session/run reference | not run |
| Criteria 1 to 6 | not run |
