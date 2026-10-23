# Release Governance

How a One Small release moves from idea to maintenance, and how humans and AI assistants share the work without conflicting records.

## Roles

| Role | Who | Responsibility |
| --- | --- | --- |
| Builder | A person or AI assistant | Implements the approved scope and records builder evidence. |
| Verifier | A different person or AI assistant | Independently re-checks the evidence and runs the checks the builder cannot judge. Never the builder for the same release. |
| Approval owner | **Joshua Small** only | Gives final release approval. No AI assistant can approve, and none may write approval on his behalf without linked evidence of his decision. |

Builder and verifier are recorded in the registry's `ownership` block. Both stay `null` until the release is scoped, and both must be assigned (as different identities) before any gate can be marked verified. Different AI tools (for example Claude builds, Codex verifies) count as independent; two sessions of the same tool reviewing their own work do not.

## The release process

1. **Freeze approved scope.** Commit a scope document in the project repository, set `targetVersion` and `scopeDocument` in the registry. Anything not in it is an enhancement.
2. **Implement requirements** on feature branches through PRs.
3. **Run automated quality checks**: build, lint, type check, tests, accessibility automation, dependency audit, in CI on the release candidate.
4. **Complete the security review** ([security.md](security.md)).
5. **Complete applicable manual QA**: keyboard, screen reader, zoom, responsive layouts, critical workflows.
6. **Obtain independent verification.** The verifier re-checks evidence and marks gates `verified` in a registry PR.
7. **Obtain human approval.** Joshua Small reviews the registry PR and the evidence, then approves (an approving review or explicit comment that is linked as evidence).
8. **Merge approved PRs.**
9. **Publish or deploy the release** (npm publish, tag, production deployment).
10. **Verify production behavior and release identity**: the live site or published package matches the verified commit.
11. **Record evidence in the registry**: set `currentVersion`, `releaseStatus: released`, approval and evidence.
12. **Transition to maintenance**: set `lifecycle: maintenance`.

`releaseStatus` describes `targetVersion` only. A previously published `currentVersion` says nothing about whether the next release is verified.

## Handling problems

### Release blockers
Record each in `release.blockers` with evidence. While any blocker is open, `no-release-blockers` cannot be verified and `releaseStatus` cannot be `verified` or `released` (the validator enforces both). Resolve the blocker, or move it out of scope by an owner decision recorded in the scope document.

### Failed CI
A red check on the release candidate means the gate is not verified. Fix forward on a branch; do not skip, disable or quarantine tests to get green. If the failure is also on the default branch, record it as a blocker with the run link.

### Incomplete manual testing
Leave the gate `in_progress` or `not_verified` and say what is missing in `notes`. Automated results never substitute for manual keyboard, screen-reader or zoom checks.

### Unavailable evidence
If evidence cannot be produced (tool unavailable, access missing, service down), record the gate as `not_verified` with the reason. Never mark a gate verified on a description, a chat summary, or "it worked last time".

### Security exceptions
Only Joshua Small can accept a critical or high finding without a fix, in writing, with an expiry date and compensating control, linked as evidence. See [security.md](security.md#severity-and-release-blocking).

### Rollback and recovery
Before release, know how to roll back: previous Vercel deployment promotion, `npm deprecate` plus a patch release (npm versions cannot be reused), reverting a merge. Application tiers verify this under `deployment-rollback`. After a rollback, set `releaseStatus` back to `blocked` with the reason.

### Post-release regressions
A defect in the released scope is a maintenance fix: patch version, its own short PR with evidence, no scope additions. A security issue follows the remediation timelines in [security.md](security.md#vulnerability-remediation).

### Future enhancement requests
Add them to `release.enhancements`. They never reopen a released version. When enough accumulate, start a new release cycle at step 1.

## Cross-AI governance

The registry ([`projects/registry.json`](../projects/registry.json)) on `main` is the **only authoritative status record**.

- Claude, ChatGPT, Codex, Copilot, Gemini and other assistants may read the registry, inspect project repositories and **propose** changes.
- Assistants must not keep their own authoritative status (memory notes, project-status docs, chat summaries) that competes with the registry. Project repositories may keep detailed working notes, but release status is read from here.
- Every change to `registry.json` goes through a pull request that passes `npm run check`.
- Every status change links evidence: a PR, commit, workflow run, release artifact, deployment or committed test record. A chat summary is never sufficient on its own.
- The builder and the verifier are different.
- Final release approval belongs to Joshua Small.
- **The current verified GitHub revision wins.** When a chat summary, an older document or an assistant's memory disagrees with what GitHub shows now, trust GitHub and update the registry through a PR. Record `observedAt` and commit SHAs so staleness is visible.

### Rules for an assistant updating the registry

1. Start from the latest `main`. Re-read the registry and the project's current GitHub state.
2. Change only the entries the task covers. Do not "tidy" other projects' status.
3. Add evidence records first, then point gates at them. Use `builder_reported` for results you are relaying but did not re-run.
4. Never set `approval.status` to `approved` or `releaseStatus` to `released` unless the owner's approval is linked.
5. Run `npm run check` and include the output in the PR.
6. Fill in the PR template, including which tool built and which verified.
