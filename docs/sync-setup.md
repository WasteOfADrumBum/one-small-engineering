# Registry sync setup (owner steps)

No credentials are needed for the pilot: TaskForge and ModsPack are public, and the workflow's own `GITHUB_TOKEN` can read public repositories and write to this one. Nothing below is done by an AI tool.

## 1. Allow Actions to open pull requests

Settings → Actions → General → Workflow permissions:

- Keep **Read repository contents and packages permissions** as the default (every workflow here declares its own permissions).
- Tick **Allow GitHub Actions to create and approve pull requests**. Sync only creates drafts; it never approves (refused in code).

## 2. First run: dry run

Actions → Registry sync → Run workflow, leave **Dry run** ticked. Check the job summary and the new **Registry sync status** issue. Nothing else is written.

## 3. Turn on draft PRs

Settings → Secrets and variables → Actions → Variables → New repository variable: `SYNC_WRITE_ENABLED` = `true`. Scheduled runs (every 6 hours) and manual runs with **Dry run** unticked then open or refresh draft `sync/<project>` PRs. Delete the variable to go back to dry run.

## 4. TaskForge integration (after your go-ahead)

1. `npm run onboard -- taskforge` writes `.github/one-small-engineering.json` and `.github/workflows/one-small-report.yml` to `out/onboard/taskforge/`.
2. A PR in TaskForge adds those two files. You approve and merge it.
3. A hub PR runs `npm run onboard -- taskforge --mode integrated`.

ModsPack stays in observe mode, with no files added, until you say its PR #3 testing is complete.

## 5. Later: private projects (One Small AI Workforce)

The job token cannot read a private repository other than this one. When AI Workforce is onboarded, add one **read-only** credential, after reviewing it:

- Preferred: a GitHub App with Metadata, Contents, Pull requests, Actions and Checks set to **Read-only**, installed only on the private project repositories, no webhook. Mint its token in the collect job and pass it as `READER_TOKEN` (one step added to `registry-sync.yml`).
- Simpler: a fine-grained personal access token, read-only for those repositories, 90-day expiry, stored as the secret `SYNC_READER_TOKEN` (already wired into the collect job).

Until then a private project reports `needs-reader-token` in the status issue.

## Optional hardening

- GitHub Pro (paid) would let branch protection on `main` be enforced at the token level. Not required, and not assumed: without it the controls in [sync.md](sync.md#security-model-on-github-free) are code restrictions plus detection, not protection.
- If Main integrity ever fails, disable the Registry sync workflow first, then review the reported commit.
