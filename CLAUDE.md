# Instructions for Claude Code and GitHub Copilot

This repository is the One Small Engineering hub: the registry, standards and audit evidence for all One Small projects. Read `README.md` first.

- Status lives in `projects/registry.json` on `main`. Change it only through a PR with evidence; run `npm run check` before opening one.
- Never merge a PR unless Joshua Small has explicitly authorized merging for that task; a standing authorization covers only the work it names. Routine registry sync PRs are merged only by the Auto-merge workflow under [`sync/automerge.json`](sync/automerge.json) ([docs/automerge.md](docs/automerge.md)).
- Never record approval, and never mark a gate verified without a separate verifier's own `pass` evidence. Joshua Small is the only approver. An owner's chat confirmation is recorded as owner-reported evidence, never as a verification.
- Future, optional work goes in [ROADMAP.md](ROADMAP.md) (and each project's own `ROADMAP.md`); it never reopens a completed release.
- Automated sync (`scripts/sync/`) is deterministic and makes no AI calls. Do not add AI calls to it.
- To assess a project: follow `agents/project-assessor.md` (assessor-spec: 1).
- To onboard a project: follow `agents/onboard-project.md` (onboard-spec: 1).
- Continuing or handing off work on any governed project: follow `standards/agent-continuity.md` (continuity contract v1) and `docs/agent-continuity.md`.
