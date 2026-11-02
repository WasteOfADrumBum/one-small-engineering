# One Small Engineering

The single source of truth for the status, release readiness and quality evidence of every One Small software project.

## What it is

- A **project registry** ([`projects/registry.json`](projects/registry.json)) with a versioned, validated schema.
- Shared **standards**: a three-tier [Definition of Done](standards/definition-of-done.md), a [security standard](standards/security.md) and [release governance](standards/release.md).
- **Audit records** ([`audits/`](audits/)) that registry entries cite as evidence.
- A dependency-free **validator** and CI check that keep the registry honest.
- **Registry sync** ([docs/sync.md](docs/sync.md)): a scheduled, deterministic job that reads each project's GitHub state and proposes registry updates as one PR per project. Routine, automation-owned changes are merged by the [Auto-merge](docs/automerge.md) workflow after every safety check passes; anything touching gates, blockers, ownership, scope or approval waits for Joshua Small. Sync never verifies a gate or approves a release.
- A **roadmap** ([ROADMAP.md](ROADMAP.md)) for optional hub enhancements; completed releases move to maintenance and roadmap items never reopen them. The latest owner acceptance record is [docs/acceptance/closeout-2026-11-02.md](docs/acceptance/closeout-2026-11-02.md).

## What it is not

- Not an application, dashboard, API or database. GitHub, JSON, Markdown and a small Node script are the whole system.
- Not a code repository for any project. It contains **no application code and no secrets**; the validator rejects credentials, email addresses and financial numbers.
- Not a replacement for each project's own docs. Projects keep their roadmaps and working notes; release status lives here.

## Projects covered

| Project | Repository | Tier |
| --- | --- | --- |
| One Small ModsPack | [one-small-mods-pack](https://github.com/WasteOfADrumBum/one-small-mods-pack) | Library / Developer Tool |
| OneSmallUI | [one-small-ui](https://github.com/WasteOfADrumBum/one-small-ui) | Library / Developer Tool |
| Personal Portfolio | [joshsmall-site](https://github.com/WasteOfADrumBum/joshsmall-site) | Showcase |
| One Small Studio | [one-small-studio](https://github.com/WasteOfADrumBum/one-small-studio) | Showcase |
| One Small Photography | [one-small-photography](https://github.com/WasteOfADrumBum/one-small-photography) | Showcase |
| TaskForge | [TaskForge](https://github.com/WasteOfADrumBum/TaskForge) | Application |
| Cortex | [cortex-brain-task](https://github.com/WasteOfADrumBum/cortex-brain-task) | Application |
| One Small AI Workforce | [one-small-ai-workforce](https://github.com/WasteOfADrumBum/one-small-ai-workforce) (private) | Application |

Legacy and profile repositories (`one-small-photo`, `README-Generator`, `i18next_translation`, `react-flask-edu`, `WasteOfADrumBum`) are inventoried under `legacyRepositories`. Every other repository found on the account is listed under `otherRepositories` as `unclassified` until evidence supports a classification; none is assumed to be legacy.

## How the registry works

Each project entry records:

- **Identity**: `id`, `name`, `repository`, `tier`, `visibility`, `lifecycle`, and a dated `repositorySnapshot` (default branch, head SHA, archived).
- **Release**: `currentVersion` (what was historically published, with its source) is separate from `targetVersion` and `releaseStatus` (the next release only). Plus `scopeDocument`, an optional `candidate` (the PR and commit proposed for release), `blockers` (optionally classified by `category`, `severity`, `blocks` and `gates`), `nextAction` and `enhancements` (future work that never blocks the current release).
- **Ownership**: `builder` and `verifier` (both `null` until the release is scoped; must be assigned and differ before any gate is verified) and `approvalOwner` (always Joshua Small, the only final release approver).
- **Evidence**: `evidence` records (ID, type, URL, commit SHA, date, result, description) and `releaseGates` that reference them by ID. `lastVerifiedAt` is when the entry was last checked against GitHub.
- **Approval**: Joshua Small's release approval, which needs linked evidence.
- **ModsPack**: installed version, integration status, adapters, capabilities, evidence and limitations.
- **missingEvidence**: what is still needed, in plain words.
- **dependencies** (optional): explicit, evidenced relationships to other registry projects; only `requiredForRelease` ones can block.

No completion percentages are stored (generated reports compute one as a progress indicator). A project is complete for a release when every applicable gate of its tier is verified and the owner has approved ([what 100% means](standards/definition-of-done.md#what-100-means)).

### Rules the validator enforces

Beyond the schema (required fields, enums, UTC timestamps, https URLs, SHAs):

1. Project IDs, evidence IDs and repository URLs are unique (URLs case-insensitively, across all three lists).
2. `gateCatalog` equals the gate tables in `standards/definition-of-done.md` for every tier, in both directions (and the schema's gate list matches them), and each project lists exactly the gates of its tier. A required gate cannot be dropped silently.
3. Every evidence reference resolves to an evidence record in the same project.
4. A `verified` gate has a date, an assigned builder and a different verifier, and at least one `pass` evidence record that is not repository metadata and was recorded by the assigned verifier. `builder_reported` evidence never verifies a gate.
5. A `not_applicable` gate has an explicit rationale (at least 20 characters). A `resolved` blocker links evidence of its resolution (not repository metadata), and `scope-document-missing` cannot be resolved while `scopeDocument` is null.
6. `releaseStatus` `verified` or `released` requires every gate verified or not applicable, no open blockers, a scope document, and a different builder and verifier. `released` also requires approval and `currentVersion` equal to `targetVersion`.
7. Approval can only be given by the approval owner, with evidence, after verification.
8. ModsPack `installed`/`verified` needs a version, adapters and evidence.
9. No credentials, tokens, email addresses, card numbers or long account-like numbers anywhere.
10. Evidence with `origin` `sync` or `builder-report` can only be `informational` or `builder_reported`; `ai-assessment` can only be `informational`, `builder_reported` or `inconclusive`. None of them can verify a gate.
11. Automated evidence has an `eventKey` that is unique within the project and starts with the project ID.
12. Only `origin: sync` records use the recorder name `One Small Engineering Sync` and the `sync-` ID prefix, and that recorder can never be a builder or verifier.
13. Automated evidence links inside the project's own repository and names a commit.
14. A blocker's `gates` belong to the project, and `severity` is only used for `category: security`. A release `candidate` needs a `targetVersion` and is not dated after `lastUpdatedAt`.
15. Dependencies name another registry project once, cite evidence, and release-required dependencies never form a cycle.

## How AI assistants should use it

Claude, ChatGPT, Codex, Copilot, Gemini and any other assistant:

1. Read `projects/registry.json` on the latest `main` before reporting or changing any project's status.
2. Treat the current GitHub revision as truth over chat history, memory or older docs.
3. Propose status changes only through a pull request that links evidence, never by keeping a separate status record.
4. Never record approval or mark a release `released` without Joshua Small's linked approval.
5. Mark relayed results `builder_reported`; only re-run results are `pass`.
6. To assess a project, follow [`agents/project-assessor.md`](agents/project-assessor.md); to onboard one, [`agents/onboard-project.md`](agents/onboard-project.md). Thin adapters exist for Claude (`.claude/skills/`), Codex (`AGENTS.md`), Copilot (`.github/copilot-instructions.md`, `.github/prompts/`) and Gemini (`GEMINI.md`).

Full rules: [Cross-AI governance](standards/release.md#cross-ai-governance).

## Automated sync

All eight active projects have a `sync` block (observe mode: nothing is needed in their repositories) and are read by [Registry sync](.github/workflows/registry-sync.yml): head and history, visibility, open PRs, CI runs with run IDs and attempts, releases, tags and root `package.json`. It updates only the fields in [`sync/field-ownership.json`](sync/field-ownership.json) (repository snapshot, open PRs, its own evidence, and `currentVersion` from a published release) through one PR per project, which [Auto-merge](docs/automerge.md) merges when it passes the field-ownership guard, the validator and CI on its exact head. Gates, blockers, release status, ownership and approval stay manual. Activation is staged by the `SYNC_STAGE` variable: A read-only (default), B draft PRs on manual runs, C every six hours (live since 2026-10-30), plus an hourly read-only [change watch](.github/workflows/watch.yml) that triggers sync when a project head or PR list changes. Each run ends `COMPLETE`, `INCOMPLETE` or `FAILED`, never reporting success with evidence missing. Onboard a project with `npm run onboard -- <project-id>`. Details: [docs/sync.md](docs/sync.md); runbook: [docs/operations.md](docs/operations.md); owner setup: [docs/sync-setup.md](docs/sync-setup.md).

## Release readiness and completion

[`reports/dashboard.md`](reports/dashboard.md) shows every active project's tier, target, readiness, verified gates, blockers, last evidence and next action, generated from the registry by [`scripts/release/`](scripts/release/). Per-project reports list each gate with its evidence provenance, and `reports/releases/<id>/<target>/` holds release preparation drafts (checklists, release notes, changelog). Only independently verified, current evidence counts; a percentage is progress, never approval. How it works: [docs/release-readiness.md](docs/release-readiness.md).

## Automated verification

[`reports/verification/dashboard.md`](reports/verification/dashboard.md) extends the completion dashboard with collector evidence: for every project the evaluated commit, readiness, the six gate states (independently verified, passed by builder, failed, inconclusive, not tested, not applicable), missing verification, stale evidence, blockers by severity, merge and release eligibility, and the next action. Collectors in [`scripts/verify/`](scripts/verify/) gather evidence at exact commits; only a separate verifier's own record, checked against [`verification/policy.json`](verification/policy.json), makes a gate count. How it works: [docs/verification.md](docs/verification.md).

## Engineering orchestrator

[`reports/engineering/dashboard.md`](reports/engineering/dashboard.md) answers "what needs my attention right now?" across all eight projects. [`npm run engineering:check`](docs/engineering.md) runs sync, collection, verification, readiness, dependency analysis and prioritization in one pass (read-only; every six hours in [engineering.yml](.github/workflows/engineering.yml)), and writes one ranked, deduplicated action queue, a dependency impact report and the release state of every project. Candidate fixes are prepared as reviewed-before-use proposals; opening one draft PR needs the owner's explicit, gated authorization. How it works and how to operate it: [docs/engineering.md](docs/engineering.md).

## Updating release status

1. Branch from `main` and edit the project's entry.
2. Add evidence records first (link PRs, commits, workflow runs, artifacts, deployments or committed test records), then update gates, blockers, `releaseStatus` and `lastVerifiedAt`. Update the registry's `lastUpdatedAt`.
3. Run `npm run check`.
4. Open a PR using the template. The verifier reviews; Joshua Small approves anything that changes release acceptance.

## How evidence is verified

The reviewer opens every linked URL and checks that it exists, points at the stated commit, shows the stated result, and applies to the target release. Builder-reported evidence counts as progress, not verification. A chat summary is never evidence on its own. See [definition-of-done.md](standards/definition-of-done.md#how-a-gate-is-satisfied).

## Running validation

Requires Node 20 or newer. No install step: there are no dependencies.

```sh
npm run validate   # check projects/registry.json
npm test           # validator tests, including negative cases
npm run check      # both; this is what CI runs
npm run sync:preview  # read-only: what registry sync would propose right now (needs a GitHub token)
npm run sync:pilot    # read-only ModsPack pilot: seven checks against live GitHub
npm run readiness     # release readiness for every project, from the registry alone
npm run release:reports -- --as-of <UTC time>  # dashboard, per-project readiness and release prep (reports/)
npm run release:check   # are the committed reports current?
npm run engineering:check   # observe all projects: sync, collect, verify, evaluate, prioritize (read-only on GitHub)
npm run engineering:report -- --check   # are the committed engineering reports current? (offline)
npm run engineering:prepare  # candidate fixes as local proposal files; writes nothing to GitHub
```

CI ([`.github/workflows/validate.yml`](.github/workflows/validate.yml)) runs `npm run check` on every pull request and on pushes to `main`, with read-only permissions, plus the field-ownership guard on `sync/*` branches. [Main integrity](.github/workflows/main-integrity.yml) runs on push and every six hours and flags any change to `main` that did not come from a merged PR. These are detection and code-level controls, not branch protection, which GitHub Free does not enforce on this private repository.

## Proposing changes

Open a pull request against `main` and fill in [the template](.github/PULL_REQUEST_TEMPLATE.md). Structural changes to the schema bump `schemaVersion` and update the validator and its tests in the same PR. Changes to tier gates update `standards/definition-of-done.md`, `gateCatalog` and the schema's gate list together; the validator fails if they differ.

## Repository layout

```text
projects/registry.json          canonical project registry
projects/registry.schema.json   schema (version 1.3.0)
standards/                      Definition of Done, security, release governance
audits/                         audit records cited as evidence
scripts/validate-registry.mjs   validator (Node built-ins only)
scripts/validate-registry.test.mjs  validator tests
scripts/readiness.mjs           release readiness and evidence summary (Definition of Done, not CI)
scripts/sync/                   registry sync: collect, plan, guard, write, status, stage, pilot, onboard (+ tests)
scripts/release/                release readiness engine, blockers, dependencies, reports, release preparation (+ tests)
scripts/verify/                 evidence collectors, verification rules, overlay, remediation guard (+ tests)
scripts/engineering/            orchestrator: monitor, dependencies, release states, queue, prepare/execute, reports (+ tests)
engineering/                    orchestrator state (generated) and the tracked remediation PR list (owner-reviewed)
verification/                   verification policy, project profiles, evidence ledgers and run log
reports/                        generated dashboards: readiness (reports/), verification (reports/verification/), engineering (reports/engineering/)
release/                        inputs for release preparation (pinned changelog snapshots)
schemas/                        project config, observation and AI assessment schemas
sync/field-ownership.json       the fields automation may change
templates/project/              files onboarding generates for a project repository
agents/                         shared AI specs: project assessor, onboarding
fixtures/sync/                  in-memory GitHub used by the tests
docs/                           sync, readiness, verification and orchestrator docs; operations runbook; owner setup
.github/                        PR template, workflows, Copilot instructions and prompts
```
