# Project assessor

assessor-spec: 1

The one shared specification for assessing a One Small project against the hub's engineering requirements. Claude, Codex, Copilot and Gemini all follow this file; their adapter files only point here.

This is **AI analysis, kept separate from deterministic sync.** Registry sync (`scripts/sync/`) never calls an AI model. An assessment runs only when someone asks for one, costs whatever that tool costs, and is advisory.

## Inputs

1. `projects/registry.json` on the latest `main` of this hub: the project's entry. Note the hub commit SHA.
2. `standards/definition-of-done.md`: the gates for the project's tier.
3. `standards/security.md` and `standards/release.md`.
4. The latest "Registry sync status" issue, if one exists.
5. The project repository at one named commit (normally its default-branch head). Read it; do not change it.

## Hard rules

- **Read-only.** Do not edit the registry, the project repository, any PR or any issue. The output is a report for a human.
- **Never verify.** An assessment never sets a gate to `verified`, resolves a blocker, changes `releaseStatus`, assigns builder or verifier, or records approval. Joshua Small is the only approver.
- **Cite everything.** Every claim links a URL pinned to a commit SHA, PR, workflow run or release. A claim without a citation is `cannot_tell`.
- **GitHub beats memory.** If chat history, memory or an older document disagrees with the repository at the named commit, trust the repository and say so.
- **Builder results stay builder results.** Test counts, CI runs in the project's own repository and release notes are builder evidence. Say "builder-reported" for them.
- **No secrets.** Do not quote credentials, tokens, `.env` values, personal contact details or financial data, even if you find them. Report that something sensitive exists and where, without the value.
- **Stay in scope.** Judge against the approved scope document only. Ideas for more work go under enhancements, never as blockers.

## Procedure

1. Read the project entry. Record its tier, `targetVersion`, `releaseStatus`, open blockers and each gate's status.
2. For each gate of the tier, look for evidence in the project repository at the named commit and in the registry's evidence records. Classify it as `appears_met`, `partially_met`, `not_met`, `cannot_tell` or `not_applicable_candidate` (a candidate only: a `not_applicable` decision needs the owner's written rationale).
3. List blockers you observe that the registry does not record.
4. Name the single most useful next action.
5. State your limitations: what you could not run, read or access.

## Output

A short Markdown report, then one fenced `json` block that validates against `schemas/assessment.schema.json`:

```json
{
  "assessmentVersion": 1,
  "projectId": "taskforge",
  "repository": "https://github.com/WasteOfADrumBum/TaskForge",
  "commitSha": "<40-hex project commit>",
  "registryCommitSha": "<40-hex hub commit>",
  "assessedAt": "2026-10-23T00:00:00Z",
  "assessedBy": "<tool and model>",
  "gates": [
    { "id": "automated-checks", "observation": "appears_met", "registryStatus": "in_progress", "citations": ["https://github.com/WasteOfADrumBum/TaskForge/actions/runs/..."], "gaps": ["builder-reported only; verifier has not re-run"] }
  ],
  "blockersObserved": [],
  "nextAction": "…",
  "limitations": ["Did not run the test suite"]
}
```

## Recording an assessment (optional)

If the owner wants it kept, open a hub PR that adds one evidence record to the project: `type: "audit"`, `origin: "ai-assessment"`, result `builder_reported` or `inconclusive`, `recordedBy` naming the tool, and the URL of the committed report. The validator rejects `pass` or `fail` for `ai-assessment` records. If the assessing tool is also the project's assigned verifier and actually re-ran a check, that re-check is recorded separately as ordinary verifier evidence, exactly as before.
