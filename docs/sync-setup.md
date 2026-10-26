# Registry sync setup (owner steps)

No new credentials are needed for the seven public projects: the workflow's own `GITHUB_TOKEN` can read public repositories and write to this one. Only private One Small AI Workforce needs a read-only reader credential (step 5). Nothing below is done by an AI tool. Day-to-day operation: [operations.md](operations.md).

Activation is staged with one repository variable, `SYNC_STAGE` (unset = A): **A** read-only, **B** draft PRs on manual runs, **C** the six-hour schedule with writes. Details and the checks for each stage: [operations.md](operations.md#activation-stages).

## 1. Allow Actions to open pull requests

Settings → Actions → General → Workflow permissions:

- Keep **Read repository contents and packages permissions** as the default (every workflow here declares its own permissions).
- Tick **Allow GitHub Actions to create and approve pull requests**. Sync only creates drafts; it never approves (refused in code).

## 2. Stage A: read-only run

Leave `SYNC_STAGE` unset. Actions → Registry sync → Run workflow. Only the read-only `collect` and `report` jobs run; neither holds a write permission, so nothing is written anywhere. Check the job summary: seven projects observed, `one-small-ai-workforce: needs-reader-token`, and the run marked `FAILED` for that one project until step 5 (a run with a project it cannot see never reports success).

Then Actions → Main integrity → Run workflow. It must finish green with "0 problem(s)"; a red run marked **check incomplete** means the token could not read the activity log (see the table below).

### What each job needs, and what has been verified

Phase 2 re-verified the read side on 2026-10-24 for all eight projects with `contents: read` only ([run 40136925489](https://github.com/WasteOfADrumBum/one-small-engineering/actions/runs/40136925489) at `6e1ce31`, the final code; earlier [run 40136403833](https://github.com/WasteOfADrumBum/one-small-engineering/actions/runs/40136403833); temporary probe since removed): all seven public repositories were collected, including the new tags, root `package.json` and head-comparison calls; the private one was reported `needs-reader-token`; the ModsPack pilot passed 7 of 7 checks. The repository identities were checked in the same run: the registry's names are right, and `one-small-modspack`, `one-small-portfolio` and `cortex-v2` do not exist (HTTP 404).

The read side was first verified on 2026-10-23 with the real `GITHUB_TOKEN` inside GitHub Actions (temporary read-only probe jobs on PR #3, since removed: [run 39956158523](https://github.com/WasteOfADrumBum/one-small-engineering/actions/runs/39956158523/job/120422394988) at `14abd29` with `contents: read`, and [run 39956339593](https://github.com/WasteOfADrumBum/one-small-engineering/actions/runs/39956339593/job/120423000544) at `63a3152` with the read scopes added). With `contents: read` alone the token read every TaskForge and ModsPack call collect makes, and the hub's commits, compare and activity log; the real `run.mjs collect` and a dry run succeeded for both projects. `GET /commits/{sha}/pulls`, the hub's PR and issue lists and Validate registry runs returned 403 with `contents: read` alone and 200 with `pull-requests: read`, `issues: read` and `actions: read` added; the real Main integrity window scan then passed (8 commits accepted, 0 problems). The token reported a limit of 5,000 requests per hour.

Not verified, because it needs a write or a merge: creating `sync/*` branches, draft PRs and the status issue, dispatching Validate registry, the "Allow GitHub Actions to create and approve pull requests" setting, the scheduled trigger itself, and whether a dispatched validation run shows as a check on the sync PR.

| Job | Token | Permissions | Reads or writes | Confirmed by |
| --- | --- | --- | --- | --- |
| Registry sync / collect | `GITHUB_TOKEN` | `contents: read` | Reads public project repos: repo, branch, contents (config file, `package.json`), pulls, PR files, Actions runs, releases, tags, compare | **Verified** in Actions for all seven public projects (see above). |
| Registry sync / report (stage A) | `GITHUB_TOKEN` | `contents: read` | Nothing: plans, guards and validates in the job, writes the job summary | Same code path **verified** in the probe run above. |
| Registry sync / write (stages B, C) | `GITHUB_TOKEN` | `contents: write`, `pull-requests: write`, `issues: write`, `actions: write` | Hub only: the status issue, `sync/*` branches, draft PRs, a dispatch of Validate registry | Read side **verified** (`pull-requests`, `issues` and `actions` read). Writes **unverified** live; tested only against the in-memory GitHub: the status issue, a draft PR from `sync/<id>` with a Validate registry run on its head commit, no duplicate on rerun. |
| Main integrity | `GITHUB_TOKEN` | `contents: read`, `pull-requests: read` | Hub only: compare, commits, the PRs for a commit, repository activity log | **Verified** in Actions: `pull-requests: read` is required (403 without it). |
| Validate registry | `GITHUB_TOKEN` | `contents: read` | Hub checkout only | Already running on PRs. |

Limits of `GITHUB_TOKEN` that this design relies on or works around:

- It is scoped to this repository. It can read other repositories only where they are public, so a private project needs the reader credential in step 5.
- Requests count against the token's hourly limit (5,000 observed in this repository's runs). A sync run uses a few dozen per project.
- Pushes, PRs and issues it makes do not start other workflows (except `workflow_dispatch`), which is why sync dispatches Validate registry and why Main integrity also runs on a schedule.
- It cannot change files under `.github/workflows/` (no `workflows` permission is granted), and it has no admin rights, so it cannot change settings, secrets or protection.

Actions minutes: about 12 short runs a day (sync, integrity, validation), well inside the GitHub Free allowance for private repositories.

## 3. Stage B, then C: draft PRs, then the schedule

Settings → Secrets and variables → Actions → Variables → New repository variable: `SYNC_STAGE` = `B`. Manual runs with **Dry run** unticked then open or refresh one draft `sync/<project>` PR per changed project and update the **Registry sync status** issue; scheduled runs still do nothing. The first write run is a bootstrap: each public project gets one PR recording its visibility, tags, package metadata and config source. Run it a second time and confirm every project says `unchanged`.

When that holds, set `SYNC_STAGE` = `C` to let the six-hour schedule write too. Set it back to `A` (or delete it) at any time to stop all writes. If `SYNC_WRITE_ENABLED=true` was set in Phase 1, delete it: it means stage C.

## 4. TaskForge integration (after your go-ahead)

1. `npm run onboard -- taskforge` writes `.github/one-small-engineering.json` and `.github/workflows/one-small-report.yml` to `out/onboard/taskforge/`.
2. A PR in TaskForge adds those two files. You approve and merge it.
3. A hub PR runs `npm run onboard -- taskforge --mode integrated`.

ModsPack stays in observe mode, with no files added, until you say its PR #3 testing is complete. Observe mode already tracks it fully: head, PRs, CI, tags, releases and `package.json` are read without anything in its repository.

## 5. Later: private projects (One Small AI Workforce)

The job token cannot read a private repository other than this one. When AI Workforce is onboarded, add one **read-only** credential, after reviewing it:

- Preferred: a GitHub App with Metadata, Contents, Pull requests and Actions set to **Read-only** (nothing else), installed only on the private project repositories, no webhook. Mint its token in the collect job and pass it as `READER_TOKEN` (one step added to `registry-sync.yml`).
- Simpler: a fine-grained personal access token, read-only for those repositories, 90-day expiry, stored as the secret `SYNC_READER_TOKEN` (already wired into the collect job).

Until then a private project reports `needs-reader-token` in the status issue. Once the credential exists, pin the repository id with `GITHUB_TOKEN=<reader token> npm run onboard -- one-small-ai-workforce` in a hub PR (its `repositoryId` is `null` until then, and collection refuses with `identity-unpinned`).

## Optional hardening

- GitHub Pro (paid) would let branch protection on `main` be enforced at the token level. Not required, and not assumed: without it the controls in [sync.md](sync.md#security-model-on-github-free) are code restrictions plus detection, not protection.
- If Main integrity ever fails, disable the Registry sync workflow first, then review the reported commit.
