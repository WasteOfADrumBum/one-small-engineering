# Personal Portfolio: issue reports

As of 2026-10-27T01:56:27Z, commit 684ef3ce76d62919045cea65259e8bf52f1c6174. One section per collector result that is not a pass. Automation proposes no code fix unless a defect's fix is unambiguous; a person decides.

## accessibility: 0 of 3 check(s) passed; 3 not run or inconclusive

- Project: personal-portfolio (https://github.com/WasteOfADrumBum/joshsmall-site)
- Commit: 684ef3ce76d62919045cea65259e8bf52f1c6174
- Gate(s): wcag-22-aa
- Severity: low; kind: evidence-gap; release impact: blocks verification of wcag-22-aa
- Evidence: ev-personal-portfolio-accessibility-684ef3c-baee89e7

### Reproduction

```text
node scripts/verify/cli.mjs run --project personal-portfolio --collector accessibility --execute
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

- Project: personal-portfolio (https://github.com/WasteOfADrumBum/joshsmall-site)
- Commit: 684ef3ce76d62919045cea65259e8bf52f1c6174
- Gate(s): automated-checks
- Severity: unclassified; kind: access; release impact: blocks verification of automated-checks
- Evidence: ev-personal-portfolio-ci-results-684ef3c-c2193761

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


## dependency audit: critical 1, high 1, moderate 0, low 0, info 0

- Project: personal-portfolio (https://github.com/WasteOfADrumBum/joshsmall-site)
- Commit: 684ef3ce76d62919045cea65259e8bf52f1c6174
- Gate(s): security-privacy-review
- Severity: high; kind: defect; release impact: blocks verification of security-privacy-review
- Evidence: ev-personal-portfolio-dependency-audit-684ef3c-448e5446

### Reproduction

```text
npm audit --json --package-lock-only (at 684ef3c)
```

### Root cause

npm audit: critical 1, high 1, moderate 0, low 0, info 0 across 448 packages

### Failure reason

critical or high advisories: next, zod

### Proposed fix

No fix proposed by automation. A person decides the fix.

### Acceptance criteria

The dependency-audit collector reports pass at the new commit, and the verifier records it for security-privacy-review.

### Verification required

- security-privacy-review: manual review by the verifier


## deployment health: 0 of 2 check(s) passed; 2 not run or inconclusive

- Project: personal-portfolio (https://github.com/WasteOfADrumBum/joshsmall-site)
- Commit: 684ef3ce76d62919045cea65259e8bf52f1c6174
- Gate(s): production-deployment
- Severity: unclassified; kind: access; release impact: blocks verification of production-deployment
- Evidence: ev-personal-portfolio-deployment-health-684ef3c-45447d7c

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
- Commit: 684ef3ce76d62919045cea65259e8bf52f1c6174
- Gate(s): documentation-accurate
- Severity: low; kind: evidence-gap; release impact: blocks verification of documentation-accurate
- Evidence: ev-personal-portfolio-documentation-684ef3c-b200612c

### Reproduction

```text
node scripts/verify/cli.mjs run --project personal-portfolio --collector documentation --execute
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


## repository structure: 3 of 5 check(s) passed; 2 not run or inconclusive

- Project: personal-portfolio (https://github.com/WasteOfADrumBum/joshsmall-site)
- Commit: 684ef3ce76d62919045cea65259e8bf52f1c6174
- Gate(s): none (context)
- Severity: low; kind: evidence-gap; release impact: context only; no gate depends on it
- Evidence: ev-personal-portfolio-repo-structure-684ef3c-0662185a

### Reproduction

```text
node scripts/verify/cli.mjs run --project personal-portfolio --collector repo-structure --execute
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

