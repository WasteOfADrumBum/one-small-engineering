# Agent continuity contract (v1)

One contract for every AI tool that works on a governed project: Claude Code, Codex, ChatGPT, Grok, GitHub Copilot, Gemini CLI, and any later tool. Development context lives in GitHub and this hub, not in a conversation. A different agent must be able to continue from the repository alone.

## The record

Each project repository holds `.engineering/state.json` (schema: `schemas/project-state.schema.json`). It is the only source of truth. `STATUS.md` and `HANDOFF.md` are generated from it and never edited by hand.

### Truth model

| Kind | Where it lives | How to treat it |
| --- | --- | --- |
| GitHub-confirmed fact (branch head, PR state, CI) | GitHub, read live | Authoritative. Always re-read. |
| Agent-reported work | `.engineering/state.json` | A claim. Useful, never proof. |
| Human decision | `decisions.made[]` with `decidedBy: human` and a `humanRef` | Only with a cited reference to where the human decided. |
| Independent verification | Hub registry only, recorded by the assigned human verifier | Never in `state.json`. `provenance.independentVerification` is always `none` there. |
| Missing or stale | `null`, empty, or a flag in the hub aggregation | Say "unknown". Never guess. |

## Protocol

### At task start

1. Identify the project (repository, hub project id).
2. Read the local instruction files and `.engineering/HANDOFF.md`, then `state.json`.
3. Consult the hub for the project's registry status and standards.
4. Check GitHub: branch head vs `recorded.commit`, open PRs vs `development.activePr`, CI on the head, whether `workingBranch` still exists.
5. If anything disagrees, trust GitHub and note the difference in your first checkpoint.
6. If the record names an active task by another agent with a recent checkpoint, do not start the same task. Take the next unclaimed one or ask.
7. Pick one bounded task, set it as `activeTask`, and begin.

### During

Keep tasks small. Run the relevant tests. Record material decisions as they are made. **Checkpoint after each finished task or decision**, because a session can end abruptly and a final exit hook cannot be guaranteed. Never write secrets, tokens or private conversation text into `.engineering/`.

### Checkpoint (and handoff)

A checkpoint states: what was completed, what remains, branch and commit, active PR and task, tests run (command, result, commit, CI link), failures, blockers, decisions, the exact next step, and whether uncommitted work exists outside the checkpoint (`none`, `possible`, `unknown`). Do not claim local files exist unless they are pushed.

Write it with the CLI so concurrent agents cannot overwrite each other:

```bash
gh repo clone WasteOfADrumBum/one-small-engineering   # once, next to the project
node one-small-engineering/scripts/state/cli.mjs show WasteOfADrumBum/<repo>
node one-small-engineering/scripts/state/cli.mjs checkpoint WasteOfADrumBum/<repo> \
  --branch <branch> --patch patch.json --expected-revision <revision you read> \
  --agent "<tool>" --model "<model>" --project <hub project id>
```

`GITHUB_TOKEN` needs `contents: write` on the project repository. The checkpoint is one commit containing `state.json` and both views. It is refused if the file's revision moved on (someone else checkpointed) or the branch head moved (not a fast-forward). On refusal: re-read, merge your changes by hand into a new patch, retry. Repeating a checkpoint with the same `checkpointId` does nothing.

With no way to run the CLI, edit `state.json` by the schema, increment `revision`, set a new `checkpointId`, leave the two views for the next CLI checkpoint to regenerate, commit and push, and say so. The hub flags views that are out of sync.

### At completion

Final checkpoint with `nextAction` set to the next unstarted item (or `null` if the milestone is done) and `activeTask: null`. Open or update the PR. Do not merge unless the project's own rules allow it.

## What an agent must never do

- Record a verification, approval, release decision or blocker resolution as a human or on a human's behalf. Those belong to the assigned verifier and to Joshua Small, and live in the hub registry.
- Report a test it did not run, or tests run at a different commit as current.
- Record itself under a human identity.
- Merge application code it wrote without the project's review rules.

## Versioning

`stateVersion: 1`. A reader that meets another version stops and reports it; it does not guess. Changes to this contract are hub PRs approved by Joshua Small.
