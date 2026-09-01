# Durable user state contract

> **Historical (Stages 1–5).** Stage 7A replaced local durable account state with cloud-authoritative Supabase state. Do not use this document to design current runtime persistence. See [Stage 7A cloud-authoritative account state](./PRODUCT_STAGE7A_CLOUD_AUTHORITATIVE_STATE.md).

## Purpose

This document defines the local data that may become a future cloud source of truth. Stage 1.5 does not add accounts, Supabase, network synchronization, or a global browser-data migration.

The fundamental read rule is:

> missing data, a valid empty collection, corrupt data, and a future unsupported schema are different states.

Portfolio and Watchlist expose typed read results with `ok`, `missing`, `corrupt`, and `unsupported_version` outcomes. A corrupt result includes a diagnostic and, when available, the untouched raw string. Compatibility readers return data for `ok`, return `[]` only for `missing`, and throw for corrupt or unsupported data. They never write during a read.

## Envelope and version strategy

Each cloud-candidate namespace is schema version 1:

```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-08-14T12:00:00.000Z",
  "revision": 3,
  "data": []
}
```

`updatedAt` is nullable because legacy storage has no trustworthy namespace mutation time. `revision: 0` and `updatedAt: null` mean “legacy mutation metadata unknown.” A durable mutation sets `updatedAt` and increments `revision`. Loading, in-memory normalization, and transient quote refreshes do not advance either value.

Legacy arrays/scalars are schema version 0 inputs. The `migratePortfolioState`, `migrateWatchlistState`, and `migratePreferencesState` functions are pure, deterministic migrations to schema version 1. Normal page loads run them only in memory. Persistence changes format only through an ordinary controlled write caused by a mutation or through explicit backup import.

## Portfolio schema v1

The canonical durable Portfolio item contains:

- Identity and contract: `id`, `ticker`, `optionType`, `strike`, `expiration`, `contracts`.
- Entry facts: `soldPrice`, `soldDate`, `entrySnapshot`, `createdAt`, `updatedAt`, `notes`.
- Entry VIX facts: `entryVixClose`, `entryVixDate`, `entryVixSource`.
- Lifecycle: `status`, `closePrice`, `closeDate`, `resolvedDate`, `resolutionType`, `resolutionSource`, `resolutionWarning`.
- Expiration resolution: `expirationClosePrice`, `expirationCloseDate`, `finalOptionValue`.
- Persisted results: `realizedPnl`, `percentCaptured`, `premiumCollected`, `daysHeld`.
- Explicit brokerage import facts: `importedSnapshot`.

`entrySnapshot` and `importedSnapshot` are durable because they describe point-in-time entry/import facts, not a current quote.

The durable item explicitly excludes `latestMarketData`, including current underlying/option prices, current IV, delta, volume, open interest, DTE, freshness, and availability. The local storage envelope may contain a sibling `localMarketData` map keyed by trade id. Runtime hydration combines durable facts with that local-only map, preserving the existing market-data experience. Future cloud code must use only envelope `data`.

Portfolio uses the existing `put_scanner_portfolio_trades` key. A root array is legacy input; a root object is required to be a supported envelope. No read rewrites either shape.

### Portfolio identity

Existing non-empty trade ids are preserved across reads, edits, canonical writes, and backup export/import. Missing portfolio ids are not generated during read. Such a legacy record produces a corrupt/controlled-migration-required result and remains untouched. The pure migration helper can accept an explicit id factory and timestamp only when a later, user-controlled migration owns that decision.

## Watchlist schema v1

The canonical durable Watchlist item contains:

- `id`
- `ticker`
- `expiry`
- `expiryTimestamp`
- `expiryFormatted`
- `strike`
- `optionType`
- `addedAt`
- `savedAt`
- `note`

It excludes `snapshot`, live `status`, and quote-refresh `updatedAt`. Those fields remain supported in the local envelope's sibling `localState` map and are rehydrated at runtime. That map can contain current bid/ask/last, underlying price, IV, delta, DTE, volume, open interest, yields, moneyness, freshness, and availability. Future cloud code must use only envelope `data`.

Watchlist identity is the deterministic contract key `TICKER|put|YYYY-MM-DD|STRIKE`. Existing ids must match that identity and survive reads, edits, writes, and backup import/export. A legacy item without the materialized id may derive it safely because the id is a pure function of the item's immutable contract identity; no randomness or read-time persistence is involved.

### Watchlist key precedence

1. If `put_scanner_watchlist` exists, it is authoritative—even if corrupt or unsupported.
2. Only when that key is absent may the legacy `watchlist` key be read.
3. Values are never merged.
4. Neither key is deleted during reads or writes. A controlled mutation writes the current key and leaves the legacy value recoverable.

## Preferences schema v1

Portable preferences are:

- `theme`
- `portfolioMarkBasis` (“Mark Book At”)
- `portfolioGroupMode`
- `collapsedExpirationGroups`
- `collapsedUnderlyingGroups`
- `showNominalYield`

Stage 1 found no persisted Show OI / Volume choice, so Stage 1.5 does not invent one.

The schema excludes debug flags, `put_scanner:last_url:v1`, navigation state, scroll/modal state, market cache controls, and all quote/history caches. Runtime preference keys remain separate in Stage 1.5; the versioned preferences envelope is used by backup and is the future cloud contract.

Theme precedence is deterministic: `put_scanner_theme` is authoritative when present; only when absent is legacy `theme` considered with `theme_migration_version`. An invalid current theme is an error, not an invitation to fall back and hide corruption. Other preference fields each use their existing key.

## Failure and write semantics

- Malformed JSON, an unexpected root, one invalid collection item, duplicate ids, invalid envelope metadata, and unsupported versions never become `[]`.
- Readers have no write or delete side effects.
- Ordinary writers refuse to replace a corrupt or unsupported existing value.
- Every envelope is normalized, serialized, parsed, and validated before `setItem`.
- A serialization or `setItem` failure returns an internal error and leaves the previous stored value in place.
- Portfolio and Watchlist each use a single-key `setItem`, which is atomic at the localStorage operation level.
- Multi-key backup import validates and serializes every intended value first, then rolls back already-written keys if any write fails.

The UI intentionally adds no new corruption banners in Stage 1.5. Under valid/missing data, behavior is unchanged. Corrupt/unsupported compatibility reads fail closed instead of displaying or propagating a false empty state.

## Backup compatibility

Backup file schema version 2 contains v1 envelopes for Portfolio, Watchlist, and Preferences. Transient local maps and all market caches are excluded.

Stage 1 backup schema version 1 remains accepted. Import explicitly validates its arrays/preferences and migrates them in memory to v1 namespace envelopes before any write. Unsupported future backup or namespace versions are rejected before storage changes. Import remains an explicit replace operation and never performs network requests.

## Future cloud boundary

Future synchronization may consume only each namespace envelope's `data`, `schemaVersion`, `updatedAt`, and `revision`. It must not upload local transient maps, market caches, debug/session/navigation state, or raw corrupt values. A corrupt, unsupported, or missing-id state requires explicit recovery/migration handling before synchronization; it must never be treated as an empty remote truth.

## Stage 6B.4 Portfolio entry snapshot extension

Portfolio schema version 1 now accepts optional `entryDelta`, `entryDeltaSource`, `entryDeltaCapturedAt`, `entryIv`, `entryIvSource`, and `entryIvCapturedAt` fields. They are canonical durable trade data and therefore participate in backup, restore, cloud fingerprints, reconciliation, and conflict recovery. Absence remains absence: legacy trades are not rewritten with `null` or `undefined`, so merely loading the new application does not advance the namespace revision or cause enrollment/sync churn.

`latestMarketData.delta` and `latestMarketData.iv` remain transient device-local Current values. They are never promoted to historical Entry values for a legacy trade. Only contemporaneous exact-contract creation capture, explicit manual/imported values, or explicit recovery from an already-durable `entrySnapshot.delta` / `entrySnapshot.iv` can create the durable fields. Entry IV uses percentage points (`65.4` means `65.4%`).
