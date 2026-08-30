# Supabase Stage 4A dormant migration foundation

> **Historical.** Automatic/local-first migration was removed in Stage 7A. Do not reintroduce it. See [the current cloud-authoritative architecture](./PRODUCT_STAGE7A_CLOUD_AUTHORITATIVE_STATE.md).

Status: machinery only. Real migration, cloud synchronization, and cloud restore have **not begun**.

## What Stage 4A builds

Stage 4A adds an isolated `src/lib/cloudState/` package containing:

- typed cloud namespace and error contracts;
- validation through the Stage 1.5 durable migrations;
- an intentionally injected Supabase transport;
- deterministic canonical comparison and read-back verification;
- a pure local-state inventory and migration planner;
- a session-only backup acknowledgement gate;
- account-scoped device metadata; and
- pure cloud-to-runtime hydration that preserves matching device-local quote state.

The package is deliberately unreachable from the normal application module graph. No component, page, provider, auth action, theme action, Portfolio action, Watchlist action, or app entry point imports it. Creating the package does not create a service singleton or execute a query. There is no feature flag to misconfigure: architectural isolation is the gate.

Consequently, Stage 4A normal runtime performs zero `public.user_state` SELECT, INSERT, or UPDATE requests. Supabase Auth behaves exactly as it did in Stage 3. Signing in, restoring a session, or signing out does not inspect, upload, download, clear, or migrate durable state.

## Cloud namespace contract

There are exactly three cloud namespaces:

| Namespace | `schema_version` | `payload` |
| --- | ---: | --- |
| `portfolio` | 1 | `{ "data": [durable Portfolio trades] }` |
| `watchlist` | 1 | `{ "data": [durable saved contracts] }` |
| `preferences` | 1 | `{ "data": {portable preference fields} }` |

Every returned row must contain the authenticated `user_id`, one allowed `namespace`, a supported positive `schema_version`, a contract-shaped `payload`, a positive `revision`, and valid database timestamps. The client writes only `user_id`, `namespace`, `schema_version`, and `payload` during initialization, and only `schema_version` and `payload` during updates. The database owns `revision`, `created_at`, and `updated_at`.

Portfolio serialization uses `toDurablePortfolioState`; Watchlist uses `toDurableWatchlistState`; Preferences uses the existing durable preference schema. Current quotes, `latestMarketData`, Watchlist snapshots/status/freshness, Yahoo and option caches, chart history, Scanner state, ETF Pulse state, debug state, last URL, auth state, and device sync metadata are not cloud payloads.

## Cloud transport and typed failures

The dormant transport exposes four operations:

- `fetchAllUserState()`
- `fetchNamespace(namespace)`
- `initializeAllNamespaces(input)`
- `updateNamespaceIfRevisionMatches(namespace, expectedRevision, schemaVersion, payload)`

The database client and authenticated user ID must be deliberately injected. The transport does not import the configured Auth client, subscribe to Auth, inspect local storage, retry, poll, or subscribe to Realtime.

Errors retain one of these categories without copying database details, URLs, credentials, tokens, or payload values into the error:

- `not_authenticated`
- `not_configured`
- `network_error`
- `permission_error`
- `conflict`
- `cloud_state_incomplete`
- `cloud_state_unexpected`
- `schema_unsupported`
- `verification_failed`

`fetchAllUserState` accepts either zero rows or one valid row for each of all three namespaces. One or two rows are incomplete. Duplicate rows, unknown namespaces, ownership mismatches, invalid revisions/timestamps, and malformed payloads are unexpected. A future schema is unsupported and is never downgraded.

## Atomic first initialization

A future approved first migration will send one bulk insert containing all three documents:

```text
INSERT [portfolio, watchlist, preferences]
```

Supabase's JavaScript client accepts an array for a bulk insert, and `.select()` returns the affected rows ([insert reference](https://supabase.com/docs/reference/javascript/insert), [returning rows reference](https://supabase.com/docs/reference/javascript/using-modifiers-select)). The existing composite primary key makes the single PostgreSQL statement all-or-nothing. If any namespace already exists, the primary-key conflict aborts the statement. There is no pre-delete, three-request fallback, or upsert.

The initialization response is validated, but it is not proof of success by itself. The full future sequence is:

```text
validated local canonical documents
  -> one bulk INSERT
  -> a separate fetch of all three rows
  -> validation and canonical semantic comparison
  -> migration_verified only after an exact match
```

Canonical comparison sorts object keys recursively while retaining array order and value types. It therefore ignores JSON object key order but detects missing values, changed values, or reordered namespace arrays. A mismatch is `verification_failed`; it never triggers a blind corrective overwrite.

## Optimistic concurrency and conflicts

Future namespace updates are compare-and-swap operations. Filters are applied to `user_id`, `namespace`, and the caller's `expectedRevision`, which follows Supabase's documented update-filter pattern ([filters reference](https://supabase.com/docs/reference/javascript/using-filters)). The request changes only `schema_version` and `payload`; the existing database trigger increments `revision`.

Zero returned rows means another writer changed the row, the row is absent, or access no longer exposes it. The safe result is `conflict`. The transport does not retry, upsert, use last-write-wins, or merge records. A successful response must contain exactly one row at `expectedRevision + 1` with the intended canonical payload.

## Deliberate local inventory

Local presence is represented by counts, not a broad “storage exists” boolean:

- Portfolio open trade count;
- Portfolio history count;
- Watchlist item count; and
- non-default portable preference count.

Default Theme (`dark`), Portfolio mark basis (`ask`), group mode (`expiration`), expanded group maps, and hidden nominal yield do not make an otherwise empty browser “populated.” The summary contains no tickers, strikes, premiums, account values, notes, or other financial facts and is not logged.

The local reader distinguishes missing, valid empty, corrupt, and unsupported state. Corrupt or unsupported state is not converted to empty and cannot become an upload input. It reads only when explicitly called and performs no write.

## Migration planner

One pure planner owns the migration state and permitted next action:

| Local | Cloud | State / safe action |
| --- | --- | --- |
| empty | not checked | `not_checked`; deliberately check later |
| empty | no rows | `cloud_empty_local_empty`; wait for explicit initialization |
| populated | no rows | `cloud_empty_local_has_data`; require a fresh session backup |
| populated + backup acknowledged | no rows | `migration_ready`; future explicit bulk initialization may be offered |
| empty | all three rows | `cloud_has_data_local_empty`; review a future restore, never auto-hydrate |
| populated | all three rows | `both_have_data`; compare and explicitly resolve, never pick a winner |
| either | partial/corrupt/unsupported/error | `error`; stop writes and hydration |
| any | metadata belongs to another user | `conflict`; leave local durable state untouched |

`migration_in_progress` means the deliberate bulk insert is awaiting read-back verification. `migration_verified` is reachable only after semantic read-back equality. An all-three-row cloud document whose payload happens to be empty is still established cloud state, not a brand-new account with no rows. Empty is valid data and never supplies an automatic overwrite direction.

## Fresh-backup gate

The backup gate is an in-memory state machine keyed by a migration-session ID. It begins locked. A failed export remains locked. Only a successful backup export recorded for that same session unlocks future initialization. A new or unrelated session starts locked again.

Nothing is written to local storage, sync metadata, cookies, or the cloud to remember the acknowledgement. The existing backup file schema and Data Backup UI are unchanged in Stage 4A; no migration UI invokes this helper yet.

## Device-local sync metadata

Future sync bookkeeping uses one explicitly versioned key:

```json
{
  "version": 1,
  "userId": "authenticated-user-id",
  "namespaces": {
    "portfolio": {
      "cloudRevision": null,
      "lastSyncedLocalUpdatedAt": null,
      "lastSyncedAt": null
    },
    "watchlist": {
      "cloudRevision": null,
      "lastSyncedLocalUpdatedAt": null,
      "lastSyncedAt": null
    },
    "preferences": {
      "cloudRevision": null,
      "lastSyncedLocalUpdatedAt": null,
      "lastSyncedAt": null
    }
  },
  "migrationState": "not_checked",
  "lastCloudCheckAt": null
}
```

Key: `put_scanner_cloud_sync_meta:v1`.

Validation uses an exact field allowlist, so auth tokens and unknown fields are rejected. Malformed metadata returns a controlled corrupt result and never reads, writes, removes, or replaces Portfolio, Watchlist, or Preferences. If the authenticated user differs from `userId`, the reader returns an account-mismatch result with fresh empty metadata for the new identity; it does not persist that result or clear durable data.

Metadata is intentionally excluded from backups. It describes one device/account relationship and could be dangerously stale on restore. The existing backup implementation reads only the three durable namespaces, so the backup format remains unchanged.

## Pure future hydration

Validated cloud documents can be transformed into runtime state without writing local storage. Portfolio hydration retains matching trade-ID `latestMarketData` from the current device. Watchlist hydration retains matching contract-ID snapshots, live status, and refresh time. Nonmatching transient data is dropped, and market data can later be reacquired normally. Preferences are copied as validated durable values.

This transformation is not called by the application in Stage 4A. No sign-in, session restoration, app/page mount, or cloud response writes cloud payloads into local storage.

## Future new-device restore and ongoing sync

A later stage may add an explicitly enabled restore review for a device with empty local durable state and all three cloud rows. That flow must validate, summarize, receive user confirmation, prepare pure hydration, and use the established safe local writers. It must not write raw cloud JSON into arbitrary storage keys.

Later event-driven ongoing sync is intended to be off the UI critical path:

```text
durable user edit
  -> immediate local UI update
  -> immediate validated localStorage write
  -> debounced namespace cloud update
  -> revision compare-and-swap
  -> success updates device-local sync metadata
```

No part of that flow is wired in Stage 4A. There is no polling, WebSocket, Realtime subscription, field-level merge engine, or last-write-wins policy.

## No-delete design

The browser transport exposes no DELETE and no upsert. An intentionally empty namespace remains a valid stable row with `{ "data": [] }` or `{ "data": {} }`. Account deletion remains a separate administrative/Auth lifecycle design relying on the existing foreign-key cascade; sign-out never deletes local or cloud data.

## Future controlled operator procedure

Real owner migration must occur only in a later explicitly authorized stage:

1. Use the authoritative browser.
2. Export a fresh backup.
3. Verify the backup.
4. Sign in.
5. Review the local/cloud migration summary.
6. Explicitly upload the validated local state with one three-row insert.
7. Read all three rows back and verify canonical equality.
8. Confirm cloud counts without logging financial values.
9. Only then test a second device.

Stage 4A does not perform any of these operator actions.

## Unchanged boundaries

Stage 4A adds no SQL migration, Supabase dashboard change, Auth configuration change, Vercel environment change, route, component, modal, account control, or sync UI. It does not access the live Supabase project and does not read the owner's production browser. All transport tests use a deterministic in-memory Supabase mock and disposable fixtures. Existing local behavior, backup behavior, authentication, layouts, financial calculations, and market-data requests remain unchanged.
