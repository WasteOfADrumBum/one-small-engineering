# Cortex 2.0.0: completion checklist

Derived as of 2026-11-14T18:13:38Z. Status: Not eligible for release. 0 of 19 applicable gates independently verified (0%); 4 open blocker(s).

1. [ ] Test the critical workflows on the candidate commit (critical-workflows, e2e-critical-workflows) and have the verifier record the result.
2. [ ] Independently re-check the builder evidence for scope-complete, automated-checks, security-privacy-review, wcag-22-aa, keyboard-screen-reader, responsive-layouts, documentation-accurate, authorization-boundaries, sensitive-data-handling, api-integration-security, integration-failure-handling, deployment-rollback; produce evidence for authentication; then verify critical-workflows, backup-recovery, audit-logging, e2e-critical-workflows once their blockers are resolved.
3. [ ] Resolve blocker live-config-pending: Open: Finances saving, approvals and live Ops data need GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REFRESH_TOKEN (drive.file and calendar.events) and GITHUB_TOKEN set in Vercel by the owner before the live checks can run.
4. [ ] Joshua Small reviews the evidence and approves or declines the release (recorded in a registry PR).
5. [ ] Only after approval: publish or deploy, then verify production-deployment and record the result in the registry.
