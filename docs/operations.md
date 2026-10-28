# Operating registry sync

The runbook for the eight-project sync. Design: [sync.md](sync.md). One-time owner settings: [sync-setup.md](sync-setup.md).

## What runs where

```text
Registry sync (Actions)   collect (contents: read) ─┬─ report  stage A: plan, guard, validate; job summary only; no write permission
                                                    └─ write   stages B/C, main only: draft sync/<project> PRs + "Registry sync status" issue
Validate registry         npm run check on every PR, push to main, and dispatched on sync/* branches (plus the field-ownership guard)
Main integrity            push to main + every 6 h: flags any change to main that is not a merged PR
Engineering orchestrator  every 6 h + manual: read-only observe run over all eight projects; reports/engineering/ in the job summary and artifact (docs/engineering.md)
You                       review the draft sync PR, mark it ready, merge it (or close it)
```

Nothing is ever written to a project repository. Project repositories need no file, secret or workflow (all eight are in `observe` mode).

## Activation stages

Set the repository variable `SYNC_STAGE` (Settings → Secrets and variables → Actions → Variables). Unset means A.

| Stage | Manual run | Scheduled run (every 6 h) | Writes |
| --- | --- | --- | --- |
| **A** read-only (default) | Collects all projects; report in the job summary | Skipped | None. The report job has `contents: read` only |
| **B** controlled PR writes | Dry run by default; untick **Dry run** to open or refresh draft `sync/<project>` PRs | Skipped | Hub only: `sync/*` branches, draft PRs, the status issue, a Validate registry dispatch |
| **C** scheduled | As B | Runs, with writes | As B |

Any other value fails the run. Phase 1's `SYNC_WRITE_ENABLED=true` still means C; prefer `SYNC_STAGE`.

Move up one stage at a time and check each before the next:

1. **A:** Actions → Registry sync → Run workflow. The summary must say which projects were observed, and the only error should be `one-small-ai-workforce: needs-reader-token` until its reader credential exists.
2. **B:** set `SYNC_STAGE=B`, allow Actions to create pull requests ([setup step 1](sync-setup.md#1-allow-actions-to-open-pull-requests)), run once with **Dry run** unticked. Expect one draft PR per changed project and a green Validate registry run on each. Run it again: every project must report `unchanged` and no new commit or PR may appear.
3. **C:** set `SYNC_STAGE=C`. Check the next two scheduled runs and the status issue.

## Running a sync by hand

- All projects: Actions → Registry sync → Run workflow.
- One project: fill in **Project ID** (for example `one-small-mods-pack`).
- Locally, read-only: `GITHUB_TOKEN=<read token> npm run sync:preview` writes `out/sync/STATUS.md` plus a proposed registry, PR body and observation per changed project. Nothing is written to GitHub.
- ModsPack pilot, read-only: `npm run sync:pilot` (same token) writes `out/pilot/one-small-mods-pack.{md,json}`.
- Readiness for every project, offline: `npm run readiness`. Gate-level readiness, the dashboard and release preparation: `npm run release:reports` ([release-readiness.md](release-readiness.md)).

## Reading a run

The job summary and the status issue start with one **Run result**:

| Result | Meaning | Exit |
| --- | --- | --- |
| `COMPLETE` | Every project collected with no gap | 0 |
| `INCOMPLETE` | Something is still pending (a workflow run in progress, a list over its cap). Nothing positive was concluded for those projects | 0, with a warning |
| `FAILED` | A project could not be collected, or a section of it could not be read at all | 1 |

The **Evidence collected** column says `Complete`, `Incomplete`, `Unavailable: <sections>` or `Not collected` for each project. Errors name the call, the HTTP status and, when GitHub says so, the permission the call needs, for example `permission-denied: ... (GitHub says this call needs pull_requests=read)`.

## Reviewing and merging a sync PR

1. Open the draft `sync(<project>): registry update from <sha>` PR.
2. Read **Registry entries modified**: every line is a fact from GitHub (head moved, PR opened, CI concluded, tag, release, package.json). A history rewrite (force push) is called out with the commits involved.
3. Read **Suggested manual updates** and **Release readiness**. Sync PRs never change gates, blockers, ownership, approval, scope, tier or release status, so readiness is the same before and after the merge.
4. Validate registry must be green on the branch (it re-runs the field-ownership guard).
5. Mark ready and merge. To decline, close it: the same commit is not proposed again; a later change opens a fresh PR.

Manual changes the suggestions point at (verifying a gate, resolving a blocker, recording approval) go in a separate, human-authored PR under [release.md](../standards/release.md).

## Failure recovery

| Symptom | Cause | Fix |
| --- | --- | --- |
| `needs-reader-token` | Private repository, no reader credential | [sync-setup.md step 5](sync-setup.md#5-later-private-projects-one-small-ai-workforce), or set `sync.enabled: false` for the project to silence it |
| `identity-unpinned` | Reader exists but the repository id is not pinned | `npm run onboard -- <id>` with the reader token, merge the hub PR |
| `repo-unreachable` / `not-visible` (404) | Renamed, deleted, made private, or the token cannot see it | Check the repository; update the registry URL by hand if renamed |
| `repo-id-mismatch` | Repository recreated or transferred | Investigate before re-pinning; never re-pin blindly |
| `permission-denied` (403) | Token lacks the named permission | Add exactly that read permission, nothing more |
| `token-rejected` (401) | Reader secret expired or revoked | Rotate `SYNC_READER_TOKEN` |
| `rate-limited`, `github-unavailable`, `network-error` | Transient | None: the next run catches up (level-triggered) |
| `Unavailable: tags` / `package` / `head-comparison` | That call failed after retries | The previous value is kept; the next run retries |
| A sync PR exists but its description is stale, or validation never ran | A run stopped half-way | Nothing: the next run repairs only what is missing |
| `sync/<id>` has a commit not made by sync | Someone pushed to the bot branch | Sync leaves it alone. Close the PR and delete the branch to let sync rebuild it |
| Main integrity red | Something reached main without a merged PR | Set `SYNC_STAGE=A` (or disable Registry sync) first, then review the reported commit |

Three consecutive failures of a project are called out in the status issue.

## Monitoring

- The **Registry sync status** issue (stages B and C) shows the last run, last success per project, consecutive failures, open sync PRs and suggested manual updates.
- GitHub emails the owner when a scheduled workflow fails. A red Registry sync means `FAILED` above; a red Main integrity is always worth reading first.
- Expect about 12 short Actions runs a day at stage C.

## Evidence limits

- Sync observes; it never verifies. Every record it adds is `informational` or `builder_reported`. A gate is satisfied only by a verifier's own `pass` record, and a release only by Joshua Small's approval.
- CI is read for the default-branch head only, from GitHub Actions only. Other CI systems, and checks on PR branches, are not collected.
- Tags: the first 100 only; the latest version tag is chosen from those and flagged when the list was cut off. A tag is never a release.
- Package metadata is the root `package.json` at the head commit (name, version, private). Publication to npm is **not** checked: the hub only calls GitHub. `distribution-verified` and `published-artifact-matches` stay manual.
- Releases: the 20 newest; `currentVersion` moves forward only from a published, non-prerelease release on the default branch.
- Deployments and production URLs are not observed.
- A rewrite of a project's default branch is detected only against the head the registry last recorded.
- A private project is not observed until the reader credential exists.

## Adding a project

1. `npm run onboard -- <id>` for a registry project, or `npm run onboard -- <id> --new --name "<Name>" --repository https://github.com/WasteOfADrumBum/<repo> --tier showcase|library|application --visibility public|private`.
2. Open a hub PR with the `projects/registry.json` change. Joshua Small reviews the tier and identity and merges it.
3. The next run includes it. Nothing is needed in the project repository for `observe` mode.

## Disabling or rolling back

- One project: set its `sync.enabled` to `false` in a hub PR (or `reporting.enabled: false` in its config file, for an integrated project).
- Writes: set `SYNC_STAGE=A`. Everything: disable the Registry sync workflow.
- Undo a proposal: close the `sync/*` PR. Undo a merged one: revert its merge commit (sync PRs touch only automation-owned fields).
- Roll back Phase 2: revert its merge. Schema 1.2.0 only adds optional fields and allows a null id for a private project, so reverting the code needs the registry's `schemaVersion` set back to `1.1.0`, the AI Workforce `sync` block removed, and the three new snapshot fields dropped in the same PR.
