# Put Scanner Cloud Migration Readiness Audit

Date: 2026-08-14
Scope: Stage 1 safety, storage inventory, infrastructure audit, and local backup only

## Executive summary

Put Scanner currently has two primary user-data stores: a single unversioned portfolio array and a single unversioned watchlist array. Several display preferences are stored as independent scalar or JSON keys. Market data is cached under a separate set of static and dynamic keys. No IndexedDB use, application-auth cookie use, or service-worker persistence was found. The only `sessionStorage` key is the Scanner return URL.

The most serious migration blocker is destructive read-time normalization. A malformed portfolio or watchlist value is treated as an empty array, and the empty/filtered result can then be written back during a normal read. Invalid individual records are also silently discarded. Cloud synchronization must not be placed on top of those semantics.

At the time of the Stage 1 audit, the repository contained the `@supabase/supabase-js` dependency and three migrations, but no runtime code imported the client and no Put Scanner feature depended on it. The migrations created a separate project-management product named Flowboard. Stage 1.5 removed those SQL files from the active migration path; see `docs/LEGACY_SUPABASE_ARTIFACTS.md`.

Stage 1 adds a local-only, versioned export/import flow. It makes no API calls, excludes market caches and transient quote fields, validates an import before writing, requires a pre-import recovery download, replaces rather than merges data, and rolls back completed key writes if a later storage write fails.

## Current durable storage

All keys below are in `localStorage` unless explicitly marked otherwise.

| Key | Files | Purpose and current shape | Writers / readers | User-created vs cache | Loss impact | Cloud candidate | Versioning need |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `put_scanner_portfolio_trades` | `src/lib/portfolioStorage.ts`; Portfolio and Options pages | JSON array of `PortfolioTrade`; open and historical records share one array | Portfolio/Options helpers write; Portfolio and backup read | User-created trade facts mixed with refreshed `latestMarketData` | Critical: open positions, notes, and history can be lost | Yes, after separating transient fields | Critical; key and payload are unversioned |
| `put_scanner_watchlist` | `src/lib/watchlist.ts`; Options/Watchlist pages | JSON array of `WatchlistItem` | Watchlist helpers and live refresh write; Watchlist/Options/backup read | User identity/notes mixed with market snapshot/status | High: saved contracts and notes are lost | Yes, durable subset only | Critical; key and payload are unversioned |
| `watchlist` | `src/lib/watchlist.ts` | Legacy watchlist array | Read only as fallback; removed by normal watchlist save/read | Legacy user state | High if it is the only valid copy | Migrate once, deliberately | Yes; current migration is implicit and destructive |
| `put_scanner_theme` | `src/lib/theme.tsx`, `src/lib/themePreference.ts` | Scalar: `dark`, `dark-blue`, `light`, or `sepia` | Theme provider writes/reads; backup reads/writes | User preference | Low | Yes | Small enum/version needed |
| `theme` | same | Legacy theme scalar, still mirrored on every theme write | Theme provider and backup | Duplicate user preference | Low | No separate cloud field; map to canonical theme | Retire only through an explicit migration |
| `theme_migration_version` | same | Scalar migration marker, currently `2` | Theme provider and backup | Local migration metadata | None by itself | No | Keep device-local |
| `put_scanner_portfolio_mark_basis` | `src/lib/portfolioMarkPreference.ts`, `src/pages/PortfolioPage.tsx` | Scalar: `last`, `bid`, or `ask` | Portfolio writes/reads; backup reads/writes | User preference (“Mark at”) | Medium: changes portfolio presentation | Yes | Enum/version needed |
| `put_scanner_portfolio_group_mode:v1` | `src/lib/portfolioSchedulePreferences.ts` | Scalar: `expiration`, `underlying`, or `none` | Portfolio writes/reads; backup reads/writes | User preference | Low | Yes | Key is v1; cloud schema still needs a version |
| `put_scanner_portfolio_expiry_groups:v1` | same | JSON object `{ [expiration]: boolean }` | Portfolio writes/reads; backup reads/writes | Persistent presentation preference | Low | Yes, if cross-device layout continuity is desired | Key is v1; prune stale expirations later |
| `put_scanner_portfolio_underlying_groups:v1` | same | JSON object `{ [ticker]: boolean }` | Portfolio writes/reads; backup reads/writes | Persistent presentation preference | Low | Yes, if cross-device layout continuity is desired | Key is v1; prune stale tickers later |
| `put_scanner_show_nominal_yield:v1` | `src/lib/optionTablePreferences.ts`, Options page | Scalar string `true`/`false` | Options writes/reads; backup reads/writes | User preference | Low | Yes | Key is v1 |

### Portfolio model: durable facts vs transient data

The storage key contains a flat array; it has no outer schema/version wrapper. Open, manually closed, assigned, expired, and pending-resolution trades are distinguished by `status` (`open`, `closed`, `expired`, `assigned`, or `expired_price_pending`) and optional resolution fields.

Durable trade facts to preserve and eventually sync:

- Identity and contract: `id`, `ticker`, `optionType`, `strike`, `expiration`, `contracts`.
- Entry: `soldPrice`, `soldDate`, `entrySnapshot`, `createdAt`, `updatedAt`, `notes`.
- Historical entry context: `entryVixClose`, `entryVixDate`, `entryVixSource`.
- Lifecycle: `status`, `closePrice`, `closeDate`, `resolvedDate`, `resolutionType`, `resolutionSource`, `resolutionWarning`.
- Expiration facts: `expirationClosePrice`, `expirationCloseDate`, `finalOptionValue`.
- Persisted results: `realizedPnl`, `percentCaptured`, `premiumCollected`, `daysHeld`.
- `importedSnapshot` is not live market cache. It records user-imported brokerage evidence and cannot reliably be regenerated, so it is retained in backup/cloud-candidate data.

`entrySnapshot` is also retained. Although its values originated in a market quote, it is an entry-time historical fact rather than a replaceable current quote.

Regenerable current market data that must not cloud-sync:

- Entire `latestMarketData` object: `underlyingPrice`, option bid/ask/mid/last, `lastTradeDate`, IV, delta, volume, open interest, DTE, refresh time, and availability status.

Realized IRR is not stored. `src/lib/portfolioHistoryAnalytics.ts` derives it from durable cash-flow and date fields. Assignment is represented by `status: "assigned"`; there is no separate assignment price/share-lot model today.

### Watchlist model: durable facts vs transient data

Durable fields to preserve and eventually sync:

- Stable contract identity: `id` (derived from ticker/type/expiry/strike), `ticker`, `optionType`, `expiry`, `expiryTimestamp`, `strike`.
- User metadata: `note`, `addedAt`, `savedAt`.
- `expiryFormatted` is retained by the Stage 1 backup to reproduce the current shape, although it can be derived from `expiry`.

Regenerable fields excluded from backup/cloud sync:

- `snapshot`: underlying price, bid/ask/last, last-trade time, delta, IV, DTE, volume, open interest, yields, and moneyness.
- `status` (`live`, `stale`, `expired`, and similar) and `updatedAt`, which describe the last market refresh.

The current watchlist deduplicates by the derived contract ID during reads/writes. It chooses the more complete/fresher snapshot while preserving the first timestamps and a nonempty note.

## Cloud candidates

Recommended account-portable state:

- Portfolio durable fields listed above, including notes and closed/expired history.
- Watchlist contract identity, notes, and save timestamps.
- Theme, portfolio mark basis, portfolio grouping, collapsed groups, and nominal-yield visibility.

Preferences that look user-configurable but are **not currently persistent** must not be invented during migration. These include Show Volume/OI on Options, Screener, and Portfolio; sort directions; Watchlist sort; Portfolio schedule sort; ETF Pulse view/filters; and Screener form state. Decide explicitly in a later product stage whether any should become account preferences.

## Device-local caches: never cloud sync

| Key or pattern | Files | Shape / purpose | Writers / readers | User-created? | Loss impact | Versioning |
| --- | --- | --- | --- | --- | --- | --- |
| `price_cache_batch_v5` | `src/lib/cache.ts`, `src/lib/api.ts` | Broker `CacheRecord<BatchPriceData>`; schema version 6 despite v5 key name | Batch-price broker | No | Regenerates; temporary slower load | Already broker-versioned; key name is misleading |
| `options_v2_{TICKER}_{initial\|UNIX}` | `src/lib/api.ts` | Broker record containing normalized option chain; schema v3 | `fetchOptions` | No | Regenerates | Versioned in record; key prefix still v2 |
| `sparkline_{TICKER}` | `src/lib/api.ts` | Intraday price/sparkline broker record | `fetchSparkline` | No | Regenerates | Broker schema v1 |
| `extended_price_{TICKER}_{spark\|daily}` | `src/lib/api.ts` | One-year performance/current-price record | `fetchExtendedPrice` | No | Regenerates | Broker schema v1 |
| `ivrank:{TICKER}` | `src/lib/api.ts` | Current IV/rank/percentile broker record | `fetchIVRank` | No | Regenerates | Broker schema v1 |
| `chart_history_cache:{TICKER}:{TIMEFRAME}` | `src/lib/chartHistory.ts` | Timeframe chart points and metadata | Chart/ETF Pulse/entry lookup | No | Regenerates | Broker schema v2 |
| `portfolio_entry_vix:{START}:{END}` | `src/lib/portfolioEntryVix.ts` | Historical VIX chart response used to fill missing entry VIX | Portfolio enrichment | No; resolved VIX values copied into trades are durable | Cache loss only causes refetch | Broker schema v1 |
| `portfolio_expiration_close:{TICKER}:{DATE}` | `src/lib/portfolioExpirationArchive.ts` | Immutable historical close lookup | Expiration resolver | No; resolved close copied into trade is durable | Cache loss only causes refetch | Broker schema v1 |
| `underlying_holdings_v1_{TICKER}` | `src/lib/underlyingHoldings.ts` | Holdings or temporary unavailable result | Holdings modal | No | Regenerates | Broker schema v2; prefix says v1 |
| `fund_assets_v1:{SORTED SYMBOLS...}` | `src/lib/fundAssets.ts` | Fund net-assets map | Scanner | No | Regenerates | Broker schema v1 |
| `etf_pulse_rows:v2` | `src/lib/etfPulseData.ts` | Calculated ETF Pulse rows plus progress/errors/timestamps | ETF Pulse | No | Regenerates from chart history | Key-versioned, not broker-wrapped |
| `scanner_option_snapshots_v2` | `src/lib/scannerOptionSnapshot.ts` | Per-ticker IV/liquidity snapshots | Manual scanner updater; Scanner reads | No | Regenerates | Entries contain schema v2 |
| `scanner_option_expirations_v1` | same | Per-ticker expiration arrays and refresh time | Option-chain cache bridge | No | Regenerates | Key-versioned only |
| `scanner_option_snapshot_diagnostics_v2` | same | Per-ticker failure/unavailable messages | Scanner updater/UI | No | None | Key-versioned only |
| `expiry_dates_cache` | `src/lib/cache.ts`, Screener | `{ expirations, cachedAt }` | Screener prefetch | No | Regenerates | Unversioned |
| `screener_expirations_v2` | `src/lib/cache.ts` | Legacy expiration cache fallback | Read-only fallback | No | None | Legacy; safe to expire |
| `put_scanner_cache_cleanup_at` | `src/lib/cacheMaintenance.ts` | Last cleanup epoch | Startup cleanup | No | None | No cloud value |
| `price_cache*`, `batch_prices*` | `src/main.tsx`, `src/lib/cacheMaintenance.ts` | Current/legacy cache prefixes inspected and pruned at startup | Cleanup only for keys without active exact writers, except batch key above | No | None | Remove only as cache maintenance |
| `trade_cockpit_scan_results*` | `src/lib/cacheMaintenance.ts` | Legacy cache prefix | Cleanup removes it | No | None | Dead/legacy |

The generic market-data broker supports `sessionStorage`, but no current production caller selects session storage.

## Ephemeral and session state

| Key/state | Location | Classification and recommendation |
| --- | --- | --- |
| `put_scanner:last_url:v1` (`sessionStorage`) | `src/lib/scannerNavigation.ts` | Scanner return URL/query only. Keep session/device-local; never cloud sync. |
| Scanner query parameters (`q`, leverage/type/expiration/sort/liquidity) | `src/lib/scannerState.ts`, Home page URL | Shareable navigation state, not account persistence. |
| `put_scanner_debug_options` | Options page, QA checklist | Device debug flag; never sync or export. |
| `put_scanner_debug_layout` | App, QA checklist | Device debug flag; never sync or export. |
| `put_scanner_debug_network` | request diagnostics/App | Device debug flag enabling in-memory counters; never sync or export. |
| Modal/drawer state, selected row, mobile sheets/tabs, loading/errors, refresh progress, sort/filter state not listed as durable | Page/component React state | Ephemeral. Do not sync. |
| Request diagnostics counters/provider health/in-flight maps | `requestDiagnostics.ts`, `marketDataRequest.ts`, `api/_lib/yahoo.js` | Memory-only operational state. Do not sync. |

No IndexedDB use or application-owned persistent cookies were found. `api/_lib/yahoo.js` handles Yahoo response cookies only inside server-side option-session acquisition; those are warm-function memory state, not browser persistence.

## Supabase artifacts found in Stage 1

Found:

- `@supabase/supabase-js` in `package.json`/lockfile.
- `supabase/migrations/20260502020956_create_tables.sql` creates `profiles`, `projects`, `project_members`, `tasks`, and `comments` and labels itself “Create Flowboard Tables.”
- `20260502021008_create_rls_policies.sql` enables RLS and project/task/comment policies.
- `20260502021016_create_triggers.sql` creates signup/project-member triggers.

No source or API file imports Supabase, creates a client, reads Supabase environment variables, or depends on these tables. Running these migrations would create unrelated Flowboard project-management objects and auth triggers in a Put Scanner database.

Stage 1.5 disposition: the three Flowboard SQL files were deleted from `supabase/migrations/` after the dependency check above and remain recoverable in Git history. The unused package dependency remains uninitialized. New Put Scanner migrations must start from a clean, product-specific baseline. See `docs/LEGACY_SUPABASE_ARTIFACTS.md`.

## Storage risks

| Severity | Finding | Why it matters before sync |
| --- | --- | --- |
| Critical | `loadPortfolioTrades` maps malformed/non-array JSON to `[]`, drops every invalid record, and writes the result during a read. | One corrupt record or payload can become permanent local deletion; a sync layer could then propagate the deletion. |
| Critical | `getWatchlist` treats corrupt canonical data as empty, writes `[]`, and removes the potentially valid legacy key. | Canonical corruption can destroy both recovery paths. |
| High | Portfolio/watchlist payloads have no outer schema version or migration journal. | Cloud and local clients cannot safely negotiate shape changes. |
| High | Save helpers swallow quota/unavailable-storage failures. UI state can appear saved until reload. | A cloud handoff must surface persistence failures and never mark a sync successful prematurely. |
| High | Portfolio has no duplicate-ID guard; watchlist silently deduplicates with market-snapshot-based precedence. | Merge/conflict rules would be inconsistent and could lose user intent. |
| High | Durable and transient market fields share each portfolio/watchlist record. | Naive row sync creates write amplification and quote conflicts across devices. |
| Medium | Watchlist legacy migration and theme migration happen implicitly during ordinary load/effect behavior. | Account migration must be explicit, observable, and recoverable rather than piggybacked on render. |
| Medium | Preference writes are separate, best-effort, and uncoordinated. Corrupt collapsed-group JSON becomes `{}` and is later persisted. | Cross-device preference updates need version/conflict policy, though financial data is not at risk. |
| Medium | Cache naming and embedded schema versions disagree (`price_cache_batch_v5`/schema 6, option key v2/schema 3, holdings key v1/schema 2). | Operational cleanup and debugging are harder; do not infer payload schema from key names. |
| Low | Multiple cache wrappers remain (`cache.ts`, `dataCache.ts`, feature caches, shared broker). | They are intentionally layered now, but future persistence work must not mistake them for user stores. |

Stage 1 does not refactor these normal read/write paths. The backup importer uses strict validation and rollback separately so it does not inherit silent-reset behavior.

## Vercel / Yahoo scalability audit

The estimates below are request units, not cost forecasts. They assume cold browser caches; Vercel CDN caching may serve identical URLs without running a function or reaching Yahoo, while explicit fresh requests and cache misses do not receive that benefit. `U` is unique ticker/expiration option chains in a user portfolio/watchlist. The current universe is 42 ETFs; ETF Pulse adds QQQ and SPY for 44 histories.

| Risk | Workflow and trigger | Per-user cold behavior | 100 users | 500 users | 1,000 users | Main concern |
| --- | --- | --- | --- | --- | --- | --- |
| Critical | ETF Pulse page load (automatic) | Up to 44 browser→Vercel 2Y history requests, concurrency 5; one Yahoo chart request per cache miss | 4,400 | 22,000 | 44,000 | A navigation fan-out, even though row/history caches are 6h/1–3d and CDN cache is 1h + SWR |
| High | Full Screener load (explicit, confirmed) | 42 initial option calls + 42 IV-rank calls + normally ~42 additional dated chains; code can schedule up to 84 additional chains. Approximately 126 typical, 168 upper-bound browser requests before cache hits | ~12,600 typical | ~63,000 | ~126,000 | IV rank itself performs an option-chain request plus a one-year chart request; only concurrency 3 limits the burst, not total work |
| High | Watchlist page load (automatic when nonempty) | `1 + U`: one revalidated batch-price call plus unbounded `Promise.all` option calls | For U=10: 1,100 | 5,500 | 11,000 | Automatic revalidation and no client concurrency cap for chains |
| High | Portfolio Refresh Open Trades (explicit) | `1 + U`; option calls run in `Promise.allSettled` | For U=10: 1,100 | 5,500 | 11,000 | Unbounded per-user chain burst; fresh marks are then persisted into durable records |
| High | Screener page entry with cold expiration cache (automatic) | 7 option-prefetch calls at concurrency 3 plus 1 VIX sparkline | 800 | 4,000 | 8,000 | Expiration discovery is per browser cache; CDN reduces upstream work but not edge request fan-out |
| Medium | Scanner/Home page load (automatic) | 1 batch prices, 1 fund metadata, 4 sparklines = 6 browser calls. `/prices` makes 3 Yahoo spark calls for 42 tickers; fund metadata is one batch upstream | 600 | 3,000 | 6,000 | Broad common traffic, mitigated by 2–5m CDN caching and client in-flight dedupe |
| Medium | Options page open (automatic) | 1–2 option calls, 1 extended-price call, 1 IV-rank call; extended price with sparkline performs two Yahoo chart calls | 300–400 | 1,500–2,000 | 3,000–4,000 | More upstream calls than the browser-call count suggests; explicit fresh option refresh is `no-store` |
| Medium | Portfolio initial load (conditional automatic) | Normally zero live quote calls, but unresolved expired trades can issue historical-close lookups and missing entry VIX can issue one batched range lookup | Data-dependent | Data-dependent | Data-dependent | Historical repair work is hidden inside page load and expired-trade lookups run concurrently |
| Low | Chart modal / proxy comparison, holdings modal | 1 history call, sometimes a second proxy call; holdings is 1 call and 7-day cached | Action-dependent | Action-dependent | Action-dependent | Explicit and well cached |

Additional findings:

- No repeating network poll was found. The Screener `setInterval` only updates a local “slow” warning.
- Client request deduplication is exact-key and in-memory. It prevents duplicate calls within one tab/runtime, not across users or Vercel instances.
- Server `Cache-Control` is present on all successful market endpoints. Option initial/dated cache windows are 5/10 minutes plus SWR; charts vary by timeframe; holdings/fund metadata are long-lived.
- `/api/prices` batches 20 symbols per Yahoo request, so the 42-symbol Scanner list is three upstream calls per uncached Vercel request.
- A warm serverless instance reuses the Yahoo cookie/crumb session for 10 minutes and deduplicates acquisition, but this is not a globally shared session cache.
- Provider circuits exist in both the client broker and Yahoo helper. They reduce retry storms after failures but do not cap healthy high-volume fan-out.
- Browser-to-Supabase account data should not traverse Vercel. Preserve Browser ↔ Vercel ↔ Yahoo only for market-data functions.

Priority recommendations for later infrastructure stages: batch ETF Pulse server-side or precompute it; eliminate automatic Watchlist revalidation or add bounded concurrency/stale-first behavior; consolidate Screener option/IV workflows; add per-user and global rate limits; instrument Vercel cache hit/upstream request counts; and load-test with realistic cold/warm mixes before 500 active users.

## Backup format and safety behavior

Schema version 1:

```json
{
  "format": "put-scanner-backup",
  "schemaVersion": 1,
  "exportedAt": "2026-08-13T23:42:00.000Z",
  "appVersion": "0.0.0",
  "data": {
    "portfolio": [],
    "watchlist": [],
    "preferences": {
      "theme": "dark",
      "portfolioMarkBasis": "ask",
      "portfolioGroupMode": "expiration",
      "collapsedExpirationGroups": {},
      "collapsedUnderlyingGroups": {},
      "showNominalYield": false
    }
  }
}
```

Export reads only known durable keys. It does not enumerate or include caches. It fails closed if the portfolio or watchlist JSON is corrupt instead of manufacturing an empty backup. Portfolio `latestMarketData` and watchlist `snapshot`/`status`/market `updatedAt` are stripped; durable trade facts and watchlist notes are kept.

Import behavior:

1. File text is parsed without writes.
2. Format, schema version, timestamps, required arrays, every trade/contract’s major fields, and preference types/enums are validated.
3. The UI displays open/history/watchlist counts, preference presence, and export time.
4. Replace remains disabled until the user explicitly downloads a `pre-import-backup-...json` recovery copy of current durable state.
5. Replace writes validated arrays and only the preference fields included in the backup. Missing optional preferences preserve current browser values.
6. A write failure triggers best-effort rollback to every captured prior raw value. A rollback failure explicitly directs the user to the downloaded recovery file.
7. Import is replacement-only and idempotent; it never merges or appends trades.

Export and import contain no `fetch`, API client, Supabase client, or navigation/reload call. Their network requirement is zero calls.

## Recommended cloud namespace model

Use three user-owned namespaces, with market data excluded:

1. `portfolio`: preferably one row per stable trade ID with durable fields, `user_id`, timestamps, schema version, and deletion/version metadata. This supports conflict handling without rewriting a user’s entire history blob.
2. `watchlist`: one row per `(user_id, ticker, option_type, expiration, strike)` with note/save timestamps and a unique constraint. Never store live quote snapshots in the account row.
3. `preferences`: one versioned per-user document or row for small account-portable display preferences. Device/session/debug settings remain local.

All account tables require deny-by-default RLS scoped to `auth.uid()`. The browser should communicate directly with Supabase for account state. Vercel must not proxy ordinary account synchronization.

## Recommended implementation sequence

Future stages only:

1. Isolate/remove the Flowboard migrations and decide whether to remove/re-pin the unused Supabase client dependency.
2. Specify durable local schema v1, non-destructive readers, validation errors, stable IDs, deletion semantics, and conflict/version fields.
3. Design Put Scanner tables and RLS; review migrations in a disposable project before any production project exists.
4. Add authentication without changing local ownership or automatically moving data.
5. Add an explicit first-sync handoff: require a fresh backup, show local/cloud inventories, let the user choose the source of truth, and perform an idempotent upload.
6. Add download-first recovery, audit logs/telemetry, multi-device conflict tests, offline behavior, and account deletion/export.
7. Only after data correctness is proven, optimize market-data fan-out separately from account sync.

## Stage 1 verification boundary

- No Supabase client initialization, project connection, migration execution, table creation, auth UI, or cloud terminology was added to the product UI.
- Existing portfolio/watchlist save/load semantics and financial/market-data calculations were not changed.
- No automatic localStorage migration, key deletion, or key rename was added.
- The only product surface added is the discreet Portfolio `Data Backup` modal and its local export/import workflow.
