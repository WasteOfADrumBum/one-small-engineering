# Event-driven sync

Goal: a material change in a project repository reaches the hub registry in minutes, not at the next six-hour sync, with no one merging anything.

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

## Activation (owner action; nothing is live until done)

This repository, `events.yml` and the notify template are merged and tested, but **no real event has been delivered** because the senders are not installed. To activate:

1. Create a fine-grained personal access token: resource owner `WasteOfADrumBum`, repository access **only** `one-small-engineering`, permission **Contents: Read and write** (GitHub requires it to create a dispatch event), 90-day expiry.
2. Add it as the Actions secret `HUB_DISPATCH_TOKEN` in each of the eight project repositories.
3. Copy `templates/project/one-small-notify.yml` to `.github/workflows/one-small-notify.yml` in each (Claude can open these eight PRs on request). Until the secret exists the workflow does nothing.
4. Verify: open a draft PR in one project; **Project events** should run in this repository within a minute and dispatch **Registry sync**.

**Security trade-off to weigh before step 1:** Contents write on this repository lets that token push to `main` (branch protection is unavailable on the Free plan; Main integrity would flag it afterwards). The token sits in eight repositories. If you prefer not to hold such a token in project repos, the alternative is a more frequent scheduled sync, which needs no secret but spends Actions minutes. The six-hour schedule is the safe default and remains in place either way.

## Not supported

GitHub App webhooks (need a hosted receiver, which means new hosting). No automatic installation of the notify workflow.
