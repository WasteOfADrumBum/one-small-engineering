# ai-standards

The canonical AI engineering policies for every One Small repository, and the files `ose ai` generates from them. Full guide: [docs/ai-standards.md](../docs/ai-standards.md).

| Path | What it is |
| --- | --- |
| `policies/*.md` | Shared, provider-neutral policies. Each has `## Core rules` (copied into every agent's instruction file) and `## Details` (in `.ai/shared/` of each repo). |
| `templates/*.tmpl` | Adapter templates (Claude, Codex, Copilot, Gemini, ChatGPT) and the `.ai/project.md` seed. |
| `manifest.json` | Policy version, checksums, adapters. Change policies, then run `npm run ai -- bump --level <patch\|minor\|major>`. |
| `registry.json` | Repositories managed by `ose ai sync --all`. |
| `schemas/` | JSON schemas for the manifest, the installed manifest and the registry. |
| `CHANGELOG.md` | What changed in each policy version. |

Agents working in this hub follow `policies/` directly; the hub is the source and is never installed into.
