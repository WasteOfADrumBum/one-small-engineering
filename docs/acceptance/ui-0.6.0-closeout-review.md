# One Small UI 0.6.0 closeout review

Status: owner decision pending. Prepared by Codex on 2026-11-03. This document does not record approval or imply an independently performed manual test.

## Release evidence

- Release candidate: `9a13c9e22d094a95364262a1ae89f666febac892`; [release CI](https://github.com/WasteOfADrumBum/one-small-ui/actions/runs/41269483773) passed including consumer Node 18, 20, 22 and 24, Windows, Linux, accessibility and layout.
- [Release acceptance evidence](https://github.com/WasteOfADrumBum/one-small-ui/blob/408474cded69acbfe4fbf1d903c5d38144ece5ba/docs/releases/0.6.0-acceptance.md) documents the 0.6.0 npm package, tag, reproducible build and limitations. PR #36 was merged; its wording describing itself as a draft is stale.
- Owner reported manual acceptance in Chrome with Windows Narrator, accepted the live documentation, and accepted two moderate development-only advisories. These are owner-reported results; the screen reader pass is limited to the environment stated.
- npm integrity reported by the owner: `sha512-HrIZIPxye5Iz6Zos6J2z1klZe7cFwpdikRil/Wm6geY0BGyjFyynDaXLadfdD1Ojl5LYPaTjUiW8Agymgt6jtQ==`. The release acceptance record reports that a clean rebuild reproduced the published artifact. This is existing builder evidence, not a new reproduction by Codex.
- Main at `408474cded69acbfe4fbf1d903c5d38144ece5ba` has successful CI for the consumer matrix, Linux and Windows, Playwright accessibility and layout. No UI pull requests were open when reviewed.

## Decision required

Version 0.6.0 has no npm provenance attestation and its tag is not signed. The published package and tag cannot be retroactively made into an attested npm publication. The proposed exception is to accept that gap for this version, rely on the documented integrity and reproducible-build evidence, and track trusted publishing for a later release. This remains an exception: the provenance requirement was not met.

The owner can instead defer closure and publish a new version with provenance. No release, verification pass, or risk acceptance is recorded until the owner's decision is obtained.

## Registry reconciliation after decision

Preserve sync-owned observations, record owner verification only to the extent actually authorized with links to this review and underlying evidence, resolve the provenance exception honestly, record release approval with its actual date, update the 0.6.0 release and maintenance status, regenerate reports, run checks and merge. Do not treat missing provenance as a passed attestation or fabricate tests. Reconcile the stale registry instruction to merge UI PR #36.
