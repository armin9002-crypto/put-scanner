# Market Data Architecture

## Cache and request inventory

| Data | Client adapter | Server endpoint | Client cache / freshness | Server cache | Refresh and dedupe | Primary callers |
| --- | --- | --- | --- | --- | --- | --- |
| Batch prices and 3M performance | `fetchBatchPrices` | `/api/prices` | Shared broker; soft 3m, hard 45m; memory + localStorage | CDN 5m, SWR 15m | `cache-first` normally, `revalidate` for user refresh; in-flight dedupe | Scanner, Watchlist, Portfolio |
| Option chains | `fetchOptions` | `/api/options` | Shared broker; soft 15m, hard 2h; schema v3 | Initial 5m/SWR 15m; dated 10m/SWR 30m; explicit fresh `no-store` | Cache-first, revalidate, or fresh; in-flight dedupe; stale-on-error | ETF page, Scanner manual update, Screener, Watchlist, Portfolio, drawer |
| Intraday sparkline | `fetchSparkline` | `/api/price` | Shared broker through compatibility adapter; soft 10m, hard 60m | CDN 2m/SWR 5m | Cache-first and deduped | Scanner market strip, Screener |
| Extended price | `fetchExtendedPrice` | `/api/price` | Shared broker through compatibility adapter; soft 10m, hard 60m | CDN 5m/SWR 15m | Cache-first and deduped | ETF option page |
| Chart history | `getChartHistory` | `/api/chart-history` | Shared broker; timeframe-specific soft TTLs from 2m to 24h and hard TTLs from 30m to 14d | Timeframe-specific 2m to 12h plus SWR | Revalidate on explicit refresh; stale-on-error; daily 1Y/2Y families satisfy shorter daily periods | Chart modal, True Leverage, ETF Pulse, expiration archive |
| Scanner IV/liquidity snapshot | Calculation consumer of `fetchOptions` | `/api/options` indirectly | Feature cache; fresh through 8h, stale through 24h; previous useful snapshot is never replaced by an unusable refresh | Option endpoint cache | Manual only, concurrency 3, maximum two expirations per ticker | Scanner |
| ETF Pulse rows | `buildEtfPulseRows` consuming 2Y chart history | `/api/chart-history` indirectly | Feature result cache; soft 6h, hard 24h; failed tickers merge previous rows | Chart endpoint cache | Explicit refresh revalidates; concurrency 5; stale history is reported | ETF Pulse, Market Read |
| IV rank | `fetchIVRank` | `/api/ivrank` | Shared broker via `cachedRequest`; soft 1h, hard 4h | CDN 1h/SWR 6h | Cache-first, stale-on-error, deduped | ETF page, Screener |
| Underlying holdings | `fetchUnderlyingHoldings` | `/api/holdings` | Shared broker; soft 7d, hard 30d | CDN 1d/SWR 7d | Revalidate on explicit refresh; stale-on-error | Holdings modal |
| Expiration close | `getExpirationClosePrice` | `/api/chart-history` custom range | Shared broker via `cachedRequest`; effectively permanent (10-year soft TTL) | CDN 1d/SWR 7d | Deduped; immutable historical result may be reused | Expired-option archive |

The shared broker owns cache records, freshness, memory/persistent lookup, schema validation, timeouts, in-flight deduplication, stale fallback, diagnostics, and client endpoint cooldowns. `cache.ts` now only provides its legacy public adapter and specialized Screener expiration cache. `dataCache.ts` retains low-level compatibility functions for specialized callers while routing `cachedRequest` through the broker. `memoryCache.ts` remains only for the specialized expiration cache.

## Yahoo server infrastructure

`api/_lib/yahoo.js` centralizes finite-number and timestamp normalization, response parsing, provider health, request timeouts, circuit cooldowns, and option-session acquisition. Warm functions reuse cookie/crumb sessions for 10 minutes and deduplicate concurrent session acquisition. A rejected session is invalidated and reacquired once; there are no retry loops.

Provider circuits open for 45 seconds after three consecutive 429, 5xx, timeout, network, or malformed-response failures. Valid 4xx/unavailable-symbol results do not count as provider outages. Explicit fresh option refresh may make one override attempt.

## Request-count benchmark

Counts below distinguish browser-to-Vercel calls from Vercel-to-Yahoo calls. They assume cold client caches and no CDN hit unless noted. `U` is unique ticker/expiration option chains, `T` is unique price tickers, and `N` is manual scanner option calls (maximum two per ticker).

| Flow | Before | After | Change |
| --- | --- | --- | --- |
| Scanner initial load (42 tickers) | Browser: 1 `/prices`, 4 `/price`, 0 options/history. Yahoo: 6 bulk spark + 4 price = 10 | Browser unchanged. Yahoo: 3 bulk spark + 4 price = 7 | 3 fewer Yahoo calls, 30% reduction; scanner still makes zero automatic option calls |
| Manual IV/liquidity update | Browser: `N` option calls. Yahoo: normally `2N` and up to `3N` with crumb fallback | Browser unchanged. Yahoo warm batch: `N` chains + one deduped 1–2 call session bootstrap | After bootstrap, one Yahoo call per chain; maximum two chains per ticker remains unchanged |
| ETF option page open | Browser: 1 extended price + 1 option call | Same | Cold behavior unchanged; a warm Yahoo option session removes repeated page/crumb setup |
| Chart modal, ETF + proxy | First selected timeframe: 2 history calls | Same first load | No behavior change on cold load |
| Switch cached 1Y charts to 6M/3M/YTD | 2 new history calls | 0 new calls | 2 fewer calls, 100% reduction for this transition |
| Portfolio initial load | 0 market requests, excluding unresolved expiration archive work | Same | Unchanged |
| Portfolio Refresh Open Trades | Browser: 1 prices + `U` options. Yahoo: `2×ceil(T/20)` price calls + normally `2U` to `3U` option/session calls | Browser unchanged. Yahoo: `ceil(T/20)` price calls + `U` chains + one shared session bootstrap | One price pass removed; option setup amortized; refresh now uses stale fallback without marking it live |
| ETF Pulse cold load / explicit refresh | Up to 44 2Y history calls | Same | No artificial request reduction; failures retain prior rows and are surfaced |

The `/prices` consolidation was verified against a live Yahoo 3-month spark payload: it contained regular market price, chart previous close, 52-week high/low, and 63 daily closes for TQQQ. This supports the existing current, daily, 5D, 1M, 3M, and 52-week calculations from one payload without changing their formulas.

## Preserved boundaries

- No polling, database, new vendor, or FRED dependency was added.
- Financial calculation modules were not changed.
- Scanner snapshot ranking, ATM IV, liquidity scoring, confidence, and two-expiration cap remain calculation-layer responsibilities.
- Expiration resolution continues to use its immutable custom-date history cache and does not use unrelated live stale quotes.
- No production-visible diagnostics were added; expanded counters remain behind the existing debug flag.
