# Audits

Committed audit records. An audit is evidence: registry entries link to it, and gates can cite it.

| Audit | Project | Revision | Date | Verdict |
| --- | --- | --- | --- | --- |
| [modspack-2.0.md](modspack-2.0.md) | One Small ModsPack | PR #3 head `80cc269` | 2026-10-22 | NO-GO (initial, read-only) |
| [modspack-2.0-release-readiness.md](modspack-2.0-release-readiness.md) | One Small ModsPack | PR #3 head `80cc269` | 2026-10-26 | Not eligible for release (Phase 3 pilot, read-only) |

## Writing an audit

Name the file `<project>-<version or topic>.md` and include:

1. **Header**: repository, exact revision (commit SHA), observation time (UTC), auditor (person or AI tool), whether it was read-only, and the verdict.
2. **Findings** using the audit states `verified`, `in_progress`, `blocked`, `not_verified`, `not_applicable`, each with a link to its evidence (PR, commit, workflow run, artifact, committed test record).
3. **Release blockers**, **remaining work** and **outstanding unknowns**, kept separate.
4. **Evidence table** with the evidence IDs used in `projects/registry.json`.

Rules:

- Separate what you confirmed from what the builder reported. Re-run results are `verified`; relayed results are `in_progress` at best.
- Static or recorded-payload tests do not prove live runtime behavior. Say which one you have.
- Automated accessibility or security scans are partial evidence; never call them a compliance result.
- Do not modify the audited repository as part of an audit.
- An audit does not approve a release. Approval belongs to Joshua Small ([release.md](../standards/release.md#roles)).
