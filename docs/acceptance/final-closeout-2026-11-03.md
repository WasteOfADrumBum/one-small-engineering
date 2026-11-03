# Final closeout package: Portfolio, Photography, Studio and Engineering Hub

Prepared 2026-11-03 by Codex; finalized at Joshua Small's explicit direction after his review, verification and approval.

## Final owner verification and approval

Joshua Small reviewed this package and gave the following explicit attestation on 2026-11-03. [Durable GitHub record](https://github.com/WasteOfADrumBum/one-small-engineering/pull/88#issuecomment-6612638149). Transcribed by Codex at his direction.

> I reviewed and accept the closeout package. I confirm my recorded manual checks and accept the linked evidence for the ten Showcase gates for Portfolio, Photography and Studio. I approve their 1.0.0 releases and Engineering Phase 6 with its documented qualifications. Record my verification and approval, finish the maintenance transitions, and merge the final closeout once checks pass.

The three approved 1.0.0 releases are recorded as released and in maintenance. All ten Showcase gates per project cite the assigned human verifier's actual attestation. This does not convert earlier builder reports into independent test runs, grant AI verifier permissions or imply a new npm publication/GitHub tag. Prior approval evidence keeps its original dates.

## Current project evidence

| Project | Reviewed revision | Current automated evidence | Owner evidence |
| --- | --- | --- | --- |
| Portfolio | 773fca08a2e33b213e51577315381f08ff601208 | [CI](https://github.com/WasteOfADrumBum/joshsmall-site/actions/runs/41581843590), [production smoke](https://github.com/WasteOfADrumBum/joshsmall-site/actions/runs/41635621811) | [Acceptance](https://github.com/WasteOfADrumBum/joshsmall-site/blob/773fca08a2e33b213e51577315381f08ff601208/docs/release/ACCEPTANCE.md): contact, reduced motion, contrast, screen reader, zoom, free plans, alerts, known risks and release approval |
| Photography | d70f75f04942f8026871c701a4b69460d088ae34 | [CI](https://github.com/WasteOfADrumBum/one-small-photography/actions/runs/41676021387), [production smoke after code fix](https://github.com/WasteOfADrumBum/one-small-photography/actions/runs/41664171346) at a1227ca; later #29 is documentation only | [Release record](https://github.com/WasteOfADrumBum/one-small-photography/blob/d70f75f04942f8026871c701a4b69460d088ae34/docs/RELEASE.md), [merged owner-results PR #29](https://github.com/WasteOfADrumBum/one-small-photography/pull/29): keyboard, Narrator, phone, backup consistency and copy checksum, private B2 versions and retained-image retrieval |
| Studio | b017cfe9c40e2166799ed59187a12d61f76e1763 | [CI](https://github.com/WasteOfADrumBum/one-small-studio/actions/runs/41573669907) | [Acceptance](https://github.com/WasteOfADrumBum/one-small-studio/blob/b017cfe9c40e2166799ed59187a12d61f76e1763/docs/release/studio-release-acceptance.md): playback, email, live headers, screen reader, risks and release approval |

Photography approval was explicitly reported by Joshua in the ChatGPT closeout conversation after merging #29. Section 6 of the committed release record remains blank; the consolidated attestation above now supplies the durable GitHub approval. No signature was invented in the project file.

### Ten Showcase gates: owner review map

| Gate | Evidence to review | Remaining action |
| --- | --- | --- |
| scope-complete | Each linked release record and prior owner release approval | Complete: consolidated owner attestation approves version 1.0.0 |
| automated-checks | Exact-head CI links above | Complete: owner accepted the linked successful exact-head CI; no redundant rerun |
| security-privacy-review | Project release security reviews, history scans and accepted risk sections | Complete: owner accepted the documented scope and limits; not a claim of zero vulnerabilities |
| wcag-22-aa | Portfolio acceptance, Studio e2e evidence, Photography #28 WCAG 2.2 fixes and owner follow-up | Complete: owner reviewed and accepted the linked combined evidence |
| keyboard-screen-reader | Existing owner confirmations in acceptance records | Complete: owner attestation recorded; completed manual tests not repeated |
| responsive-layouts | Recorded phone/desktop/tablet/zoom evidence and owner checks | Complete: owner accepted the linked coverage; no additional device details inferred |
| critical-workflows | Owner contact/gallery/playback reports plus tests and smoke checks | Complete: consolidated owner attestation |
| production-deployment | Existing provider-observed deployment records and production smoke; docs-only follow-ups | Complete: owner accepted linked production evidence; Codex did not authenticate Vercel |
| documentation-accurate | Linked README, release and recovery records | Complete: owner review recorded; historical observations remain dated |
| no-release-blockers | Successful remediation and scope/limitations in this package | Complete: human verifier accepted the package and final blocker disposition |

## Photography: retain completed work and accepted limits

- PR #28 fixed the PostgreSQL test teardown and accessibility defects. Main CI is now successful.
- The real backup script ran under PowerShell 7.6.9. Its output reported consistent data and a matching second-copy checksum. Backup data is not included in this repository.
- The owner expressly accepts the backup copy being unencrypted on his private drive. Do not request encryption again.
- B2 bucket is private and retains all versions. A disposable image was deleted through the site, then its retained small image was retrieved and opened.
- File recovery was tested. Recreating the deleted database row was not. The previously recorded isolated restore drill is supporting recovery evidence; do not claim the new backup file was restored.
- Keyboard/Narrator and phone checks passed by owner report. No additional screen-reader or device coverage is inferred.
- Build-time moderate advisories, missing script-src CSP, CDN retention after hiding a photo, memory/sitewide abuse controls and monthly backup limitations remain disclosed. Their final disposition belongs to the owner, not to Codex.

## Independent Phase 6 safety review

Reviewed the integrated Hub at 6b8e47c3479a48570405f4e4a3cde7751303755e, including merged #73 fixes. Reviewer: Codex, different from builder Claude Code.

Inspected:
- scripts/sync/automerge.mjs, guard.mjs, github.mjs, events.mjs and watch.mjs;
- scripts/state/lib.mjs, push.mjs, aggregate.mjs, install.mjs and cli.mjs;
- automerge, registry-sync, events, state and watch workflows; field-ownership and auto-merge policy;
- related regression tests and current release/verification policy.

Review result: GO for the reviewed Phase 6 safety scope after the test portability fix below. No new release-blocking implementation finding was identified in that scope. This is not a claim of exhaustive security coverage or a substitute for owner sign-off.

Confirmed through code inspection and the test suite:
- write-capable auto-merge checks out the default branch, treats project PR content as data, and enforces the registry field/path guard;
- required checks apply to the exact PR head, stale branches are rebuilt, review/file/check pagination rejects incomplete lists where safety depends on completeness;
- a manual Registry sync dry run does not dispatch a live auto-merge;
- checkpoint revision checks and non-force ref updates reject stale writes;
- secrets in URL credentials and query strings are scanned; event hints cannot directly replace registry data;
- permission scopes are explicit, actions are pinned, and project code is not executed by the auto-merge job.

### Validation actually executed by Codex

The native git clone failed because of the local credential-helper environment. Instead, 226 repository text files were retrieved at the exact commit through the GitHub connector. Every local file's git blob SHA was checked against the recursive Git tree: 226 matched, zero mismatches before the deliberate test fix.

Initial exact-source Windows run: registry validation passed; 461 tests passed and one failed. The failure was a test harness path issue: URL.pathname produces a drive-prefixed URL path instead of a native Windows filename. The existing CLI itself printed usage correctly.

Fix: scripts/state/state.test.mjs now uses fileURLToPath for the spawned CLI path. The existing regression test verifies the result; no assertions were removed or relaxed.

After that fix: npm run check passed, registry valid, 462 tests passed, zero failures. After recording the owner's verification, two tests that hard-coded zero verified gates were updated to assert that offline observation preserves recorded verification without inventing additional passes. Final integrated validation again passed all 462 tests, registry validation and all three report reproducibility checks. No project application code changed. No production tests, database writes, new credentials, publishing or deployments were performed in this review.

## Phase 6 accepted-scope qualifications to decide once

- Claude-to-Codex continuation was demonstrated through the connector; isolated CLI and other vendors' runtime adapters remain untested.
- Hourly change watch plus the six-hour scheduled reconciliation are operational. Push-event delivery remains off by design; instant events are optional.
- Remediation writes remain disabled. Fixture safety tests and prior draft-fix demonstrations exist; no new live privileged demonstration is claimed.
- These qualifications must be explicitly accepted for this scoped completion; they must not silently be represented as executed tests.

## Closure result

Joshua Small accepted all three 1.0.0 release scopes, the ten Showcase gates for each, and the documented Phase 6 qualifications. The registry records his actual verification and release approval; all three sites are released/in maintenance. His attestation also supplies final Phase 6 sign-off and authorizes merging this PR after successful final-head checks.

Conflict resolution preserves the newest main registry observations and other projects' manual governance. The integration commit includes current main as a parent. No tests or security rules were disabled.
