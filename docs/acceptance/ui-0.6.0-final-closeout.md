# One Small UI 0.6.0: final closeout package

Prepared 2026-11-11 by Claude Code for Joshua Small's review. Status: **attested and approved**. Joshua Small signed the package on [PR #181](https://github.com/WasteOfADrumBum/one-small-engineering/pull/181#issuecomment-6784298549) on 2026-11-11; the registry records it as evidence `ui-owner-final-verification-2026-11-11`.

This follows the same pattern as [the showcase closeout](final-closeout-2026-11-03.md): Joshua Small, the assigned human verifier, reviews the linked evidence and records one attestation. Earlier builder-reported results keep their provenance; no test is represented as newly run.

## Release identity

- Package: `@onesmall/ui@0.6.0` on [npm](https://www.npmjs.com/package/@onesmall/ui/v/0.6.0), tag [v0.6.0](https://github.com/WasteOfADrumBum/one-small-ui/releases/tag/v0.6.0).
- Release candidate: `9a13c9e22d094a95364262a1ae89f666febac892`, [release CI](https://github.com/WasteOfADrumBum/one-small-ui/actions/runs/41269483773) green (consumer Node 18/20/22/24, Linux, Windows, accessibility, layout).
- Docs site: Vercel deployment of `408b884`, a docs-only difference from the candidate.
- Prior review and the provenance decision: [ui-0.6.0-closeout-review.md](ui-0.6.0-closeout-review.md).

## Gate evidence map (22 applicable gates)

| Gate                            | Evidence for review                                                                                                                                                                                                                                              |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| scope-complete                  | [0.6.0 scope R1–R9](https://github.com/WasteOfADrumBum/one-small-ui/blob/9a13c9e22d094a95364262a1ae89f666febac892/docs/releases/0.6.0-scope.md), [closeout PR #36](https://github.com/WasteOfADrumBum/one-small-ui/pull/36)                                      |
| automated-checks                | [Release CI on 9a13c9e](https://github.com/WasteOfADrumBum/one-small-ui/actions/runs/41269483773)                                                                                                                                                                |
| security-privacy-review         | [Readiness report §C](https://github.com/WasteOfADrumBum/one-small-ui/blob/408b8844db13037a22c718b790f0d769a910803a/docs/releases/0.6.0-readiness.md): production audit 0, dev audit 0 critical/high, 2 moderate dev-only advisories (owner-accepted 2026-11-02) |
| wcag-22-aa                      | Readiness §D (axe, jest-axe, contrast, 1,243 layout checks) plus the owner's Chrome and Windows Narrator acceptance ([closeout-2026-11-02](closeout-2026-11-02.md))                                                                                              |
| keyboard-screen-reader          | Owner's Chrome and Windows Narrator acceptance, limited to that environment                                                                                                                                                                                      |
| responsive-layouts              | Readiness §D: target size, reflow and short-viewport fixtures in Chromium; Firefox/WebKit short-viewport is roadmap item E2                                                                                                                                      |
| critical-workflows              | Readiness §E and §G: packed-tarball consumer apps (React 18/19, ESM/CJS, SSR, hydration) and the 48-check consumer smoke                                                                                                                                         |
| production-deployment           | Vercel deployment of 408b884 serving the docs                                                                                                                                                                                                                    |
| documentation-accurate          | Owner accepted the live docs (2026-11-02); README inventory and upgrade notes in PR #34                                                                                                                                                                          |
| no-release-blockers             | This package: no open release blocker once the provenance exception below is accepted                                                                                                                                                                            |
| package-metadata-exports        | Readiness §E and §G                                                                                                                                                                                                                                              |
| clean-consumer-install          | Readiness §E (clean installs of the packed tarball)                                                                                                                                                                                                              |
| runtime-compatibility           | Readiness §E (Node 18–24, React 18/19)                                                                                                                                                                                                                           |
| package-archive-inspection      | Readiness §G                                                                                                                                                                                                                                                     |
| supply-chain-review             | Readiness §C plus the owner's acceptance of the 2 dev-only advisories                                                                                                                                                                                            |
| ci-release-pipeline             | Readiness report; later hardened by [one-small-ui#38](https://github.com/WasteOfADrumBum/one-small-ui/pull/38) (0.6.1 dry run passed, nothing published)                                                                                                         |
| versioning-changelog            | CHANGELOG and release notes (PR #34)                                                                                                                                                                                                                             |
| distribution-verified           | npm `latest` is 0.6.0 under @onesmall/ui                                                                                                                                                                                                                         |
| release-provenance              | **Exception:** 0.6.0 has no npm provenance and an unsigned tag; it relies on the published integrity matching the reproduced candidate tarball. Provenance via trusted publishing ships with the next release (roadmap E5)                                       |
| upgrade-rollback-uninstall-docs | Readiness report and PR #34                                                                                                                                                                                                                                      |
| public-docs-accurate            | Owner accepted the live docs (2026-11-02)                                                                                                                                                                                                                        |
| published-artifact-matches      | npm `dist.integrity` equals the candidate tarball sha512 in the readiness report                                                                                                                                                                                 |

## Proposed owner attestation

To close 0.6.0, Joshua Small posts this (or his own wording) as a comment on this pull request:

> I reviewed and accept the One Small UI 0.6.0 closeout package. I confirm my recorded manual checks and accept the linked evidence for the 22 applicable gates. I accept that 0.6.0 shipped without npm provenance or a signed tag, relying on the documented integrity and reproducible build, and provenance comes with the next release. I approve release 0.6.0. Record my verification and approval, move it to maintenance, and merge once checks pass.

After that comment, the registry gates cite it as his verifier attestation, approval is recorded with its date, reports are regenerated, and this PR merges.
