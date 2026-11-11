# Personal Portfolio: issue reports

As of 2026-11-11T03:33:46Z, commit 56ea76e631008695d6b8c4cd6ee8fecd2ae5e302. One section per collector result that is not a pass. Automation proposes no code fix unless a defect's fix is unambiguous; a person decides.

## accessibility: 0 of 3 check(s) passed; 3 not run or inconclusive

- Project: personal-portfolio (https://github.com/WasteOfADrumBum/joshsmall-site)
- Commit: 56ea76e631008695d6b8c4cd6ee8fecd2ae5e302
- Gate(s): wcag-22-aa
- Severity: low; kind: evidence-gap; release impact: blocks verification of wcag-22-aa
- Evidence: ev-personal-portfolio-accessibility-56ea76e-a1e62722

### Reproduction

```text
node scripts/verify/cli.mjs run --project personal-portfolio --collector accessibility
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

- Project: personal-portfolio (https://github.com/WasteOfADrumBum/joshsmall-site)
- Commit: 56ea76e631008695d6b8c4cd6ee8fecd2ae5e302
- Gate(s): automated-checks, critical-workflows
- Severity: low; kind: evidence-gap; release impact: blocks verification of automated-checks, critical-workflows
- Evidence: ev-personal-portfolio-build-test-56ea76e-03122acd

### Reproduction

```text
node scripts/verify/cli.mjs run --project personal-portfolio --collector build-test
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

- Project: personal-portfolio (https://github.com/WasteOfADrumBum/joshsmall-site)
- Commit: 56ea76e631008695d6b8c4cd6ee8fecd2ae5e302
- Gate(s): automated-checks
- Severity: unclassified; kind: access; release impact: blocks verification of automated-checks
- Evidence: ev-personal-portfolio-ci-results-56ea76e-ea76ee50

### Reproduction

```text
node scripts/verify/cli.mjs run --project personal-portfolio --collector ci-results
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

- Project: personal-portfolio (https://github.com/WasteOfADrumBum/joshsmall-site)
- Commit: 56ea76e631008695d6b8c4cd6ee8fecd2ae5e302
- Gate(s): production-deployment
- Severity: unclassified; kind: access; release impact: blocks verification of production-deployment
- Evidence: ev-personal-portfolio-deployment-health-56ea76e-439cbcc3

### Reproduction

```text
node scripts/verify/cli.mjs run --project personal-portfolio --collector deployment-health
```

### Root cause

Not established. The collector could not decide; see the failure reason.

### Failure reason

could not reach https://joshsmall-portfolio.vercel.app from this runner

### Proposed fix

No fix proposed by automation. A person decides the fix.

### Acceptance criteria

The deployment-health collector reports pass at the new commit, and the verifier records it for production-deployment.

### Verification required

- production-deployment: manual review by the verifier


## documentation: 3 of 4 check(s) passed; 1 not run or inconclusive

- Project: personal-portfolio (https://github.com/WasteOfADrumBum/joshsmall-site)
- Commit: 56ea76e631008695d6b8c4cd6ee8fecd2ae5e302
- Gate(s): documentation-accurate
- Severity: low; kind: evidence-gap; release impact: blocks verification of documentation-accurate
- Evidence: ev-personal-portfolio-documentation-56ea76e-85fea46c

### Reproduction

```text
node scripts/verify/cli.mjs run --project personal-portfolio --collector documentation
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

- Project: personal-portfolio (https://github.com/WasteOfADrumBum/joshsmall-site)
- Commit: 56ea76e631008695d6b8c4cd6ee8fecd2ae5e302
- Gate(s): automated-checks
- Severity: low; kind: evidence-gap; release impact: blocks verification of automated-checks
- Evidence: ev-personal-portfolio-lint-format-types-56ea76e-4b2bfc2f

### Reproduction

```text
node scripts/verify/cli.mjs run --project personal-portfolio --collector lint-format-types
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


## repository structure: 3 of 5 check(s) passed; 2 not run or inconclusive

- Project: personal-portfolio (https://github.com/WasteOfADrumBum/joshsmall-site)
- Commit: 56ea76e631008695d6b8c4cd6ee8fecd2ae5e302
- Gate(s): none (context)
- Severity: low; kind: evidence-gap; release impact: context only; no gate depends on it
- Evidence: ev-personal-portfolio-repo-structure-56ea76e-fb62f904

### Reproduction

```text
node scripts/verify/cli.mjs run --project personal-portfolio --collector repo-structure
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

