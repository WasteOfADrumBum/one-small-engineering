# One Small ModsPack: issue reports

As of 2026-10-27T01:56:27Z, commit 80cc269ebb7c20aca5f6ca03214954726fb494f7. One section per collector result that is not a pass. Automation proposes no code fix unless a defect's fix is unambiguous; a person decides.

## accessibility: 1 of 4 check(s) passed; 3 not run or inconclusive

- Project: one-small-mods-pack (https://github.com/WasteOfADrumBum/one-small-mods-pack)
- Commit: 80cc269ebb7c20aca5f6ca03214954726fb494f7
- Gate(s): wcag-22-aa
- Severity: low; kind: evidence-gap; release impact: blocks verification of wcag-22-aa
- Evidence: ev-one-small-mods-pack-accessibility-80cc269-ca3183a8

### Reproduction

```text
node scripts/verify/cli.mjs run --project one-small-mods-pack --collector accessibility --execute
```

### Root cause

Not established. The collector could not decide; see the failure reason.

### Failure reason

not run or inconclusive: automated accessibility run (no automated accessibility command is configured for this project); site:check (browser accessibility and layout checks) (needs a browser; not run by the collector); manual review (Screen reader (NVDA or similar), real 200%/400% zoom, text spacing and Windows forced-colors review of the generated documentation site.)

### Proposed fix

No fix proposed by automation. A person decides the fix.

### Acceptance criteria

The accessibility collector reports pass at the new commit, and the verifier records it for wcag-22-aa.

### Verification required

- wcag-22-aa: manual review by the verifier


## CI results: not readable

- Project: one-small-mods-pack (https://github.com/WasteOfADrumBum/one-small-mods-pack)
- Commit: 80cc269ebb7c20aca5f6ca03214954726fb494f7
- Gate(s): automated-checks
- Severity: unclassified; kind: access; release impact: blocks verification of automated-checks
- Evidence: ev-one-small-mods-pack-ci-results-80cc269-35769d7e

### Reproduction

```text
node scripts/verify/cli.mjs run --project one-small-mods-pack --collector ci-results
```

### Root cause

Not established. The collector could not decide; see the failure reason.

### Failure reason

check runs: the token was rejected (HTTP 401); it is missing, expired or revoked

### Proposed fix

No fix proposed by automation. A person decides the fix.

### Acceptance criteria

The ci-results collector reports pass at the new commit, and the verifier records it for automated-checks.

### Verification required

- automated-checks: re-executed by the verifier


## compatibility: 1 of 3 check(s) failed

- Project: one-small-mods-pack (https://github.com/WasteOfADrumBum/one-small-mods-pack)
- Commit: 80cc269ebb7c20aca5f6ca03214954726fb494f7
- Gate(s): runtime-compatibility
- Severity: medium; kind: defect; release impact: blocks verification of runtime-compatibility
- Evidence: ev-one-small-mods-pack-compatibility-80cc269-fff1571b

### Reproduction

```text
node scripts/verify/cli.mjs run --project one-small-mods-pack --collector compatibility --execute
```

### Root cause

CI tests the engines floor: floor 20, CI Node 22

### Failure reason

failed: CI tests the engines floor

### Proposed fix

No fix proposed by automation. A person decides the fix.

### Acceptance criteria

The compatibility collector reports pass at the new commit, and the verifier records it for runtime-compatibility.

### Verification required

- runtime-compatibility: manual review by the verifier


## documentation: 5 of 6 check(s) passed; 1 not run or inconclusive

- Project: one-small-mods-pack (https://github.com/WasteOfADrumBum/one-small-mods-pack)
- Commit: 80cc269ebb7c20aca5f6ca03214954726fb494f7
- Gate(s): documentation-accurate, public-docs-accurate, upgrade-rollback-uninstall-docs
- Severity: low; kind: evidence-gap; release impact: blocks verification of documentation-accurate, public-docs-accurate, upgrade-rollback-uninstall-docs
- Evidence: ev-one-small-mods-pack-documentation-80cc269-c7ec0915

### Reproduction

```text
node scripts/verify/cli.mjs run --project one-small-mods-pack --collector documentation --execute
```

### Root cause

Not established. The collector could not decide; see the failure reason.

### Failure reason

not run or inconclusive: accuracy against behaviour (whether the documentation matches the product is a manual review)

### Proposed fix

No fix proposed by automation. A person decides the fix.

### Acceptance criteria

The documentation collector reports pass at the new commit, and the verifier records it for documentation-accurate, public-docs-accurate, upgrade-rollback-uninstall-docs.

### Verification required

- documentation-accurate: manual review by the verifier
- public-docs-accurate: manual review by the verifier
- upgrade-rollback-uninstall-docs: manual review by the verifier


## release packaging: 1 of 10 check(s) failed

- Project: one-small-mods-pack (https://github.com/WasteOfADrumBum/one-small-mods-pack)
- Commit: 80cc269ebb7c20aca5f6ca03214954726fb494f7
- Gate(s): ci-release-pipeline, clean-consumer-install, package-archive-inspection, package-metadata-exports, versioning-changelog
- Severity: medium; kind: defect; release impact: blocks verification of ci-release-pipeline, clean-consumer-install, package-archive-inspection, package-metadata-exports, versioning-changelog
- Evidence: ev-one-small-mods-pack-release-packaging-80cc269-3663499d

### Reproduction

```text
npm run build && npm pack --dry-run --json --ignore-scripts
```

### Root cause

publish workflow: no workflow runs npm publish (1 workflow(s))

### Failure reason

failed: publish workflow

### Proposed fix

No fix proposed by automation. A person decides the fix.

### Acceptance criteria

The release-packaging collector reports pass at the new commit, and the verifier records it for ci-release-pipeline, clean-consumer-install, package-archive-inspection, package-metadata-exports, versioning-changelog.

### Verification required

- ci-release-pipeline: manual review by the verifier
- clean-consumer-install: manual review by the verifier
- package-archive-inspection: re-executed by the verifier
- package-metadata-exports: re-executed by the verifier
- versioning-changelog: re-executed by the verifier

