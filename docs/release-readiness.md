# Release readiness and completion

How the hub decides whether a project can be released, what is left to do, and how to prepare a release for Joshua Small's decision. Everything here is computed from [`projects/registry.json`](../projects/registry.json); the gates themselves are defined only in [standards/definition-of-done.md](../standards/definition-of-done.md).

Code: [`scripts/release/`](../scripts/release/). It is deterministic, offline and read-only: no network, no AI calls, and it never writes the registry, GitHub or any project repository.

## Commands

```text
npm run release:reports  -- --as-of 2026-10-26T02:00:00Z   # dashboard, all project reports, release prep for scoped releases
npm run release:check                                       # are the committed reports current for the registry?
npm run release:assess   -- --project one-small-mods-pack  # print one project's report (add --json for JSON)
npm run release:dashboard                                   # reports/dashboard.md and .json only
npm run release:prepare  -- --project one-small-mods-pack  # reports/releases/<id>/<target>/ only
```

Options: `--as-of <UTC time>` (default now; it fixes the report time so output is reproducible), `--stale-days <n>` (default 30), `--out <dir>` (default `reports`). The registry must pass `npm run validate` first; an invalid registry produces no report. Exit codes: 0 done, 1 invalid input or out-of-date reports, 2 usage error.

Outputs (commit them with the registry change that produced them):

| Path | What |
| --- | --- |
| [`reports/dashboard.md`](../reports/dashboard.md), `.json` | One row per active project: tier, target, readiness, verified/applicable gates, blockers, last evidence, next action |
| `reports/projects/<id>.md`, `.json` | Every gate with state, provenance, evidence, missing requirements, blockers and next action |
| `reports/releases/<id>/<target>/` | `release-prep.md`/`.json`, `checklist.md`, `release-notes.draft.md`, `CHANGELOG.draft.md` |

Every report states its as-of time and the sha256 of the registry it was computed from, and labels content as **Fact** (a registry record citing evidence), **Derived** (calculated here) or **Unverified** (builder-reported). Output passes through the same redaction as the validator.

## How a gate's state is decided

The gates of a project are exactly its tier's `gateCatalog` entry. For each gate:

| State | When |
| --- | --- |
| Verified | Registry status `verified` **and** independent pass evidence that is current (below) **and** the release candidate has not moved |
| In progress | Registry status `in_progress` with at least one current evidence record |
| Not started | Registry status `not_verified` |
| Blocked | Registry status `blocked` |
| Not applicable | Registry status `not_applicable` with a written rationale (20+ characters). Without one the gate stays applicable |
| Unknown or stale | Marked verified without current independent proof; all of an in-progress gate's evidence is stale; not applicable without a rationale; or the gate is missing from the entry |

### Which evidence counts as verified

Only **independent** evidence verifies a gate. A record is independent when all of these hold:

- `result` is `pass`, its origin is manual, and its type is not `repository_metadata`;
- `ownership.builder` and `ownership.verifier` are both named, different, and neither is automation;
- it was recorded by someone other than the builder or the builder's AI tool family (`toolFamilies` in `verification/policy.json`).

Every other record is still shown, with its class: *pass without an independent verifier* (for example the Phase 0 baseline records), *builder-reported*, *observation* (informational, sync, AI assessment, metadata) or *failed*. A passing CI run, an open PR or a deployment is evidence of one thing; it never verifies a gate by itself.

**Current** means the record is no older than the staleness window, is not dated after the report, and, when `release.candidate` is recorded, is for the candidate's commit (records without a commit are judged by age only). If the candidate's pull request has moved past `release.candidate.headSha`, every commit-pinned record is stale until a person records the new candidate.

## How readiness is calculated

- **Applicable gates** = tier gates minus justified `not_applicable` ones.
- **Readiness %** = verified ÷ applicable, rounded *down* to one decimal (2 of 3 is 66.6%, never 66.7%). With no applicable gates it is `n/a`.
- **Pre-publication gates**: everything except `production-deployment`, `distribution-verified`, `published-artifact-matches` and `release-provenance`, which can only be shown after publication or deployment ([release.md](../standards/release.md#the-release-process) steps 9 and 10).
- **Missing independent verification** lists gates where work exists (builder-reported or pre-verifier pass) but nobody independent has re-checked it.

### Why a percentage is not approval

The percentage is progress. Eligibility is separate and strict:

| Eligibility | Meaning |
| --- | --- |
| Not scoped | No `targetVersion` or no `scopeDocument` |
| Not eligible | Scoped, but a pre-publication gate is unverified, a blocker is open, or ownership is invalid |
| Ready for the owner's release decision | Every applicable pre-publication gate verified on current evidence, ownership valid, no blocker open except the approval itself and post-publication work |
| Release-ready | Every applicable gate verified and current, no blocker open, and Joshua Small's approval recorded with evidence |
| Released | Release-ready and the registry records `releaseStatus: released` |

Approval counts only when `approval.status` is `approved`, `approvedBy` is the approval owner, and its evidence exists and was not recorded by automation. Nothing in this tooling can create, change or tick an approval. The Definition of Done's rule "no completion percentages are recorded" still holds: percentages live only in generated reports, never in the registry.

## Blockers

Two sources, always shown apart:

- **Registry blockers** (`release.blockers`, status `open`): manual, governed records. They always block, whatever their category or severity, and automation never adds, edits or removes them. Optional classification (schema 1.3.0): `category`, `severity` (security only), `blocks` (`merge` or `release`, default `release`) and `gates`.
- **Derived blockers** (`auto-*`): proposals computed from the registry, each naming its rule. They are never written back. Rules: missing scope (unless a scope blocker is recorded), ownership not valid, candidate moved, failing CI on the head or candidate (merge blocker), a `fail` record on a gate, stale gates, unverified critical workflows, applicable pre-publication gates without independent verification, required dependencies not released, and the owner's approval not recorded (unless an approval blocker is recorded).

Reports split them into **merge blockers**, **release blockers** and **post-release enhancements** (`release.enhancements`, which never block). Any open blocker keeps a project from being release-ready. Security findings follow [security.md](../standards/security.md#severity-and-release-blocking): a derived security failure without a severity is treated as blocking until a person classifies it.

To resolve a blocker, fix the problem, add evidence of the fix, and set the blocker `resolved` in a registry PR (the validator requires resolution evidence). To move one out of scope, record the owner's decision in the scope document.

## Next actions

Derived from blockers and gates only, in this order: (1) critical and high security, (2) broken functionality (`defect`), (3) missing required verification (scope first, then naming a verifier), (4) failed or missing CI, (5) accessibility release blockers, (6) missing release artifacts and dependencies, (7) documentation and the rest. The owner's approval appears only when nothing else remains. Nothing is inferred from the absence of reported failures: a gate without evidence asks for evidence.

## Release preparation

`release:prepare` (and `release:reports` for every project with a `targetVersion`) writes reviewable drafts: the readiness summary, version and candidate, relevant PRs and commits, test and CI evidence with provenance, security and accessibility status, remaining blockers, known limitations, rollback references, an owner approval checklist, a completion checklist, release notes and a changelog draft.

Changelog wording comes from a snapshot listed in [`release/inputs.json`](../release/inputs.json): a copy of the project's `CHANGELOG.md` at a pinned commit, guarded by sha256. It is labelled builder-authored and unverified, and it is flagged stale when the candidate has moved past its commit. To refresh it, copy the file from the new candidate commit (read-only), update `commitSha` and `sha256`, and regenerate.

Preparation never publishes, tags, deploys, merges or approves. The checklist ticks a line only when the registry shows it, and never ticks the approval line unless the approval is recorded.

## Dependencies between projects

Declare them in the dependent project's `dependencies` (schema 1.3.0); nothing is guessed from names:

```json
{ "project": "one-small-ui", "relationship": "uses-components", "requiredForRelease": true, "minVersion": "0.6.0",
  "reason": "Studio 1.0 ships the OneSmallUI 0.6 page blocks.", "evidenceRefs": ["studio-package-json"] }
```

`relationship` is `adopts`, `uses-components`, `shared-package`, `integrates` or `hub-sync`. Only `requiredForRelease: true` can block, and only until the dependency's `currentVersion` reaches `minVersion` (any release when null). The validator rejects unknown projects, self-dependencies, duplicates, declarations without evidence, and cycles of release-required dependencies; the engine also reports optional cycles and dependency evidence older than the staleness window.

## Reviewing and approving a release

1. Run `npm run release:reports` on the registry PR that records the final evidence, and read `reports/releases/<id>/<target>/release-prep.md`.
2. Check that the eligibility is **Ready for the owner's release decision**, every listed blocker is resolved, and the evidence links point at the candidate commit.
3. Joshua Small approves in the registry PR (an approving review or explicit comment), which is linked as evidence.
4. After the authorized publication or deployment, record the post-publication evidence, then `currentVersion`, `releaseStatus: released` and `lifecycle: maintenance` ([release.md](../standards/release.md)).

## Troubleshooting stale or wrong evidence

| Symptom | Cause and fix |
| --- | --- |
| A gate marked verified shows *Unknown or stale* | Its pass evidence is from the builder, from automation, too old, for another commit, or the verifier is not assigned. Have the verifier re-check on the candidate and record their own pass |
| Every gate went stale at once | The candidate PR moved. Record the new `release.candidate` and re-collect evidence |
| A project shows *Not scoped* | Commit a scope document and set `targetVersion` and `scopeDocument` |
| `release:check` fails | The registry changed after the reports were generated. Run `npm run release:reports` and commit the result |
| `release:reports` exits 1 with "registry is invalid" | Fix the registry first (`npm run validate`) |
| "does not match its recorded sha256" | A changelog snapshot was edited. Re-copy it from the pinned commit and update the hash |
| Snapshot dates look old | Registry sync refreshes snapshots and CI evidence once stage B or C is on ([operations.md](operations.md)); the readiness tooling never fetches anything itself |

## Operating with minimal effort

- Let registry sync keep snapshots and CI evidence current (stage C). It never changes gates, blockers, approval, the candidate or dependencies.
- When a verifier finishes, or a blocker is resolved, make one registry PR with the evidence, run `npm run release:reports`, commit the reports with it, and read the dashboard diff in the PR.
- CI runs every test and validation on each PR and prints the dashboard to the Validate registry job summary.
