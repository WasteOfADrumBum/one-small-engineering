# One Small ModsPack 2.0.0: completion checklist

Derived as of 2026-11-11T05:47:35Z. Status: Not eligible for release. 0 of 21 applicable gates independently verified (0%); 19 open blocker(s).

1. [ ] Resolve blocker codex-interactive-trust: Codex hook enforcement verified only with trust bypassed (0.159.3); interactive /hooks trust not confirmed (manual-acceptance row P1). No OpenAI credentials in the agent container on 2026-11-04.
2. [ ] Resolve blocker copilot-gemini-runtime-untested: Copilot and Gemini CLI hook enforcement, custom agents and model use are NOT TESTED (discovery verified 2026-10-31 in Copilot CLI 1.0.105 and Gemini CLI 0.66.0; no credentials in the agent container on 2026-11-04). Owner decision: test (manual-acceptance rows P2, P3) or mark DEFERRED-BY-OWNER and ship as unverified.
3. [ ] Test the critical workflows on the candidate commit (critical-workflows) and have the verifier record the result.
4. [ ] Independently re-check the builder evidence for automated-checks; produce evidence for scope-complete, security-privacy-review, documentation-accurate, package-metadata-exports; then verify critical-workflows once their blockers are resolved.
5. [ ] Re-collect current evidence for ci-release-pipeline on the release candidate and have the verifier re-check it.
6. [ ] Re-collect current evidence for clean-consumer-install on the release candidate and have the verifier re-check it.
7. [ ] Re-collect current evidence for keyboard-screen-reader on the release candidate and have the verifier re-check it.
8. [ ] Re-collect current evidence for package-archive-inspection on the release candidate and have the verifier re-check it.
9. [ ] Re-collect current evidence for public-docs-accurate on the release candidate and have the verifier re-check it.
10. [ ] Re-collect current evidence for responsive-layouts on the release candidate and have the verifier re-check it.
11. [ ] Re-collect current evidence for runtime-compatibility on the release candidate and have the verifier re-check it.
12. [ ] Re-collect current evidence for supply-chain-review on the release candidate and have the verifier re-check it.
13. [ ] Re-collect current evidence for upgrade-rollback-uninstall-docs on the release candidate and have the verifier re-check it.
14. [ ] Re-collect current evidence for versioning-changelog on the release candidate and have the verifier re-check it.
15. [ ] Re-collect current evidence for wcag-22-aa on the release candidate and have the verifier re-check it.
16. [ ] Resolve blocker manual-screen-reader-review: Screen reader review (NVDA or similar) of the generated documentation site is NOT TESTED.
17. [ ] Resolve blocker manual-zoom-forced-colors-review: Real 200%/400% browser zoom, text spacing and Windows forced-colors review is NOT TESTED (only viewport-width and emulated checks).
18. [ ] Resolve blocker npm-ownership-access: npm account access for publishing one-small-modspack not confirmed by the owner; the name is still unpublished (npm view E404 on 2026-11-04, which is not a reservation). The npm-publish environment and a first-publication token are owner setup steps (release/README.md).
19. [ ] Joshua Small reviews the evidence and approves or declines the release (recorded in a registry PR).
20. [ ] Only after approval: publish or deploy, then verify distribution-verified, release-provenance, published-artifact-matches and record the result in the registry.
