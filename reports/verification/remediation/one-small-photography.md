# One Small Photography: issue reports

As of 2026-11-02T18:00:00Z, commit fa2d17fd66ee9bb3d92473dc68a6818ea284711b. One section per collector result that is not a pass. Automation proposes no code fix unless a defect's fix is unambiguous; a person decides.

## accessibility: 0 of 3 check(s) passed; 3 not run or inconclusive

- Project: one-small-photography (https://github.com/WasteOfADrumBum/one-small-photography)
- Commit: fa2d17fd66ee9bb3d92473dc68a6818ea284711b
- Gate(s): wcag-22-aa
- Severity: low; kind: evidence-gap; release impact: blocks verification of wcag-22-aa
- Evidence: ev-one-small-photography-accessibility-fa2d17f-1abce92c

### Reproduction

```text
node scripts/verify/cli.mjs run --project one-small-photography --collector accessibility
```

### Root cause

Not established. The collector could not decide; see the failure reason.

### Failure reason

not run or inconclusive: automated accessibility tooling (none declared in package.json); automated accessibility run (no automated accessibility command is configured for this project); manual review (Keyboard, screen reader, zoom and contrast review by a person is required for WCAG 2.2 AA.)

### Proposed fix

No fix proposed by automation. A person decides the fix.

### Acceptance criteria

The accessibility collector reports pass at the new commit, and the verifier records it for wcag-22-aa.

### Verification required

- wcag-22-aa: manual review by the verifier


## build and test: project code was not executed

- Project: one-small-photography (https://github.com/WasteOfADrumBum/one-small-photography)
- Commit: fa2d17fd66ee9bb3d92473dc68a6818ea284711b
- Gate(s): automated-checks, critical-workflows
- Severity: low; kind: evidence-gap; release impact: blocks verification of automated-checks, critical-workflows
- Evidence: ev-one-small-photography-build-test-fa2d17f-6207ff46

### Reproduction

```text
node scripts/verify/cli.mjs run --project one-small-photography --collector build-test
```

### Root cause

Not established. The collector could not decide; see the failure reason.

### Failure reason

execution is disabled for this run (pass --execute in an isolated job to run project commands)

### Proposed fix

No fix proposed by automation. A person decides the fix.

### Acceptance criteria

The build-test collector reports pass at the new commit, and the verifier records it for automated-checks, critical-workflows.

### Verification required

- automated-checks: re-executed by the verifier
- critical-workflows: manual review by the verifier


## CI results: not readable

- Project: one-small-photography (https://github.com/WasteOfADrumBum/one-small-photography)
- Commit: fa2d17fd66ee9bb3d92473dc68a6818ea284711b
- Gate(s): automated-checks
- Severity: unclassified; kind: access; release impact: blocks verification of automated-checks
- Evidence: ev-one-small-photography-ci-results-fa2d17f-05128f81

### Reproduction

```text
node scripts/verify/cli.mjs run --project one-small-photography --collector ci-results
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


## deployment health: 0 of 2 check(s) passed; 2 not run or inconclusive

- Project: one-small-photography (https://github.com/WasteOfADrumBum/one-small-photography)
- Commit: fa2d17fd66ee9bb3d92473dc68a6818ea284711b
- Gate(s): production-deployment
- Severity: unclassified; kind: access; release impact: blocks verification of production-deployment
- Evidence: ev-one-small-photography-deployment-health-fa2d17f-f67b9da9

### Reproduction

```text
node scripts/verify/cli.mjs run --project one-small-photography --collector deployment-health
```

### Root cause

Not established. The collector could not decide; see the failure reason.

### Failure reason

could not reach https://one-small-photography.vercel.app from this runner

### Proposed fix

No fix proposed by automation. A person decides the fix.

### Acceptance criteria

The deployment-health collector reports pass at the new commit, and the verifier records it for production-deployment.

### Verification required

- production-deployment: manual review by the verifier


## documentation: 3 of 4 check(s) passed; 1 not run or inconclusive

- Project: one-small-photography (https://github.com/WasteOfADrumBum/one-small-photography)
- Commit: fa2d17fd66ee9bb3d92473dc68a6818ea284711b
- Gate(s): documentation-accurate
- Severity: low; kind: evidence-gap; release impact: blocks verification of documentation-accurate
- Evidence: ev-one-small-photography-documentation-fa2d17f-25b82d41

### Reproduction

```text
node scripts/verify/cli.mjs run --project one-small-photography --collector documentation
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


## lint, format and types: project code was not executed

- Project: one-small-photography (https://github.com/WasteOfADrumBum/one-small-photography)
- Commit: fa2d17fd66ee9bb3d92473dc68a6818ea284711b
- Gate(s): automated-checks
- Severity: low; kind: evidence-gap; release impact: blocks verification of automated-checks
- Evidence: ev-one-small-photography-lint-format-types-fa2d17f-5a25ef9a

### Reproduction

```text
node scripts/verify/cli.mjs run --project one-small-photography --collector lint-format-types
```

### Root cause

Not established. The collector could not decide; see the failure reason.

### Failure reason

execution is disabled for this run (pass --execute in an isolated job to run project commands)

### Proposed fix

No fix proposed by automation. A person decides the fix.

### Acceptance criteria

The lint-format-types collector reports pass at the new commit, and the verifier records it for automated-checks.

### Verification required

- automated-checks: re-executed by the verifier


## repository structure: 4 of 5 check(s) passed; 1 not run or inconclusive

- Project: one-small-photography (https://github.com/WasteOfADrumBum/one-small-photography)
- Commit: fa2d17fd66ee9bb3d92473dc68a6818ea284711b
- Gate(s): none (context)
- Severity: low; kind: evidence-gap; release impact: context only; no gate depends on it
- Evidence: ev-one-small-photography-repo-structure-fa2d17f-12f4047a

### Reproduction

```text
node scripts/verify/cli.mjs run --project one-small-photography --collector repo-structure
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


## secret scan: 2 of 3 check(s) passed; 1 not run or inconclusive

- Project: one-small-photography (https://github.com/WasteOfADrumBum/one-small-photography)
- Commit: fa2d17fd66ee9bb3d92473dc68a6818ea284711b
- Gate(s): security-privacy-review
- Severity: low; kind: evidence-gap; release impact: blocks verification of security-privacy-review
- Evidence: ev-one-small-photography-secret-scan-fa2d17f-ea7ed43e

### Reproduction

```text
node scripts/verify/cli.mjs collect --project <id> --collector secret-scan
```

### Root cause

Not established. The collector could not decide; see the failure reason.

### Failure reason

not run or inconclusive: credential-shaped values in tests and docs (needs human review (often deliberate fixtures): .github/workflows/ci.yml:42 (credentials in URL))

### Proposed fix

No fix proposed by automation. A person decides the fix.

### Acceptance criteria

The secret-scan collector reports pass at the new commit, and the verifier records it for security-privacy-review.

### Verification required

- security-privacy-review: manual review by the verifier

