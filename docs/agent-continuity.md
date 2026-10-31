# Switching AI tools without losing the thread

Contract: [standards/agent-continuity.md](../standards/agent-continuity.md). State: `.engineering/` in each project. Aggregate view: the **Project state** workflow summary (`npm run state:aggregate`).

## Starting work on any project

Tell any agent: *"Continue `<project>`. Follow the Engineering Hub continuity contract."* It reads `AGENTS.md`/`CLAUDE.md`/`GEMINI.md`/`copilot-instructions.md` in the repository (each carries the short block), then `.engineering/HANDOFF.md`, then checks GitHub. Nothing from the previous conversation is needed.

## Switching tools

| From → to | What to do |
| --- | --- |
| Claude → Codex (tested once via the ChatGPT connector, not the isolated CLI: docs/handoff-acceptance/codex-task.md) | In Codex: *"Continue `<project>` from where Claude stopped."* Codex reads `AGENTS.md`, then HANDOFF. When it finishes it checkpoints (CLI). |
| Codex → Claude | Same prompt in Claude Code. `CLAUDE.md` carries the block. |
| Claude → ChatGPT | ChatGPT cannot read your repository by itself. Paste `.engineering/HANDOFF.md` (or let a connected GitHub integration read it) plus the resume prompt below. ChatGPT proposes a patch; apply it with the CLI or ask Claude/Codex to. |
| ChatGPT → Grok | Same: paste the HANDOFF and resume prompt. Neither writes to GitHub on its own unless you give it that access. |
| Interrupted session (usage limit, crash) | The last checkpoint is the truth. Work after it is lost unless it was pushed: HANDOFF says `uncommittedWorkOutsideCheckpoint`. The next agent re-reads GitHub, finds any branch ahead of the recorded commit, and treats it as unverified. |

### Resume prompt (any tool)

> Continue the project `<id>` in `WasteOfADrumBum/<repo>`. Follow the continuity contract in WasteOfADrumBum/one-small-engineering `standards/agent-continuity.md`. Read `.engineering/HANDOFF.md` and `state.json`, verify them against the current branch head, open PRs and CI, tell me any disagreement, then do the recorded next action. Checkpoint when you finish a task. Do not record verifications or approvals.

### Checkpoint prompt (any tool, before you stop)

> Write a checkpoint for `<id>`: what you completed, what remains, branch and commit, active PR, tests run with results and commit, failures, blockers, decisions, the exact next step, and whether any work exists only locally. Output it as a JSON patch for `.engineering/state.json` following the contract. Do not include secrets or claim verification.

## Platform support

| Tool | Reads instructions from | Automatic checkpoint | Status |
| --- | --- | --- | --- |
| Claude Code / Cowork | `CLAUDE.md` (block installed) | Optional hooks, example below | Convention documented; **not runtime-tested here** |
| OpenAI Codex | `AGENTS.md` (block installed) | None; explicit CLI/prompt | Handoff tested once via ChatGPT connector (not the isolated CLI) |
| GitHub Copilot | `.github/copilot-instructions.md` (block installed); coding agent also reads `AGENTS.md` | None | Convention documented; not runtime-tested |
| Gemini CLI | `GEMINI.md` (block installed) | None | Convention documented; not runtime-tested |
| ChatGPT, Grok | Nothing in the repository is read automatically | None; paste prompts | Prompt-based only |

No tool is guaranteed to checkpoint at session end: an abrupt termination leaves no final checkpoint. The protocol therefore asks for incremental checkpoints after each task. The producer/consumer behaviour of the contract itself is tested in `scripts/state/handoff.test.mjs`; that test uses two *simulated* agents, not two vendors.

### Optional Claude Code hooks

Not installed by default (a project may already own its hooks). To add reminders, merge into `.claude/settings.json`:

```json
{ "hooks": {
  "SessionStart": [{ "hooks": [{ "type": "command", "command": "cat .engineering/HANDOFF.md 2>/dev/null || true" }] }],
  "PreCompact":   [{ "hooks": [{ "type": "command", "command": "echo 'Checkpoint .engineering/state.json before context is compacted.'" }] }]
} }
```

Check the current Claude Code hooks documentation before relying on event names.

## Installing into a project

`installPlan` (`scripts/state/install.mjs`) adds or refreshes one marked block in `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` and `.github/copilot-instructions.md`, leaving existing text untouched, and creates `.engineering/` only if absent. Install is a normal PR in the project repository.
