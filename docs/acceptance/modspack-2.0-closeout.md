# ModsPack 2.0.0: closeout package

Prepared 2026-11-11 by Claude Code for Joshua Small's review. Status: **attested and approved**. Joshua Small signed the package on [PR #196](https://github.com/WasteOfADrumBum/one-small-engineering/pull/196#issuecomment-6796287364) on 2026-11-11; the registry records it as evidence `msp-owner-final-verification-2026-11-11`.

`one-small-modspack@2.0.0` is published on npm. This page follows [the UI 0.6.0 closeout](ui-0.6.0-final-closeout.md) and [the Cortex 1.0 closeout](cortex-1.0-closeout.md): Joshua Small, the assigned human verifier, reviews the linked evidence and records one attestation. Builder evidence keeps its provenance; no test is represented as newly run.

## Release identity

- Package: [one-small-modspack 2.0.0](https://www.npmjs.com/package/one-small-modspack/v/2.0.0), dist-tag `latest`, published 2026-11-11 10:35 UTC.
- Source: commit [03ab44a](https://github.com/WasteOfADrumBum/one-small-mods-pack/commit/03ab44a4f4be78e8298371eaabdb4d35cf1874a0), Joshua Small's sign-off commit (`Owner sign-off: Joshua Small on 2026-11-11` in `release/2.0.0/manual-acceptance.md`).
- Published by the Release (npm) workflow, mode `publish`, started by Joshua Small with the authorization phrase for 03ab44a: [run 42989562213, attempt 3](https://github.com/WasteOfADrumBum/one-small-mods-pack/actions/runs/42989562213/attempts/3). The run shows red only because its final "confirm the registry serves it" step gave up before the registry caught up (about 3 minutes); [mods-pack#11](https://github.com/WasteOfADrumBum/one-small-mods-pack/pull/11) makes that step wait 5 minutes and warn instead of failing.
- Provenance: npm shows an SLSA v1 provenance attestation for 2.0.0. The registry integrity (`sha512-89/SGyBr…cmyqb+OQ==`, 82 files) matches the tarball the workflow built.
- CI on 03ab44a: [run 42969970860](https://github.com/WasteOfADrumBum/one-small-mods-pack/actions/runs/42969970860) green; release dry run on 03ab44a: [run 42970116646](https://github.com/WasteOfADrumBum/one-small-mods-pack/actions/runs/42970116646) green.
- Not yet done (owner steps, not release gates): GitHub release `v2.0.0` and the documentation website deploy (optional hosting, ModsPack ROADMAP.md R5; the build-mode run on 03ab44a passed).

## Gate evidence map (22 library gates)

### Evidence for review (verified only by Joshua Small's attestation)

| Gate | Evidence |
| --- | --- |
| scope-complete | 2.0.0 scope in [release/2.0.0/tracker.md](https://github.com/WasteOfADrumBum/one-small-mods-pack/blob/03ab44a4f4be78e8298371eaabdb4d35cf1874a0/release/2.0.0/tracker.md); everything else is in ROADMAP.md |
| automated-checks | CI on 03ab44a (cli, mods, windows, site, Node 20/24, macOS) and the dry run on 03ab44a |
| security-privacy-review | Builder review on this page (below) |
| critical-workflows | CI's packed-artifact smoke test packs the tarball, installs it, validates and initializes every platform |
| documentation-accurate | README, docs/getting-started.md and the compatibility catalog, which labels each platform's verification level |
| no-release-blockers | No open blocker once the six open blockers are resolved as listed below |
| package-metadata-exports | package.json: name, version 2.0.0, `bin.modspack`, `files` allowlist, MIT, `engines.node >=20`, repository URL that provenance checks |
| clean-consumer-install | Same packed-artifact smoke test, on Linux, Windows and macOS |
| package-archive-inspection | Published tarball: 82 files, integrity equal to the CI-built tarball |
| supply-chain-review | Zero runtime dependencies; `npm audit` in CI; all workflows default to `contents: read`; `id-token: write` only on the publish and Pages deploy jobs; publish needs the owner as actor plus the authorization phrase |
| ci-release-pipeline | release.yml dry run and publish runs above |
| versioning-changelog | CHANGELOG `## 2.0.0 (2026-11-11)`; package version 2.0.0 |
| distribution-verified | `npm view one-small-modspack` shows 2.0.0 as `latest` |
| release-provenance | npm provenance attestation (SLSA v1) for 2.0.0, built from 03ab44a by release.yml |
| upgrade-rollback-uninstall-docs | Install, update and `modspack uninstall --yes` in docs/getting-started.md |
| public-docs-accurate | README limitations and the compatibility catalog state that Copilot and Gemini runtime enforcement and Codex interactive trust are not tested |
| published-artifact-matches | Registry integrity and file count equal the CI-built tarball |

`production-deployment` stays not applicable (owner decision 2026-10-22: npm library and GitHub-hosted plugin marketplace, no hosted service).

### Owner-accepted exceptions: NOT verified, checks deferred by Joshua Small

Joshua Small wrote on 2026-11-11 (04:04 UTC, project chat): go ahead without the manual checks for now; the checks will be performed later; he looked at the content for verification. The 15 rows in `release/2.0.0/manual-acceptance.md` read DEFERRED-BY-OWNER, which is not a pass. Following the UI 0.6.0 release-provenance precedent, these four gates are recorded as owner-accepted exceptions whose notes say plainly that they are not met:

| Gate | What is deferred | What exists |
| --- | --- | --- |
| wcag-22-aa | Manual site review (rows A1-A5) | Automated axe, contrast and reflow checks on the generated site (builder-reported PASS) |
| keyboard-screen-reader | Screen reader review (rows K1-K3, T1) | Automated keyboard and focus checks (builder-reported PASS) |
| responsive-layouts | Real 200%/400% zoom, text spacing, forced colors (rows Z1, Z2, H1) | Viewport-width reflow checks (builder-reported PASS) |
| runtime-compatibility | Codex interactive trust (P1), Copilot and Gemini CLI runtime (P2, P3) | Claude Code harness PASS; Codex hooks with trust bypassed; Copilot and Gemini discovery only |

The six open blockers close this way: `manual-screen-reader-review`, `manual-zoom-forced-colors-review`, `copilot-gemini-runtime-untested` and `codex-interactive-trust` as deferred by owner (not passed); `npm-ownership-access` by the publication itself; `release-authorization` by the sign-off line and the publish run. The deferred checks stay listed under missing evidence until they are done.

## Builder security review (Claude Code, 2026-11-11)

- No runtime dependencies, so nothing third-party runs when a consumer installs the CLI.
- The CLI calls `git` and project scripts through `spawnSync` and `execFileSync` with argument arrays, not a shell string.
- Workflows default to read-only tokens. The publish job runs in the `npm-publish` environment, only for the repository owner and only with the exact authorization phrase for the candidate commit.
- Finding (low): publishing used a short-lived granular npm token. Joshua Small has been asked to delete it; trusted publishing replaces it at the next release (release/README.md).

## Proposed owner attestation

To close 2.0.0, Joshua Small posts this (or his own wording) as a comment on this pull request:

> I reviewed and accept the ModsPack 2.0.0 closeout package. I accept the linked evidence for the seventeen evidence gates. I deferred the manual accessibility checks and the Codex, Copilot and Gemini runtime checks; I looked at the content for verification and the checks will be performed later, so record those four gates as owner-accepted exceptions that are not met. I approve ModsPack 2.0.0. Record my verification and approval, move it to maintenance, and merge once checks pass.

After that comment, the registry gates cite it as his verifier attestation, the six blockers are resolved as described, approval is recorded with its date, reports are regenerated, and the registry update merges.
