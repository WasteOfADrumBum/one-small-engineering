# OneSmallUI 0.6.0: completion checklist

Derived as of 2026-11-04T16:26:15Z. Status: Not eligible for release. 0 of 22 applicable gates independently verified (0%); 4 open blocker(s).

1. [ ] Test the critical workflows on the candidate commit (critical-workflows) and have the verifier record the result.
2. [ ] Independently re-check the builder evidence for scope-complete, automated-checks, wcag-22-aa, documentation-accurate, package-metadata-exports, clean-consumer-install, runtime-compatibility, package-archive-inspection, supply-chain-review, ci-release-pipeline, versioning-changelog, upgrade-rollback-uninstall-docs, public-docs-accurate; produce evidence for security-privacy-review, keyboard-screen-reader, responsive-layouts; then verify critical-workflows once their blockers are resolved.
3. [ ] Re-collect current evidence for production-deployment on the release candidate and have the verifier re-check it.
4. [ ] Joshua Small reviews the evidence and approves or declines the release (recorded in a registry PR).
5. [ ] Only after approval: publish or deploy, then verify production-deployment, distribution-verified, release-provenance, published-artifact-matches and record the result in the registry.
