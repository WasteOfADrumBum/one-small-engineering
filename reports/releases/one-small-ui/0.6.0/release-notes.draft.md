# OneSmallUI 0.6.0 release notes (draft)

> **Draft, not approved, not published.** Status: Not eligible for release. 0 of 22 applicable gates independently verified (0%); 4 open blocker(s). Generated 2026-11-03T04:21:29Z.

## Highlights

_Fill in from the approved scope document._

## Verification status

- 0 of 22 applicable release gates independently verified.
- Builder-reported, awaiting independent verification: scope-complete, automated-checks, wcag-22-aa, documentation-accurate, package-metadata-exports, clean-consumer-install, runtime-compatibility, package-archive-inspection, supply-chain-review, ci-release-pipeline, versioning-changelog, upgrade-rollback-uninstall-docs, public-docs-accurate, published-artifact-matches.

## Known limitations

- Not yet verified: Verifier verify:record entries for every 0.6.0 gate at 9a13c9e (none recorded).
- Not yet verified: npm provenance for 0.6.0 (none; owner decides whether release-provenance is unmet or not applicable).
- Not yet verified: Owner approval record for 0.6.0.

## Upgrade, rollback and uninstall

npm versions cannot be reused: roll back with `npm deprecate <name>@<bad version>` plus a patch release, and point users to the previous version. A git revert of the merge restores the source. See standards/release.md#rollback-and-recovery.
