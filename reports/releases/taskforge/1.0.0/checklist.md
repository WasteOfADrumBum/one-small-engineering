# TaskForge 1.0.0: completion checklist

Derived as of 2026-11-12T18:11:17Z. Status: Not eligible for release. 0 of 20 applicable gates independently verified (0%); 5 open blocker(s).

1. [ ] Resolve blocker backup-restore-unverified: A real private backup of the production database and an isolated restore have not been run. The export and verify tooling and a synthetic CI drill shipped in KAN-53 (PR #52); the owner must run backup:export and backup:verify against Atlas.
2. [ ] Test the critical workflows on the candidate commit (critical-workflows, e2e-critical-workflows) and have the verifier record the result.
3. [ ] Independently re-check the builder evidence for automated-checks; produce evidence for security-privacy-review, wcag-22-aa, keyboard-screen-reader, responsive-layouts, documentation-accurate, authentication, authorization-boundaries, sensitive-data-handling, api-integration-security, integration-failure-handling, audit-logging, deployment-rollback, user-data-isolation; then verify critical-workflows, backup-recovery, e2e-critical-workflows once their blockers are resolved.
4. [ ] Re-collect current evidence for scope-complete on the release candidate and have the verifier re-check it.
5. [ ] Joshua Small reviews the evidence and approves or declines the release (recorded in a registry PR).
6. [ ] Only after approval: publish or deploy, then verify production-deployment and record the result in the registry.
