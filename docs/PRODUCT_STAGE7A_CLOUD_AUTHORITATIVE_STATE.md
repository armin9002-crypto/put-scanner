# Stage 7A: cloud-authoritative account state

Status: current production architecture as of 2026-08-29. This document supersedes the Stage 4 migration and Stage 5 local-first synchronization documents for runtime design decisions.

## Source-of-truth rules

| Data | Signed in | Signed out | Browser persistence |
| --- | --- | --- | --- |
| Portfolio, history, Entry Delta/VIX, notes, maintenance fields | Supabase `portfolio` namespace | unavailable for durable saving | ephemeral process memory only |
| Watchlist contracts and notes | Supabase `watchlist` namespace | save/star is rejected with a sign-in prompt | ephemeral process memory only |
| Mark basis, Portfolio grouping mode, nominal-yield display | Supabase `preferences` namespace | defaults; changes are not durable | ephemeral process memory only |
| Theme | device | device | localStorage |
| Collapsed expiration/underlying groups | device | device | localStorage |
| Market data and request caches | provider/cache layer | provider/cache layer | localStorage/sessionStorage/memory as already designed |
| Scanner return route | device session | device session | sessionStorage |

The Supabase schema remains three `public.user_state` namespaces: `portfolio`, `watchlist`, and `preferences`. Row-level ownership and per-row revision behavior are unchanged.

## Before Stage 7A

Portfolio and Watchlist components wrote versioned envelopes to localStorage. Durable mutation events triggered a root production sync manager. That manager tracked a device identity, enrollment, local revisions, fingerprints, cloud revisions, and namespace snapshots. Startup compared local and cloud values and classified each namespace as `IN_SYNC`, `LOCAL_AHEAD`, `CLOUD_AHEAD`, or `BOTH_CHANGED`. Local-ahead state could push, cloud-ahead state could pull, and both-changed state froze the namespace behind **Keep This Device** / **Use Account Copy** recovery. Stage 4 first-login migration separately decided whether to initialize cloud from local data or restore cloud to a browser.

This protected pre-account browser data during rollout, but permanently left two durable authorities and allowed an obsolete browser Portfolio to block the user's cloud Portfolio.

## After Stage 7A

`CloudSyncProvider` now acts as the account-state provider. Its responsibilities are limited to:

1. wait for authentication resolution;
2. clear/lock account memory on every identity transition;
3. fetch all three canonical namespaces from Supabase;
4. initialize a brand-new account with three empty documents, never legacy browser data;
5. hydrate a process-memory compatibility adapter;
6. track cloud rows and revisions;
7. issue minimal namespace CAS writes for explicit durable edits;
8. reload the newest cloud row on a stale CAS;
9. revert failed optimistic memory state to the last cloud-saved value;
10. provide explicit reload and backup-restore actions.

It does not enroll a device, fingerprint local data, assign local/cloud-ahead classifications, migrate local data, poll, subscribe to Realtime, or keep an offline queue.

## Bootstrap and transitions

Authenticated startup is gated: auth resolves, the account-memory adapter is locked and cleared, all namespaces are fetched, the verified cloud rows hydrate memory, and only then do Portfolio/Watchlist routes render. Legacy localStorage is never read for this bootstrap, so it cannot flash in the UI or affect a decision.

If cloud loading fails, the app shows an integrity-preserving error with **Retry** and **Sign Out**. Account routes do not render and legacy data is not used as fallback. The cleanup allowlist is not run.

Sign-out locks and clears account memory before anonymous routes are allowed to remount. It never deletes Supabase rows. Signed-out Portfolio and Watchlist reads are empty; durable writes are rejected with a sign-in-required notice.

## Writes, CAS, and conflicts

An explicit durable edit updates the in-memory runtime model and emits a namespace signal. The account layer validates the resulting document and sends one `updateNamespaceIfRevisionMatches` request using the cloud revision loaded for that namespace. Success replaces the tracked row with the returned revision.

Network/permission/verification failure restores the last cloud-saved document in memory and tells the user the change was not saved. No local durable copy or offline queue is retained.

A CAS conflict now means only: **the cloud row changed since this device loaded it**. The manager fetches that namespace, hydrates the latest cloud value, identifies the namespace in account status, and asks the user to retry the intended edit. `BOTH_CHANGED` and local-vs-cloud winner selection no longer exist.

## Legacy key policy

Only after successful cloud retrieval, validation, and memory hydration, the following exact localStorage keys are retired:

- `put_scanner_portfolio_trades`
- `put_scanner_watchlist`
- `watchlist`
- `put_scanner_portfolio_mark_basis`
- `put_scanner_portfolio_group_mode:v1`
- `put_scanner_show_nominal_yield:v1`
- `put_scanner_cloud_sync_meta:v1`
- `put_scanner_cloud_sync_engine:v1`
- `put_scanner_cloud_device_id:v1`

Cleanup is an explicit allowlist. A failed cloud bootstrap removes none of them.

The following device keys are deliberately preserved:

- `put_scanner_theme`, `theme`, `theme_migration_version`
- `put_scanner_portfolio_expiry_groups:v1`
- `put_scanner_portfolio_underlying_groups:v1`
- `put_scanner:last_url:v1` (sessionStorage)
- `put_scanner_debug_layout` and other explicit development presentation toggles

## Market-cache exclusion

Stage 7A does not enumerate or clear storage. It therefore preserves every market/request cache, including the current known static/dynamic families:

- `price_cache_batch_v5`, `expiry_dates_cache`, `screener_expirations_v2`
- `scanner_option_snapshots_v2`, `scanner_option_expirations_v1`, `scanner_option_snapshot_diagnostics_v2`
- `etf_pulse_rows:v2`
- `chart_history_cache:*`, `sparkline_*`, `extended_price_*`
- `options_*`, `ticker-detail-v1:*`, `screener_batch_v*`, holdings/request cache keys
- `put_scanner_cache_cleanup_at`

Provider/server caching, request coalescing, cache TTLs, and request budgets are unchanged. Portfolio and Watchlist quote refresh writes transient quote fields only; the durable comparison emits no cloud mutation.

## Preference classification

- **Account/cloud:** Portfolio mark basis, Portfolio group mode, and nominal-yield visibility follow the user and participate in CAS writes.
- **Device-local:** theme and collapsed-group maps describe a particular screen/device and remain localStorage settings. They do not emit account mutations.
- Historical cloud preference payloads may still contain theme/collapse fields for schema compatibility. Account-preference updates preserve those fields but the current UI does not hydrate them over device settings.

## Backup and restore

A signed-in export is constructed directly from the tracked canonical cloud rows, including cloud revision/timestamp metadata. It never reads legacy localStorage or market caches. Existing version 1 and version 2 JSON backups remain parseable.

Restore is signed-in only, explicitly confirmed, validated before writing, and performs revision-checked namespace cloud mutations. The mandatory pre-import recovery download is also generated from cloud state. A stale revision stops the restore, reloads cloud state, and requires an explicit retry. Signed-out import controls are disabled and explain that sign-in is required.

## Removed architecture

Stage 7A deletes the Stage 4 migration planner/restore path, Stage 5 device identity and enrollment, fingerprints, local/cloud revision metadata, reconciliation matrix, namespace freeze/recovery dialogs, retry queue, startup sync coordinator, development migration/sync harnesses, and their intentionally obsolete tests. The cloud transport, validation, schema, RLS assumptions, CAS primitive, mutation signal, durable domain validation, and manual backup format remain.

## Production rollout smoke test

1. Confirm the expected cloud Portfolio before deploy if practical.
2. Deploy the tested build.
3. Sign in from a browser known to contain old local Portfolio data.
4. Verify the cloud Portfolio appears without a local-data flash.
5. Verify no conflict/migration/winner-selection modal appears.
6. Verify the cloud Watchlist.
7. Optionally edit one harmless note.
8. Reload and confirm that note returns from cloud.
9. Sign out and confirm Portfolio/Watchlist account data disappears.
10. Sign back in and confirm it returns from cloud.

No automated test or rollout step should mutate a real production account.
