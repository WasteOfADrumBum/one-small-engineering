# OneSmallUI: issue reports

As of 2026-10-31T01:00:00Z, commit 94438ee63ed8c72c027be4d58fc0b168236d213d. One section per collector result that is not a pass. Automation proposes no code fix unless a defect's fix is unambiguous; a person decides.

## accessibility: 2 of 3 check(s) passed; 1 not run or inconclusive

- Project: one-small-ui (https://github.com/WasteOfADrumBum/one-small-ui)
- Commit: 94438ee63ed8c72c027be4d58fc0b168236d213d
- Gate(s): wcag-22-aa
- Severity: low; kind: evidence-gap; release impact: blocks verification of wcag-22-aa
- Evidence: ev-one-small-ui-accessibility-94438ee-c38c97f7

### Reproduction

```text
node scripts/verify/cli.mjs run --project one-small-ui --collector accessibility --execute
```

### Root cause

Not established. The collector could not decide; see the failure reason.

### Failure reason

not run or inconclusive: manual review (Keyboard and screen reader review of the docs app and components.)

### Proposed fix

No fix proposed by automation. A person decides the fix.

### Acceptance criteria

The accessibility collector reports pass at the new commit, and the verifier records it for wcag-22-aa.

### Verification required

- wcag-22-aa: manual review by the verifier


## CI results: not readable

- Project: one-small-ui (https://github.com/WasteOfADrumBum/one-small-ui)
- Commit: 94438ee63ed8c72c027be4d58fc0b168236d213d
- Gate(s): automated-checks
- Severity: unclassified; kind: access; release impact: blocks verification of automated-checks
- Evidence: ev-one-small-ui-ci-results-94438ee-0475c8d2

### Reproduction

```text
node scripts/verify/cli.mjs run --project one-small-ui --collector ci-results
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

- Project: one-small-ui (https://github.com/WasteOfADrumBum/one-small-ui)
- Commit: 94438ee63ed8c72c027be4d58fc0b168236d213d
- Gate(s): runtime-compatibility
- Severity: medium; kind: defect; release impact: blocks verification of runtime-compatibility
- Evidence: ev-one-small-ui-compatibility-94438ee-1fbb33cf

### Reproduction

```text
node scripts/verify/cli.mjs run --project one-small-ui --collector compatibility --execute
```

### Root cause

CI tests the engines floor: floor 18, CI Node 22

### Failure reason

failed: CI tests the engines floor

### Proposed fix

No fix proposed by automation. A person decides the fix.

### Acceptance criteria

The compatibility collector reports pass at the new commit, and the verifier records it for runtime-compatibility.

### Verification required

- runtime-compatibility: manual review by the verifier


## dependency audit: critical 2, high 0, moderate 1, low 0, info 0

- Project: one-small-ui (https://github.com/WasteOfADrumBum/one-small-ui)
- Commit: 94438ee63ed8c72c027be4d58fc0b168236d213d
- Gate(s): security-privacy-review, supply-chain-review
- Severity: high; kind: defect; release impact: blocks verification of security-privacy-review, supply-chain-review
- Evidence: ev-one-small-ui-dependency-audit-94438ee-c247d2a2

### Reproduction

```text
npm audit --json --package-lock-only (at 94438ee)
```

### Root cause

npm audit: critical 2, high 0, moderate 1, low 0, info 0 across 521 packages

### Failure reason

critical or high advisories: tinypool, vitest

### Proposed fix

No fix proposed by automation. A person decides the fix.

### Acceptance criteria

The dependency-audit collector reports pass at the new commit, and the verifier records it for security-privacy-review, supply-chain-review.

### Verification required

- security-privacy-review: manual review by the verifier
- supply-chain-review: manual review by the verifier


## deployment health: 1 of 2 check(s) passed; 1 not run or inconclusive

- Project: one-small-ui (https://github.com/WasteOfADrumBum/one-small-ui)
- Commit: 94438ee63ed8c72c027be4d58fc0b168236d213d
- Gate(s): production-deployment
- Severity: unclassified; kind: access; release impact: blocks verification of production-deployment
- Evidence: ev-one-small-ui-deployment-health-94438ee-ae0893ff

### Reproduction

```text
node scripts/verify/cli.mjs run --project one-small-ui --collector deployment-health
```

### Root cause

Not established. The collector could not decide; see the failure reason.

### Failure reason

could not reach https://one-small-ui.vercel.app from this runner

### Proposed fix

No fix proposed by automation. A person decides the fix.

### Acceptance criteria

The deployment-health collector reports pass at the new commit, and the verifier records it for production-deployment.

### Verification required

- production-deployment: manual review by the verifier


## documentation: 1 of 6 check(s) failed

- Project: one-small-ui (https://github.com/WasteOfADrumBum/one-small-ui)
- Commit: 94438ee63ed8c72c027be4d58fc0b168236d213d
- Gate(s): documentation-accurate, public-docs-accurate, upgrade-rollback-uninstall-docs
- Severity: low; kind: defect; release impact: blocks verification of documentation-accurate, public-docs-accurate, upgrade-rollback-uninstall-docs
- Evidence: ev-one-small-ui-documentation-94438ee-009b26ac

### Reproduction

```text
node scripts/verify/cli.mjs run --project one-small-ui --collector documentation --execute
```

### Root cause

upgrade, rollback and uninstall documented: no mention of upgrade, no mention of rollback, no mention of uninstall

### Failure reason

failed: upgrade, rollback and uninstall documented

### Proposed fix

No fix proposed by automation. A person decides the fix.

### Acceptance criteria

The documentation collector reports pass at the new commit, and the verifier records it for documentation-accurate, public-docs-accurate, upgrade-rollback-uninstall-docs.

### Verification required

- documentation-accurate: manual review by the verifier
- public-docs-accurate: manual review by the verifier
- upgrade-rollback-uninstall-docs: manual review by the verifier


## release packaging: 2 of 10 check(s) failed

- Project: one-small-ui (https://github.com/WasteOfADrumBum/one-small-ui)
- Commit: 94438ee63ed8c72c027be4d58fc0b168236d213d
- Gate(s): ci-release-pipeline, clean-consumer-install, package-archive-inspection, package-metadata-exports, versioning-changelog
- Severity: medium; kind: defect; release impact: blocks verification of ci-release-pipeline, clean-consumer-install, package-archive-inspection, package-metadata-exports, versioning-changelog
- Evidence: ev-one-small-ui-release-packaging-94438ee-26f4e088

### Reproduction

```text
npm run build && npm pack --dry-run --json --ignore-scripts
```

### Root cause

version matches the registry target: package 0.5.0, target 0.6.0 | publish workflow: no workflow runs npm publish (1 workflow(s))

### Failure reason

failed: version matches the registry target, publish workflow

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

