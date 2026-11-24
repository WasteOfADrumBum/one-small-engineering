# AI engineering standards (`ose ai`)

One source of truth for how AI agents work across every One Small repository. Change a policy once here, run one command, and Claude Code, Codex, GitHub Copilot, Gemini CLI and ChatGPT Projects all get the same rules, while each project keeps its own architecture and instructions.

- Source: [`ai-standards/`](../ai-standards/) (policies, templates, manifest, registry, schemas)
- Code: [`scripts/ai/`](../scripts/ai/) (Node built-ins only, no dependencies), entry point [`scripts/ose.mjs`](../scripts/ose.mjs)
- Tests: [`scripts/ai/ai.test.mjs`](../scripts/ai/ai.test.mjs), part of `npm test` and therefore of this hub's CI
- Changelog: [`ai-standards/CHANGELOG.md`](../ai-standards/CHANGELOG.md)

## 1. Architecture

```text
One Small Engineering (this repo)            each managed repository
ai-standards/                                .ai/
  policies/*.md      ── copied ──────────▶     shared/*.md            managed, checksummed
  templates/*.tmpl   ── rendered ────────▶     chatgpt-project-instructions.md   managed
  manifest.json      (version, checksums)      manifest.json          installed state
  registry.json      (managed repos)           history/*.json         rollback points
                                               project.md             project-owned, never overwritten
                     ── marked block ────▶   CLAUDE.md, AGENTS.md, .github/copilot-instructions.md, GEMINI.md
```

- **Copied, not linked.** Every repository carries its own versioned copy, so cloud agents, CI and offline clones see the same rules without reaching this hub.
- **Adapters.** The policies are provider-neutral Markdown. Each agent format is an adapter in `manifest.json` (a marked block in an instruction file, or a whole generated file). A new agent is one manifest entry and one template; the policies are never duplicated.
- **Marked blocks.** In instruction files, `ose ai` owns only the text between `<!-- one-small-engineering:ai-standards v1 -->` and `<!-- /one-small-engineering:ai-standards -->`. Everything outside it, including the Hub continuity block and any ModsPack block, is left byte for byte.
- **Compact by design.** Blocks carry the short "Core rules" of each policy (about 1,700 tokens) and point to `.ai/shared/` for detail, so every session loads the essentials without pulling in all ten files. Blocks use no Claude `@imports`, which keeps references one-way and free of cycles.

| Agent | File | How it is found |
| --- | --- | --- |
| Claude Code | `CLAUDE.md` (block) | loaded automatically from the repository root |
| OpenAI Codex | `AGENTS.md` (block) | loaded automatically; the Copilot coding agent reads it too |
| GitHub Copilot | `.github/copilot-instructions.md` (block) | repository custom instructions |
| Gemini CLI | `GEMINI.md` (block) | only where the file already exists |
| ChatGPT Projects | `.ai/chatgpt-project-instructions.md` | manual: ChatGPT does not read repositories (section 13) |

## 2. Policy hierarchy

1. Platform permissions, sandboxes, branch protection and deployment controls (always win).
2. The owner's explicit instructions for the current task.
3. Project rules: `.ai/project.md` and project text outside managed blocks. They refine shared policies but never remove a Level 3 safeguard. A project rule may define what counts as authorization (for example Reflections Manga: "commit and push once a story is approved").
4. Shared policies: `.ai/shared/*.md`.

The task brief adds scope and acceptance criteria on top. Policies: autonomy, security, architecture, code quality, testing, accessibility (WCAG 2.2 AA), documentation, completion, collaboration (multi-agent roles), learning (turning repeat corrections into rules).

## 3. Risk-based autonomy (default policy)

| Level | Behavior | Examples |
| --- | --- | --- |
| 1 | Do it | read, analyze, implement, scoped refactor, tests, build, lint, docs, safe fixes |
| 2 | Do it with safeguards | multi-file refactor, cost-free dependency update, shared components, managed instruction files |
| 3 | Stop for explicit approval | destructive or irreversible steps, deploy, publish, major redesign, new costs, credentials, force push, delete remote branch, merge PR |

Commits, pushes, merges, deployments and publication always need explicit authorization. These are instructions, not a security boundary: real protection comes from permissions, sandboxes and branch protection.

## 4. Setup on your machine

Requires Node 20+. No install step and no dependencies.

```powershell
cd "C:\Workspace\01 Development\Projects\one-small-engineering"
git pull
npm link          # optional: puts `ose` on your PATH (Windows creates ose.cmd)
ose ai help       # or, without npm link: node scripts/ose.mjs ai help
```

The workspace defaults to the folder that contains this hub, so with the hub at `...\Projects\one-small-engineering` no configuration is needed. Override with `--workspace "<dir>"` or the `OSE_WORKSPACE` environment variable. Quoted paths copied with Explorer's "Copy as path" work as they are.

## 5. Repository registration

`ai-standards/registry.json` lists managed repositories by GitHub `owner/name`. Local folders are matched by their git remote, so a folder can be called `Cortex` while the repository is `cortex-brain-task`. Set `path` on an entry only to pin a folder.

```powershell
ose ai discover                       # every git repo under the workspace and its eligibility
ose ai register --target ".\New Repo" # add one (no files in it are changed)
ose ai unregister --id new-repo       # remove the entry (files are untouched)
```

Discovery never descends into a repository it found (nested repos and submodules are not counted twice), skips `node_modules`, build output and symbolic links, honors `discovery.exclude`, and reports the hub itself as the source. Discovery and registration never modify a repository.

## 6. Install and sync

```powershell
ose ai install --target ".\New Repo"   # first install; registers it too (--no-register to skip)
ose ai sync --target cortex            # one repo, by registry id or folder
ose ai sync --all                      # every enabled registry entry
ose ai status                          # live: installed version per repo and whether it validates
ose ai validate --all                  # read-only checks of every installed repo
```

Install creates `.ai/project.md` once, seeded from the repo's own package metadata (stack, the check commands it really has, and which instruction files already hold project rules). After that it belongs to the project.

Sync is deterministic and idempotent: with no source change it writes nothing, not even the manifest. `--adapters claude,codex` limits the adapters; the selection is remembered in `.ai/manifest.json`.

## 7. Dry run

Add `--dry-run` to `install`, `sync` or `rollback` to see every intended operation (`+` create, `~` update, `-` remove, `!` conflict) without writing anything, including the registry.

```powershell
ose ai sync --all --dry-run
```

## 8. Conflict handling

Every managed file and block is checksummed in `.ai/manifest.json` (line endings normalized, so Windows `autocrlf` checkouts are not false conflicts). Sync refuses to overwrite:

- a managed file or block edited since the last sync,
- a file at a managed path that `ose ai` did not write,
- a block that was deleted, or markers that are broken or duplicated.

A conflict stops that repository entirely (no partial update) and `--all` carries on with the others. The output names each file and the fix: move the edit you want to keep into `.ai/project.md`, then

```powershell
ose ai sync --target cortex --overwrite .ai/shared/testing.md
```

The overwritten content is kept in the rollback snapshot.

## 9. Rollback

Each sync that changes something writes `.ai/history/<timestamp>.json` (the last 5 are kept; commit them with the change). Rollback restores the previous managed state of the most recent snapshot:

```powershell
ose ai rollback --target cortex --dry-run
ose ai rollback --target cortex
```

It changes a file only if it still holds exactly what that sync wrote, so later edits are never overwritten; any mismatch aborts the whole rollback. Rolling back an install removes everything it added and leaves the repository byte-identical. An edited `.ai/project.md` is kept. For a change that arrived through a merged pull request, reverting that PR works too.

## 10. Adding or changing a policy

1. Edit or add a file in `ai-standards/policies/` with front matter (`id`, `title`), a `## Core rules` bullet list (goes into every instruction file, keep it short) and `## Details`. New files also get an entry in `manifest.json` `policies`.
2. `npm run ai -- bump --level <patch|minor|major>` updates the version and checksums. Validation fails if policy text changes without this step.
3. Add a line to `ai-standards/CHANGELOG.md`, run `npm run check`, open a PR.
4. After merge: `git pull`, then `ose ai sync --all --dry-run` and `ose ai sync --all`, and commit the changes in each repository.

## 11. Adding an agent adapter

Add an entry to `manifest.json` `adapters` (`kind: block` for a marked block in an existing instruction file, or `kind: file` for a generated file inside `.ai/`), add its template in `ai-standards/templates/` (and to `templates` with its checksum through `bump`), and add it to `defaultAdapters` if every repo should get it. Templates are named `*.tmpl`, never `CLAUDE.md` or `AGENTS.md`, so agents working in this hub do not load them as instructions.

## 12. Project-specific rules

Put them in each repository's `.ai/project.md`, or keep them where they already are (text outside the managed block in `CLAUDE.md` or `AGENTS.md`). `ose ai` never edits either. After editing `.ai/project.md`, run `ose ai sync --target <repo>` so the ChatGPT file picks it up.

## 13. ChatGPT Projects setup (manual)

ChatGPT cannot read your repositories, so this step is by hand, once per project and again after a policy change:

1. Open [chatgpt.com](https://chatgpt.com), open or create the Project (left sidebar, **Projects**).
2. Open the Project's settings and its **Instructions** field.
3. Paste the contents of `<repo>/.ai/chatgpt-project-instructions.md`. If it does not fit, upload that file under the Project's **Files** instead and put `Follow the uploaded chatgpt-project-instructions.md for every task.` in Instructions.
4. Optional: upload the files in `<repo>/.ai/shared/` as Project files for full policy detail.

For a single set of rules across all ChatGPT chats, `ose ai render --adapter chatgpt` prints the project-neutral text for ChatGPT's personal custom instructions.

## 14. Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `policy source is invalid ... checksum` | A policy changed without `bump`. Run `npm run ai -- bump --level patch`. |
| `another ose ai run holds .ai/.lock` | A run was interrupted. If none is running, delete `.ai/.lock`. |
| `not found under <workspace>` | Clone the repo into the workspace, or set `path` on its registry entry, or pass `--workspace`. |
| `not installed; run ose ai install` | `sync` only updates installed repos. |
| `older than the installed` | The hub is behind the repo. `git pull` the hub, or `--allow-downgrade` deliberately. |
| `update failed and was rolled back` | A write failed (disk, permissions, antivirus lock). Nothing was left half-done; fix the cause and rerun. |
| Validation `managed file modified locally` | Someone edited `.ai/shared/`. Move the edit to `.ai/project.md` and sync with `--overwrite`. |

## 15. Security and permission boundaries

- Instruction files are guidance, not enforcement. Use platform permissions, sandboxes, branch protection and deployment controls for anything that must not happen.
- `ose ai` only reads and writes inside the target repository (paths are checked so nothing escapes it), never runs code from the repositories it manages, makes no network calls and works offline.
- It only installs content from this hub's own `ai-standards/` whose checksums match the manifest, and it refuses a repository whose `.ai/manifest.json` names a different source.
- Validation scans policies and generated files for credentials and personal data; no secrets belong in any of them.
- It never commits, pushes or opens pull requests. Committing the result is your step.

## CI

This hub's existing `Validate registry` workflow runs `npm run check`, which now includes the AI standards tests: source schema and checksums (drift between policy text and manifest), template rendering, reference resolution, sensitive-data scans, and the full install, sync, conflict, rollback and discovery suite against temporary fixtures. No new workflow and no new dependency were added. Managed repositories are validated with `ose ai validate --all` from your machine; their CI does not need the hub.

## ModsPack integration: deferred

One Small ModsPack is a public, MIT-licensed npm package (`one-small-modspack`) for any developer. It already has its own installer (`modspack init`) with its own marked blocks and manifest. Adding `ose-mods ai` aliases would make a public package depend on this personal hub, duplicate an install engine, and add nothing `ose ai` does not already do. The two coexist safely: different markers, different manifests (`.modspack/` and `.ai/`). Revisit only if ModsPack gains a plugin mechanism for third-party installers.
