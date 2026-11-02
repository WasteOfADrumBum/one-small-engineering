# One Small Engineering Hub: roadmap

Future, optional work for the hub itself. **Nothing here is a release blocker** and nothing here reopens the delivered hub (Phases 0–6, operational acceptance 2026-10-31). Defects in delivered behaviour are maintenance fixes, not roadmap items. Current-release requirements and owner acceptance live in [docs/acceptance/closeout-2026-11-02.md](docs/acceptance/closeout-2026-11-02.md); project status lives only in [projects/registry.json](projects/registry.json).

Each project keeps its own `ROADMAP.md` in its repository, linked from its README and its `.engineering/` checkpoint:
[joshsmall-site](https://github.com/WasteOfADrumBum/joshsmall-site/blob/main/ROADMAP.md),
[one-small-photography](https://github.com/WasteOfADrumBum/one-small-photography/blob/main/ROADMAP.md),
[one-small-studio](https://github.com/WasteOfADrumBum/one-small-studio/blob/main/ROADMAP.md),
[one-small-ui](https://github.com/WasteOfADrumBum/one-small-ui/blob/main/ROADMAP.md).
ModsPack is on hold and gets no roadmap work until the owner lifts the hold.

## How to use this file

- An item moves into a release only when the owner adds it to an approved scope. Until then it stays here.
- Priority: **P1** worth doing next, **P2** useful, **P3** nice to have.
- An item that needs a new credential, a paid service or write access names that in Dependencies; it is never activated by an agent.

## Enhancements

### E1. Instant change events through a GitHub App (P2)

- **Purpose:** cut sync latency from up to an hour (hourly change watch) to minutes without giving project repositories write access to the hub.
- **Scope:** a GitHub App installed on the eight repositories, a receiver that only triggers `Registry sync` (`workflow_dispatch`), and docs. Reuses `scripts/sync/events.mjs` validation. Excludes the rejected `HUB_DISPATCH_TOKEN` design.
- **Acceptance criteria:** a real push or PR event reaches the hub within 5 minutes; an unknown repository, a forged signature and a duplicate delivery are rejected (tests plus one live negative); the six-hour schedule still reconciles a missed event; no project repository holds a hub-write credential.
- **Dependencies:** owner decision on hosting the receiver (must be free tier); App creation is owner-only.

### E2. Isolated Codex CLI handoff repeat (P3)

- **Purpose:** close the qualification on the 2026-10-31 Claude-to-Codex handoff (it ran through the ChatGPT connector, not the isolated CLI).
- **Scope:** repeat `docs/handoff-acceptance/codex-task.md` with the Codex CLI and a write token scoped to the throwaway branch; then delete `handoff-test/claude-to-codex`.
- **Acceptance criteria:** the six criteria in the handoff kit pass from the CLI; transcript reviewed; branch deleted.
- **Dependencies:** owner runs Codex CLI with a scoped token.

### E3. Committed evidence ledgers refreshed from workflow artifacts (P2)

- **Purpose:** `verification/evidence/*.json`, `verification/runs/latest.json` and `engineering/state.json` on main are snapshots from 2026-10-28 (the last one recorded a local run whose token was rejected). Scheduled runs are current but keep their results in 30-day artifacts and job summaries.
- **Scope:** a scheduled, read-only job that opens a single PR refreshing the ledgers and reports from the latest orchestrator artifact, eligible for the existing auto-merge only if the field-ownership and path rules are extended in a reviewed PR.
- **Acceptance criteria:** ledgers on main are never more than 7 days behind the latest scheduled run; no governance field can change through that PR (negative tests); `npm run check` green.
- **Dependencies:** owner approval of the auto-merge path extension.

### E4. Action runtime and pin refresh (P2)

- **Purpose:** keep pinned actions on supported Node runtimes.
- **Scope:** bump SHA-pinned `actions/checkout`, `setup-node`, `upload-artifact` in all hub workflows; keep `permissions: {}` defaults.
- **Acceptance criteria:** every workflow green on its next run; `repo-files.test.mjs` passes; no permission widened.
- **Dependencies:** none.

### E5. Prune merged `sync/*` branches (P3)

- **Purpose:** branch hygiene.
- **Scope:** delete `sync/<project>` branches whose PR merged and whose head equals the merge; sync recreates them when needed.
- **Acceptance criteria:** no open PR loses its branch; next sync run COMPLETE.
- **Dependencies:** none (contents write already granted to the sync job; deletion stays a manual or reviewed step).

### E6. Zero-job `pull_request` runs on superseded sync heads (P3)

- **Purpose:** `Validate registry` and `Verify projects` show a few `failure` runs with zero jobs on `sync/*` heads that were rebuilt before the run started (for example run 41340635517 on 5b27304; the PR head still had a green `validate` check and merged). They are noise but read as failures.
- **Scope:** confirm the cause and add a `concurrency` group or path filter so a superseded head cancels instead of failing.
- **Acceptance criteria:** no zero-job failures over seven days of scheduled syncs; required checks unchanged.
- **Dependencies:** none.

### E7. Authorized remediation writes (P3, owner-gated)

- **Purpose:** let the hub open draft fix PRs for confirmed defects ([docs/verification.md](docs/verification.md#remediation)).
- **Scope:** owner creates `REMEDIATION_TOKEN` (fine-grained, one repository, Contents and Pull requests write), sets `REMEDIATION_WRITE_ENABLED=true`, and runs `remediation.yml` by hand for one reviewed plan.
- **Acceptance criteria:** one draft PR on `verify/remediation/*`, nothing merged, token revoked or kept per owner decision.
- **Dependencies:** explicit owner authorization. Remediation writes stay **off** until then; no agent creates the token or sets the variable.

### E8. Release provenance for libraries (P3)

- **Purpose:** supply-chain signal for `@onesmall/ui` (and ModsPack when the hold lifts).
- **Scope:** npm trusted publishing from a release workflow with `id-token: write` only in that job.
- **Acceptance criteria:** `npm view <pkg> --json` shows provenance for the next release; workflow permissions reviewed.
- **Dependencies:** owner configures trusted publishing on npmjs.com.
