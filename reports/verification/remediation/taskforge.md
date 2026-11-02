# TaskForge: issue reports

As of 2026-11-02T18:00:00Z, commit f9f14be45796bf5919e58f6b34ee1636ecd48a77. One section per collector result that is not a pass. Automation proposes no code fix unless a defect's fix is unambiguous; a person decides.

## accessibility: 0 of 3 check(s) passed; 3 not run or inconclusive

- Project: taskforge (https://github.com/WasteOfADrumBum/TaskForge)
- Commit: f9f14be45796bf5919e58f6b34ee1636ecd48a77
- Gate(s): wcag-22-aa
- Severity: low; kind: evidence-gap; release impact: blocks verification of wcag-22-aa
- Evidence: ev-taskforge-accessibility-f9f14be-9670cd35

### Reproduction

```text
node scripts/verify/cli.mjs run --project taskforge --collector accessibility
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

- Project: taskforge (https://github.com/WasteOfADrumBum/TaskForge)
- Commit: f9f14be45796bf5919e58f6b34ee1636ecd48a77
- Gate(s): automated-checks, critical-workflows, e2e-critical-workflows
- Severity: low; kind: evidence-gap; release impact: blocks verification of automated-checks, critical-workflows, e2e-critical-workflows
- Evidence: ev-taskforge-build-test-f9f14be-3185b8aa

### Reproduction

```text
node scripts/verify/cli.mjs run --project taskforge --collector build-test
```

### Root cause

Not established. The collector could not decide; see the failure reason.

### Failure reason

execution is disabled for this run (pass --execute in an isolated job to run project commands)

### Proposed fix

No fix proposed by automation. A person decides the fix.

### Acceptance criteria

The build-test collector reports pass at the new commit, and the verifier records it for automated-checks, critical-workflows, e2e-critical-workflows.

### Verification required

- automated-checks: re-executed by the verifier
- critical-workflows: manual review by the verifier
- e2e-critical-workflows: manual review by the verifier


## CI results: not readable

- Project: taskforge (https://github.com/WasteOfADrumBum/TaskForge)
- Commit: f9f14be45796bf5919e58f6b34ee1636ecd48a77
- Gate(s): automated-checks
- Severity: unclassified; kind: access; release impact: blocks verification of automated-checks
- Evidence: ev-taskforge-ci-results-f9f14be-ef462fd9

### Reproduction

```text
node scripts/verify/cli.mjs run --project taskforge --collector ci-results
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

- Project: taskforge (https://github.com/WasteOfADrumBum/TaskForge)
- Commit: f9f14be45796bf5919e58f6b34ee1636ecd48a77
- Gate(s): deployment-rollback, production-deployment
- Severity: unclassified; kind: access; release impact: blocks verification of deployment-rollback, production-deployment
- Evidence: ev-taskforge-deployment-health-f9f14be-69d2920c

### Reproduction

```text
node scripts/verify/cli.mjs run --project taskforge --collector deployment-health
```

### Root cause

Not established. The collector could not decide; see the failure reason.

### Failure reason

could not reach https://taskforge-alpha-six.vercel.app from this runner

### Proposed fix

No fix proposed by automation. A person decides the fix.

### Acceptance criteria

The deployment-health collector reports pass at the new commit, and the verifier records it for deployment-rollback, production-deployment.

### Verification required

- deployment-rollback: manual review by the verifier
- production-deployment: manual review by the verifier


## documentation: 3 of 4 check(s) passed; 1 not run or inconclusive

- Project: taskforge (https://github.com/WasteOfADrumBum/TaskForge)
- Commit: f9f14be45796bf5919e58f6b34ee1636ecd48a77
- Gate(s): documentation-accurate
- Severity: low; kind: evidence-gap; release impact: blocks verification of documentation-accurate
- Evidence: ev-taskforge-documentation-f9f14be-b74ed9aa

### Reproduction

```text
node scripts/verify/cli.mjs run --project taskforge --collector documentation
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

- Project: taskforge (https://github.com/WasteOfADrumBum/TaskForge)
- Commit: f9f14be45796bf5919e58f6b34ee1636ecd48a77
- Gate(s): automated-checks
- Severity: low; kind: evidence-gap; release impact: blocks verification of automated-checks
- Evidence: ev-taskforge-lint-format-types-f9f14be-f82161a2

### Reproduction

```text
node scripts/verify/cli.mjs run --project taskforge --collector lint-format-types
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


## secret scan: 2 of 3 check(s) passed; 1 not run or inconclusive

- Project: taskforge (https://github.com/WasteOfADrumBum/TaskForge)
- Commit: f9f14be45796bf5919e58f6b34ee1636ecd48a77
- Gate(s): security-privacy-review, sensitive-data-handling
- Severity: low; kind: evidence-gap; release impact: blocks verification of security-privacy-review, sensitive-data-handling
- Evidence: ev-taskforge-secret-scan-f9f14be-22746d50

### Reproduction

```text
node scripts/verify/cli.mjs collect --project <id> --collector secret-scan
```

### Root cause

Not established. The collector could not decide; see the failure reason.

### Failure reason

not run or inconclusive: credential-shaped values in tests and docs (needs human review (often deliberate fixtures): server/src/ai/ollama.test.ts:111 (credentials in URL); server/src/app.test.ts:62 (credentials in URL))

### Proposed fix

No fix proposed by automation. A person decides the fix.

### Acceptance criteria

The secret-scan collector reports pass at the new commit, and the verifier records it for security-privacy-review, sensitive-data-handling.

### Verification required

- security-privacy-review: manual review by the verifier
- sensitive-data-handling: manual review by the verifier

