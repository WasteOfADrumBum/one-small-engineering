# One Small ModsPack 2.0.0: completion checklist

Derived as of 2026-10-26T02:00:00Z. Status: Not eligible for release. 0 of 21 applicable gates independently verified (0%); 11 open blocker(s).

1. [ ] Record the builder and a different, independent verifier in the registry ownership block (an owner decision).
2. [ ] Resolve blocker codex-interactive-trust: Codex hook enforcement verified only with trust bypassed; interactive /hooks trust not confirmed.
3. [ ] Resolve blocker copilot-gemini-runtime-untested: Copilot and Gemini CLI hook enforcement and custom agents are NOT TESTED; either test in authenticated runtimes or record an owner decision to ship them as experimental.
4. [ ] Test the critical workflows on the candidate commit (critical-workflows) and have the verifier record the result.
5. [ ] Independently re-check the builder evidence for automated-checks, clean-consumer-install, package-archive-inspection, supply-chain-review, versioning-changelog, upgrade-rollback-uninstall-docs; produce evidence for scope-complete, security-privacy-review, package-metadata-exports; then verify wcag-22-aa, keyboard-screen-reader, responsive-layouts, critical-workflows, documentation-accurate, runtime-compatibility, ci-release-pipeline, public-docs-accurate once their blockers are resolved.
6. [ ] Resolve blocker manual-screen-reader-review: Screen reader review (NVDA or similar) of the generated documentation site is NOT TESTED.
7. [ ] Resolve blocker manual-zoom-forced-colors-review: Real 200%/400% browser zoom, text spacing and Windows forced-colors review is NOT TESTED (only viewport-width and emulated checks).
8. [ ] Resolve blocker npm-ownership-access: npm ownership of one-small-modspack and publish access not confirmed; the name is currently unpublished.
9. [ ] Resolve blocker publish-pipeline-missing: No release or publish workflow exists at the candidate commit (only ci.yml), so the package cannot be published from CI with npm provenance. Add a least-privilege publish workflow (manual trigger, npm --provenance) or record an owner decision on how 2.0.0 is published. Proposed by Claude Code in the Phase 3 PR for owner review.
10. [ ] Resolve blocker pr-description-stale: PR #3 description disagrees with docs/release-verification.md at the same head (dependency audit INCONCLUSIVE vs PASS; 55 vs 82 packed files; 85 vs 89 CLI tests). Reconcile before review.
11. [ ] Joshua Small reviews the evidence and approves or declines the release (recorded in a registry PR).
12. [ ] Only after approval: publish or deploy, then verify distribution-verified, release-provenance, published-artifact-matches and record the result in the registry.
