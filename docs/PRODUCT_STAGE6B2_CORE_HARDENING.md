# Stage 6B.2 - Core Product Reliability and UX Hardening

Completion date: 2026-08-27

## Scope and outcome

Stage 6B.2 hardens the existing Put Scanner product. It does not add a broad stock universe, Saved Underlyings, ThetaGang workflows, wheel automation, alerts, polling, rolling, or new cloud schema. Scanner, Screener, Watchlist, Portfolio, contract detail, and ETF Pulse retain their current product boundaries.

Sixteen concrete defects were found and fixed:

1. Screener used a union expiration calendar as if every ticker shared every date, silently excluding valid per-ticker matches.
2. Screener converted real 0-DTE contracts to 1 DTE, producing a false annualized value.
3. A new Screener load could retain the preceding dataset while the replacement request was active.
4. A total Screener acquisition failure could finish without a clear fatal retry state.
5. Overlapping Scanner price retries could publish an older completion, and a second timeout was left pending.
6. A Watchlist refresh could recreate a contract removed while the request was in flight.
7. An unexpected Watchlist refresh failure could leave weak or stuck loading/error feedback.
8. Portfolio's quote refresh could perform durable expiration archival and Entry VIX enrichment.
9. A Portfolio quote completion could recreate a deleted position or overwrite a newer edit.
10. A passive Portfolio lifecycle completion could recreate a deleted position or overwrite a newer edit.
11. An older or unmounted ETF Pulse request could publish late progress, results, or errors.
12. Close Candidate reasons were available only through desktop hover text and were not transparent on phones.
13. The contract drawer did not show discovery-denominator SCY and Ann. SCY beside position returns.
14. Compact sort controls still called Ann. SCY "Annualized yield," weakening cross-surface terminology.
15. Watchlist auto/manual refresh relied on rendered disabled state, allowing a narrow duplicate-invocation and post-unmount publication edge.
16. Portfolio quote refresh had the same duplicate-invocation and post-unmount publication edge; a fully conflict-blocked lifecycle pass could also announce an archive it did not apply.

Each fix has a deterministic regression in `tests/stage6b2-core-hardening.test.mjs` or an explicit source guard in the responsive checklist.

## Workflow walkthrough findings

### Scanner

Scanner mount remains quote-first. A cold load uses one batched price endpoint, one fund-metadata endpoint, and four small context/spark requests (SPY, VIX, QQQ, and VXN). Sorting, filtering, expanding a row, and Analyze Ticker input produce no request. Option-chain work remains behind the explicit IV/Liquidity refresh.

The visible data keeps its last good state during transient failures. A generation guard now ensures an older batch completion cannot replace a newer retry. The local timeout belongs to that generation and is cleared on completion or teardown.

### Screener

Screener is explicitly two-phase:

- Page entry acquires the expiration inventory and VIX context.
- `Load`/`Run Screener` explicitly scans the structural selection.
- After load, numeric filters, liquidity filters, display columns, and sorting are client-only.
- Changing ETF membership or the expiration selection marks the dataset out of date and requires another explicit load. That scope warning is visible on mobile as well as desktop.

Expiration selection is now evaluated against each ticker's own expiration calendar. `All` selects every expiration for that ticker; `<= 30 DTE` selects that ticker's qualifying dates; an exact date includes only tickers that actually list it. A same-day contract remains 0 DTE. SCY is still valid, but Ann. SCY and a model-derived Delta fail closed at zero time; a finite provider Delta remains usable.

Starting a replacement scan clears the old published rows and criteria. Fatal acquisition failure produces a retryable error, and success, partial failure, stale completion, and fatal failure cannot leave the action buttons stuck. Request generations prevent an older scan from publishing after a newer one.

### Watchlist

Cold mount still performs the established explicit saved-contract refresh. It batches underlying prices once and acquires each unique ticker/expiration chain once. Filtering, sorting, and opening a drawer are local-only.

Refresh reconciliation is identity-based. A removed contract stays removed, a newly added contract stays present, and current durable notes/timestamps win over the request's old snapshot. Unexpected failure preserves saved rows, always exits loading, and exposes retry feedback.

### Portfolio and Analytics

`Refresh Open Trades` is now quote-only. It batches prices once and reuses one chain per unique ticker/expiration. It updates only `localMarketData`; it does not archive expired positions, resolve expiration closes, enrich Entry VIX, edit position economics, or increment durable revisions.

Quote reconciliation begins from the latest stored trades. Deleted positions are not recreated, edited durable fields are retained, and a quote is accepted only for the same open ticker/expiration/strike/type identity. A newer market timestamp also wins. Passive lifecycle archival remains a real durable operation, but it separately checks the current record's `updatedAt` against the inspected baseline before applying a result.

Analytics collapse/expand, grouping, filters, and mark-basis display changes make no market-data request. The mark-basis choice is a real portable preference; it does not alter trade economics. Refresh errors retain the last good portfolio and clearly describe partial data.

### Contract detail and drawer

Initial detail remains one consolidated `/api/ticker-detail` request. Expiry changes request only the selected chain. Drawer open/close and calculator changes are local-only. The drawer now exposes SCY and Ann. SCY using gross strike cash, alongside Net-Risk Return and its annualized value using entry net maximum-loss capital. This makes an identical contract auditable across discovery and position contexts without pretending the denominators are the same.

### ETF Pulse

Pulse still performs one explicit aggregate endpoint call backed by up to 44 unique ticker-history acquisitions on a cold cache. Filter, sort, view changes, and hover are local-only. Request generations now suppress progress, results, errors, and `finally` work from superseded or unmounted requests.

## Portfolio policy made explicit

The existing algorithms were extracted without changing thresholds.

Close Candidate qualifications:

- premium captured at least 75%, or at least 50%;
- at least 50% captured and annualized remaining liability below 5%;
- current option mark at or below $0.05;
- remaining DTE at or below 14 and breakeven cushion at or above 20%.

Only positions with at least one qualification reason enter Close Candidates. Ranking adds captured percent, declining annualized remaining liability, a 30-point small-mark bonus, declining DTE, and up to 20 points of breakeven cushion. Reasons are rendered directly in cards on phone and desktop.

Needs Attention is a ranking, not a qualification filter: every open position is eligible and the highest five scores are shown. The exact components are:

- missing breakeven: +20;
- below breakeven: +120 plus up to 60 by distance; otherwise up to 80 as cushion narrows;
- below strike: +60; otherwise up to 45 as strike distance narrows;
- expired: +40; otherwise up to 35 as DTE declines;
- absolute Delta: up to 45;
- gross risk: up to 35.

Freshness age and availability status are not separate score inputs. This is documented as remaining policy debt, not silently inferred intent.

## Cold request graph

Counts are architectural core acquisitions, not guaranteed raw Yahoo HTTP attempts. Authentication/session acquisition, retries, circuit breakers, stale fallbacks, and cache hits can change vendor traffic; endpoint diagnostics remain the source of actual attempts.

| Workflow | Browser / Vercel | Provider core acquisitions | Zero-request interactions |
|---|---:|---:|---|
| Scanner entry | 6 / 6 | normally about 8: 3 price chunks, 1 fund batch, 4 context histories | filter, sort, expand, Analyze input |
| Screener entry | 2 / 2 | up to 7 expiration-prefetch option calls plus 1 VIX call | local UI changes before Load |
| Screener Load, full 14 batches | 14 / 14 | normally up to 126: 3 initial chains, 3 selected chains, and 3 realized-vol histories per stable batch | post-load nonstructural filters and sort |
| Watchlist refresh | `1 + U` / `1 + U` | `ceil(T/20) + U` | filter, sort, drawer |
| Portfolio quote refresh | `1 + U` / `1 + U` | `ceil(T/20) + U` | filter, group, analytics toggle |
| Ticker detail entry | 1 / 1 | normally 4: daily, intraday, one chain, realized-vol history | drawer/calculator |
| Ticker expiry change | 1 / 1 | 1 selected chain | row sort/filter |
| ETF Pulse cold refresh | 1 / 1 | up to 44 unique histories | filter, sort, view, hover |

`T` is the number of unique underlyings and `U` the number of unique ticker/expiration pairs. Warm caches, in-flight deduplication, and stale-while-revalidate behavior can reduce network work to zero.

The Portfolio quote refresh previously added up to `E + V` browser calls, Vercel invocations, and provider acquisitions: `E` unique expiration-history requirements plus one VIX history request when Entry VIX dates were unresolved. Those calls are now removed from the quote action. The common cold case with no expired positions but missing Entry VIX saves one call at every layer; larger expired sets save correspondingly more. Durable lifecycle work remains isolated to lifecycle processing.

One selected Screener ticker still executes its stable three-symbol batch and can therefore cost up to nine core provider acquisitions. This deliberate cache-key/stable-batch tradeoff is unchanged and visible here rather than hidden behind a one-ticker claim.

## Durable versus transient state

| Action | Durable mutation? | Notes |
|---|---|---|
| Scanner/Screener/Pulse market refresh | No | Market snapshots only |
| Watchlist market refresh | No | Durable identity, note, and saved timestamps remain current |
| Portfolio `Refresh Open Trades` | No | Persists only transient local market cache; durable revision remains unchanged |
| Portfolio automatic expiration archive | Yes | Real lifecycle transition, conflict-checked against the current record |
| Add/edit/remove Watchlist or Portfolio item | Yes | Existing local-first/cloud sync path unchanged |
| Portfolio mark-basis preference | Yes, preference only | Does not change position economics |
| Detail/drawer view | No | No saved record unless an existing explicit save action is used |

No Stage 6B.2 change modifies Supabase schema, migration, RLS, enrollment, conflict recovery, or production feature flags.

## Mobile and responsive result

Phone layouts now expose the Screener structural-scope warning and fatal retry state, Watchlist refresh errors, visible Close Candidate reasons, and both SCY and net-risk returns in the full-screen trade sheet. Existing touch targets, safe areas, dense shared rows, and contextual navigation are unchanged.

The deterministic responsive matrix covers 375x667, 667x375, 390x844, 844x390, 430x932, and 932x430, plus tablet and desktop sizes. In-app live browser inspection was attempted during this stage, but the browser bridge rejected the session because its sandbox metadata was incomplete. Therefore this stage claims passing source/layout guardrails, type checks, tests, and production build validation - not a live pixel-level or interaction pass.

## Remaining fragilities and technical debt

1. Screener stable three-symbol chunks intentionally fetch unselected peers and retry still restarts the whole requested scan rather than only failed batches.
2. Shared acquisitions can continue server-side after a client request becomes stale; publication is guarded, but cancellation is not plumbed end to end.
3. Watchlist and Portfolio prevent unsafe publication but do not abort already-running option acquisitions.
4. Passive expiration lifecycle work can perform network-backed durable archival on Portfolio mount. It is now conflict-safe but remains implicit.
5. Entry VIX gaps no longer piggyback on quote refresh; the product needs a separate, explicit maintenance action if that enrichment remains valuable.
6. Needs Attention does not explicitly score quote age, stale-cache state, or unavailable market fields.
7. Screener and Portfolio pages still contain large view/state orchestration surfaces that are difficult to reason about as a whole.
8. ETF Pulse retains a high cold-cache fan-out of up to 44 histories.
9. Some local-storage write failures need more uniform user-visible quota/recovery feedback.
10. A real cross-browser viewport suite remains necessary because static responsive guards cannot prove focus behavior, clipping, or visual density.

## Highest-value next improvements for the current Put Scanner

1. Add privacy-safe production endpoint/cache latency, retry, stale-fallback, and provider-attempt observability.
2. Add failed-batch-only Screener retry with visible batch diagnostics.
3. Create an explicit scoped Portfolio lifecycle/Entry VIX maintenance action, separate from quotes.
4. Extract Screener, Portfolio, and detail request/view state machines into testable controllers.
5. Incorporate quote availability and freshness age into a documented Needs Attention policy.
6. Standardize visible local-storage write/quota recovery across every durable action.
7. Add Playwright-grade browser E2E for the existing route/viewport matrix in CI.
8. Plumb abort signals through page, broker, Vercel, and provider layers where shared-cache semantics permit.
9. Audit and test modal/drawer focus trapping and keyboard recovery on all existing routes.
10. Load-test Pulse and expose aggregate cache-hit/partial-result diagnostics before broader use.

Recommended next stage: **Stage 6B.3 - Production Observability and Deterministic Browser E2E**. It should improve the current Put Scanner's operational evidence and failure diagnosis without adding new universes or adjacent trading products. Broad stock discovery, ThetaGang community features, wheel automation, rolling, and strategy expansion belong in a separate future product/design track unless later evidence justifies reopening Put Scanner's scope.
