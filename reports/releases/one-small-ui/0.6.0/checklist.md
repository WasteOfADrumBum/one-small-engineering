# OneSmallUI 0.6.0: completion checklist

Derived as of 2026-10-31T01:00:00Z. Status: Not scoped (no target version or scope document). 0 of 22 applicable gates independently verified (0%); 4 open blocker(s).

1. [ ] Resolve blocker scope-document-missing: No v0.6.0 / Phase 5 page-blocks scope document exists in the repository; scope cannot be frozen.
2. [ ] Test the critical workflows on the candidate commit (critical-workflows) and have the verifier record the result.
3. [ ] Independently re-check the builder evidence for automated-checks; produce evidence for security-privacy-review, wcag-22-aa, keyboard-screen-reader, responsive-layouts, documentation-accurate, package-metadata-exports, clean-consumer-install, runtime-compatibility, package-archive-inspection, supply-chain-review, ci-release-pipeline, versioning-changelog, upgrade-rollback-uninstall-docs, public-docs-accurate; then verify scope-complete, critical-workflows once their blockers are resolved.
4. [ ] Joshua Small reviews the evidence and approves or declines the release (recorded in a registry PR).
5. [ ] Only after approval: publish or deploy, then verify production-deployment, distribution-verified, release-provenance, published-artifact-matches and record the result in the registry.
