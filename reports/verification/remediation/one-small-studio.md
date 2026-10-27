# One Small Studio: issue reports

As of 2026-10-27T01:05:00Z, commit 175cef6bafbc0322e0d54cf3e543aafa1626a049. One section per collector result that is not a pass. Automation proposes no code fix unless a defect's fix is unambiguous; a person decides.

## accessibility: 1 of 3 check(s) passed; 2 not run or inconclusive

- Project: one-small-studio (https://github.com/WasteOfADrumBum/one-small-studio)
- Commit: 175cef6bafbc0322e0d54cf3e543aafa1626a049
- Gate(s): wcag-22-aa
- Severity: low; kind: evidence-gap; release impact: blocks verification of wcag-22-aa
- Evidence: ev-one-small-studio-accessibility-175cef6-363512db

### Reproduction

```text
node scripts/verify/cli.mjs run --project one-small-studio --collector accessibility --execute
```

### Root cause

Not established. The collector could not decide; see the failure reason.

### Failure reason

not run or inconclusive: automated accessibility run (no automated accessibility command is configured for this project); manual review (Keyboard, screen reader, zoom and contrast review by a person is required for WCAG 2.2 AA.)

### Proposed fix

No fix proposed by automation. A person decides the fix.

### Acceptance criteria

The accessibility collector reports pass at the new commit, and the verifier records it for wcag-22-aa.

### Verification required

- wcag-22-aa: manual review by the verifier


## CI results: not readable

- Project: one-small-studio (https://github.com/WasteOfADrumBum/one-small-studio)
- Commit: 175cef6bafbc0322e0d54cf3e543aafa1626a049
- Gate(s): automated-checks
- Severity: unclassified; kind: access; release impact: blocks verification of automated-checks
- Evidence: ev-one-small-studio-ci-results-175cef6-f298f2b3

### Reproduction

```text
node scripts/verify/cli.mjs run --project one-small-studio --collector ci-results --execute
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


## dependency audit: critical 0, high 2, moderate 0, low 0, info 0

- Project: one-small-studio (https://github.com/WasteOfADrumBum/one-small-studio)
- Commit: 175cef6bafbc0322e0d54cf3e543aafa1626a049
- Gate(s): security-privacy-review
- Severity: high; kind: defect; release impact: blocks verification of security-privacy-review
- Evidence: ev-one-small-studio-dependency-audit-175cef6-fd8b01aa

### Reproduction

```text
npm audit --json --package-lock-only (at 175cef6)
```

### Root cause

npm audit: critical 0, high 2, moderate 0, low 0, info 0 across 443 packages

### Failure reason

critical or high advisories: body-parser, zod

### Proposed fix

No fix proposed by automation. A person decides the fix.

### Acceptance criteria

The dependency-audit collector reports pass at the new commit, and the verifier records it for security-privacy-review.

### Verification required

- security-privacy-review: manual review by the verifier


## deployment health: 1 of 2 check(s) passed; 1 not run or inconclusive

- Project: one-small-studio (https://github.com/WasteOfADrumBum/one-small-studio)
- Commit: 175cef6bafbc0322e0d54cf3e543aafa1626a049
- Gate(s): production-deployment
- Severity: unclassified; kind: access; release impact: blocks verification of production-deployment
- Evidence: ev-one-small-studio-deployment-health-175cef6-f5e271b7

### Reproduction

```text
node scripts/verify/cli.mjs run --project one-small-studio --collector deployment-health --execute
```

### Root cause

Not established. The collector could not decide; see the failure reason.

### Failure reason

could not reach https://one-small-studio.vercel.app from this runner

### Proposed fix

No fix proposed by automation. A person decides the fix.

### Acceptance criteria

The deployment-health collector reports pass at the new commit, and the verifier records it for production-deployment.

### Verification required

- production-deployment: manual review by the verifier


## documentation: 3 of 4 check(s) passed; 1 not run or inconclusive

- Project: one-small-studio (https://github.com/WasteOfADrumBum/one-small-studio)
- Commit: 175cef6bafbc0322e0d54cf3e543aafa1626a049
- Gate(s): documentation-accurate
- Severity: low; kind: evidence-gap; release impact: blocks verification of documentation-accurate
- Evidence: ev-one-small-studio-documentation-175cef6-4ba9575d

### Reproduction

```text
node scripts/verify/cli.mjs run --project one-small-studio --collector documentation --execute
```

### Root cause

Not established. The collector could not decide; see the failure reason.

### Failure reason

not run or inconclusive: accuracy against behaviour (whether the documentation matches the product is a manual review)

### Proposed fix

No fix proposed by automation. A person decides the fix.

### Acceptance criteria

The documentation collector reports pass at the new commit, and the verifier records it for documentation-accurate.

### Verification required

- documentation-accurate: manual review by the verifier


## repository structure: 4 of 5 check(s) passed; 1 not run or inconclusive

- Project: one-small-studio (https://github.com/WasteOfADrumBum/one-small-studio)
- Commit: 175cef6bafbc0322e0d54cf3e543aafa1626a049
- Gate(s): none (context)
- Severity: low; kind: evidence-gap; release impact: context only; no gate depends on it
- Evidence: ev-one-small-studio-repo-structure-175cef6-d86527ca

### Reproduction

```text
node scripts/verify/cli.mjs run --project one-small-studio --collector repo-structure --execute
```

### Root cause

Not established. The collector could not decide; see the failure reason.

### Failure reason

not run or inconclusive: license (absent)

### Proposed fix

No fix proposed by automation. A person decides the fix.

### Acceptance criteria

The repo-structure collector reports pass.

### Verification required

- None beyond re-collection.

