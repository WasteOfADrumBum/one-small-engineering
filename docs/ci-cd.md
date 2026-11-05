# CI/CD standard

How the hub validates its own changes, what it enforces, what it only detects, and how to operate and recover it. Adopted 2026-11-05 ([acceptance record and handoff](acceptance/ci-cd-2026-11-05.md)).

This is about the **hub's own code and registry**. It is not project verification, independent review or release approval; those stay in [verification.md](verification.md) and the registry, and only Joshua Small approves releases.

## The merge gate

[`validate.yml`](../.github/workflows/validate.yml) ("Validate registry") runs on every pull request, every push to `main`, every merge-queue group, and every `sync/*` branch (Registry sync dispatches it, because PRs opened with `GITHUB_TOKEN` do not start `pull_request` workflows). There are no path filters at the trigger, so a documentation-only PR runs the gate too and nothing is left pending.

| Job | What it proves | Typical time |
| --- | --- | --- |
| `changes` | Which conditional jobs a PR needs. Only a `pull_request` with a computed, non-empty diff may narrow the work; every other event and any doubt runs everything ([`changes.mjs`](../scripts/ci/changes.mjs)) | ~10 s |
| `validate` | Registry schema and rules, the full test suite (unit, fixture, adversarial and the local-server integration suite), the field-ownership guard on `sync/*` branches, the release readiness summary. Reports how many tests passed ([`run-check.mjs`](../scripts/ci/run-check.mjs)) | ~30 s |
| `security` | actionlint, zizmor, gitleaks over full history, and the repository policy ([below](#security-validation)). Reports which scanners ran | ~45 s |
| `isolation` | On a real runner, hostile project code cannot read the job token, reach the runner's files, use sudo or docker, or outlive its command ([below](#project-code-isolation)) | ~20 s |
| `ci-gate` | The single result a merge depends on ([`gate.mjs`](../scripts/ci/gate.mjs), policy [`ci/gate-policy.json`](../ci/gate-policy.json)) | ~10 s |

`ci-gate` runs with `if: always()` and fails unless:

- every job in `required` is a dependency of `ci-gate` and no unknown job is (a removed or added dependency is caught at run time);
- each required job ended `success`, or `skipped` where `allowedSkips` permits it: only `isolation`, only on `pull_request`, and only when `changes` succeeded and said `isolation=false`. `failure`, `cancelled` (which includes a timeout or a job that never completed), `neutral`, a missing result, or any value GitHub adds later fail the gate;
- each green job produced its evidence: `validate` passed at least 500 tests with 0 failed, `security` ran all four scanners, `changes` classified the change. A green job that ran nothing fails the gate.

The job summary records the event, evaluated revision (`github.sha`, which is the merge commit for a PR), head and base SHAs, run and attempt, policy and gate versions, each job's verdict, whether project code ran, and that merge protection is not enforced. On failure the decision is uploaded as `ci-gate-<run>-<attempt>` for 7 days.

### Who consumes the check names

| Name | Consumer |
| --- | --- |
| `validate`, `ci-gate` | [`sync/automerge.json`](../sync/automerge.json) `requiredChecks` |
| `.github/workflows/validate.yml` | `requiredCheckSource.workflowPath` in the same policy; Registry sync dispatches it by file name ([`write.mjs`](../scripts/sync/write.mjs)) |
| `Validate registry` (workflow name) | Documentation only (the `workflow_run` trigger that used it was removed) |

Rename a job or the file only together with these consumers and their tests.

### Auto-merge binds results to source, commit and attempt

For a sync PR, [`automerge.mjs`](../scripts/sync/automerge.mjs) accepts a required check only if it was created by GitHub Actions (app id 15368), for the exact PR head, inside a check suite that belongs to a run of `.github/workflows/validate.yml` for that head. It reads every attempt (`filter=all`) and takes the newest check run per name, so an old success cannot mask a newer pending or failed attempt. A same-named check from another app or workflow cannot satisfy a requirement; if it fails or is pending it still blocks. Incomplete pages wait instead of merging. Everything else it already did is unchanged: registry-only scope, field-ownership guard, trusted author, hold label and pause controls, exact-head merge.

### Merge race

Auto-merge re-reads the PR head and **main** immediately before the merge call and sends the head SHA with it. A push to the head after that read fails the merge (GitHub refuses a stale `sha`). A different PR merged into main in the milliseconds between the main re-read and the merge call is not caught by the application; only platform branch protection ("require branches to be up to date") closes that window, and it is unavailable here ([below](#merge-protection-status)). Main integrity reports any commit on main that did not come from a merged PR, and the next push to main reruns the gate on the result.

### Merge queue

`merge_group` is a trigger, so the gate validates the queued combined revision if a merge queue is ever enabled. A merge queue needs rulesets, which this repository's plan does not provide, so it is not enabled today.

## Zero-job runs

Every registry sync cycle shows two failed runs on the sync PR head: "Validate registry" and (until 2026-11-05) "Verify projects", event `pull_request`, actor `github-actions[bot]`, **with no jobs**. Examples: runs 42027759349 and 42027759275 on head `8a811d8` (PR #105). Investigated 2026-11-05 from the API:

- Both runs were created at 12:30:46Z, two seconds after the bot opened PR #105 at 12:30:42Z. Their check suites (113882242261, 113882242493) have `latest_check_runs_count: 0`; the jobs endpoint returns an empty list; there are no logs.
- Both concluded `failure` at 12:31:36Z, one second after PR #105 was merged at 12:31:35Z. The earlier cycles match exactly (runs 41981207153/41981207171 against PR #104, 41943329534/41943329451 against PR #103).
- The same workflow file on the same SHA ran successfully as a `workflow_dispatch` run (42027753125, check run `validate` success), so it is not a syntax or configuration rejection. Other workflows ran normally at the same time, so it is not a billing or minutes block.

Conclusion: GitHub records a `pull_request` run for a PR opened with `GITHUB_TOKEN` but never starts it (the platform's rule that `GITHUB_TOKEN` events do not trigger workflows), and closes it as failed when the PR closes. It is platform behaviour, not a repository defect, and there is no log to recover. What the repository does about it:

- Sync validation comes from the dispatched run, which auto-merge reads by exact head and workflow file.
- Auto-merge waits on **check runs**, never on pending workflow runs, so these never-started runs cannot deadlock it, and they have no check runs, so they cannot satisfy it either (test `zero-job pull_request runs ... neither block nor satisfy the merge`).
- The noise is cosmetic: a red cross on an already-merged sync commit. It would disappear only if sync PRs were opened by a GitHub App or another identity, which needs a new credential; not adopted.

## Security validation

| Scanner | Covers | Pinned |
| --- | --- | --- |
| [actionlint](https://github.com/rhysd/actionlint) 1.7.7 | Workflow syntax, expressions, types, and shellcheck on `run:` scripts (shellcheck is preinstalled on GitHub's Ubuntu runners) | SHA-256 in [`ci/tools.lock`](../ci/tools.lock) |
| [zizmor](https://github.com/zizmorcore/zizmor) 1.31.1, `--offline` | Dangerous triggers, template injection, excessive permissions, credential persistence, unpinned actions | SHA-256 of the wheel |
| [gitleaks](https://github.com/gitleaks/gitleaks) 8.28.0 | Secrets in every commit of every ref, values redacted in the log | SHA-256; config [`.gitleaks.toml`](../.gitleaks.toml) |
| Repository policy ([`workflow-policy.mjs`](../scripts/ci/workflow-policy.mjs)) | Full-SHA pins; workflow- and job-level permissions; a timeout on every job; `persist-credentials: false`; no `${{ }}` inside `run:`; no `pull_request_target` or `workflow_run`; no write permission or secret in a workflow a PR can trigger; project code only after the sandbox setup; no dependencies or install scripts in `package.json`; no `eval`, `new Function`, shell strings or `node:vm` in `scripts/`; GitHub writes only from the four reviewed modules, each behind its own endpoint allowlist | In the repository |

Run them locally: `bash scripts/ci/install-tools.sh /tmp/tools && TOOLS=/tmp/tools bash scripts/ci/security-scan.sh`. `npm run security:policy` runs the repository policy alone.

### What is not used, and why

- **CodeQL / GitHub code scanning:** not enabled (the API answers "Code scanning is not enabled for this repository"). On a private repository it needs GitHub Advanced Security, a paid product. The JavaScript risks that matter here (shell execution, dynamic code, unreviewed write calls) are covered by the repository policy and the tests; a general SAST engine is not.
- **Dependency audit / dependency review:** the hub has no dependencies and no lockfile, so an audit would validate nothing. The policy fails the moment a dependency or install script is added, and that PR must add a lockfile, `npm ci --ignore-scripts` and a dependency review step ([below](#dependencies)).
- **Secret scanning push protection:** a GitHub Advanced Security feature on private repositories; gitleaks in CI is the substitute, and it detects after push rather than preventing it.

### Exceptions

| Exception | Scope | Reason | Owner | Review by |
| --- | --- | --- | --- | --- |
| gitleaks allowlist for `"cacheKey": "<16 hex>"` lines | `verification/evidence/*.json` | The value is the first 16 hex characters of a SHA-256 over collector inputs ([`evidence.mjs`](../scripts/verify/evidence.mjs)), not a credential; seven false positives on 2026-11-05 | Joshua Small | 2027-05-05 |

There are no zizmor or actionlint suppressions.

### Pin updates

Actions are pinned to full commit SHAs with the version in a comment. [`.github/dependabot.yml`](../.github/dependabot.yml) proposes updates weekly; the gate validates each PR and a person merges it. The scanner versions in `ci/tools.lock` are updated by hand: bump the version and checksum from the release's own checksums file, run the scans locally, open a PR.

### Dependencies

Adding a dependency is a deliberate change: add a lockfile, install with `npm ci --ignore-scripts`, add a dependency review step (or `npm audit --audit-level=high` if dependency review is unavailable on the plan) to the `security` job, record it here, and only then relax `checkPackage` in the policy.

## Project-code isolation

Collectors run third-party project code (`npm ci`, builds, tests) when asked to execute. That code is untrusted. An allowlisted environment alone was not a boundary: a child running as the same user can read its parent's environment through `/proc/<pid>/environ` (where `GITHUB_TOKEN` lived in `verify.yml`), and it can leave a process behind that outlives the step and reads the runtime token of a later `upload-artifact` or `cache` step.

So project code now runs as a separate unprivileged user:

1. [`sandbox-setup.sh`](../scripts/ci/sandbox-setup.sh) creates user `osrun` (no sudo, not in the docker group, own home), closes the runner user's home (workspace, temp files, runner configuration) with `chmod 700`, and makes `/tmp/one-small-work` for checkouts.
2. [`exec.mjs`](../scripts/verify/exec.mjs) runs every command as `sudo -n -u osrun -- /usr/bin/env -i <allowlisted vars> ...`; no variable that looks like a credential may cross (the call is refused instead), and git reader credentials are never used in execute mode.
3. After every command it kills every process `osrun` still has and fails the command if one survives.
4. The `isolation` job runs a hostile probe through the same runner and requires that it finds nothing, and runs the same probe **without** the sandbox as a control that must find the canary. The control proves the probe can see a leak, so a pass is not a no-op.

Used by: `engineering.yml` jobs `execute` and `prepare`, and `verify.yml` job `collect`. The policy refuses any job that runs `--execute` without the sandbox setup.

Residual limits: project code still has network access (it needs the registry to install), and it shares the runner's kernel. A job that handles a write token never runs project code: `remediation.yml` re-prepares proposals without executing, and the observe job only reads artifacts.

## Workflows

| Workflow | Triggers | Writes | Notes |
| --- | --- | --- | --- |
| validate.yml | PR, push main, merge_group, dispatch | none | The merge gate. Cancels obsolete runs on the same ref |
| automerge.yml | dispatch (from sync), schedule 3h | merge sync PRs | Runs main's code; never checks out PR code. Serialized, never cancelled |
| registry-sync.yml | schedule 6h (stage C), dispatch | `sync/*` branches, draft PRs, status issue | Write job only on main. Serialized |
| main-integrity.yml | push main, schedule 6h, dispatch | none | Detection, not prevention |
| engineering.yml | schedule 6h, dispatch | none | Observe; execute and prepare are manual and sandboxed. No PR trigger since 2026-11-05 |
| verify.yml | dispatch | none | Manual collection, sandboxed. No PR trigger since 2026-11-05 |
| remediation.yml | dispatch, gated | one draft PR in a project repo | Off unless `REMEDIATION_WRITE_ENABLED=true` |
| events.yml | repository_dispatch | dispatch sync | Sender checked |
| watch.yml | schedule hourly, dispatch | dispatch sync | Credential-free detection |
| state.yml | schedule 6h, dispatch | none | Aggregation |

Every job has explicit permissions and a timeout; every checkout has `persist-credentials: false`; values from events and inputs reach scripts through `env:`; every action is pinned to a full SHA. API retries are bounded (4 attempts, 60-second cap, a long rate-limit reset is not waited for) in [`github.mjs`](../scripts/sync/github.mjs); scanner downloads retry 3 times with a 60-second limit.

Dispatch loops: Registry sync dispatches Auto-merge (not in a manual dry run); Auto-merge dispatches Registry sync only after it merged something, or on its schedule when PRs are stale; event-chained runs never dispatch back, and GitHub does not chain runs started by `GITHUB_TOKEN`. Sync and auto-merge each run one at a time; a queued run waits and is never cancelled, and because both reread live GitHub state, a dropped intermediate run is recovered by the next one or the schedule.

## Merge protection status

**Not enforced.** `GET /repos/.../branches/main/protection` and `GET /repos/.../rulesets` both answer HTTP 403 "Upgrade to GitHub Pro or make this repository public to enable this feature" (checked 2026-11-05). The repository stays private; upgrading is the owner's choice and is not recommended here as the default.

What still holds without it: auto-merge's own checks (above), the gate on every PR, and Main integrity, which reports (after the fact) any commit on main without a merged PR, any force push and any unmerged ref update.

What can bypass the application-level safeguards today:

- Anyone with write access can push directly to main, force-push, delete the branch, or merge a PR whose gate is red or still running. Main integrity reports pushes and force pushes; it does not prevent them, and it does not judge a red-gate merge.
- Any workflow with `contents: write` (automerge, registry-sync) could push to main if its code were changed; that code runs only from main, and its write allowlists are code, not token restrictions.
- The race in [Merge race](#merge-race).

Minimal settings if the plan ever allows it (Settings, Rules, Rulesets, New branch ruleset, target `main`):

1. Restrict deletions; block force pushes.
2. Require a pull request before merging, 0 required approvals (routine PRs do not need a human approval; Joshua Small remains the only release approver through the registry).
3. Require status checks to pass: `ci-gate`, source GitHub Actions; require branches to be up to date.
4. Bypass list: none. Auto-merge merges through the API with `GITHUB_TOKEN` and passes the same checks, so it needs no bypass.
5. Optionally enable the merge queue (the gate already listens to `merge_group`).

## Operations

### Stop writes or pause automation

| To stop | Do |
| --- | --- |
| All auto-merges | Repository variable `AUTOMERGE_PAUSED=true` (runs still report), or disable the "Auto-merge registry sync" workflow |
| One sync PR | Label it `hold` |
| Registry sync writes | Set `SYNC_STAGE` to `A` (or unset): sync becomes read-only and the schedule stops |
| Change-watch dispatches | `SYNC_STAGE` other than `C` |
| Remediation PRs | `REMEDIATION_WRITE_ENABLED` unset (the default) |
| Everything | Settings, Actions, General, disable Actions for the repository |

### Recover

- A sync PR failed the gate: nothing merges; the next sync supersedes it. Re-run the dispatched Validate registry run for transient failures.
- The gate failed on a PR: read the `ci-gate` summary; it names each failing job and why. The `ci-gate-<run>-<attempt>` artifact keeps the decision.
- A scanner download failed: rerun the job (downloads retry three times). A checksum mismatch is a security signal: do not change the checksum without reading the upstream release.
- Main changed without a PR: Main integrity fails with the commit; see [operations.md](operations.md).
- State corruption in the engineering cache: run the orchestrator by hand from main; a fresh run rebuilds state from live GitHub.

### Verify a merged change

A merge made by auto-merge (`GITHUB_TOKEN`) does not trigger push workflows. To validate the merged revision on main, dispatch Validate registry on `main` (Actions, Validate registry, Run workflow) and confirm the run's `head_sha` equals the merge commit. Dispatch Main integrity to check the window.

### Revert this standard

Revert the merge commit of the PR that introduced it (`git revert -m 1 <merge>` or GitHub's Revert button). That restores the previous `validate.yml`, re-adds the PR triggers of `verify.yml` and `engineering.yml` and the `workflow_run` trigger, and returns `sync/automerge.json` to `requiredChecks: ["validate"]` with no source binding. The policy and `automerge.mjs` are compatible in either order: the old code ignores `requiredCheckSource`, and the new code with the old policy requires only `validate` from any source (the earlier behaviour).
