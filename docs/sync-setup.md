# Registry sync setup (owner steps)

No credentials are needed for the pilot: TaskForge and ModsPack are public, and the workflow's own `GITHUB_TOKEN` can read public repositories and write to this one. Nothing below is done by an AI tool.

## 1. Allow Actions to open pull requests

Settings → Actions → General → Workflow permissions:

- Keep **Read repository contents and packages permissions** as the default (every workflow here declares its own permissions).
- Tick **Allow GitHub Actions to create and approve pull requests**. Sync only creates drafts; it never approves (refused in code).

## 2. First run: dry run

Actions → Registry sync → Run workflow, leave **Dry run** ticked. Check the job summary and the new **Registry sync status** issue. A dry run writes nothing else: no branch, no PR, no change to any project repository. (The status issue is the one write a dry run makes; it needs `issues: write`.)

Then Actions → Main integrity → Run workflow. It must finish green with "0 problem(s)"; a red run marked **check incomplete** means the token could not read the activity log (see the table below).

### What each job needs, and what the first runs confirm

| Job | Token | Permissions | Reads or writes | Confirmed by |
| --- | --- | --- | --- | --- |
| Registry sync / collect | `GITHUB_TOKEN` | `contents: read` | Reads public project repos: repo, branch, contents (config file), pulls, PR files, Actions runs, releases, tags, compare | First dry run: each project shows "ok at <sha>" in the log. A `repo-unreachable` or HTTP 403 means the token cannot read it. |
| Registry sync / write | `GITHUB_TOKEN` | `contents: write`, `pull-requests: write`, `issues: write`, `actions: write` | Hub only. Dry run: reads PRs and issues, writes the status issue. Write mode (after step 3): `sync/*` branches, draft PRs, a dispatch of Validate registry | Dry run: the status issue appears. Write mode: a draft PR from `sync/<id>` with a Validate registry run on its head commit. |
| Main integrity | `GITHUB_TOKEN` | `contents: read`, `pull-requests: read` | Hub only: compare, commits, the PRs for a commit, repository activity log | Manual run is green. |
| Validate registry | `GITHUB_TOKEN` | `contents: read` | Hub checkout only | Already running on PRs. |

Limits of `GITHUB_TOKEN` that this design relies on or works around:

- It is scoped to this repository. It can read other repositories only where they are public, so a private project needs the reader credential in step 5.
- Requests count against 1,000 per hour per repository. A sync run uses a few dozen per project.
- Pushes, PRs and issues it makes do not start other workflows (except `workflow_dispatch`), which is why sync dispatches Validate registry and why Main integrity also runs on a schedule.
- It cannot change files under `.github/workflows/` (no `workflows` permission is granted), and it has no admin rights, so it cannot change settings, secrets or protection.

Actions minutes: about 12 short runs a day (sync, integrity, validation), well inside the GitHub Free allowance for private repositories.

## 3. Turn on draft PRs

Settings → Secrets and variables → Actions → Variables → New repository variable: `SYNC_WRITE_ENABLED` = `true`. Scheduled runs (every 6 hours) and manual runs with **Dry run** unticked then open or refresh draft `sync/<project>` PRs. Delete the variable to go back to dry run.

## 4. TaskForge integration (after your go-ahead)

1. `npm run onboard -- taskforge` writes `.github/one-small-engineering.json` and `.github/workflows/one-small-report.yml` to `out/onboard/taskforge/`.
2. A PR in TaskForge adds those two files. You approve and merge it.
3. A hub PR runs `npm run onboard -- taskforge --mode integrated`.

ModsPack stays in observe mode, with no files added, until you say its PR #3 testing is complete.

## 5. Later: private projects (One Small AI Workforce)

The job token cannot read a private repository other than this one. When AI Workforce is onboarded, add one **read-only** credential, after reviewing it:

- Preferred: a GitHub App with Metadata, Contents, Pull requests and Actions set to **Read-only** (nothing else), installed only on the private project repositories, no webhook. Mint its token in the collect job and pass it as `READER_TOKEN` (one step added to `registry-sync.yml`).
- Simpler: a fine-grained personal access token, read-only for those repositories, 90-day expiry, stored as the secret `SYNC_READER_TOKEN` (already wired into the collect job).

Until then a private project reports `needs-reader-token` in the status issue.

## Optional hardening

- GitHub Pro (paid) would let branch protection on `main` be enforced at the token level. Not required, and not assumed: without it the controls in [sync.md](sync.md#security-model-on-github-free) are code restrictions plus detection, not protection.
- If Main integrity ever fails, disable the Registry sync workflow first, then review the reported commit.
