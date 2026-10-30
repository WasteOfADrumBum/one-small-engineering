# Automated verification

Phase 4 turns the [release-readiness engine](release-readiness.md) into a verification pipeline: collectors gather reproducible evidence from each project at an exact commit, a separate verifier examines it and records their own verification, and readiness is recalculated from what was independently verified. Code: [`scripts/verify/`](../scripts/verify/). Node built-ins only; no AI calls.

The rule that everything here enforces: **collector evidence is never verification**. A gate counts only when a verifier named in the registry, who is not the builder or the builder's AI tool, examined current evidence for the evaluated commit and recorded it. Readiness is still progress, not authorization; only Joshua Small approves a release.

## Commands

```text
npm run verify:run -- --execute                      # all eight projects: collect, update ledgers, regenerate reports
npm run verify:run -- --project one-small-mods-pack  # one project (read-only checks only, no project code)
npm run verify:report -- --as-of 2026-10-27T02:00:00Z  # regenerate reports/verification/ from committed files (offline)
npm run verify:check                                 # are the committed verification reports current?
npm run verify:freshness [-- --strict]               # missing or stale evidence for the evaluated commits
npm run verify:record -- ...                         # a verifier records their own verification (refused in CI)
npm run verify:remediate -- --plan <file> --repository <url> [--confirm]
```

Options for `run`: `--collector <name>` (repeatable), `--execute` (run project install, build and test commands), `--no-network`, `--full` (ignore the cache), `--work <dir>`, `--invoked-by <text>` (who ran a local collection; recorded in provenance). Exit codes: 0 done, 1 invalid input, stale reports or a refused action, 2 usage error.

## Files

| Path | Owner | What |
| --- | --- | --- |
| [`verification/policy.json`](../verification/policy.json) | Owner (reviewed PR) | Which collectors speak for which gate, how automatable each gate is, human-only gates, AI verifier permissions, tool families, freshness windows, remediation limits |
| [`verification/projects.json`](../verification/projects.json) | Reviewed PR | Per-project build and test profile, mirroring the project's own CI. Steps that cannot run here are listed with the reason and never count as passes |
| `verification/evidence/<id>.json` | Automation | Evidence ledger: digested collector records, newest first, at most six per collector |
| `verification/verifications/<id>.json` | Verifier (reviewed PR) | Independent verification records |
| `verification/runs/latest.json` | Automation | The last collection run per project: evaluated commit, access, collectors run or reused |
| `reports/verification/` | Generated | `dashboard.md`/`.json`, `projects/<id>.md`/`.json`, `remediation/<id>.md` issue reports |

The registry (`projects/registry.json`) is never written. Gate status, ownership, blockers, approval and release status change only through owner-reviewed registry PRs, as before.

## Evidence

Each collector record carries: project and gates, repository and exact commit SHA, collector name and version, execution time, result, checks, artifact references (sha256 of listings and reports), a reproduction command, provenance (collector identity `One Small Engineering Verify`, executor `github-actions` with the run URL or `local` with who invoked it, Node and npm versions), an expiry, a failure reason for anything not passing, and a sha256 digest of the whole record. Editing a record after collection breaks the digest and the record is rejected. A verification pins the digest it examined, so later edits cannot change what was verified.

Results: `pass`, `fail`, `inconclusive` (could not decide, or something was not run), `unavailable` (could not reach the repository, API or service) and `not_applicable`. Unreachable is never read as absent, and absent is never read as passing.

Evidence is stale when it is for a different commit than the one evaluated, or past its expiry (30 days; 7 for CI results and dependency audits; 1 for deployment health).

### Collectors

| Collector | Gates it speaks for | Runs project code | Notes |
| --- | --- | --- | --- |
| `repo-structure` | none (context) | no | package.json, lockfile, README, license, workflows |
| `build-test` | automated-checks, critical-workflows, e2e-critical-workflows | yes | `npm ci --ignore-scripts`, then the profile's build and test commands. Pinned tools (ModsPack's Claude Code harness) are installed per run |
| `lint-format-types` | automated-checks | yes | lint, format check and type check scripts |
| `ci-results` | automated-checks only | no | GitHub check runs on the exact commit. A green run says nothing about any other gate |
| `dependency-audit` | supply-chain-review, security-privacy-review | no | `npm audit --package-lock-only`; critical or high advisories fail |
| `secret-scan` | security-privacy-review, sensitive-data-handling | no | High-confidence credential patterns and committed `.env` files. Reports file, line and kind, never the value. Matches in tests and docs need human review |
| `accessibility` | wcag-22-aa | yes, if configured | Automated tooling and commands; manual review is always listed as not run |
| `deployment-health` | production-deployment, deployment-rollback | no | The registry's productionUrl must answer; the deployed revision still needs the verifier |
| `documentation` | documentation-accurate, public-docs-accurate, upgrade-rollback-uninstall-docs | no | README, install/usage section, relative links, CHANGELOG and upgrade/rollback/uninstall docs for libraries. Accuracy is manual |
| `release-packaging` | package-metadata-exports, package-archive-inspection, versioning-changelog, clean-consumer-install, ci-release-pipeline | yes (pack) | Name, version, license, entry points, files, engines, registry target, CHANGELOG top entry, publish workflow, `npm pack --dry-run` contents |
| `compatibility` | runtime-compatibility | no | engines floor tested in CI; declared cross-project dependencies |

## Independent verification

`judgeVerification` in [`verification.mjs`](../scripts/verify/verification.mjs) decides whether a record counts. All of these must hold, and every failing rule is reported:

- The registry names a builder and a verifier, and they are different parties. The record's verifier is the registry's verifier.
- The verifier is not the builder, not the same AI tool family as the builder (a second Claude session does not verify Claude's work), and not automation.
- An AI verifier counts only when `policy.json` `aiVerifiers.allowed` lists that project, tool and identity, its tool family is recognisable, and the method is not a manual test. The list is empty: no AI tool may verify today.
- Human-only gates (`no-release-blockers`, `scope-complete`, `keyboard-screen-reader`) need a person.
- A pass on a gate that is only partly automatable, or not automatable, needs method `manual-test`: automated evidence alone cannot pass it.
- The record is for the evaluated commit; every cited evidence record exists, is untampered, matches the digest the verifier examined, is for the same commit, speaks for the gate and was current when examined. A pass needs passing evidence from every collector the policy requires for that gate.
- The record has a github.com attestation URL (the verifier's review, comment or commit) and notes on what was examined.

Valid records are applied to an in-memory copy of the registry, which must still pass `npm run validate`, and the Phase 3 engine recalculates readiness from it. If the copy would be invalid, nothing is applied. `verify:record` refuses to run in CI and refuses any record that would not count, so a verifier sees the reasons before opening the PR.

The three-tier Definition of Done is unchanged: the gate list per tier still comes only from [standards/definition-of-done.md](../standards/definition-of-done.md).

## Recording a verification

Only the verifier named in the registry does this (today Joshua Small for every project). An AI tool may prepare the checklist and the command; it never runs the review, never chooses the result and never records itself.

1. Find the gate and the evaluated commit in `reports/verification/projects/<id>.md`, and the evidence ids for that commit in `verification/evidence/<id>.json`. The gate list comes from the project's tier: a showcase project has, for example, `documentation-accurate` and `security-privacy-review`, not `sensitive-data-handling`.
2. Do the check yourself against that exact commit.
3. Leave a public trace on github.com: a PR review, an issue comment or a commit saying what you checked and the result. Its URL is the attestation.
4. Outside CI, run:

   ```sh
   npm run verify:record -- --project <id> --gate <gate> --verifier "Joshua Small" --kind human \
     --method manual-test|reviewed-artifacts|re-executed --result pass|fail \
     --evidence <evidence id> [--evidence <id>...] \
     --attestation <github.com URL> --notes "<what you examined, at least 20 characters>"
   ```

   A pass on a partly or non-automatable gate needs `--method manual-test`. The command refuses any record that would not count and prints every failing rule.
5. Run `npm run check` and regenerate reports (`npm run release:reports`, `npm run verify:report -- --as-of <time>`).
6. Open a hub PR with `verification/verifications/<id>.json` and the reports. Only after it merges does readiness count the gate.

## Orchestrator

For each selected project the orchestrator chooses the commit to evaluate (the registry's release candidate when one is recorded, otherwise the live default-branch head, otherwise the snapshot head; drift between them is reported), works out the applicable gates from the tier, plans the collectors those gates need, reuses current records with the same cache key (project, commit, collector version, policy and profile hash, execution mode), retries anything unavailable, runs the rest, records the results, routes ready evidence to the registry's verifier (verification requests in each project report), recalculates readiness and lists blockers and the next action.

## Gate states on the dashboard

| State | Meaning |
| --- | --- |
| Independently verified | Counted. A valid verification exists for the evaluated commit |
| Passed by builder (not independent) | Builder pass records, or every required collector passed. Not counted |
| Failed | A collector or a verifier recorded a failure on the evaluated commit |
| Inconclusive | Evidence unavailable, undecided or stale |
| Not tested | No evidence for the evaluated commit |
| Not applicable | Registry rationale recorded |

## GitHub Actions

[`verify.yml`](../.github/workflows/verify.yml): manual and pull requests that touch verification code, policy or the registry. Top-level `permissions: {}`; jobs get `contents: read` (plus `checks: read` and `actions: read` for the CI-results collector). No secrets, no write permission, no `pull_request_target`, credentials not persisted. Project commands run through [`exec.mjs`](../scripts/verify/exec.mjs) with an allowlisted environment, so `GITHUB_TOKEN` and the Actions runtime tokens never reach project code. Scheduled collection moved to the engineering orchestrator ([engineering.md](engineering.md)), which runs every six hours, incrementally, and never executes project code on a schedule. Evidence, run log and reports are uploaded as an artifact for 30 days, and the job summary lists every collector result. Committing new evidence to the repository is a person's PR.

## Remediation

Every collector result that is not a pass becomes an issue report in `reports/verification/remediation/<id>.md` with project, repository, commit, gates, severity, release impact, reproduction, root cause (when established), proposed fix, acceptance criteria and the verification required.

A draft remediation PR is only for a confirmed defect with a clear fix, one PR per repository. A plan file (`verification/remediation/<name>.json`) is reviewed first; [`remediation.yml`](../.github/workflows/remediation.yml) then runs only by hand, from main, with `REMEDIATION_WRITE_ENABLED=true`, the exact confirmation text and a fine-grained `REMEDIATION_TOKEN` scoped to the target repository. [`remediation.mjs`](../scripts/verify/remediation.mjs) refuses, whatever the plan says: merges, review approvals, deletions, settings, releases, contents API writes, existing branches (never updated or force-pushed), branches outside `verify/remediation/`, protected refs (`main`, `master`, ModsPack's `modspack-2-0`), workflow files, unsafe paths, more than 20 files, non-defects, findings for another commit or repository, and PR bodies that claim approval. Scheduled runs never write.

## Limits

- Access: a private repository (One Small AI Workforce) is read through the read-only `SYNC_READER_TOKEN`; without it every collector reports `unavailable`. An `unavailable` record speaks only for the commit it was recorded at: one left at an older commit (for example by the execute job, which holds no reader) does not hide evidence at the current commit, while one at the current commit stays visible until a run reads the repository. The CI-results collector needs a working GitHub API token; a local session behind a proxy reports it unavailable.
- Collector evidence is integrity-protected, not signed: the digest proves it was not edited, and provenance plus the run URL make it reproducible, but authorship rests on the reviewed PR that commits it. Prefer evidence from the workflow run.
- Profiles mirror each project's CI as read at the cited commit. When a project's CI changes, update its profile in a reviewed PR.
