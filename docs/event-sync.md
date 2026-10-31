# Event-driven sync

> **Decision (Phase 6 final integration).** The push-style event path below (`events.yml` plus a Contents-write token in eight repositories) is implemented and tested but is **kept disabled and is not recommended**: it would put a credential able to push to this repository's `main` in every project repo. The operational path is the **change watch** (`watch.yml`): an hourly, read-only comparison of each project's live head and open pull requests with the registry that dispatches the existing Registry sync only when something differs. It needs no new secret, no project-repository change, and no hosting. Worst-case latency is about one hour (previously six); the six-hour sync remains the fallback. Treat true immediate delivery as pending.

## Options considered

| Option | Latency | Credential exposure | Verdict |
| --- | --- | --- | --- |
| Six-hour sync + auto-merge only | up to 6 h | none | Safe baseline, kept as fallback |
| Hourly change watch (**adopted**) | up to ~1 h; syncs only on change | hub `GITHUB_TOKEN` plus the existing read-only reader secret | Safe, no new secret |
| Push events with `HUB_DISPATCH_TOKEN` in 8 repos | minutes | Contents write on this repo in every project | Rejected as designed |
| GitHub App (webhook to hub) | seconds | narrowly scoped, one app | Best long-term; needs a hosted receiver or Actions relay: new hosting, owner decision |
| Org-level secret or environment-scoped token | minutes | still broad | Not available on this account type; same blast radius |

## Change watch (live path)

```text
hourly schedule (watch.yml, read-only)
  -> scripts/sync/watch.mjs: GET default-branch head and open PRs per sync-enabled project
     compare with repositorySnapshot.headSha / openPullRequests on main
  -> changed? dispatch Registry sync (actions: write, SYNC_STAGE == C only)
  -> Validate registry -> Auto-merge -> registry updated on main
```

Properties: unreadable projects are reported and never trigger a dispatch; the dispatch is a full sync, so changes coalesce; nothing read is written; the payload-free design means there is nothing to forge. Between a sync PR opening and merging the watch may request another idempotent sync (at most one per hour). Tested in `scripts/sync/watch.test.mjs` (detection logic) and `repo-files.test.mjs` (workflow permissions). Live behaviour is verified only by an observed run, recorded in `docs/phase-6-progress.md`.

## Push events (implemented, disabled)


Goal of the push design: a material change in a project repository reaches the hub registry in minutes, not at the next six-hour sync, with no one merging anything.

```text
project repo event (PR / push / check suite / release / tag)
  -> repository_dispatch "onesmall-project-event"          (sent by the project's notify workflow)
  -> Project events (events.yml): sender must be the owner; repository must be a sync-enabled project;
     event kind and delivery id must be well formed            (scripts/sync/events.mjs, no network)
  -> Registry sync (registry-sync.yml, full sync)             existing collector, planner, writer, guard, validator
  -> Validate registry on the sync branch
  -> Auto-merge registry sync (automerge.yml)                 Stage 1 safe merge
  -> registry updated on main
```

## What is untrusted

The dispatch payload is only a hint. Only the matched registry project id leaves `events.mjs`; the title, branch, SHA or text in a payload never reach the registry. The sync always rereads GitHub itself, so a forged, duplicated, delayed or out-of-order event cannot change what the registry says. Governance fields stay protected by the field-ownership guard exactly as before; an event can never verify, approve or release anything.

## Properties

| Concern | Behaviour |
| --- | --- |
| Authentication | `repository_dispatch` needs a token with write access to this repository, which GitHub checks. `events.mjs` additionally requires the actor to be the owner. |
| Unknown repository | Rejected; the run fails visibly and nothing is dispatched. |
| Duplicates / out of order | Harmless: the sync is idempotent and reads current state. |
| Bursts | Each event always requests a **full** sync. `registry-sync` queues at most one pending run, so a burst coalesces into one sync that still covers every project. |
| Concurrent writes | `registry-sync` and `automerge` each run one at a time (`concurrency`). |
| Missed events | The six-hour `registry-sync` schedule (stage C) is unchanged and reconciles anything an event never reported. Auto-merge also has its own three-hourly fallback. |
| Stage gating | `SYNC_STAGE` still decides whether a sync may write. Events cannot enable writes. |

## Activation of the push design (not recommended; owner action; nothing is live until done)

This repository, `events.yml` and the notify template are merged and tested, but **no real event has been delivered** because the senders are not installed. To activate:

1. Create a fine-grained personal access token: resource owner `WasteOfADrumBum`, repository access **only** `one-small-engineering`, permission **Contents: Read and write** (GitHub requires it to create a dispatch event), 90-day expiry.
2. Add it as the Actions secret `HUB_DISPATCH_TOKEN` in each of the eight project repositories.
3. Copy `templates/project/one-small-notify.yml` to `.github/workflows/one-small-notify.yml` in each (Claude can open these eight PRs on request). Until the secret exists the workflow does nothing.
4. Verify: open a draft PR in one project; **Project events** should run in this repository within a minute and dispatch **Registry sync**.

**Security trade-off to weigh before step 1:** Contents write on this repository lets that token push to `main` (branch protection is unavailable on the Free plan; Main integrity would flag it afterwards). The token sits in eight repositories. If you prefer not to hold such a token in project repos, the alternative is a more frequent scheduled sync, which needs no secret but spends Actions minutes. The six-hour schedule is the safe default and remains in place either way.

## Not supported

GitHub App webhooks (need a hosted receiver, which means new hosting). No automatic installation of the notify workflow.
