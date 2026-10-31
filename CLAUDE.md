# Instructions for Claude Code and GitHub Copilot

This repository is the One Small Engineering hub: the registry, standards and audit evidence for all One Small projects. Read `README.md` first.

- Status lives in `projects/registry.json` on `main`. Change it only through a PR with evidence; run `npm run check` before opening one.
- Never merge, never record approval, never mark a gate verified without a separate verifier's own `pass` evidence. Joshua Small is the only approver.
- Automated sync (`scripts/sync/`) is deterministic and makes no AI calls. Do not add AI calls to it.
- To assess a project: follow `agents/project-assessor.md` (assessor-spec: 1).
- To onboard a project: follow `agents/onboard-project.md` (onboard-spec: 1).
- Continuing or handing off work on any governed project: follow `standards/agent-continuity.md` (continuity contract v1) and `docs/agent-continuity.md`.
