# Cortex: issue reports

As of 2026-10-27T01:05:00Z, commit ec49fd7907e9c901e6e4871732c7fe51881e5d3d. One section per collector result that is not a pass. Automation proposes no code fix unless a defect's fix is unambiguous; a person decides.

## accessibility: 0 of 3 check(s) passed; 3 not run or inconclusive

- Project: cortex (https://github.com/WasteOfADrumBum/cortex-brain-task)
- Commit: ec49fd7907e9c901e6e4871732c7fe51881e5d3d
- Gate(s): wcag-22-aa
- Severity: low; kind: evidence-gap; release impact: blocks verification of wcag-22-aa
- Evidence: ev-cortex-accessibility-ec49fd7-27cfef71

### Reproduction

```text
node scripts/verify/cli.mjs run --project cortex --collector accessibility --execute
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


## CI results: not readable

- Project: cortex (https://github.com/WasteOfADrumBum/cortex-brain-task)
- Commit: ec49fd7907e9c901e6e4871732c7fe51881e5d3d
- Gate(s): automated-checks
- Severity: unclassified; kind: access; release impact: blocks verification of automated-checks
- Evidence: ev-cortex-ci-results-ec49fd7-cdd510f0

### Reproduction

```text
node scripts/verify/cli.mjs run --project cortex --collector ci-results --execute
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

- Project: cortex (https://github.com/WasteOfADrumBum/cortex-brain-task)
- Commit: ec49fd7907e9c901e6e4871732c7fe51881e5d3d
- Gate(s): deployment-rollback, production-deployment
- Severity: unclassified; kind: access; release impact: blocks verification of deployment-rollback, production-deployment
- Evidence: ev-cortex-deployment-health-ec49fd7-805608a7

### Reproduction

```text
node scripts/verify/cli.mjs run --project cortex --collector deployment-health --execute
```

### Root cause

Not established. The collector could not decide; see the failure reason.

### Failure reason

could not reach https://cortex-brain-nu.vercel.app from this runner

### Proposed fix

No fix proposed by automation. A person decides the fix.

### Acceptance criteria

The deployment-health collector reports pass at the new commit, and the verifier records it for deployment-rollback, production-deployment.

### Verification required

- deployment-rollback: manual review by the verifier
- production-deployment: manual review by the verifier


## documentation: 3 of 4 check(s) passed; 1 not run or inconclusive

- Project: cortex (https://github.com/WasteOfADrumBum/cortex-brain-task)
- Commit: ec49fd7907e9c901e6e4871732c7fe51881e5d3d
- Gate(s): documentation-accurate
- Severity: low; kind: evidence-gap; release impact: blocks verification of documentation-accurate
- Evidence: ev-cortex-documentation-ec49fd7-e08f6339

### Reproduction

```text
node scripts/verify/cli.mjs run --project cortex --collector documentation --execute
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


## lint, format and types: none configured

- Project: cortex (https://github.com/WasteOfADrumBum/cortex-brain-task)
- Commit: ec49fd7907e9c901e6e4871732c7fe51881e5d3d
- Gate(s): automated-checks
- Severity: low; kind: evidence-gap; release impact: blocks verification of automated-checks
- Evidence: ev-cortex-lint-format-types-ec49fd7-4b9bec16

### Reproduction

```text
node scripts/verify/cli.mjs run --project cortex --collector lint-format-types --execute
```

### Root cause

Not established. The collector could not decide; see the failure reason.

### Failure reason

the project declares no lint, format check or type check script

### Proposed fix

No fix proposed by automation. A person decides the fix.

### Acceptance criteria

The lint-format-types collector reports pass at the new commit, and the verifier records it for automated-checks.

### Verification required

- automated-checks: re-executed by the verifier


## repository structure: 3 of 5 check(s) passed; 2 not run or inconclusive

- Project: cortex (https://github.com/WasteOfADrumBum/cortex-brain-task)
- Commit: ec49fd7907e9c901e6e4871732c7fe51881e5d3d
- Gate(s): none (context)
- Severity: low; kind: evidence-gap; release impact: context only; no gate depends on it
- Evidence: ev-cortex-repo-structure-ec49fd7-0105455c

### Reproduction

```text
node scripts/verify/cli.mjs run --project cortex --collector repo-structure --execute
```

### Root cause

Not established. The collector could not decide; see the failure reason.

### Failure reason

not run or inconclusive: license (absent); workflows (no GitHub Actions workflows)

### Proposed fix

No fix proposed by automation. A person decides the fix.

### Acceptance criteria

The repo-structure collector reports pass.

### Verification required

- None beyond re-collection.

