# Registry auto-merge

Routine registry sync PRs merge without the owner. Everything else still needs a human.

**Workflow:** `.github/workflows/automerge.yml` · **Script:** `scripts/sync/automerge.mjs` · **Policy:** `sync/automerge.json`

## What triggers it

- `Validate registry` finishing successfully on a `sync/*` branch (`workflow_run`), normally minutes after sync opens or updates the PR.
- A fallback schedule every three hours (`41 */3 * * *`), so a missed event is picked up.
- Manual run (dry run by default).

## What it merges

A PR merges only if all of these hold, judged from API data (no PR code is checked out or run with the merge token):

1. Branch `sync/<project-id>`, base `main`, head in this repository, author is the sync bot, no `hold` label, no requested changes.
2. Exactly one commit, authored by `One Small Engineering Sync`, whose parent is the **current** main.
3. Exactly one changed file, `projects/registry.json`.
4. `guardRegistryChange` (the field-ownership guard, same code the writer used) passes against main, and the full schema/rule validator passes on the new registry.
5. The `validate` check completed successfully for that exact head and no other check failed or is pending.
6. The PR head is re-read just before merging, and the merge call carries the head SHA, so a push in between fails the merge instead of merging new content.

Merge method is squash. The result and merge commit are recorded as a PR comment and in the job summary.

## What can never merge this way

The guard allows automation to change only `repositorySnapshot`, `openPullRequests`, its own `origin: sync` evidence, `release.currentVersion` (forward only, with release evidence), `sync.lastSynced*`/`configSource` and `lastUpdatedAt`. Approval, verification records, builder/verifier assignment, ownership, tier, release scope or blockers, security exceptions, gates, other projects, any other file, and any workflow or source code are rejected. The script's write allowlist also refuses everything except: mark-ready, merge, comment, and dispatching Registry sync.

## Recovery

| Situation | Behaviour |
| --- | --- |
| CI failed | Rejected with the reason; sync's next run supersedes the PR |
| Check pending or missing | Waits; next event or schedule re-evaluates |
| Main moved (another PR merged) | Waits as stale; after a merge it dispatches Registry sync to rebuild remaining PRs from the new main |
| Head pushed mid-merge / conflict | Merge refused by GitHub; recorded as waiting |
| Closed or duplicate PR | Ignored; sync keeps one PR per project |
| API outage / rate limit | Client retries with backoff; a PR that still fails is an `error` row and the run exits red; next trigger retries |
| Concurrent runs | One at a time (`concurrency: automerge`) |

## Pausing

Set the repository variable `AUTOMERGE_PAUSED=true`, label one PR `hold`, set `"enabled": false` in `sync/automerge.json` (needs a PR), or disable the workflow. Paused runs still report what they would have done.
