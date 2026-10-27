# One Small Photography: issue reports

As of 2026-10-27T01:56:27Z, commit 45a74bad8a05c47ed7d6027dfb76e621dc16ef8f. One section per collector result that is not a pass. Automation proposes no code fix unless a defect's fix is unambiguous; a person decides.

## accessibility: 0 of 3 check(s) passed; 3 not run or inconclusive

- Project: one-small-photography (https://github.com/WasteOfADrumBum/one-small-photography)
- Commit: 45a74bad8a05c47ed7d6027dfb76e621dc16ef8f
- Gate(s): wcag-22-aa
- Severity: low; kind: evidence-gap; release impact: blocks verification of wcag-22-aa
- Evidence: ev-one-small-photography-accessibility-45a74ba-5ad5aff3

### Reproduction

```text
node scripts/verify/cli.mjs run --project one-small-photography --collector accessibility --execute
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

- Project: one-small-photography (https://github.com/WasteOfADrumBum/one-small-photography)
- Commit: 45a74bad8a05c47ed7d6027dfb76e621dc16ef8f
- Gate(s): automated-checks
- Severity: unclassified; kind: access; release impact: blocks verification of automated-checks
- Evidence: ev-one-small-photography-ci-results-45a74ba-b919d9a0

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
- Commit: 45a74bad8a05c47ed7d6027dfb76e621dc16ef8f
- Gate(s): production-deployment
- Severity: unclassified; kind: access; release impact: blocks verification of production-deployment
- Evidence: ev-one-small-photography-deployment-health-45a74ba-6f7249e7

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
- Commit: 45a74bad8a05c47ed7d6027dfb76e621dc16ef8f
- Gate(s): documentation-accurate
- Severity: low; kind: evidence-gap; release impact: blocks verification of documentation-accurate
- Evidence: ev-one-small-photography-documentation-45a74ba-a1411b23

### Reproduction

```text
node scripts/verify/cli.mjs run --project one-small-photography --collector documentation --execute
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

- Project: one-small-photography (https://github.com/WasteOfADrumBum/one-small-photography)
- Commit: 45a74bad8a05c47ed7d6027dfb76e621dc16ef8f
- Gate(s): none (context)
- Severity: low; kind: evidence-gap; release impact: context only; no gate depends on it
- Evidence: ev-one-small-photography-repo-structure-45a74ba-761de6c0

### Reproduction

```text
node scripts/verify/cli.mjs run --project one-small-photography --collector repo-structure --execute
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
- Commit: 45a74bad8a05c47ed7d6027dfb76e621dc16ef8f
- Gate(s): security-privacy-review
- Severity: low; kind: evidence-gap; release impact: blocks verification of security-privacy-review
- Evidence: ev-one-small-photography-secret-scan-45a74ba-3a0e0c19

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

