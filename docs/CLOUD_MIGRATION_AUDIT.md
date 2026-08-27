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

Priority recommendations for later infrastructure stages: consolidate Screener option/IV workflows; add authenticated per-user and global provider limits; and load-test with realistic cold/warm mixes before 500 active users. ETF Pulse batching, Watchlist stale-first behavior, bounded refresh concurrency, and request instrumentation were implemented in Stage 1.6A below.

## Stage 1.6A market-data scalability foundation

These are deterministic request-planner results, not live-Yahoo load-test results and not Vercel bill estimates. No provider was hammered to produce them.

### Measured before/after request flows

| Scenario | Before Stage 1.6A | After Stage 1.6A | Cache behavior |
| --- | --- | --- | --- |
| ETF Pulse, cold browser | 44 browserâ†’Vercel `/api/chart-history` calls; client maximum 5; up to 44 Yahoo calls with aggregate concurrency 5 | 1 browserâ†’Vercel `/api/etf-pulse` call; a cold dataset build schedules 44 unique Yahoo histories with maximum concurrency 6 | Full datasets are shared at the CDN for 1h with 6h SWR. Existing calculated rows remain local for 6h/24h hard stale fallback. A warm local row cache makes 0 calls. |
| ETF Pulse, warm CDN | Browser still made up to 44 history URLs, though each could be an edge hit | 1 browser request and expected 0 Yahoo work | The combined URL is common to all users. Explicit Refresh uses `no-store`; partial builds receive only 1m CDN freshness plus 1h SWR. |
| Watchlist, 10 contracts / 5 unique chains | 1 revalidated batch-price request followed by 5 deduplicated chain requests launched together; maximum option concurrency 5 | Cold: still at most 1 + 5 exact requests, but option concurrency is 3. Automatic page entry is cache-first, so fresh client records cause 0 Vercel calls for those records. Explicit Refresh remains revalidate. | Exact `TICKER|expirationTimestamp` keys prevent contract-level duplicates. Stale-on-error retains existing snapshots. |
| Portfolio explicit refresh, 20 trades / 6 unique chains | 1 batch-price request + 6 deduplicated option calls; maximum option concurrency 6 | Same 7 request units when fully cold, with maximum option concurrency 3 | This remains an explicit revalidation action. One returned chain is applied to every matching position. |
| Portfolio initial repair, 5 expiration records + 5 missing VIX dates | Up to 5 expiration history calls started together, followed by one VIX range request: up to 6 browser/Yahoo calls, maximum expiration concurrency 5 | Rich cached daily history is checked once per ticker and can resolve multiple dates with 0 expiration calls. Remaining exact immutable lookups are deduplicated and capped at 3; VIX remains one covering range request. Worst-case request count remains 6, but the burst is bounded. | Successfully resolved expiration closes and VIX-at-entry values remain durable and are not fetched again. |

The ETF endpoint returns the same 2Y daily points that the prior per-ticker endpoint returned. Existing client `buildEtfPulseRow` code still computes RSI, returns, moving averages, realized volatility, drawdowns, heatmap inputs, and momentum state; the calculation path was not copied to the server. SPY, QQQ, and all 42 configured ETFs appear once in the shared universe.

The endpoint has a 60-second function duration configuration. With a six-worker pool and a 6-second per-history timeout, 44 histories require eight waves and have an approximate timeout-bound acquisition envelope of 48 seconds plus small serialization overhead. Individual failures become explicit per-ticker errors rather than failing the whole batch. This fits Vercel's documented 60-second Hobby maximum when Fluid Compute is disabled and is below the current Fluid Compute default; it does not depend on warm function memory for correctness.

### 100 / 500 / 1,000-user ETF Pulse projection

| Cold browsers opening during a cache window | Browserâ†’Vercel request units, old | Browserâ†’Vercel request units, Stage 1.6A | Yahoo work with one shared CDN fill | Conservative five independent edge/region fills | Worst case if CDN reuse is completely ineffective |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 44 | 1 | 44 | 44 | 44 |
| 100 | 4,400 | 100 | 44 | 220 | 4,400 |
| 500 | 22,000 | 500 | 44 | 220 | 22,000 |
| 1,000 | 44,000 | 1,000 | 44 | 220 | 44,000 |

The last column is deliberately pessimistic: every combined endpoint request is treated as a distinct CDN miss. Even then, each function invocation limits Yahoo concurrency to six; the primary cross-user benefit comes from the shared `s-maxage=3600, stale-while-revalidate=21600` response. Explicit user refreshes bypass that shared cache and are excluded from the normal-open projection.

Watchlist and Portfolio cold request totals do not magically disappear because exact option expiration datasets remain separate. Their improvement is removal of request bursts, exact chain reuse, and cache-first automatic Watchlist entry. At 1,000 simultaneous cold Watchlists with five unique chains, the upper browser request count remains 6,000, but each browser has at most three option calls active and shared option CDN entries can eliminate corresponding Yahoo work. Portfolio's explicit 20-trade/six-chain case remains 7,000 browser request units at 1,000 manual refreshes, also capped at three option calls per browser.

### Debug instrumentation and future authenticated limits

Development diagnostics now separate browser network requests, Vercel responses, Yahoo attempts reported by safe headers, memory/persistent cache hits, stale fallbacks, in-flight dedupes, chain dedupes, maximum observed concurrency, failures, and circuit-breaker rejections. Safe responses may include `X-PutScanner-Upstream-Requests`, `X-PutScanner-Cache-Strategy`, `X-PutScanner-Dataset-Version`, concurrency, and circuit-rejection counts. No cookies, Yahoo crumb, secrets, auth material, or stack traces are exposed.

Stage 6B.3 standardizes an ephemeral `X-PutScanner-Request-Id`, server duration/retry/cache/failure headers, one count-only structured log per existing market request, and a capped in-memory development summary. It adds no request, telemetry vendor, log-upload path, Supabase write, or durable diagnostic state. The current request graph, privacy exclusions, regression budgets, cancellation behavior, and deterministic local Playwright harness are documented in `PRODUCT_STAGE6B3_OBSERVABILITY_E2E.md`.

True per-user limits remain deferred until authentication exists. A later authenticated design should start with a three-request option-chain burst, a rolling per-user manual option-refresh allowance, approximately one ETF Pulse cache-bypassing refresh per minute, and separate lower-frequency Screener allowances. Global provider concurrency/queues, CDN-aware metrics, 429 backoff, and the existing circuit breakers should accompany those limits. Exact quotas must be set from production cache-hit and latency observations, not IP identity or assumptions made in this stage.

## Stage 1.6B Screener scalability architecture

This section records the Stage 1.6B code audit and deterministic fixture measurements. Request totals are planning units, not a live-Yahoo load test, Vercel billing estimate, or guarantee of edge-cache behavior.

### Stage 1.6A baseline measured before this change

The Screener remains a manual workflow: Load/Run is the only action that starts a scan. Its fixed universe contains 42 ETFs. A full scan first requested one undated `/api/options` chain for every selected ETF (client concurrency 3), then requested `/api/ivrank` once per ETF (client concurrency 3), and finally requested up to two globally selected expirations per ticker (client concurrency 3), skipping only a chain already held under the same ticker/expiration key. `/api/ivrank` independently acquired the initial Yahoo option chain again before its one-year weekly chart, so the browser did not expose the full upstream duplication.

The global expiration union was sorted ascending. `all` selected its first two dates, `lte_30dte` selected its first two dates at or below 30 DTE, and an exact-date filter selected that date. A ticker contributed rows only when it advertised the selected global date. Prices were not separate Screener calls: each option response supplied the underlying price. Delta, moneyness, NY/AY, liquidity filters, IV-rank filtering, display choices, and sorting ran in the browser.

Normal Load was cache-first, not forced revalidation. Exact option keys were reused within a tab, but the separate IV endpoint still repeated the initial Yahoo option dataset. Changing a non-structural filter or sort after Load issued zero requests. Changing ETF/expiration inputs also issued zero requests until the user explicitly clicked Load again. On a cold page, the expiration picker separately prefetched seven undated chains at concurrency 3, while VIX used one independent history request.

Deterministic baseline planners:

| Scan | Browser→Vercel plan | Comparable cold Yahoo core datasets, excluding variable session bootstrap |
| --- | ---: | ---: |
| Small, 3 ETFs, normal nearest coverage | 3 initial options + 3 IV + about 3 dated options = about 9 | 3 initial options + 3 IV options + 3 IV charts + about 3 dated options = about 12 |
| Full, normal case | 42 initial + 42 IV + about 42 dated = about 126 | 42 initial + 42 repeated IV options + 42 IV charts + about 42 dated = about 168 |
| Full, widest permitted case | 42 initial + 42 IV + up to 84 dated = up to 168 | 42 initial + 42 repeated IV options + 42 IV charts + up to 84 dated = up to 210 |

The baseline maximum client concurrency was 3 in each scan phase. The comparable healthy Yahoo core concurrency was also 3 inside those requests, although the independent page-entry VIX/expiration work could briefly add another request and cold serverless session acquisition/retry behavior was instance-dependent. The successful `/api/options` CDN policy was 5 minutes with 10 minutes SWR for initial chains and 10 minutes with 30 minutes SWR for dated chains; `/api/ivrank` used 1 hour with 6 hours SWR.

### Implemented acquisition plan and request budget

The 42-symbol fixed order is divided into 14 stable chunks of 3. A selected ETF requests its entire fixed chunk, so different users converge on the same public URLs. The only URL inputs are `chunk` and, for an exact expiration, `date`. No user/account state or client-only filter enters a cache key. `all` and `lte_30dte` intentionally share the `nearest` acquisition key: acquiring each ticker's initial chain and its own first two advertised expirations is sufficient to reconstruct the existing globally earliest-two selection. If a ticker offered a globally selected date, that date must be among that ticker's own earliest two; dates earlier for that ticker would themselves precede it in the global union.

The browser runs no more than 2 batch functions concurrently. Each function uses the Stage 1.6A shared worker pool with no more than 3 active Yahoo operations. Therefore one scan is attributable for at most 2 × 3 = 6 concurrent Yahoo acquisitions. The server first acquires each chunk's three initial chains, then concurrently acquires IV history and any missing second/exact chain. IV rank consumes the already-acquired initial option payload, removing its prior duplicate option call. `/api/options` remains unchanged and available to every other product surface.

| Full scan budget | Before | Stage 1.6B |
| --- | ---: | ---: |
| Browser→Vercel request units, normal | about 126 | 14 |
| Browser→Vercel request units, widest | up to 168 | 14 |
| Maximum browser scan concurrency | 3 | 2 batch functions |
| Comparable cold Yahoo core datasets, normal | about 168 | normally at most 126: 84 option chains + 42 IV charts |
| Comparable timeout-bound/anomalous core maximum | up to 210 | up to 168 if Yahoo's undated response is not one of its advertised first two and two additional chains are needed |
| Maximum attributable Yahoo core concurrency | normally 3, with independent entry work possible | 6 across two functions; 3 inside each function |

Actual diagnostic Yahoo-attempt headers count session-page/crumb work and authentication retries as well as core datasets, so those observed totals can exceed the comparable core counts above. They are reported, not inferred to be globally unique.

Complete batch responses use `public, s-maxage=300, stale-while-revalidate=900`, matching the existing initial-option freshness expectation while extending safe shared reuse. Partial batches use `private, no-store`. The browser broker holds complete batch results for 5 minutes and permits a 45-minute stale-on-error fallback; partial results are held only as recovery material and revalidated on the next run. Exact in-flight and warm keys dedupe in one runtime. The consolidated expiration-picker endpoint replaces seven browser calls with one, uses server concurrency 3, and has a 2-hour shared freshness window with 6-hour SWR. VIX remains separate.

Acquisition-relevant controls are ETF selection (which fixed chunks are needed) and exact expiration date (which dated chain is needed). `all` versus `lte_30dte` does not need different upstream data because the shared nearest-two dataset preserves both algorithms. Delta, moneyness, annualized/nominal yield, OI, volume, IV rank, Volume/OI display, result sort, and option-drawer behavior are client-only and never change batch URLs.

### Correctness, failure, cancellation, and diagnostics

The server returns a compact Yahoo-shaped subset containing only the quote, expiration dates, selected chain expiration, and put fields consumed by the existing adapter. The browser runs that payload through the existing option normalizer and a single extracted copy of the pre-existing put-delta formula; row construction retains the existing DTE, Delta fallback/clamping, moneyness, NY/AY, IV-rank, eligibility, and sorting inputs. Deterministic fixtures cover direct and calculated Delta, bid/ask/last values, last-trade date, IV, OI, volume, Volume/OI, moneyness, DTE, NY/AY, filter inclusion, exact-date result count, and sorting fields.

A failed ticker becomes an explicit partial-batch error without erasing successful tickers or batches. Successful exact chains are primed into the normal client option cache. A whole failed batch leaves other completed batches usable. A subsequent Run reuses complete cached work and revalidates partial keys, so rows are reconstructed from maps keyed by ticker and expiration without duplication. Progressive row publication was not added: the existing global expiration selection is only stable after all initial expiration lists arrive, so preserving the current end-of-scan display avoids rows that disappear or reorder during acquisition. Existing progress is updated as batches finish.

Every Run receives a new generation token and AbortController. Starting a later run invalidates and aborts scheduling for the older run; only the current generation may publish progress, rows, warnings, or loading state. Shared in-flight broker work may finish and be reused, but stale run state cannot overwrite the newer scan.

Debug diagnostics now expose scan ID, planned ETF/batch/chain counts, unique chains, browser calls, Vercel responses, reported Yahoo attempts, response bytes, dataset/cache strategy, maximum client and server concurrency, failures, circuit rejections, cache hits, in-flight dedupes, stale fallback, and elapsed time. No Yahoo cookies, crumb, URLs, user state, or secrets are exposed.

### Payload and duration guardrails

A representative deterministic chunk with 3 tickers, 2 chains each, and 100 puts per chain serializes to 107,922 bytes. Fourteen such responses transfer about 1,510,908 bytes (1.44 MiB) for a full cold browser scan before HTTP compression. Each response has a 750,000-byte server guard, well below the [Vercel Functions documented 4.5 MB request/response payload limit](https://vercel.com/docs/functions/limitations).

The deterministic mocked cold-batch fixture completes below one second (normally tens of milliseconds on the development machine), but that is a scheduling/serialization check rather than a Yahoo latency measurement. Each real core Yahoo operation has a 6-second timeout, including session acquisition. In the normal three-ticker plan the conservative timeout waves are: session plus initial option wave (up to 12 seconds), followed by two phase-two waves (up to 12 seconds); a crumb fallback or authentication retry can add bounded work. The function ceiling and browser broker timeout are 60 and 58 seconds respectively, configured using [Vercel's per-function duration setting](https://vercel.com/docs/functions/configuring-functions/duration). This keeps normal cold work comfortably below the configured ceiling, isolates a slow chunk from the remaining 13, and avoids one all-universe function. Runtime observations must still be collected in production diagnostics before raising chunk size.

### 100 / 500 / 1,000-user Screener projections

This first table models the same full-scan action per browser. It does not assume all users are simultaneous. “One shared fill” is the idealized case where those requests reach the same fresh edge entry; five fills is a conservative multi-edge/region planning case; ineffective cache is deliberately pessimistic.

| Full scans | Browser→Vercel, baseline normal (widest) | Browser→Vercel, Stage 1.6B | Yahoo core work, one shared normal fill | Yahoo core work, five independent fills | Yahoo core work if batch caching is ineffective |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 126 (168) | 14 | 126 | 126 | 126 |
| 100 | 12,600 (16,800) | 1,400 | 126 | 630 | 12,600 |
| 500 | 63,000 (84,000) | 7,000 | 126 | 630 | 63,000 |
| 1,000 | 126,000 (168,000) | 14,000 | 126 | 630 | 126,000 |

Warm shared-CDN scans still use 14 browser/Vercel invocation units but are expected to create zero Yahoo work until revalidation. The pessimistic Stage 1.6B Yahoo total is lower than the old normal 168-per-scan core total because IV charts reuse the batch's initial options, but it is not a promise of cache effectiveness. Exact expiration dates have separate public keys.

A realistic planning scenario is 1,000 registered users, 20% daily active, and 1.5 manual Screener runs per active user: 300 runs/day and 4,200 browser/Vercel batch requests/day. If those runs occupy 30 distinct five-minute activity windows and each chunk is independently filled in two regions per window, the planning estimate is 14 chunks × 9 normal core datasets × 30 windows × 2 regions = 7,560 Yahoo core acquisitions/day. One region fill per active window would be 3,780; completely ineffective caching would be 37,800. These assumptions are deliberately visible and should be replaced with production cache-hit and latency measurements.

No IP quota or unauthenticated per-user limiter is introduced. After authentication, begin evaluation with one active Screener run per account, a burst of one, and a provisional allowance around three manual runs per ten minutes, plus a global provider queue and existing circuit breakers. Final authenticated limits belong to Stage 3/6 and must be derived from observed behavior.

Stage 1.6B did not redesign the Screener, change a financial formula/filter/sort, alter durable Portfolio or Watchlist state, or add Supabase/authentication. The in-app local browser facility was attempted on 2026-08-20 but could not establish a permitted session, so no visual/browser-pass claim is made. Automated type, deterministic Screener, full-app regression, responsive, lint, and production-build checks remain the verification boundary recorded by the commit.

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

Stage 2A supersedes the audit's preliminary normalized-row recommendation. At the
current scale, use one `public.user_state` table with exactly one document row per
`(user_id, namespace)` for `portfolio`, `watchlist`, and `preferences`. The three
documents preserve the established durable local envelopes, make backup/restore
and future first-sync comparison explicit, and keep the initial RLS surface small.
They must exclude all live quotes, market snapshots, device caches, session state,
and debug flags listed above. Revisit per-trade/per-contract normalization only if
measured document contention or payload growth warrants the added merge surface.

The Stage 2A design uses a database-managed revision for optimistic concurrency,
immutable row identity, explicit authenticated-role privileges, and deny-by-default
own-row RLS. The browser may eventually use a publishable project key plus a user
session, but ordinary account sync must not use a secret/service-role key or bypass
RLS. No runtime connection is introduced in Stage 2A. See
`docs/SUPABASE_STAGE2_DESIGN.md` for the reviewed design and capacity model.

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
