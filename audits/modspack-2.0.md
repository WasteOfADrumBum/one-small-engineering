# Audit: One Small ModsPack 2.0 (initial, read-only)

| | |
| --- | --- |
| Repository | [WasteOfADrumBum/one-small-mods-pack](https://github.com/WasteOfADrumBum/one-small-mods-pack) (public) |
| Audited revision | PR #3 head [`80cc269`](https://github.com/WasteOfADrumBum/one-small-mods-pack/commit/80cc269ebb7c20aca5f6ca03214954726fb494f7); default branch `main` at [`367cede`](https://github.com/WasteOfADrumBum/one-small-mods-pack/commit/367cede6ffba17de9bf2d3a20968a3e1cd1b3371) |
| Observed | 2026-10-22T16:33Z |
| Auditor | Claude Code, Phase 0 baseline. Read-only: GitHub API and a local shallow clone. Nothing in the ModsPack repository, PR, branches, CI or release configuration was changed. |
| Type | Evidence audit of what GitHub shows. Tests were **not** re-run here. |
| Verdict | **NO-GO for release** (agrees with the PR's own verdict). Release status `in_progress`. npm release **not** approved. |

PR #3 is under active testing in another session. Its head may move after this audit; anything below tied to `80cc269` must be re-checked on the final head.

## Status legend

`verified` = confirmed directly from GitHub by this audit. `in_progress` = builder evidence exists but is incomplete or not independently re-run. `blocked` = cannot proceed without a decision or missing access. `not_verified` = no acceptable evidence. `not_applicable` = does not apply, with reason.

## Findings by category

| Category | State | Finding and evidence |
| --- | --- | --- |
| Default branch and commit | verified | `main` at `367cede` (merge of PR #2, 2026-10-11). `main` contains the 0.1.0 `guardrail-mods` marketplace with four Claude Code mods. No tags, no GitHub releases. |
| PR #3 state and head | verified | Open, **draft**, mergeable (`clean`), 23 commits, 111 files, +9978/−41, base `main` at `367cede`, head `80cc269`, last updated 2026-10-22T16:20Z. No reviews or PR comments yet. Description states "NO-GO for release". |
| Implemented functionality | verified (present in source) | See [Functionality](#functionality-present-at-80cc269). Presence in source is confirmed; behavior is covered only by the builder's tests and runtime notes. |
| Automated test evidence | in_progress | CI runs the CLI suite (`node --test test/*.test.mjs`), plugin validation and mod tests under the Claude Code 2.1.304 harness. Builder reports 89 CLI tests and 131 mod tests passing on Windows ([release-verification.md](https://github.com/WasteOfADrumBum/one-small-mods-pack/blob/80cc269ebb7c20aca5f6ca03214954726fb494f7/docs/release-verification.md)). Counts not re-run here. |
| CI status | verified | [Run 39813140190](https://github.com/WasteOfADrumBum/one-small-mods-pack/actions/runs/39813140190) on `80cc269`: `cli`, `mods`, `windows` all succeeded. Earlier failures on the branch (runs 39493876850, 39477466444, 2026-10-20) were followed by green runs. Workflow uses `permissions: contents: read`; actions are pinned by tag (`@v4`), not SHA. |
| TypeScript / lint / build | in_progress | CI `cli` job runs `tsc -p tsconfig.cli.json`, `npm run shared`, the test suite (which builds `dist/modspack.mjs`) and `npm pack --dry-run`, and passed. Mod type checks need local Claude Code declarations (`npm run types`) and are not in CI. No ESLint step for the toolkit's own code. |
| Live runtime verification | in_progress | Builder-reported only: Claude Code 2.1.307 real Edit triggered the WCAG jsx-a11y hook; Codex 0.159.3 discovered the instruction block and 12 skills, and denied a secret write **only with hook trust bypassed** (untrusted hooks are silently skipped). Copilot and Gemini CLI runtime enforcement and custom agents are **NOT TESTED**. The five primary live guard checks are "prior user-reported evidence". Static adapter and recorded-payload tests do **not** establish live enforcement. |
| Security findings | not_verified | No independent security review recorded. Builder notes: hooks fail open and do not judge shell commands; secret/PII detection is pattern based; Codex untrusted hooks are a silent no-op (documented in `docs/limitations.md`). No vulnerability reported in the toolkit itself. |
| Dependency findings | in_progress | Zero runtime dependencies (devDependencies only: `@types/node`, `axe-core`, `esbuild`, `jsdom`, `typescript`). Builder reports `npm audit` 0 vulnerabilities across 67 locked packages and `npm audit signatures` verified on 2026-10-22. **Inconsistency:** the PR description still says the dependency audit was INCONCLUSIVE. |
| Documentation completeness | in_progress | `README.md`, `CHANGELOG.md` (2.0.0 unreleased), and `docs/` (cli, configuration, getting-started, limitations, migration, troubleshooting, verification, release-verification, ci, agent-names) exist. `docs/limitations.md` states the testing limits plainly. Accuracy against behavior not independently checked. |
| npm package readiness | in_progress | `package.json`: name `one-small-modspack`, version `2.0.0`, `bin.modspack` → `dist/modspack.mjs`, `engines.node >=20`, MIT, `files` allowlist, `prepack` builds. Builder reports an 82-file tarball after fixing two packaging defects (missing marketplace manifest; hooks not packed). Not re-packed here. Name is unpublished on npm (registry returned Not found); ownership not confirmed. Node 20 is only partially tested; CI runs Node 22 only. |
| Distribution mechanism | verified (as designed) | Two channels: (1) npm package `one-small-modspack` providing the `modspack` CLI and adapter files for Codex, Copilot and Gemini; native adapter hooks run `npx --no-install modspack`, so consumers need it installed locally (`npm i -D one-small-modspack`). (2) The GitHub repository as a Claude Code plugin marketplace (`.claude-plugin/marketplace.json`) for the six plugins. No publish workflow exists yet. |
| CDN necessity | verified | Not required. See [npm and CDN assessment](#npm-and-cdn-assessment). |
| Release blockers | blocked | See [Release blockers](#release-blockers). |
| Remaining work | in_progress | See [Remaining work](#remaining-work). |

## Functionality present at `80cc269`

Confirmed by reading the source tree (presence, not behavior):

| Claimed in the brief | Found | Notes |
| --- | --- | --- |
| ModsPack CLI | Yes | `src/cli.ts`, built to `dist/modspack.mjs`. Commands: `inspect`, `init`, `doctor`, `uninstall`, `check`, `security`, `privacy`, `accessibility`, `release-check`, `agents`, `skills`, `validate`, `hook`. |
| Existing Claude Code guardrails | Yes | `wcag-enforcer`, `design-guardrail`, `qa-gate`, `secret-scrubber`, bumped 0.1.0 → 0.1.1. |
| Privacy Guard | Yes | `mods/privacy-guard` 2.0.0 (personal/health data detection; never claims HIPAA compliance). |
| Six agent roles | Yes | `mods/modspack-agents/agents/`: accessibility-auditor, code-reviewer, qa-engineer, release-engineer, release-manager, security-privacy-auditor. |
| Shared Agent Skills | Yes | 12 skills in `mods/modspack-agents/skills/`. |
| Claude Code adapter | Yes | Six plugins plus marketplace manifest. |
| Codex adapter | Yes | Rendered by `src/adapters/render.ts` (`.codex/agents`, `.codex/hooks.json`, instruction block). |
| Copilot adapter | Yes | `.github/agents`, `.github/hooks/modspack.json`, `AGENTS.md` block. |
| Gemini CLI adapter | Yes | `.gemini/agents`, `.gemini/settings.json`, `GEMINI.md` block. |
| Installer and uninstall | Yes | `src/install/install.ts`: manifest-based plan/apply, `planUninstall`/`applyUninstall` remove only what was installed. |
| Security and accessibility checks | Yes | `src/checks/` (secrets, privacy, exposure, gates, release, project); `modspack accessibility`; `wcag-enforcer`. |
| npm publication plans | Partly | Package metadata ready; no publish workflow, provenance, or confirmed npm ownership. |
| Documentation website | Yes (generated, not hosted) | `site/build.mjs` generates pages to `site/dist/` (gitignored); browser checks in `scripts/site-browser-check.mjs`. No deployment configuration found. |

Platform capability claims come from `catalog/compatibility.json`, which labels each as `static`, `harness` or `runtime` verified. That labelling is honest and should be kept; registry gates follow it.

## Release blockers

Open at `80cc269` (also recorded in the registry):

1. **Screen reader review** of the documentation site: NOT TESTED.
2. **Real browser zoom (200%/400%), text spacing and Windows forced colors**: only viewport-width and emulated checks.
3. **Copilot and Gemini CLI**: runtime hook enforcement and custom agents NOT TESTED. Either test in authenticated runtimes or record an owner decision to ship them as experimental.
4. **Codex interactive `/hooks` trust** not confirmed (only trust-bypassed enforcement).
5. **npm ownership and publish access** for `one-small-modspack` not confirmed.
6. **PR description out of date** relative to `docs/release-verification.md` at the same head: dependency audit "INCONCLUSIVE" vs PASS; "55 files" vs 82; "85 CLI tests" vs 89. Reconcile so reviewers see one story.
7. **Owner authorization** for merge, tag, npm publish and any deployment: not given.

Deferred, not blocking npm release: plugin icon artwork (needed only for plugin-directory submission).

## npm and CDN assessment

**Expected distribution.** `npm install -D one-small-modspack` in each consuming project, then `npx modspack init --platform <claude-code|codex|copilot|gemini>`. Native hooks call `npx --no-install modspack`, so a project-local install is required. Claude Code users can alternatively install the plugins from the GitHub marketplace. Publishing should happen from CI with `npm publish --provenance` and a granular token, after the gates above.

**Is a CDN required? No.**

- The product is a Node CLI plus files written into a project; npm already serves the versioned tarball, and the registry acts as the distribution network.
- The Claude Code marketplace is served from GitHub.
- There are no browser runtime assets for third-party pages to load.
- The JSON schema (`schema/modspack.schema.json`) ships inside the package. If editors need a stable public `$schema` URL later, npm-backed mirrors (unpkg, jsDelivr) already provide versioned URLs with no infrastructure.
- The generated documentation site, if published, is ordinary static hosting (GitHub Pages or Vercel), not a CDN decision.

Recommendation: do not introduce CDN infrastructure. Revisit only if a concrete need appears (for example versioned browser assets).

## Remaining work

- Finish the manual accessibility checks (items 1–2) and record browser/AT versions.
- Decide on Copilot/Gemini: test or explicitly label as experimental (item 3); confirm Codex trust (item 4).
- Reconcile the PR description (item 6).
- Independent verification of the final head by a tool other than the builder: re-run `npm run check`, `npm pack --dry-run` and a clean consumer install.
- Add a release workflow with npm provenance; consider Node 20 in the CI matrix and SHA-pinned actions.
- Confirm npm ownership, then owner approval, then publish (step order in [release.md](../standards/release.md)).

## Outstanding unknowns

- Whether the PR #3 head will change during the active testing session.
- Results of the "five primary live guard checks" beyond the recovered transcripts (user-reported, not linked as artifacts).
- Whether the documentation site will be hosted, and where.
- Whether the owner will accept Copilot/Gemini as experimental for 2.0.0.
- npm account ownership and 2FA/provenance setup.

## Evidence

| ID | Link |
| --- | --- |
| `msp-repo-metadata` | https://github.com/WasteOfADrumBum/one-small-mods-pack |
| `msp-pr-3` | https://github.com/WasteOfADrumBum/one-small-mods-pack/pull/3 |
| `msp-ci-pr3-head` | https://github.com/WasteOfADrumBum/one-small-mods-pack/actions/runs/39813140190 |
| `msp-release-verification` | https://github.com/WasteOfADrumBum/one-small-mods-pack/blob/80cc269ebb7c20aca5f6ca03214954726fb494f7/docs/release-verification.md |
| `msp-compatibility-catalog` | https://github.com/WasteOfADrumBum/one-small-mods-pack/blob/80cc269ebb7c20aca5f6ca03214954726fb494f7/catalog/compatibility.json |
| `msp-npm-name-check` | https://www.npmjs.com/package/one-small-modspack |
