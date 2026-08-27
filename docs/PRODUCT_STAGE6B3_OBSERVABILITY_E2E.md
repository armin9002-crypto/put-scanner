# Stage 6B.3 — Request Observability and Deterministic Browser E2E

Scope: the existing leveraged-ETF / short-put Put Scanner only. This stage does not add a broader stock universe, Wheel/covered-call workflows, earnings, rolling, alerts, social, subscriptions, or recommendations. Financial formulas and the Stage 3–5 cloud architecture are unchanged.

## Request graph

| Workflow | Browser and cache path | Existing Vercel route | Provider work, retry, and fallback |
|---|---|---|---|
| Scanner | `requestMarketData`/`threeLayerCache`: one batched price dataset, fund assets, QQQ/SPY/VIX/VXN sparklines; filters/sort/hover are local | `/api/prices`, `/api/fund-metadata`, `/api/price` | Three Yahoo price chunks, one fund quote, four charts when cold. Cache-first and stale fallback apply; explicit update revalidates missing/stale option snapshots. |
| Screener entry | session expiration dataset plus VIX sparkline | `/api/screener-expirations`, `/api/price` | Seven bounded option metadata acquisitions plus one chart on a cold fill. |
| Screener Load | fixed three-symbol plans through the broker, browser concurrency 2 | `/api/screener-batch` | Up to nine core acquisitions per cold batch, server concurrency 3, incomplete datasets not durably cached. Successful batches remain when another fails. |
| Watchlist | one price batch plus deduplicated `ticker|expiry` chains, option concurrency 3 | `/api/prices`, `/api/options` | `ceil(tickers/20) + unique chains`; stale snapshots survive failures. Refresh/remove reconciliation reads current durable state before publication. |
| Portfolio Refresh | one price batch plus unique open-trade chains | `/api/prices`, `/api/options` | `ceil(tickers/20) + unique chains`; quote-only reconciliation cannot change sold price, contracts, notes, status, entry economics, or lifecycle facts. |
| Ticker Detail | one combined cached request; expiry switch is one options request | `/api/ticker-detail`, then `/api/options` for a switch | Combined initial option session/chain, daily + optional intraday price, and volatility history. Yahoo session authentication can retry once. Stale detail may be used except for explicit fresh requests. |
| Option Drawer | current row data only | none | Zero provider work. Calculator and quote-basis changes are local. |
| ETF Pulse | one combined dataset request and a 6h row cache | `/api/etf-pulse` | Up to 44 two-year histories on a cold shared fill, concurrency 6. Partial/stale row fallback remains. |
| Charts/holdings | timeframe-aware `requestMarketData` or holdings cache | `/api/chart-history`, `/api/holdings` | One main history and optional explicit proxy history; holdings may make one authenticated retry. Longer compatible histories satisfy shorter chart windows. |

Every browser market request now uses `fetchObservedMarketData`. It adds one ephemeral `X-PutScanner-Request-Id` header to the request that was already going to be made and reads response headers from that same response. It creates no telemetry request, polling loop, log-upload request, Supabase call, or durable record.

## Correlation, headers, and structured logs

The browser creates a `ps-<time>-<random>` request-local ID. An existing API route accepts only a bounded safe character form; otherwise it creates `ps-srv-<uuid>`. The route echoes the selected ID. Provider attempts remain within the same server request and are summarized by count, so browser → Vercel → provider work can be joined without retaining ticker/portfolio payloads.

All market routes use `observeMarketRequest`. It patches the existing JSON response once and emits exactly one compact JSON log summary:

- `event`, `requestId`, `endpoint`, `method`
- `tickerCount`, `expiryCount`
- `cacheStatus`
- `providerAttemptCount`, `retryCount`
- `durationMs`, `outcome`, `failureCategory`

Existing responses expose additive, backward-compatible headers:

- `X-PutScanner-Request-Id`
- `X-PutScanner-Server-Duration-Ms`
- `X-PutScanner-Retry-Count`
- `X-PutScanner-Cache-Status`
- `X-PutScanner-Failure-Category`
- existing `X-PutScanner-Upstream-Requests`, cache strategy, dataset version, concurrency, circuit, planned-chain, and response-byte headers where applicable

Failure categories are bounded values (`none`, `validation`, `not_found`, `aborted`, `rate_limit`, `provider`, or `http`); raw provider errors are not returned as diagnostic metadata.

The logs and browser collector explicitly exclude auth tokens, cookies/Yahoo crumbs, Supabase credentials, email addresses, portfolio symbols/quantities/premiums/notes, contract payloads, cloud documents, and JSON backups. Counts are preferred even for public symbols. Request IDs and the most recent 100 development events are memory-only.

The existing development Network diagnostics panel now summarizes browser requests, Vercel responses, provider attempts, retries, failures, aborts, and per-endpoint cache/circuit/concurrency counters. It is active in development; production remains inert unless the existing device-local `put_scanner_debug_network=true` flag is deliberately set. It uploads nothing.

## Request budgets

`src/lib/requestBudgets.ts` defines upper regression thresholds, not brittle claims that every conditional retry/cache state has the same exact count.

| Workflow | Browser | Vercel | Provider ceiling |
|---|---:|---:|---:|
| Scanner load | 6 | 6 | 8 |
| Screener entry | 2 | 2 | 8 |
| Screener full Load | 14 | 14 | 126 |
| Watchlist representative refresh | 2 | 2 | 8 |
| Portfolio representative refresh | 3 | 3 | 12 |
| Ticker Detail | 1 | 1 | 4 |
| Expiry change | 1 | 1 | 3 |
| Option Drawer | 0 | 0 | 0 |
| ETF Pulse | 1 | 1 | 44 |

Watchlist and Portfolio production totals remain data-dependent (`1 + U` browser/Vercel; provider work is `ceil(T/20) + U`). Tests assert representative boundaries and reject meaningful multiplication, including a consolidated Ticker Detail becoming two avoidable initial calls and drawer/local filters producing requests.

## Cancellation

`requestMarketData` accepts an external `AbortSignal`. Its in-flight entry tracks active consumers: one abandoned consumer can stop waiting without canceling another consumer, while the underlying fetch is aborted once nobody is interested. An already-aborted in-flight entry is never joined (important for React development remounts). Timeouts remain failures; supersession/navigation aborts are recorded separately and never use stale fallback, provider health penalties, user-facing provider errors, or retry.

Low-risk propagation now covers:

- Screener gate → broker → fetch → route disconnect signal → batch provider helpers
- Ticker Detail / expiry change → cache broker → fetch → route → option, price, and volatility helpers
- ETF Pulse generation → combined fetch → route → history fan-out
- chart, holdings, prices, fund assets, and exact option helpers already using the broker signal

Generation checks remain the final publication guard. Server routes listen for an aborted request/closed response and pass the resulting signal into provider helpers where supported. Some explicit maintenance paths remain generation-guarded rather than being redesigned; this stage does not add complex cross-function cancellation infrastructure.

## Screener partial retry

Every scan result records only internal `failedBatchIds`; the UI exposes no IDs. A partial load keeps normalized results/maps from successful fixed chunks and shows “Some results could not be loaded.” with **Retry failed results**. Retry reconstructs plans from the original ETF/expiration criteria, requests only failed fixed chunks with revalidation, and merges Maps by canonical ticker/expiration keys, preventing duplicate rows.

The latest-scan gate applies to both full loads and partial retries. Starting a new load aborts/invalidates an older retry. Changing ETF selection or expiration removes incompatible retry state. Client-side delta, moneyness, yield, OI, volume, and IV filters do not invalidate data or refetch. If no batch returns a usable initial result, the existing full retry state remains.

Deterministic example: a full 42-ETF scan is 14 browser/Vercel batch requests and up to 126 core provider acquisitions. If two chunks fail, the old whole-scan retry repeated 14/14/up to 126; failed-only retry uses 2/2/up to 18, saving 12 browser calls, 12 function responses, and up to 108 core acquisitions. One failed chunk uses 1/1/up to 9 instead of 14/14/up to 126.

## Local storage failure feedback

The audit found typed failures in canonical Portfolio/Watchlist writers but ordinary UI helpers silently retained the old array, while nominal-yield, mark-basis, schedule grouping, and theme preference writes caught errors silently. These paths now notify one shared transient listener. The app renders a dismissible alert: “Put Scanner could not save this change locally.” No failed payload or storage exception is displayed, logged, synced, or stored.

Sync metadata remains unchanged: its typed result and Account/engine handling are retained. Market caches remain best-effort and intentionally do not produce user-facing durable-save warnings.

## Deterministic browser E2E

Playwright is repository-owned and independent of the in-app browser bridge. It starts Vite on `127.0.0.1:4317`, launches Chromium (system Chrome on Windows; installed Playwright Chromium in CI), intercepts every `/api/**` call, blocks every non-local browser request, and uses deterministic Yahoo-shaped market, Pulse, holdings, Screener, Portfolio, Watchlist, and Account UI fixtures. It never contacts Yahoo, Supabase, Vercel production, or a production account. The development-only React Strict Mode remount can produce one abandoned request plus its active replacement; production request budgets remain one for the consolidated Detail load.

Run:

```text
npm run test:e2e
```

For headed local debugging use `npm run test:e2e:headed`. On CI/non-Windows, install the pinned Playwright Chromium dependency first with `npx playwright install --with-deps chromium`; Windows developers may override the executable with `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`.

Projects cover 1440×900, 1024×768, 375×667, 390×844, 430×932, 667×375, and 844×390. Core workflows include Scanner filters/exact-expiry/back/default-shortest behavior, Screener partial retry/request counts, Watchlist refresh races/failure preservation plus expiration-day 0-DTE visibility, Portfolio local analytics and quote-only refresh, Detail/expiry/Analyze Ticker plus unavailable-expiry fallback and recoverable errors, zero-request drawer metrics, Pulse navigation cancellation/cached revisit, and local Account signed-out/synced/conflict UI. The viewport smoke matrix clicks the relevant mobile/landscape surfaces rather than relying on width-only DOM assertions.

On failure Playwright retains a screenshot and trace. The test fixture additionally attaches the page URL and captured console/page errors; the Playwright error/trace contains the failing step. Successes do not retain those artifacts. `e2e-artifacts/` and `playwright-report/` are ignored.

## Performance and frozen boundaries

Instrumentation performs header parsing, constant-size counter updates, and one server JSON serialization/log per existing request. Browser events are capped at 100. It adds zero HTTP/provider calls, no polling, no synchronous contract-level loop, and only small modules/configuration to the client/build. Bundle deltas are checked by `npm run build:report`.

No Supabase migration/schema/RLS, `CloudSyncProvider`, CAS/conflict recovery, enrollment, Auth design, cloud payload, or production configuration changed. Observability and retry state are memory-only; E2E fixtures are development/test-only. The only durable-write changes are error notifications around existing writes; they add no write.

## Deferred recommendations

- Add quote age to Needs Attention only after defining product policy and stale-data semantics.
- Make Entry VIX and expiration maintenance explicit in a later focused UX stage.
- Decompose large page components only as a dedicated refactor with no product changes.
- Optimize Pulse cold fan-out using provider/cache evidence; do not widen its universe here.
- Use production request summaries to set rate/concurrency controls before scale, without adding user tracking.

Recommended Stage 6B.4: explicit, user-controlled Portfolio maintenance (expiration close and Entry VIX) with a quote-age policy, keeping cloud and financial formulas frozen. Do not start it as part of Stage 6B.3.
