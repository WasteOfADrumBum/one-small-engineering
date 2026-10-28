# TaskForge: issue reports

As of 2026-10-27T03:40:00Z, commit 11975d0278c7f04db5033c0461295c734e3b4134. One section per collector result that is not a pass. Automation proposes no code fix unless a defect's fix is unambiguous; a person decides.

## accessibility: 0 of 3 check(s) passed; 3 not run or inconclusive

- Project: taskforge (https://github.com/WasteOfADrumBum/TaskForge)
- Commit: 11975d0278c7f04db5033c0461295c734e3b4134
- Gate(s): wcag-22-aa
- Severity: low; kind: evidence-gap; release impact: blocks verification of wcag-22-aa
- Evidence: ev-taskforge-accessibility-11975d0-5d28a392

### Reproduction

```text
node scripts/verify/cli.mjs run --project taskforge --collector accessibility --execute
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

- Project: taskforge (https://github.com/WasteOfADrumBum/TaskForge)
- Commit: 11975d0278c7f04db5033c0461295c734e3b4134
- Gate(s): automated-checks
- Severity: unclassified; kind: access; release impact: blocks verification of automated-checks
- Evidence: ev-taskforge-ci-results-11975d0-6ee2dff9

### Reproduction

```text
node scripts/verify/cli.mjs run --project taskforge --collector ci-results --execute
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


## dependency audit: critical 0, high 4, moderate 3, low 0, info 0

- Project: taskforge (https://github.com/WasteOfADrumBum/TaskForge)
- Commit: 11975d0278c7f04db5033c0461295c734e3b4134
- Gate(s): security-privacy-review
- Severity: high; kind: defect; release impact: blocks verification of security-privacy-review
- Evidence: ev-taskforge-dependency-audit-11975d0-930082be

### Reproduction

```text
npm audit --json --package-lock-only (at 11975d0)
```

### Root cause

npm audit: critical 0, high 4, moderate 3, low 0, info 0 across 1101 packages

### Failure reason

critical or high advisories: body-parser, undici, vite, zod

### Proposed fix

No fix proposed by automation. A person decides the fix.

### Acceptance criteria

The dependency-audit collector reports pass at the new commit, and the verifier records it for security-privacy-review.

### Verification required

- security-privacy-review: manual review by the verifier


## deployment health: 1 of 2 check(s) passed; 1 not run or inconclusive

- Project: taskforge (https://github.com/WasteOfADrumBum/TaskForge)
- Commit: 11975d0278c7f04db5033c0461295c734e3b4134
- Gate(s): deployment-rollback, production-deployment
- Severity: unclassified; kind: access; release impact: blocks verification of deployment-rollback, production-deployment
- Evidence: ev-taskforge-deployment-health-11975d0-6024ae7e

### Reproduction

```text
node scripts/verify/cli.mjs run --project taskforge --collector deployment-health --execute
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
- Commit: 11975d0278c7f04db5033c0461295c734e3b4134
- Gate(s): documentation-accurate
- Severity: low; kind: evidence-gap; release impact: blocks verification of documentation-accurate
- Evidence: ev-taskforge-documentation-11975d0-132d686c

### Reproduction

```text
node scripts/verify/cli.mjs run --project taskforge --collector documentation --execute
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


## secret scan: 2 of 3 check(s) passed; 1 not run or inconclusive

- Project: taskforge (https://github.com/WasteOfADrumBum/TaskForge)
- Commit: 11975d0278c7f04db5033c0461295c734e3b4134
- Gate(s): security-privacy-review, sensitive-data-handling
- Severity: low; kind: evidence-gap; release impact: blocks verification of security-privacy-review, sensitive-data-handling
- Evidence: ev-taskforge-secret-scan-11975d0-8442003a

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

