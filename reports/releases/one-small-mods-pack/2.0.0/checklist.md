# One Small ModsPack 2.0.0: completion checklist

Derived as of 2026-10-30T15:00:00Z. Status: Not eligible for release. 0 of 21 applicable gates independently verified (0%); 23 open blocker(s).

1. [ ] Resolve blocker codex-interactive-trust: Codex hook enforcement verified only with trust bypassed; interactive /hooks trust not confirmed.
2. [ ] Resolve blocker copilot-gemini-runtime-untested: Copilot and Gemini CLI hook enforcement and custom agents are NOT TESTED; either test in authenticated runtimes or record an owner decision to ship them as experimental.
3. [ ] Test the critical workflows on the candidate commit (critical-workflows) and have the verifier record the result.
4. [ ] Produce evidence for security-privacy-review, package-metadata-exports; then verify critical-workflows, documentation-accurate once their blockers are resolved.
5. [ ] Re-collect current evidence for automated-checks on the release candidate and have the verifier re-check it.
6. [ ] Re-collect current evidence for ci-release-pipeline on the release candidate and have the verifier re-check it.
7. [ ] Re-collect current evidence for clean-consumer-install on the release candidate and have the verifier re-check it.
8. [ ] Re-collect current evidence for keyboard-screen-reader on the release candidate and have the verifier re-check it.
9. [ ] Re-collect current evidence for package-archive-inspection on the release candidate and have the verifier re-check it.
10. [ ] Re-collect current evidence for public-docs-accurate on the release candidate and have the verifier re-check it.
11. [ ] Re-collect current evidence for responsive-layouts on the release candidate and have the verifier re-check it.
12. [ ] Re-collect current evidence for runtime-compatibility on the release candidate and have the verifier re-check it.
13. [ ] Re-collect current evidence for scope-complete on the release candidate and have the verifier re-check it.
14. [ ] Re-collect current evidence for supply-chain-review on the release candidate and have the verifier re-check it.
15. [ ] Re-collect current evidence for upgrade-rollback-uninstall-docs on the release candidate and have the verifier re-check it.
16. [ ] Re-collect current evidence for versioning-changelog on the release candidate and have the verifier re-check it.
17. [ ] Re-collect current evidence for wcag-22-aa on the release candidate and have the verifier re-check it.
18. [ ] Resolve blocker manual-screen-reader-review: Screen reader review (NVDA or similar) of the generated documentation site is NOT TESTED.
19. [ ] Resolve blocker manual-zoom-forced-colors-review: Real 200%/400% browser zoom, text spacing and Windows forced-colors review is NOT TESTED (only viewport-width and emulated checks).
20. [ ] Resolve blocker npm-ownership-access: npm ownership of one-small-modspack and publish access not confirmed; the name is currently unpublished.
21. [ ] Resolve blocker publish-pipeline-missing: No release or publish workflow exists at the candidate commit (only ci.yml), so the package cannot be published from CI with npm provenance. Add a least-privilege publish workflow (manual trigger, npm --provenance) or record an owner decision on how 2.0.0 is published. Proposed by Claude Code in the Phase 3 PR for owner review.
22. [ ] Resolve blocker pr-description-stale: PR #3 description disagrees with docs/release-verification.md at the same head (dependency audit INCONCLUSIVE vs PASS; 55 vs 82 packed files; 85 vs 89 CLI tests). Reconcile before review.
23. [ ] Joshua Small reviews the evidence and approves or declines the release (recorded in a registry PR).
24. [ ] Only after approval: publish or deploy, then verify distribution-verified, release-provenance, published-artifact-matches and record the result in the registry.
