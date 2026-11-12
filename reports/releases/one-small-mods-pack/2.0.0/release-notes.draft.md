# One Small ModsPack 2.0.0 release notes (draft)

> **Draft, not approved, not published.** Status: Released and approved. 17 of 17 applicable gates independently verified (100%); 0 open blocker(s). Generated 2026-11-12T18:11:17Z.

## Highlights

_From CHANGELOG.md at b0ff54a (older than the release candidate: re-read it); builder-authored, not independently verified._

- `modspack` command line tool: inspect, init, doctor, uninstall, check, security, privacy, accessibility, release-check, agents, skills, validate, hook.
- Six agent roles and twelve shared Agent Skills.
- `privacy-guard` mod: personal and health data detection and a HIPAA-related review that never claims compliance.
- Adapters for Claude Code, OpenAI Codex, GitHub Copilot and Gemini CLI with a reversible installer.
- Friendly agent names (Atlas, Sentinel, Scout, Echo, Aegis, Forge) as metadata, customisable with `agentNames`; technical IDs and native agent files unchanged.
- Public documentation website generated from the definitions and catalogs.
- CI workflow for this repository, with Node 20 and 24 jobs and a macOS job that run the packed-artifact smoke test.
- `scripts/consumer-smoke.mjs` (`npm run smoke`): packs the package, installs the tarball in a throwaway git project and drives every command through the installed bin, checking exit codes, preview safety, idempotent install, hook denials, a byte-identical uninstall and that deterministic commands open no network connection.
- `.github/workflows/release.yml`: a manually started, fail-closed npm publish workflow (dry run by default) with provenance. See `release/README.md`.

## Fixes

_From CHANGELOG.md at b0ff54a (older than the release candidate: re-read it); builder-authored._

- `scripts/run-mods.mjs` (behind `npm run validate` and `npm test`) did nothing and exited 0 when the repository was reached through a symlink, such as macOS `/var` → `/private/var` or a symlinked checkout: Node resolves the main module's real path, so the entrypoint check never matched. It now compares real paths, with a regression test. Found by the new macOS CI job.
- npm artifact: `package.json` `files` listed `mods/*/hooks`, `mods/*/scripts`, `agents`, `skills`, `catalog`, `schema` and `docs` as bare directories, which npm does not expand through the `*` pattern; the tarball shipped no guard hook modules or helper scripts (55 files). They are now `/**` patterns (82 files), and the artifact test compares every file under each mod's `hooks` and `scripts` with the tarball listing.
- Website: in Windows high contrast (forced colors) the home page button lost its only boundary; it now keeps a 2px `ButtonText` border. `scripts/site-browser-check.mjs` also checks forced colors and text spacing, and no longer crashes its own server on a missing file.
- npm artifact: include `.claude-plugin/marketplace.json`, which `modspack validate` reads. The source checkout validated successfully but the installed tarball crashed with ENOENT. A regression test now packs, installs, validates and initializes every platform from the artifact.
- privacy-guard: with `blockAt: low`, a Write or Edit that added an address to `publicContacts` in `.claude/guardrail-mods/privacy-guard.json` was blocked, because the list was read from the file as it was before the write. Values in a top-level `publicContacts` array of a well-formed config (string entries shaped like an email or phone number, on lines holding only that array) are now treated as listed. The same value in any other field, SSNs, cards, health data, other files, and malformed or mistyped configs are judged as before.
- Windows: two design-guardrail tests failed under the real Claude Code 2.1.304 harness because their file stubs matched paths by a `/` suffix while the Windows engine reports backslashes. The hooks were correct. The stubs in design-guardrail, privacy-guard, qa-gate and wcag-enforcer now compare separator-insensitively, and design-guardrail has tests that deliver backslash paths.
- Windows: `npm run validate` and `npm test` used POSIX `for` loops that Windows' npm shell cannot parse (`mod was unexpected at this time.`). They now run `scripts/run-mods.mjs`, a cross-platform Node runner with argument arrays, the same scope, fail-fast behaviour and exit status, and tests for scope, ordering, error propagation and paths with spaces.
- Mod typecheck against the real Claude Code declarations: tool arguments are `unknown`, so design-guardrail, privacy-guard, qa-gate, secret-scrubber and wcag-enforcer narrow them with `asString` before use (25 errors to 0). A missing or non-string field never throws; behaviour for each is in `docs/verification.md`, with `malformed tool arguments` tests in every mod.
- Windows: two CLI tests assumed the working tree is LF. They now compare through `readLf` and check the git index, with a new test that rendering from a CRLF checkout is byte-identical. No product code changed for this.
- Windows: `npm run types`, `build` and the other repository scripts derived the repository path from `new URL(import.meta.url).pathname`, which produced `C:\C:\Users\...` and ENOENT. They now use `fileURLToPath` left to the platform's own rules (`scripts/root.mjs`; an earlier attempt passed `windows: false` explicitly, which still doubled the drive on native Windows), with regression tests that evaluate both rule sets on any OS and a native Windows CI job. The published CLI was not affected.
- `secret-scrubber`: the generic secret pattern backtracked quadratically on very long lines (80,000 characters took 12 seconds, now 21 ms).

- Windows (found by a native Windows CI job): `npm`, `pnpm`, `yarn` and `eslint` are command shims there, so the quality and package gates reported "could not run npm: spawn ENOENT"; they now run npm through node and other shims only with shell-safe arguments. Skill file links were reported missing because of backslash separators, and CRLF checkouts broke front matter and the site's tables; paths are normalised and line endings are read as LF, and `.gitattributes` keeps checkouts LF.

## Verification status

- 17 of 17 applicable release gates independently verified.

## Known limitations

See the Known limitations page. The five guards enforced in a live Claude Code 2.1.316 run. Codex, Copilot and Gemini CLI have live instruction and skill discovery evidence; a Codex hook denied a secret live only with trust bypassed, and hooks, custom agents and model use on Copilot and Gemini CLI are NOT TESTED. Manual accessibility testing of the website (screen readers, real zoom, Windows High Contrast) is NOT TESTED.

- Not yet verified: Manual screen reader, browser zoom, text spacing, Windows contrast theme and keyboard results (release/2.0.0/manual-acceptance.md rows deferred by owner on 2026-11-11).
- Not yet verified: Codex interactive trust and Copilot and Gemini CLI runtime evidence (rows P1-P3, deferred by owner on 2026-11-11).

## Upgrade, rollback and uninstall

npm versions cannot be reused: roll back with `npm deprecate <name>@<bad version>` plus a patch release, and point users to the previous version. A git revert of the merge restores the source. See standards/release.md#rollback-and-recovery.
