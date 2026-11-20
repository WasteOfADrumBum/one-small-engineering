# AI engineering standards changelog

Each policy version is applied to managed repositories with `ose ai sync --all`. Versions follow semver: patch for wording that does not change behavior, minor for new or stricter rules, major for changes that remove or reverse a rule.

## 1.0.0 (2026-11-20)

- First release: ten shared policies (autonomy, security, architecture, code quality, testing, accessibility, documentation, completion, collaboration, learning) with risk-based autonomy levels 1 to 3 as the default.
- Adapters for Claude Code (`CLAUDE.md`), OpenAI Codex (`AGENTS.md`), GitHub Copilot (`.github/copilot-instructions.md`), Gemini CLI (`GEMINI.md`, existing files only) and a portable ChatGPT Projects file.
