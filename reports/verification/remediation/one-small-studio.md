# One Small Studio: issue reports

As of 2026-11-02T18:40:00Z, commit d6854deb5cb40e248a7b464f7995b08ce93aaf5e. One section per collector result that is not a pass. Automation proposes no code fix unless a defect's fix is unambiguous; a person decides.

## accessibility: 1 of 3 check(s) passed; 2 not run or inconclusive

- Project: one-small-studio (https://github.com/WasteOfADrumBum/one-small-studio)
- Commit: d6854deb5cb40e248a7b464f7995b08ce93aaf5e
- Gate(s): wcag-22-aa
- Severity: low; kind: evidence-gap; release impact: blocks verification of wcag-22-aa
- Evidence: ev-one-small-studio-accessibility-d6854de-a3117ac6

### Reproduction

```text
node scripts/verify/cli.mjs run --project one-small-studio --collector accessibility
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


## build and test: project code was not executed

- Project: one-small-studio (https://github.com/WasteOfADrumBum/one-small-studio)
- Commit: d6854deb5cb40e248a7b464f7995b08ce93aaf5e
- Gate(s): automated-checks, critical-workflows
- Severity: low; kind: evidence-gap; release impact: blocks verification of automated-checks, critical-workflows
- Evidence: ev-one-small-studio-build-test-d6854de-f7c2444f

### Reproduction

```text
node scripts/verify/cli.mjs run --project one-small-studio --collector build-test
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

- Project: one-small-studio (https://github.com/WasteOfADrumBum/one-small-studio)
- Commit: d6854deb5cb40e248a7b464f7995b08ce93aaf5e
- Gate(s): automated-checks
- Severity: unclassified; kind: access; release impact: blocks verification of automated-checks
- Evidence: ev-one-small-studio-ci-results-d6854de-fa913bb0

### Reproduction

```text
node scripts/verify/cli.mjs run --project one-small-studio --collector ci-results
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


## deployment health: 1 of 2 check(s) passed; 1 not run or inconclusive

- Project: one-small-studio (https://github.com/WasteOfADrumBum/one-small-studio)
- Commit: d6854deb5cb40e248a7b464f7995b08ce93aaf5e
- Gate(s): production-deployment
- Severity: unclassified; kind: access; release impact: blocks verification of production-deployment
- Evidence: ev-one-small-studio-deployment-health-d6854de-970cfe92

### Reproduction

```text
node scripts/verify/cli.mjs run --project one-small-studio --collector deployment-health
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
- Commit: d6854deb5cb40e248a7b464f7995b08ce93aaf5e
- Gate(s): documentation-accurate
- Severity: low; kind: evidence-gap; release impact: blocks verification of documentation-accurate
- Evidence: ev-one-small-studio-documentation-d6854de-f5f494e3

### Reproduction

```text
node scripts/verify/cli.mjs run --project one-small-studio --collector documentation
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

- Project: one-small-studio (https://github.com/WasteOfADrumBum/one-small-studio)
- Commit: d6854deb5cb40e248a7b464f7995b08ce93aaf5e
- Gate(s): automated-checks
- Severity: low; kind: evidence-gap; release impact: blocks verification of automated-checks
- Evidence: ev-one-small-studio-lint-format-types-d6854de-e3c97668

### Reproduction

```text
node scripts/verify/cli.mjs run --project one-small-studio --collector lint-format-types
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

- Project: one-small-studio (https://github.com/WasteOfADrumBum/one-small-studio)
- Commit: d6854deb5cb40e248a7b464f7995b08ce93aaf5e
- Gate(s): none (context)
- Severity: low; kind: evidence-gap; release impact: context only; no gate depends on it
- Evidence: ev-one-small-studio-repo-structure-d6854de-4cd6c1c4

### Reproduction

```text
node scripts/verify/cli.mjs run --project one-small-studio --collector repo-structure
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

