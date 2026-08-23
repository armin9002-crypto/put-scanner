# Supabase Stage 5C.1 production sync integration

Status: implemented behind `VITE_CLOUD_SYNC_ENABLED`, which is off by default. Stage 5C.1 does not authorize enabling the flag in Vercel, deploying it, signing into a real account, or running a live test.

Put Scanner remains local-first. Portfolio/history, Watchlist, and portable Preferences are written and read locally first. Supabase is an authenticated durable account copy, cross-device state source, and revision authority only after this browser is explicitly enrolled.

## Feature gate and root ownership

Production orchestration exists only when the build-time value is exactly:

```text
VITE_CLOUD_SYNC_ENABLED=true
```

Missing, `false`, differently cased, whitespace-padded, or any other value disables the capability. The false production build removes the production provider, coordinator, engine, and Account Sync controls. Authentication remains optional and Account Data migration/restore remains available.

When included, `CloudSyncProvider` is mounted inside `AuthProvider` and above `ThemeProvider`, `BrowserRouter`, navigation, pages, drawers, and Account UI. Closing Account, navigating routes, or remounting ordinary UI therefore does not own or dispose the coordinator. Only feature disablement at build time, sign-out, account change, or root-provider teardown ends its session.

## Explicit enrollment

A signed-in browser with no Stage 5 engine metadata remains `Not enabled on this device` and performs no automatic `user_state` read. **Enable Sync on This Device** is the only enrollment action.

Enrollment requires a fresh proof of all of the following:

- authenticated user ID matches valid Stage 4 metadata;
- Stage 4 migration/restore state is `migration_verified`;
- local Portfolio/history, Watchlist, and Preferences validate;
- the cloud inventory is the complete, valid three-namespace account state;
- local canonical documents exactly equal cloud documents;
- all Stage 4 revisions and local mutation timestamps still match; and
- no corrupt, account-mismatched, already-enabled, or attention-state Stage 5 metadata exists.

Local state and metadata are re-read after the asynchronous inventory request so enrollment cannot commit a stale baseline. A successful action creates enabled Stage 5 metadata, constructs the root coordinator, and attaches its listener once. It performs one inventory SELECT and zero data-changing `user_state` writes.

## Already-enabled startup

After auth restoration, a device with valid `syncMode = enabled` metadata for the authenticated user automatically reconstructs the coordinator. Startup validates metadata and local durable state before transport construction, then performs exactly one inventory reconciliation using the persisted last-synced revisions and fingerprints.

| Classification | Startup behavior |
| --- | --- |
| `CLEAN` | No payload action |
| `CLOUD_AHEAD` | Transactional, verified local pull with rollback |
| `LOCAL_AHEAD` | CAS push only against the persisted known revision |
| `BOTH_CHANGED` | Conflict; preserve both sides and choose no winner |
| `CLOUD_MISSING` | Attention; never recreate automatically |
| `INVALID` | Attention; no listener attachment |
| `ACCOUNT_MISMATCH` | Block before cloud access |

The listener attaches only after a safe reconciliation result. A conflict is safe to preserve, so the listener attaches while the conflicted namespace remains frozen; unrelated namespaces can continue. Missing/invalid/unavailable startup state does not attach the mutation listener. A later explicit **Sync Now** can retry a transient failure and attaches the listener only after a safe result.

Safe cloud hydration uses the existing Stage 5 pull path, which writes storage directly under recovery/verification control and does not emit a user mutation. A cloud pull therefore cannot echo as a CAS update.

## Normal edits and request safety

Once enrolled and safely started, existing durable writers emit namespace-only events. No page-specific instrumentation was added.

- Portfolio add/edit/delete/archive/history and successful JSON import use the Portfolio queue.
- Watchlist add/remove/canonical note changes use the Watchlist queue.
- Portable preference changes use the Preferences queue.
- Transient quotes, option chains, chart data, ETF Pulse data, snapshots, caches, diagnostics, sorting, filters, hover, scroll, resize, orientation, and market refreshes emit no account-sync request.

Each namespace retains its independent 1,000 ms coalescing queue, one write in flight, revision-checked CAS, verified response, and bounded network retry. There is no upsert, DELETE, blind update, payload merge, timestamp winner, polling, Realtime, focus handler, visibility handler, cron, or recurring retry loop.

## Offline, conflicts, and manual Sync Now

An offline local edit succeeds immediately and remains visible. The queue makes one initial attempt plus at most two bounded network retries. If those fail, status becomes **Saved locally — account sync pending**; local state and known cloud revision are preserved. Recovery occurs only through a later durable mutation, next enabled-app startup, or explicit **Sync Now**.

**Sync Now** performs one inventory SELECT and only the safe action identified per namespace. It does not force a winner. `BOTH_CHANGED` freezes that namespace and displays **Sync conflict — namespace needs attention**. Other namespaces remain independent. Existing local backup export is offered; conflict resolution is deferred.

## Sign-out and account switching

Sign-out immediately invalidates the coordinator generation, detaches the listener, and disposes queues. Portfolio, history, Watchlist, Preferences, backups, and device bookkeeping are not cleared. Late responses cannot advance metadata.

Signing into another account when device metadata belongs to the previous account produces **Account mismatch** before a cloud client or request is created. Metadata is not retagged, local data is not restored, and nothing is overwritten.

## Account UI and Stage 4 Account Data

The feature-enabled signed-in Account panel contains a compact **Account Sync** section with enrollment, verifying, synced, syncing, pending, conflict, mismatch, and unavailable/attention states. Enabled devices expose **Sync Now** and optional namespace details. No route or navigation tab was added.

Once Stage 5 metadata is enabled or blocked, Account Data becomes a non-mutating summary with local backup export. It shows **Account copy established / Sync enabled on this device** for enrollment and suppresses initial migration/restore actions so the two workflows cannot compete. With the feature flag false, the existing Account UI and Stage 4 workflow remain unchanged.

The Stage 5B disposable harness remains a separate development-only surface. Its fixture markers, test email, device labels, mutation controls, and diagnostics are excluded from both production build variants.

## Request and cost model

Architecture estimate, not a Supabase plan-limit claim. Assumptions: every listed user is active and enabled; one app startup per user/day; six durable UI edits coalesce into three namespace CAS writes; no manual Sync Now, retries, conflicts, or HTTP/database overhead.

| Daily active users | Startup inventory requests | Namespace rows read | CAS writes | Baseline browser requests |
| ---: | ---: | ---: | ---: | ---: |
| 10 | 10 | 30 | 30 | 40 |
| 100 | 100 | 300 | 300 | 400 |
| 500 | 500 | 1,500 | 1,500 | 2,000 |
| 1,000 | 1,000 | 3,000 | 3,000 | 4,000 |

One clean manual Sync Now adds one inventory request and three rows read. It adds a CAS only for a namespace classified `LOCAL_AHEAD`; a safe `CLOUD_AHEAD` pull adds no cloud write. Idle enabled apps make no recurring sync requests.

## Future controlled localhost real-account test procedure — do not execute in Stage 5C.1

1. Confirm the Stage 5C.1 commit and all automated/forced-build checks are green.
2. Download a fresh local Put Scanner backup and keep the current Stage 4 account copy unchanged.
3. Stop the localhost server.
4. In a deliberately controlled local-only environment, set `VITE_CLOUD_SYNC_ENABLED=true`. Do not set it in Vercel and do not commit a user-specific environment file.
5. Restart localhost, then have the human sign into the intended controlled account.
6. Open Account. Confirm Account Data reports the established account copy and Account Sync reports **Not enabled on this device**. There must be no startup `user_state` request before enrollment.
7. Click **Enable Sync on This Device** and accept its confirmation. Confirm one inventory SELECT, exact local/cloud equality, enabled metadata, `Synced`, and zero cloud UPDATEs from enrollment.
8. Close Account, navigate between Scanner and Portfolio, reopen Account, and confirm sync remains enabled without another coordinator.
9. Make one reviewed durable edit and confirm one coalesced revision-checked CAS for only that namespace. Do not manufacture a real conflict in this stage.
10. Use **Sync Now** once and confirm one inventory read and no unnecessary write.
11. Sign out and confirm all local durable data remains byte-for-byte present.
12. Stop localhost, return the local flag to false/remove it, restart, and confirm Account Sync is absent. Do not deploy.

## Infrastructure boundary

Stage 5C.1 adds no SQL migration, schema/RLS change, Supabase dashboard setting, Vercel variable, deployment, cron, Realtime configuration, server function, or client DELETE capability. All implementation validation uses local mocks and build inspection only.
