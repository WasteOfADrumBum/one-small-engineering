# Final closeout package: Portfolio, Photography, Studio and Engineering Hub

Prepared 2026-11-03 by Codex. This is an independent review and an owner-review package, not an owner verification or approval.

## One final owner action

Review the evidence below and the accepted limitations. The existing manual checks and release approvals must not be repeated. A single explicit attestation can name the three projects and their ten Showcase gates; an assistant may then transcribe that actual decision with this PR's URL. Until that attestation, registry gates remain in progress and approval stays pending. No identity is impersonated and no AI-verifier permission is changed.

Proposed statement, for Joshua Small to decide after review:

> I have reviewed this closeout package and its linked evidence. I confirm the completed manual checks attributed to me, accept the documented release scopes and limits, and approve version 1.0.0 for Portfolio, Photography and Studio. As their assigned verifier, I attest that the ten Showcase gates listed below pass for the recorded release revisions, based on my manual checks and review of the linked artifacts. I approve recording those passes, my existing release approvals, and released/maintenance status. I accept Engineering Phase 6 with the documented runtime and event-delivery qualifications, and approve its final sign-off and merging this closeout work.

This is proposed wording only. It does not assert that Joshua has given this attestation.

## Current project evidence

| Project | Reviewed revision | Current automated evidence | Owner evidence |
| --- | --- | --- | --- |
| Portfolio | 773fca08a2e33b213e51577315381f08ff601208 | [CI](https://github.com/WasteOfADrumBum/joshsmall-site/actions/runs/41581843590), [production smoke](https://github.com/WasteOfADrumBum/joshsmall-site/actions/runs/41635621811) | [Acceptance](https://github.com/WasteOfADrumBum/joshsmall-site/blob/773fca08a2e33b213e51577315381f08ff601208/docs/release/ACCEPTANCE.md): contact, reduced motion, contrast, screen reader, zoom, free plans, alerts, known risks and release approval |
| Photography | d70f75f04942f8026871c701a4b69460d088ae34 | [CI](https://github.com/WasteOfADrumBum/one-small-photography/actions/runs/41676021387), [production smoke after code fix](https://github.com/WasteOfADrumBum/one-small-photography/actions/runs/41664171346) at a1227ca; later #29 is documentation only | [Release record](https://github.com/WasteOfADrumBum/one-small-photography/blob/d70f75f04942f8026871c701a4b69460d088ae34/docs/RELEASE.md), [merged owner-results PR #29](https://github.com/WasteOfADrumBum/one-small-photography/pull/29): keyboard, Narrator, phone, backup consistency and copy checksum, private B2 versions and retained-image retrieval |
| Studio | b017cfe9c40e2166799ed59187a12d61f76e1763 | [CI](https://github.com/WasteOfADrumBum/one-small-studio/actions/runs/41573669907) | [Acceptance](https://github.com/WasteOfADrumBum/one-small-studio/blob/b017cfe9c40e2166799ed59187a12d61f76e1763/docs/release/studio-release-acceptance.md): playback, email, live headers, screen reader, risks and release approval |

Photography approval was explicitly reported by Joshua in the ChatGPT closeout conversation after merging #29. Section 6 of the committed release record remains blank; the final attestation should provide a durable GitHub record, rather than invent a signature in that file.

### Ten Showcase gates: owner review map

| Gate | Evidence to review | Remaining action |
| --- | --- | --- |
| scope-complete | Each linked release record and prior owner release approval | One consolidated verifier attestation; proposed Studio/Photography version 1.0.0 |
| automated-checks | Exact-head CI links above | Verifier reviews successful checks; no redundant full rerun requested |
| security-privacy-review | Project release security reviews, history scans and accepted risk sections | Verifier confirms disposition of documented limits, not a claim of zero vulnerabilities |
| wcag-22-aa | Portfolio acceptance, Studio e2e evidence, Photography #28 WCAG 2.2 fixes and owner follow-up | Verifier reviews automated and manual evidence together |
| keyboard-screen-reader | Existing owner confirmations in acceptance records | Transcribe actual owner attestation; do not repeat completed tests |
| responsive-layouts | Recorded phone/desktop/tablet/zoom evidence and owner checks | Owner attests applicable coverage after reviewing records; do not infer unreported device details |
| critical-workflows | Owner contact/gallery/playback reports plus tests and smoke checks | Consolidated verifier attestation |
| production-deployment | Existing provider-observed deployment records and production smoke; docs-only follow-ups | Confirm evidence applies to released code; this session could not authenticate Vercel |
| documentation-accurate | Linked README, release and recovery records | Consolidated review; keep historical observations dated |
| no-release-blockers | Successful remediation and scope/limitations in this package | Human verifier confirms final blocker disposition |

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

After that fix: npm run check passed, registry valid, 462 tests passed, zero failures. No project application code changed. No production tests, database writes, new credentials, publishing or deployments were performed in this review.

## Phase 6 accepted-scope qualifications to decide once

- Claude-to-Codex continuation was demonstrated through the connector; isolated CLI and other vendors' runtime adapters remain untested.
- Hourly change watch plus the six-hour scheduled reconciliation are operational. Push-event delivery remains off by design; instant events are optional.
- Remediation writes remain disabled. Fixture safety tests and prior draft-fix demonstrations exist; no new live privileged demonstration is claimed.
- These qualifications must be explicitly accepted for this scoped completion; they must not silently be represented as executed tests.

## Closure mechanics

The registry reconciles factual scope, evidence and remaining attestation tasks without setting gates to verified or claiming approval. It leaves the assigned verifier as Joshua Small and AI-verifier permissions unchanged.

After the owner gives the consolidated attestation on this PR, transcribe it into the three projects' verification/approval evidence, run the registry validators and regenerate reports, and record released/maintenance status when those records satisfy policy. Preserve previous approval dates. Use this PR/review URL as the durable source for the new attestation. No further owner terminal commands or repeat manual tests should be necessary unless a concrete new defect is found.

