# One Small Engineering

The single source of truth for the status, release readiness and quality evidence of every One Small software project.

## What it is

- A **project registry** ([`projects/registry.json`](projects/registry.json)) with a versioned, validated schema.
- Shared **standards**: a three-tier [Definition of Done](standards/definition-of-done.md), a [security standard](standards/security.md) and [release governance](standards/release.md).
- **Audit records** ([`audits/`](audits/)) that registry entries cite as evidence.
- A dependency-free **validator** and CI check that keep the registry honest.

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
- **Release**: `currentVersion` (what was historically published, with its source) is separate from `targetVersion` and `releaseStatus` (the next release only). Plus `scopeDocument`, `blockers`, `nextAction` and `enhancements` (future work that never blocks the current release).
- **Ownership**: `builder` and `verifier` (both `null` until the release is scoped; must be assigned and differ before any gate is verified) and `approvalOwner` (always Joshua Small, the only final release approver).
- **Evidence**: `evidence` records (ID, type, URL, commit SHA, date, result, description) and `releaseGates` that reference them by ID. `lastVerifiedAt` is when the entry was last checked against GitHub.
- **Approval**: Joshua Small's release approval, which needs linked evidence.
- **ModsPack**: installed version, integration status, adapters, capabilities, evidence and limitations.
- **missingEvidence**: what is still needed, in plain words.

No completion percentages are stored. A project is complete for a release when every applicable gate of its tier is verified and the owner has approved ([what 100% means](standards/definition-of-done.md#what-100-means)).

### Rules the validator enforces

Beyond the schema (required fields, enums, UTC timestamps, https URLs, SHAs):

1. Project IDs, evidence IDs and repository URLs are unique (URLs case-insensitively, across all three lists).
2. Each project lists exactly the gates of its tier from `gateCatalog`.
3. Every evidence reference resolves to an evidence record in the same project.
4. A `verified` gate has a date, an assigned builder and a different verifier, and at least one `pass` evidence record that is not repository metadata and was recorded by someone other than the builder. `builder_reported` evidence never verifies a gate.
5. A `not_applicable` gate has an explicit rationale (at least 20 characters).
6. `releaseStatus` `verified` or `released` requires every gate verified or not applicable, no open blockers, a scope document, and a different builder and verifier. `released` also requires approval and `currentVersion` equal to `targetVersion`.
7. Approval can only be given by the approval owner, with evidence, after verification.
8. ModsPack `installed`/`verified` needs a version, adapters and evidence.
9. No credentials, tokens, email addresses, card numbers or long account-like numbers anywhere.

## How AI assistants should use it

Claude, ChatGPT, Codex, Copilot, Gemini and any other assistant:

1. Read `projects/registry.json` on the latest `main` before reporting or changing any project's status.
2. Treat the current GitHub revision as truth over chat history, memory or older docs.
3. Propose status changes only through a pull request that links evidence, never by keeping a separate status record.
4. Never record approval or mark a release `released` without Joshua Small's linked approval.
5. Mark relayed results `builder_reported`; only re-run results are `pass`.

Full rules: [Cross-AI governance](standards/release.md#cross-ai-governance).

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
```

CI ([`.github/workflows/validate.yml`](.github/workflows/validate.yml)) runs `npm run check` on every pull request and on pushes to `main`, with read-only permissions.

## Proposing changes

Open a pull request against `main` and fill in [the template](.github/PULL_REQUEST_TEMPLATE.md). Structural changes to the schema bump `schemaVersion` and update the validator and its tests in the same PR. Changes to tier gates update both `gateCatalog` and `standards/definition-of-done.md` (a test checks they match).

## Repository layout

```text
projects/registry.json          canonical project registry
projects/registry.schema.json   schema (version 1.0.0)
standards/                      Definition of Done, security, release governance
audits/                         audit records cited as evidence
scripts/validate-registry.mjs   validator (Node built-ins only)
scripts/validate-registry.test.mjs  validator tests
.github/                        PR template and CI workflow
```
