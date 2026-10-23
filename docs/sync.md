# Registry sync

Registry sync keeps `projects/registry.json` current without routine manual edits. It is deterministic: no AI calls, no project code, only read-only GitHub API calls and draft PRs that Joshua Small reviews and merges.

## How it works

```text
Registry sync (schedule every 6 h, or Run workflow)
  collect   read-only token     for each project with sync.enabled:
                                  verify owner + pinned repository id + name
                                  read config file, default-branch head, open PRs,
                                  recent merges, completed CI runs, releases
                                  → observation (schemas/observation.schema.json)
  write     main only           plan (pure) → field-ownership guard → full validator
                                  dry run: report only
                                  write:   sync/<project-id> branch + one draft PR,
                                           dispatch Validate registry on it
                                  update the "Registry sync status" issue
Validate registry               npm run check + guard on every sync/* branch
Main integrity (push + every 6 h) flags any change to main that is not a merged PR
You                             review, mark ready, merge (or close)
```

- **Hub pull.** The hub reads each project. Project repositories hold no secrets and cannot write to the hub.
- **Level-triggered.** Every run reconciles the current state with a 14-day look-back. A missed run, an outage or a duplicate trigger changes nothing; the next run catches up.
- **Idempotent.** Evidence IDs and `eventKey`s are derived from the facts. A CI record's identity is workflow, commit, run ID (base 36) and attempt, for example `sync-taskforge-run-ci-yml-11975d0-hg2yxnr-2` / `taskforge:workflow_run:ci.yml/11975d0/hg2yxnr/2`, so a re-run on the same commit (success then failure, or the reverse) is a new record that supersedes the old one. Superseded records are removed only if nothing cites them; a cited one stays and the PR says it is no longer current. The same GitHub state always gives the same registry, so a re-run pushes nothing.
- **One PR per project.** `sync/<project-id>` is rebuilt from the latest `main` each time, so a PR that conflicts after another merges is regenerated on the next run.
- **Self-repairing writes.** The writer reconciles three things separately on every run: the branch content, the existence of an open draft PR, and a Validate registry run for the branch head. If a run pushed the branch but failed to open the PR or dispatch validation, the next run sees the branch is right and creates only what is missing. A PR you close without merging is not reopened for the same commit; a later change opens a new one.

## What automation may change

Defined in [`sync/field-ownership.json`](../sync/field-ownership.json) and enforced twice (in the sync job and in CI):

| Field | Rule |
| --- | --- |
| `repositorySnapshot`, `openPullRequests` | Replaced from GitHub. `observedAt` is when the facts last changed. |
| `evidence` with `origin: "sync"` | Added; superseded CI records are removed only if nothing cites them. Results are only `informational` or `builder_reported`. |
| `release.currentVersion` / `currentVersionSource` | Forward only, from a published non-prerelease GitHub release whose tag matches the pattern and whose commit is on the default branch. |
| `sync.lastSyncedAt` / `lastSyncedHead` / `configSource` | When the registry last absorbed a sync. |
| top-level `lastUpdatedAt` | Set when a change is proposed. |

Everything else is manual: gates, blockers, release status, target version, scope, ownership, approval, tier, lifecycle, ModsPack integration, missing evidence, manual evidence, other projects. When the facts suggest a manual change, it appears under **Suggested manual updates** in the PR and the status issue, and stays a suggestion.

### What counts as material

A PR is opened only when one of these differs from `main`: the default-branch head, the open PR list (opened, closed, merged, draft toggled, head moved), a CI conclusion on the head, a new release, a merged PR carrying the evidence label or touching `materialPaths`, or the config source. Sync timestamps alone never open a PR.

## Builder-reported versus verified

| Source | Recorded as | Can verify a gate? |
| --- | --- | --- |
| Sync observations (CI runs, merges, releases) | `origin: sync`, `informational` or `builder_reported` | **Never** (validator rule 10) |
| Builder reports (reserved for a later phase) | `origin: builder-report`, same results | Never |
| AI assessments | `origin: ai-assessment`, `builder_reported` / `inconclusive` / `informational` | Never |
| The verifier's own re-check | manual record, `pass` / `fail` | Yes, under the existing rules |

## Project configuration

Optional file `.github/one-small-engineering.json` in the project repository ([schema](../schemas/project-config.schema.json)). The minimal form is enough:

```json
{ "configVersion": 1, "projectId": "taskforge" }
```

It confirms the mapping; it cannot choose it. The registry decides which repository is which project, and a mismatching `projectId` fails closed. Optional `reporting` keys: `enabled` (false pauses sync), `workflows`, `includeDraftPullRequests`, `releaseTagPattern`, `evidenceLabel` (default `release-evidence`), `materialPaths`, `lookbackDays`.

Modes, set in the registry's `sync` block:

- `observe`: the hub reads the repository and expects nothing in it (hub defaults apply). ModsPack stays here until its PR #3 testing is complete.
- `integrated`: the config file is required; a missing file is an error.

## Status report

Every run writes the same Markdown to the job summary and to the single open issue titled **Registry sync status**: last run, per-project result, last successful sync, consecutive failures, detected changes, errors, outstanding registry PRs, and suggested manual updates. History is kept in a hidden comment in that issue. Three consecutive failures for a project are called out. Locally: `npm run sync:preview` (read-only) writes it to `out/sync/STATUS.md`.

## Onboarding

One command, or the shared prompt [`agents/onboard-project.md`](../agents/onboard-project.md) in any AI tool:

```sh
npm run onboard -- cortex                       # existing registry project
npm run onboard -- my-site --new --name "My Site" \
  --repository https://github.com/WasteOfADrumBum/my-site --tier showcase --visibility public
```

It pins the repository ID, enables sync in `observe` mode, validates the registry, and writes the two project files to `out/onboard/<id>/`. Nothing is registered twice: the registry entry is the allowlist, and the project file only repeats the ID.

## Pausing and rollback

- Pause one project: `"reporting": { "enabled": false }` in its config, or `sync.enabled: false` in the registry.
- Pause everything: unset `SYNC_WRITE_ENABLED` (back to dry run) or disable the Registry sync workflow.
- Undo: close `sync/*` PRs. Schema 1.1.0 is additive, so reverting the code leaves a valid registry.

## Adding event-driven sync later

All triggers already end in `node scripts/sync/run.mjs collect|write [--project <id>]`. A future trigger (for example `repository_dispatch` from a project, or a GitHub App webhook) only has to pass a project ID; it carries no trusted data, because the run re-reads GitHub itself. The observation schema, planner, guard and writer stay unchanged. Adding it means one new trigger in `registry-sync.yml`, its credential review, and a test; nothing else is rebuilt.

## Security model on GitHub Free

Branch protection and rulesets are not enforced on this private repository, so nothing at the GitHub level stops a token with `contents: write` from pushing to `main`. The controls are:

**These are code restrictions and detection, not token-level branch protection.** The job token itself can push to `main`; what stops it is the code below, which you merged and can review, and what catches a failure of that code is Main integrity.

1. The write token is the job's own `GITHUB_TOKEN`: it exists only while the job runs, reaches only this repository, and cannot change workflow files.
2. The write job runs only from `main` (code you merged), only on schedule or manual dispatch, never on a PR.
3. `restrictWrites` in `scripts/sync/write.mjs` refuses every API write not on its allowlist: refs only under `refs/heads/sync/<slug>`, no merges, no contents API, no deletes, no reviews, PRs only as drafts into `main`, trees with exactly one path (`projects/registry.json`). Tested in `write.test.mjs`.
4. Before any write, the proposal must pass the field-ownership guard and the full validator.
5. `Validate registry` re-runs the guard on every sync branch.
6. `Main integrity` fails loudly if anything reaches `main` without a merged PR. A push made with `GITHUB_TOKEN` does not trigger push workflows, so it also runs on its own schedule (every 6 hours, offset from sync) and checks **every commit** on `main` in the last seven days plus every update of `main` in GitHub's repository activity log, which records `GITHUB_TOKEN` pushes and force pushes. On a push it checks every commit between the old and new head, not just the head. Legitimate exceptions (the repository's initial commit) are listed with a reason in `sync/main-integrity-acknowledged.json`.

A scan that cannot see everything fails as **incomplete** instead of passing: when the activity log cannot be read, when it returns a full page (100 updates in a week), or when the window holds more than 1,000 commits. A green run therefore means every commit and every update of `main` in the window was checked.

Limits of detection: it reports after the fact and never reverts or blocks anything; a change older than seven days is outside the window if both the push run and every scheduled run in that time were missed; and the commit list is selected by commit date, so a backdated direct commit is caught through the activity log rather than the commit list.

Merging stays a manual act. On GitHub Free a required review cannot be enforced for this private repository either, so the rule "only Joshua Small merges registry PRs" is procedural, and every sync PR is opened as a draft.
