# Stage 6B.3 Revised - Operational Reliability

> **Historical persistence note.** Request observability remains current. References to local-first durable-account writes or Stage 1–5 account architecture were superseded by [Stage 7A](./PRODUCT_STAGE7A_CLOUD_AUTHORITATIVE_STATE.md); only genuine device-local settings still use localStorage failure feedback.

This document supersedes the earlier Stage 6B.3 implementation note for the post-UI-5 codebase at `b071c95`. The UI-5 design, market-product scope, financial formulas, and Stage 1-5 account/cloud architecture remain frozen.

## Request terminology

- **Browser request:** an HTTP fetch from the application to an existing `/api/*` route.
- **Function invocation:** execution of one API handler. A CDN-served response can satisfy a browser request without a new invocation.
- **Provider acquisition:** one logical market-data operation, such as one price batch, option chain, or history.
- **Provider HTTP attempt:** an actual outbound provider transport attempt. Yahoo session-page/crumb acquisition and a 401/403 retry can make this exceed logical acquisitions.
- **Cache hit/miss:** resolution by the browser broker, persistent cache, CDN, or handler policy as reported at the layer that knows it.
- **Retry:** a repeated compatible provider operation after a retryable response.
- **Fallback:** use of compatible stale data after a current acquisition fails.

The older `X-PutScanner-Upstream-Requests` header is retained for compatibility. New diagnostics call the same measured value **provider HTTP attempts**.

## Actual post-UI-5 request graph

| Workflow | Browser action and request | Function/cache path | Cold logical provider acquisitions | Retry/fallback/publication |
|---|---|---|---:|---|
| Scanner | Initial/manual load -> one `/api/prices`, one `/api/fund-metadata`, four `/api/price` charts | `requestMarketData`/three-layer cache; one price dataset, one fund dataset, four chart keys | 8: three 20-symbol price chunks + fund quote + QQQ/SPY/VIX/VXN charts | Cache-first; compatible stale broker data can survive provider failure. Filter, sort, hover, and expiry filtering are local. A newer price generation or route teardown aborts its consumers and also suppresses stale publication. |
| Screener entry | Route entry -> `/api/screener-expirations` and VIX `/api/price` | Session expiration cache plus chart broker cache | Up to 8: seven bounded option-metadata acquisitions + VIX | Entry calls receive route-teardown signals. Partial expiration discovery remains usable. |
| Screener Load | Confirmed Load -> up to fourteen `/api/screener-batch` calls | Fixed three-symbol chunks, browser concurrency 2, server concurrency 3 | Up to 126: nine logical acquisitions per batch | Successful chunks remain. Failed chunk IDs are transient. Retry revalidates only compatible failed chunks. A new generation aborts the old one and its publication guard rejects stale completion. |
| Watchlist refresh | Refresh All -> one `/api/prices` plus one `/api/options` per unique ticker/expiry chain | Price broker + canonical option-chain dedupe, option concurrency 3 | `ceil(T/20) + U` | Route teardown aborts both price and chain consumers. Failures preserve durable items/snapshots; final reconciliation rereads current state so refresh cannot resurrect removals or overwrite notes. |
| Portfolio Refresh | Refresh Open Trades -> one `/api/prices` plus one `/api/options` per unique open chain | Price broker + canonical option-chain dedupe | `ceil(T/20) + U` | Route teardown aborts both. Refresh is quote-only: no Entry VIX/expiration maintenance and no durable trade-fact advancement. Publication occurs only after the refreshed state is locally persisted. |
| Ticker Detail | Ticker/route load -> one consolidated `/api/ticker-detail`; expiry change -> one `/api/options` | Detail and chain caches | Initial detail up to 4; expiry change 1 | Initial detail combines options, daily/intraday price, and volatility context. Ticker/expiry supersession aborts the browser consumer; generation checks remain the final state guard. Options authentication can retry once; compatible stale data is allowed except for explicit fresh requests. |
| Option Drawer | Open/edit quote basis/contracts | Existing selected row only | 0 | No fetch, function invocation, or provider acquisition. |
| ETF Pulse | Route/load -> one `/api/etf-pulse` | Aggregate broker request plus six-hour row cache | Up to 44 histories | Supersession/route teardown aborts the browser fetch; generation guards suppress stale progress/publication. Partial rows and compatible stale rows remain allowed. |
| Charts/holdings | Explicit chart/holdings consumer -> `/api/chart-history` or `/api/holdings` | Timeframe-aware chart cache and holdings cache | Normally 1 per cold key | Consumer-aware abort reaches `fetch`; compatible longer histories can satisfy shorter windows. Holdings can retry authentication once. |

Every browser market-data HTTP path uses `fetchObservedMarketData`. Observability decorates the request that already exists; it does not create a second call.

## Production-safe observability

### Correlation IDs

The browser creates an ephemeral ID in the form `ps-<base36 time>-<base36 random>`. It is placed only on the existing request as `X-PutScanner-Request-Id`. The handler accepts a bounded 8-96 character safe identifier; otherwise it creates `ps-srv-<random UUID>`. The selected value is echoed on the existing response.

Correlation IDs are request-scoped, non-identifying, not stored in localStorage or Supabase, and not added to account/cloud payloads. Development events retain at most the latest 100 IDs in memory.

### One bounded server summary

`observeMarketRequest` wraps each market handler response and emits exactly one compact JSON summary on normal JSON completion or the first observed disconnect. The exact fields are:

```text
event
requestId
endpoint
operation
method
symbolCount
expiryCount
cacheStatus
providerAttemptCount
retryCount
durationMs
status
outcome
failureCategory
```

`outcome` is `success`, `failure`, or `aborted`. `failureCategory` is bounded to `none`, `validation`, `not_found`, `aborted`, `rate_limit`, `provider`, or `http`. Status 499 is used only as diagnostic classification for a disconnected invocation; it is not exposed as provider-failure UI.

Counts remain zero when a handler cannot accurately know them. There is no contract-level log line and no market or account payload is serialized into the summary.

### Diagnostic response headers

All observed market handlers add these bounded headers to the response they were already returning:

- `X-PutScanner-Request-Id`
- `X-PutScanner-Server-Duration-Ms`
- `X-PutScanner-Provider-Attempts`
- `X-PutScanner-Retry-Count`
- `X-PutScanner-Cache-Status`
- `X-PutScanner-Failure-Category`

Existing route-specific headers remain, including `X-PutScanner-Upstream-Requests`, `X-PutScanner-Cache-Strategy`, `X-PutScanner-Dataset-Version`, `X-PutScanner-Max-Observed-Concurrency`, `X-PutScanner-Circuit-Rejections`, `X-PutScanner-Planned-Chains`, and `X-PutScanner-Response-Bytes` where applicable. The additions do not change `Cache-Control`, request URLs, bodies, or CDN cache keys.

### Privacy exclusions

The server summary and development collector never record authentication tokens, Supabase keys, email addresses, user IDs, Portfolio quantities or entry prices, position premiums, Watchlist notes, backup/import payloads, cloud documents, conflict snapshots, or device/account identifiers. Public market symbols and expiration counts can remain part of the market route itself, but current summaries record bounded counts rather than request payloads.

### Zero-request proof

Observability performs header creation/parsing, bounded in-memory counter updates, and one existing-handler `console.info`. It adds:

- 0 browser network calls
- 0 function invocations
- 0 provider acquisitions/HTTP attempts
- 0 Supabase writes
- 0 telemetry-vendor calls

The deterministic browser-observer test replaces global `fetch`, invokes `fetchObservedMarketData` once, asserts exactly one fetch, and verifies the correlation/counter result from that same response. No timer, beacon, polling loop, or upload endpoint exists.

## Development/test request inspector

The collector is enabled only by `import.meta.env.DEV` or an explicit test override. The React panel is rendered only behind `import.meta.env.DEV`; production cannot enable it with localStorage. Its compact summary distinguishes:

- browser requests
- function responses/invocations
- provider HTTP attempts
- cache hits
- stale fallbacks
- retries
- failures
- aborts
- per-endpoint counts

Events are memory-only and capped at 100. The lower-level broker snapshot also exposes memory/persistent hits, in-flight dedupe, planned/unique chains, circuit rejections, response bytes, and concurrency for deterministic tests. `npm run request:ledger` prints the checked-in expected/ceiling report without making a network call.

## Request-budget ledger

Expected and regression ceiling are equal for the browser, function, and logical acquisition graph; legitimate provider session/fallback transport is represented separately by the conditional HTTP maximum.

| Workflow fixture | Browser expected/ceiling | Function expected/ceiling | Provider acquisition expected/ceiling | Conditional provider HTTP maximum |
|---|---:|---:|---:|---:|
| Scanner, 42 symbols | 6/6 | 6/6 | 8/8 | 8 |
| Screener entry | 2/2 | 2/2 | 8/8 | 13 |
| Screener full 42-ETF scan | 14/14 | 14/14 | 126/126 | 196 |
| Watchlist, one ticker + one chain | 2/2 | 2/2 | 2/2 | 7 |
| Portfolio, two tickers + two chains | 3/3 | 3/3 | 3/3 | 13 |
| Portfolio Entry Delta capture, loaded/cached chain | 0/1 | 0/1 | 0/1 | 6 cold maximum |
| Explicit Portfolio Entry VIX maintenance | 1/1 | 1/1 | 1/1 | 6 |
| Explicit Portfolio lifecycle maintenance, one history requirement | 1/1 | 1/1 | 1/1 | 6 |
| Consolidated Ticker Detail | 1/1 | 1/1 | 4/4 | 9 |
| Explicit expiry change | 1/1 | 1/1 | 1/1 | 6 |
| Option Drawer | 0/0 | 0/0 | 0/0 | 0 |
| ETF Pulse | 1/1 | 1/1 | 44/44 | 44 |
| Recommendations explicit refresh, cold full universe (up to three selected tenors plus discovery) | 15/15 | 15/15 | 254/254 | 324 |
| Recommendations board/evidence/export interactions | 0/0 | 0/0 | 0/0 | 0 |

The HTTP maximum is a conservative transport guard for a cold Yahoo option session and one compatible authentication retry. It is not the expected steady-state count. Browser and function ceilings intentionally fail material graph multiplication even when transport fallback is legitimate.

Recommendations composes the existing cache-aware Pulse acquisition (1 browser/function request and 44 histories) with the same fourteen Screener batches. Each of up to 42 qualified ETFs performs one metadata/discovery chain, selects at most three bounded near/middle/far expirations, and reuses discovery when it is selected; one volatility-context operation reuses the discovery payload. The 254 count is the cold worst case, not steady state. A compatible warm cache removes provider work, while hard fails, sparse calendars, and discovery reuse reduce it. Opening the page, sorting/expanding/showing the Opportunity Board, opening evidence or Decision Trace/Methodology, using near misses/hover, selecting recommendations, and exporting the in-memory snapshot make no market request.

Dynamic Watchlist/Portfolio fixtures use one browser/function price request when `T > 0`, plus `U` unique option-chain requests; logical provider acquisitions are `ceil(T/20) + U`.

## Screener failed-batch retry

Each fixed plan records success or failure in transient `ScreenerScanResult.failedBatchIds`. Partial success retains all normalized maps from successful chunks and renders the existing partial-state notice with **Retry failed results**. Retry rebuilds plans from the original compatible scope, forces revalidation only for failed chunk IDs, and merges by canonical ticker/expiration keys. Successful chunks are not resent or discarded and reconstructed rows remain unique.

Dataset compatibility is now expressed by `screenerDatasetScopeKey`:

- ETF selection changes invalidate failed-batch state.
- An exact-date change changes the upstream key and invalidates failed-batch state.
- `all` and `lte_30dte` reuse the same standard-expiration upstream dataset, so switching between them is a local filter: it retains retry state and makes zero requests.
- Delta, moneyness, yield, OI, volume, sort, and IV-versus-realized-range changes remain local.

The same latest-scan gate protects full loads and failed-only retries. Beginning generation B aborts generation A's signal and makes `A.isCurrent()` false. Even when a server/runtime finishes old work, A cannot publish into B. If every planned batch fails, the result has zero usable initial data and the existing fatal state offers a normal full retry rather than pretending that partial data exists.

Deterministic savings for the current 42-ETF architecture: 14 fixed batches, 12 successful and 2 failed. A whole retry would use 14 browser requests, 14 function invocations, and up to 126 logical acquisitions. Failed-only retry uses 2/2/up to 18, saving 12 browser calls, 12 invocations, and up to 108 logical acquisitions.

## Cancellation: reality and limitations

### Before this revision

Ticker Detail, the main Screener scan, and ETF Pulse already combined AbortController use with generation-based publication suppression. Scanner price timeout/generations, Scanner auxiliary data, Watchlist refresh, Portfolio Refresh, and Screener entry data still had paths where obsolete work could complete and only publication was suppressed. Provider helpers accepted signals in many paths, but route teardown did not consistently supply one.

### After this revision

- Scanner price supersession and timeout abort the broker consumer/fetch; route teardown aborts prices, fund assets, and the four market charts.
- Screener route teardown aborts VIX and expiration discovery; full loads and retries continue to use the latest-scan gate.
- Watchlist and Portfolio route teardown abort the price batch and every unique option-chain consumer.
- Ticker Detail and expiry changes continue to abort superseded fetches.
- ETF Pulse continues to abort superseded/teardown fetches.
- Recommendations uses the same latest-generation gate: a new explicit refresh aborts and supersedes the prior Pulse/Screener work, and only the current generation may publish its in-memory run.
- `threeLayerCache`, price/fund/chart helpers, option helpers, API handlers, Yahoo option/history helpers, Screener fan-out, and Pulse fan-out propagate `AbortSignal` where the underlying implementation supports it.
- The market broker remains consumer-aware: one canceled consumer does not kill shared work needed by another; the underlying request is aborted when no consumers remain.
- Abort is counted separately and does not increment provider failure state, trigger normal retry UI, use stale failure UI, or publish obsolete state.

Generation checks remain mandatory because cancellation and publication suppression solve different problems.

### Upstream uncertainty

A browser abort does not guarantee that a deployed serverless platform immediately emits `req.aborted`/response `close`, nor that already-scheduled provider work stops before completion. When the handler receives disconnect, it aborts the route signal and Yahoo `fetch` helpers honor it. However:

- an invocation can continue if the platform does not surface disconnect promptly;
- provider/CDN infrastructure can receive an already-sent request even after local fetch abort;
- aggregate handlers that set attempt headers only after dataset completion can log zero attempts for an early disconnect even if work had begun;
- `fund-metadata` uses `yahoo-finance2.quote`, whose current call path does not expose the shared AbortSignal;
- a CDN hit has no new function summary because there is no function invocation.

Therefore cancellation improves browser resource use and can stop handler/provider work, but no guaranteed provider-cost saving is claimed.

## Durable local-storage failure behavior

The audit covered Portfolio, Watchlist, preferences, sync/enrollment metadata, and backup/import writes.

- Canonical Portfolio and Watchlist writers already serialize/validate before `setItem`, refuse corrupt/unsupported roots, return typed success/failure, and emit durable sync mutation events only after a successful durable write.
- High-level Portfolio/Watchlist mutation helpers now retain the previously stored array after a failed write.
- Options Detail now derives its Watchlist star from the array returned by the durable helper, so a quota/blocking failure cannot show an unsaved add/remove as successful.
- Portfolio page state, add/edit/delete modal completion, refreshed timestamps, lifecycle notices, and import-modal completion now advance only when the corresponding state is successfully persisted.
- Theme, nominal-yield, mark-basis, and schedule/group preference failures notify the shared failure channel instead of failing silently.
- Cloud enrollment/sync metadata already returns typed failure to the Stage 3-5 coordinator/UI. Its schema, ownership, architecture, and behavior were not changed.
- Backup/import already validates before writes and performs best-effort rollback from captured raw values. It was not redesigned.
- Market caches and cleanup timestamps remain best-effort nonfinancial cache state and do not show a durable-save alert.

The shared transient alert uses the existing design system and exact copy:

> Put Scanner couldn't save this change on this browser.

It exposes no `QuotaExceededError`, browser internals, key name, payload, or cloud data. No failed mutation event is emitted, so ongoing local-first sync cannot falsely treat the change as durable. The app keeps the last known durable state visible.

## Existing browser-harness extensions

The existing Playwright/Vite harness remains the only repository browser framework. It still blocks non-local requests and intercepts `/api/**` with deterministic Yahoo-shaped fixtures. Stage 6B.3 extends those fixtures with the new provider-attempt header and failed-request accounting.

The harness runs Vite in development mode, where React Strict Mode can abandon an initial consumer and issue its active replacement. Browser assertions therefore allow that one development-only replacement while the production ledger keeps the consolidated Detail ceiling at one.

The existing product scenarios now assert:

- one failed Screener chunk causes 15 total batch requests (14 initial + 1 failed-only retry), retains successful rows, and local filter/sort/drawer work adds zero requests;
- switching between compatible standard-expiration filters retains Retry Failed Results and adds zero requests;
- Scanner filtering and hover remain local;
- Detail remains consolidated and Option Drawer remains zero-request;
- a forced Watchlist `setItem` quota failure shows safe copy, preserves localStorage, and leaves the Detail star unsaved;
- delayed Pulse navigation records an actual failed/aborted browser request and never publishes the old route;
- Watchlist races/failures and Portfolio quote-only boundaries remain intact.

The phase-gated audit enabled no additional scenarios. The 83 gated cases are deliberate screenshot-phase workflows in the `ui-overhaul*.visual.spec.ts` files; the meaningful cross-page product regression checks already run in `product.spec.ts`. Making screenshot capture unconditional would duplicate the separate 8-viewport visual workflow rather than improve operational coverage.

## Performance and operational debt

Runtime overhead is bounded header parsing, small counters, a maximum of 100 development events, and one compact server JSON log per invoked market handler. There is no contract-level loop, polling, telemetry SDK, database work, or added market-data call. Production excludes the React developer inspector; only the small shared request wrapper and server logger remain.

Remaining debt:

1. Validate provider-attempt distributions from deployed function logs before tightening conservative HTTP maxima.
2. Serverless disconnect delivery and already-sent provider work remain platform-dependent.
3. Early-aborted aggregate routes cannot always report attempts that have not yet been copied to response headers.
4. `fund-metadata` cannot currently propagate abort through `yahoo-finance2.quote`.
5. Theme persistence spans three compatibility keys and reports partial failure but is not transactional.
6. Console summaries are platform-local; there is intentionally no telemetry vendor, durable aggregation, or user-level attribution.
7. Live Yahoo and production Vercel behavior are not part of deterministic CI; no live provider or production account is mutated by this stage.

## Recommended product follow-up

Top Put Scanner improvements after this stage, in order:

1. Define a truthful quote-age/stale-data policy across Watchlist and Portfolio decisions.
2. Make Portfolio expiration-close and Entry VIX maintenance explicit, user-controlled actions.
3. Add configurable but non-prescriptive position-review thresholds using existing metrics.
4. Improve Watchlist review organization/search without widening the underlying universe.
5. Use measured production summaries to tune Pulse/Screener cold-path caching and concurrency before any scale increase.

Recommended next stage: **Stage 6B.4 - explicit Portfolio maintenance and quote-age policy**, with financial formulas, product scope, and Stage 1-5 cloud architecture still frozen.
