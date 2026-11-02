# Onboard a project

onboard-spec: 1

The one shared prompt for adding a repository to registry sync. Works the same in Claude, Codex, Copilot and Gemini.

## Steps

1. In this hub, branch from the latest `main`.
2. Run one command:
   - Existing registry project: `npm run onboard -- <project-id>`
   - New project: `npm run onboard -- <project-id> --new --name "<name>" --repository https://github.com/WasteOfADrumBum/<repo> --tier showcase|library|application --visibility public|private` (add `--reclassify` only if the owner said to move it out of legacy or unclassified).
3. Run `npm run check`. Open a **draft** hub PR with the registry change, using the PR template. State that sync starts in `observe` mode.
4. Only with the owner's explicit go-ahead for that repository: open a PR in the project repository adding the two files from `out/onboard/<project-id>/` (`.github/one-small-engineering.json` and `.github/workflows/one-small-report.yml`). After it merges, switch the project to `integrated` with `npm run onboard -- <project-id> --mode integrated` in another hub PR.

## Rules

- Never merge. Joshua Small reviews and merges both PRs (onboarding changes governance fields, so it is never eligible for auto-merge).
- Never add credentials. A private repository needs the owner to grant the read-only reader credential (see `docs/sync-setup.md`).
- One Small ModsPack stays observe-only until the owner says its PR #3 testing is complete. Do not add files to ModsPack.
- Do not invent tier, scope or gate decisions. The scaffold leaves every gate `not_verified` and builder and verifier `null`.
