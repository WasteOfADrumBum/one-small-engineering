# Definition of Done

**Principle: standardize quality and release expectations, not technology stacks.**

Next.js, Astro, Vite, plain HTML, Express, MongoDB, Postgres and the rest are deliberate portfolio choices. Nothing here asks a project to change its framework, language, hosting or architecture. Each gate says *what must be true*; the project decides *how* to show it.

Each gate has a stable ID. The IDs are the `gateCatalog` in [`projects/registry.json`](../projects/registry.json), and every project lists exactly the gates of its tier. A test fails if this document and the catalog drift apart.

## How a gate is satisfied

| Status | Meaning |
| --- | --- |
| `not_verified` | Default. No acceptable evidence yet. |
| `in_progress` | Work or partial evidence exists (for example builder-reported results). |
| `blocked` | Cannot progress until something else is resolved. Explain in `notes`. |
| `verified` | Linked evidence with result `pass` shows the gate is met for the target release. |
| `not_applicable` | The gate does not apply to this project. Requires a written rationale in `notes`. |

A gate is **verified** only when:

- it links at least one evidence record whose `result` is `pass`;
- that evidence is not repository metadata and not a `builder_reported` claim;
- the evidence applies to the target release (the commit or deployment being released), not an older one;
- the verifier is not the builder (see [release.md](release.md#roles)).

"Applicable" means the gate covers something the project actually has. A site with no forms has no form workflows to test; a CLI with no hosted service has no production deployment. Use `not_applicable` with a one-line reason instead of inventing work.

## Tier 1: Showcase

Applies to Personal Portfolio (`joshsmall-site`), One Small Studio and One Small Photography.

| # | Gate ID | Requirement |
| --- | --- | --- |
| 1 | `scope-complete` | The approved release scope document is complete; every in-scope item is done. |
| 2 | `automated-checks` | Applicable build, lint, type check and automated tests pass in CI on the release commit. |
| 3 | `security-privacy-review` | Security and privacy review completed against [security.md](security.md). |
| 4 | `wcag-22-aa` | Applicable WCAG 2.2 AA success criteria verified (automated checks plus manual review). |
| 5 | `keyboard-screen-reader` | Keyboard-only and screen-reader testing completed on the critical pages. |
| 6 | `responsive-layouts` | Layouts tested at phone, tablet and desktop widths and at 200% zoom. |
| 7 | `critical-workflows` | Critical user workflows (navigation, contact form, media playback, galleries) tested. |
| 8 | `production-deployment` | The production deployment serves the release commit and behaves as tested. |
| 9 | `documentation-accurate` | README and essential docs describe the actual project, setup and deployment. |
| 10 | `no-release-blockers` | No unresolved release-blocking findings. |

What Showcase does **not** require:

- Enterprise infrastructure (status pages, on-call, SLAs, multi-region, paid monitoring).
- Extensive process documentation beyond an accurate README.
- Booking, pricing, e-commerce or sales features. Photography and Studio are non-commercial hobby portfolios.
- More content. Additional music, photos, albums or projects are content updates, not code-release blockers. Record them as `enhancements`.

## Tier 2: Library / Developer Tool

Applies to One Small ModsPack and OneSmallUI.

All ten Tier 1 gates apply where applicable (for example `wcag-22-aa` covers a documentation site or UI components; `production-deployment` is usually `not_applicable` for a package with no hosted service). In addition:

| # | Gate ID | Requirement |
| --- | --- | --- |
| 11 | `package-metadata-exports` | Package name, version, `exports`/`bin`, `files`, `engines`, license and repository metadata verified. |
| 12 | `clean-consumer-install` | The packed artifact installs and works in a clean consumer project. |
| 13 | `runtime-compatibility` | Supported runtimes and platforms (Node versions, OS, host tools) tested as claimed. |
| 14 | `package-archive-inspection` | `npm pack` (or equivalent) contents inspected: required files present, no tests, secrets, `.env`, or build junk. |
| 15 | `supply-chain-review` | Dependency audit and supply-chain review completed (see [security.md](security.md#package-supply-chain)). |
| 16 | `ci-release-pipeline` | CI and the release/publish pipeline verified, with least-privilege permissions. |
| 17 | `versioning-changelog` | Semantic version chosen and CHANGELOG updated for this release. |
| 18 | `distribution-verified` | The package is available from npm (or the stated channel) under the expected name and version. |
| 19 | `release-provenance` | Release provenance (npm `--provenance` or signed tags) where the channel supports it. |
| 20 | `upgrade-rollback-uninstall-docs` | Upgrade, rollback and uninstall behavior documented. |
| 21 | `public-docs-accurate` | Public documentation reflects actual, verified capabilities and states limits plainly. |
| 22 | `published-artifact-matches` | The published artifact matches the verified release commit and inspected archive. |

## Tier 3: Application

Applies to TaskForge and Cortex.

All ten Tier 1 gates apply where applicable. In addition:

| # | Gate ID | Requirement |
| --- | --- | --- |
| 11 | `authentication` | Sign-in, sign-out, session expiry and credential handling verified. |
| 12 | `authorization-boundaries` | Permission boundaries verified: users and agents can only do what they are allowed to. |
| 13 | `sensitive-data-handling` | Personal, financial and other sensitive data handling reviewed (collection, storage, display, retention). |
| 14 | `api-integration-security` | APIs and third-party integrations (Drive, Todoist, Calendar, AI providers, databases) secured and least-privilege. |
| 15 | `integration-failure-handling` | Behavior when each integration fails or times out is tested. |
| 16 | `backup-recovery` | Backup and recovery verified with an actual restore, where the application stores data. |
| 17 | `audit-logging` | Security-relevant and approval actions are logged appropriately, without logging secrets. |
| 18 | `deployment-rollback` | Deployment and rollback procedure verified. |
| 19 | `e2e-critical-workflows` | End-to-end tests of critical workflows pass against the release. |
| 20 | `user-data-isolation` | One user's data cannot be read or changed by another, where the app has multiple users. |

## What 100% means

A project is **100% complete** for a release when the **approved release scope** passes **every applicable release gate**, has no open blockers, has been independently verified, and has Joshua Small's recorded approval. In registry terms: `releaseStatus` is `released`, every gate is `verified` or `not_applicable`, and `approval.status` is `approved` with evidence.

- The enhancement backlog never prevents the current release from being complete. Ideas found during verification go to `enhancements` unless they are defects in the approved scope.
- No completion percentages are recorded. Progress is the list of gates and their evidence.
- After final acceptance, set `lifecycle` to `maintenance`. Maintenance means fixing defects and security issues, not reopening the release for optional improvements.
- A future release starts its own scope document, target version and gate cycle. Earlier verification does not carry forward automatically.
