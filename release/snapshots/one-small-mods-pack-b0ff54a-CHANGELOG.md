# Changelog

## 2.0.0 (unreleased)

### Added
- `modspack` command line tool: inspect, init, doctor, uninstall, check, security, privacy, accessibility, release-check, agents, skills, validate, hook.
- Six agent roles and twelve shared Agent Skills.
- `privacy-guard` mod: personal and health data detection and a HIPAA-related review that never claims compliance.
- Adapters for Claude Code, OpenAI Codex, GitHub Copilot and Gemini CLI with a reversible installer.
- Friendly agent names (Atlas, Sentinel, Scout, Echo, Aegis, Forge) as metadata, customisable with `agentNames`; technical IDs and native agent files unchanged.
- Public documentation website generated from the definitions and catalogs.
- CI workflow for this repository, with Node 20 and 24 jobs and a macOS job that run the packed-artifact smoke test.
- `scripts/consumer-smoke.mjs` (`npm run smoke`): packs the package, installs the tarball in a throwaway git project and drives every command through the installed bin, checking exit codes, preview safety, idempotent install, hook denials, a byte-identical uninstall and that deterministic commands open no network connection.
- `.github/workflows/release.yml`: a manually started, fail-closed npm publish workflow (dry run by default) with provenance. See `release/README.md`.

### Fixed
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

### Mod versions
Claude Code updates an installed plugin only when its version changes, so the mods whose hook code changed since 0.1.0 (argument narrowing, Windows path handling, the `secret-scrubber` backtracking fix) are bumped.
- `design-guardrail` 0.1.1
- `qa-gate` 0.1.1
- `secret-scrubber` 0.1.1
- `wcag-enforcer` 0.1.1
- `privacy-guard` 2.0.0
- `modspack-agents` 2.0.0

### Known limitations
See the Known limitations page. The five guards enforced in a live Claude Code 2.1.316 run. Codex, Copilot and Gemini CLI have live instruction and skill discovery evidence; a Codex hook denied a secret live only with trust bypassed, and hooks, custom agents and model use on Copilot and Gemini CLI are NOT TESTED. Manual accessibility testing of the website (screen readers, real zoom, Windows High Contrast) is NOT TESTED.

## 0.1.0
The four Claude Code mods (each 0.1.0) and the `guardrail-mods` marketplace.
