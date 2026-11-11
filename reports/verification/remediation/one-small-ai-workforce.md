# One Small AI Workforce: issue reports

As of 2026-11-11T03:33:46Z, commit c70d8b117c3c5a046583e7ee83016d4a3ed4b065. One section per collector result that is not a pass. Automation proposes no code fix unless a defect's fix is unambiguous; a person decides.

## accessibility: no checkout

- Project: one-small-ai-workforce (https://github.com/WasteOfADrumBum/one-small-ai-workforce)
- Commit: c70d8b117c3c5a046583e7ee83016d4a3ed4b065
- Gate(s): wcag-22-aa
- Severity: unclassified; kind: access; release impact: blocks verification of wcag-22-aa
- Evidence: ev-one-small-ai-workforce-accessibility-c70d8b1-8770fa90

### Reproduction

```text
node scripts/verify/cli.mjs run --project one-small-ai-workforce --collector accessibility
```

### Root cause

Not established. The collector could not decide; see the failure reason.

### Failure reason

repository not found or not visible without a reader credential (private repositories need one)

### Proposed fix

No fix proposed by automation. A person decides the fix.

### Acceptance criteria

The accessibility collector reports pass at the new commit, and the verifier records it for wcag-22-aa.

### Verification required

- wcag-22-aa: manual review by the verifier


## build and test: no checkout

- Project: one-small-ai-workforce (https://github.com/WasteOfADrumBum/one-small-ai-workforce)
- Commit: c70d8b117c3c5a046583e7ee83016d4a3ed4b065
- Gate(s): automated-checks, critical-workflows, e2e-critical-workflows
- Severity: unclassified; kind: access; release impact: blocks verification of automated-checks, critical-workflows, e2e-critical-workflows
- Evidence: ev-one-small-ai-workforce-build-test-c70d8b1-73f101ba

### Reproduction

```text
node scripts/verify/cli.mjs run --project one-small-ai-workforce --collector build-test
```

### Root cause

Not established. The collector could not decide; see the failure reason.

### Failure reason

repository not found or not visible without a reader credential (private repositories need one)

### Proposed fix

No fix proposed by automation. A person decides the fix.

### Acceptance criteria

The build-test collector reports pass at the new commit, and the verifier records it for automated-checks, critical-workflows, e2e-critical-workflows.

### Verification required

- automated-checks: re-executed by the verifier
- critical-workflows: manual review by the verifier
- e2e-critical-workflows: manual review by the verifier


## CI results: not readable

- Project: one-small-ai-workforce (https://github.com/WasteOfADrumBum/one-small-ai-workforce)
- Commit: c70d8b117c3c5a046583e7ee83016d4a3ed4b065
- Gate(s): automated-checks
- Severity: unclassified; kind: access; release impact: blocks verification of automated-checks
- Evidence: ev-one-small-ai-workforce-ci-results-c70d8b1-1f512833

### Reproduction

```text
node scripts/verify/cli.mjs run --project one-small-ai-workforce --collector ci-results
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


## dependency audit: no checkout

- Project: one-small-ai-workforce (https://github.com/WasteOfADrumBum/one-small-ai-workforce)
- Commit: c70d8b117c3c5a046583e7ee83016d4a3ed4b065
- Gate(s): security-privacy-review
- Severity: unclassified; kind: access; release impact: blocks verification of security-privacy-review
- Evidence: ev-one-small-ai-workforce-dependency-audit-c70d8b1-ad200744

### Reproduction

```text
node scripts/verify/cli.mjs run --project one-small-ai-workforce --collector dependency-audit
```

### Root cause

Not established. The collector could not decide; see the failure reason.

### Failure reason

repository not found or not visible without a reader credential (private repositories need one)

### Proposed fix

No fix proposed by automation. A person decides the fix.

### Acceptance criteria

The dependency-audit collector reports pass at the new commit, and the verifier records it for security-privacy-review.

### Verification required

- security-privacy-review: manual review by the verifier


## documentation: no checkout

- Project: one-small-ai-workforce (https://github.com/WasteOfADrumBum/one-small-ai-workforce)
- Commit: c70d8b117c3c5a046583e7ee83016d4a3ed4b065
- Gate(s): documentation-accurate
- Severity: unclassified; kind: access; release impact: blocks verification of documentation-accurate
- Evidence: ev-one-small-ai-workforce-documentation-c70d8b1-ffee6cea

### Reproduction

```text
node scripts/verify/cli.mjs run --project one-small-ai-workforce --collector documentation
```

### Root cause

Not established. The collector could not decide; see the failure reason.

### Failure reason

repository not found or not visible without a reader credential (private repositories need one)

### Proposed fix

No fix proposed by automation. A person decides the fix.

### Acceptance criteria

The documentation collector reports pass at the new commit, and the verifier records it for documentation-accurate.

### Verification required

- documentation-accurate: manual review by the verifier


## lint, format and types: no checkout

- Project: one-small-ai-workforce (https://github.com/WasteOfADrumBum/one-small-ai-workforce)
- Commit: c70d8b117c3c5a046583e7ee83016d4a3ed4b065
- Gate(s): automated-checks
- Severity: unclassified; kind: access; release impact: blocks verification of automated-checks
- Evidence: ev-one-small-ai-workforce-lint-format-types-c70d8b1-0e87bc58

### Reproduction

```text
node scripts/verify/cli.mjs run --project one-small-ai-workforce --collector lint-format-types
```

### Root cause

Not established. The collector could not decide; see the failure reason.

### Failure reason

repository not found or not visible without a reader credential (private repositories need one)

### Proposed fix

No fix proposed by automation. A person decides the fix.

### Acceptance criteria

The lint-format-types collector reports pass at the new commit, and the verifier records it for automated-checks.

### Verification required

- automated-checks: re-executed by the verifier


## repository not readable

- Project: one-small-ai-workforce (https://github.com/WasteOfADrumBum/one-small-ai-workforce)
- Commit: c70d8b117c3c5a046583e7ee83016d4a3ed4b065
- Gate(s): none (context)
- Severity: unclassified; kind: access; release impact: context only; no gate depends on it
- Evidence: ev-one-small-ai-workforce-repo-structure-c70d8b1-956c945b

### Reproduction

```text
node scripts/verify/cli.mjs run --project one-small-ai-workforce --collector repo-structure
```

### Root cause

Not established. The collector could not decide; see the failure reason.

### Failure reason

repository not found or not visible without a reader credential (private repositories need one)

### Proposed fix

No fix proposed by automation. A person decides the fix.

### Acceptance criteria

The repo-structure collector reports pass.

### Verification required

- None beyond re-collection.


## secret scan: no checkout

- Project: one-small-ai-workforce (https://github.com/WasteOfADrumBum/one-small-ai-workforce)
- Commit: c70d8b117c3c5a046583e7ee83016d4a3ed4b065
- Gate(s): security-privacy-review, sensitive-data-handling
- Severity: unclassified; kind: access; release impact: blocks verification of security-privacy-review, sensitive-data-handling
- Evidence: ev-one-small-ai-workforce-secret-scan-c70d8b1-ade537e3

### Reproduction

```text
node scripts/verify/cli.mjs run --project one-small-ai-workforce --collector secret-scan
```

### Root cause

Not established. The collector could not decide; see the failure reason.

### Failure reason

repository not found or not visible without a reader credential (private repositories need one)

### Proposed fix

No fix proposed by automation. A person decides the fix.

### Acceptance criteria

The secret-scan collector reports pass at the new commit, and the verifier records it for security-privacy-review, sensitive-data-handling.

### Verification required

- security-privacy-review: manual review by the verifier
- sensitive-data-handling: manual review by the verifier

