# Historical Analytics Model

Historical Analytics is a local derived-data surface over the Portfolio trades already in application state. It has two deliberately separate families: rolling event-window analytics in `src/lib/rollingHistoricalAnalytics.ts` and point-in-time book state in `src/lib/portfolioHistoricalStateAnalytics.ts`. Neither module fetches, enriches, formats, or persists data.

## Metric families

The Rolling group contains exactly six metrics:

| Metric | Event date | Calculation |
| --- | --- | --- |
| Entry AY | Sold date | Gross-Risk-weighted canonical Entry AY |
| Entry IV | Sold date | Gross-Risk-weighted canonical Entry IV, in percentage points |
| Entry Delta | Sold date | Gross-Risk-weighted signed canonical Entry Delta |
| Realized IRR | Canonical realization date | Gross-Risk-weighted canonical position Realized IRR |
| Original DTE | Sold date | Gross-Risk-weighted canonical Original DTE |
| Annualized Premium Run Rate | Sold date | Canonical Premium originated in the selected window, annualized by the selected period factor |

The Portfolio State group contains exactly two metrics:

| Metric | Observation | Calculation |
| --- | --- | --- |
| Gross Risk Exposure | End of day | Sum of canonical initial Gross Risk for positions open at that EOD |
| Avg Remaining DTE | End of day | Gross-Risk-weighted remaining DTE for those open positions; `null` when no risk is open |

Gross Risk is the cash-secured initial notional, `strike × 100 × contracts`. Premium is the entry credit, `soldPrice × 100 × contracts`. Existing Portfolio helpers remain authoritative for Entry AY, Original DTE, Realized IRR, Entry Delta/IV validation, and lifecycle economics. The retired Annualized Gross Risk Deployed flow is not part of the product surface.

## Shared timeline and rolling prefix windows

Every metric uses one x-domain from the earliest valid `soldDate` through the current `America/New_York` date. Observation dates are the exact strategy start, every Friday after it, and the current New York date when it is not already present. Date-only UTC arithmetic prevents DST from moving observations.

For a rolling observation:

- `requestedWindowStart` is the observation date minus the selected 3, 6, or 12 calendar months, with month-end clamping.
- `effectiveWindowStart` is `max(strategyStart, requestedWindowStart)`.
- The inclusive calculation interval is `[effectiveWindowStart, observationDate]`.
- `fullWindow` is true only when `requestedWindowStart >= strategyStart`.
- `availableDays` reports elapsed available history while the full lookback is unavailable, allowing the UI to show a raw-derived “x of y months available” label.
- `requestedWindowMonths` always retains the selected period.

A valid prefix is calculated rather than suppressed. Weighted metrics apply their normal eligibility and coverage rules to the effective interval. Realized IRR uses canonical realization dates: actual `closeDate` for closed trades, `expiration` for held-to-expiration trades, and established assignment `resolvedDate` with the existing lifecycle fallback. Open and unresolved records have no realized event.

Annualized Premium Run Rate preserves the selected factor even for a partial prefix: 3M uses ×4, 6M uses ×2, and 12M uses ×1. It does not annualize by the shorter available history. A valid window with no originations is economically `0`; malformed premium inputs fail closed.

## Portfolio-state EOD reconstruction

State observations are sampled daily because exposure and remaining DTE can change on any date. A position is open at EOD only when `soldDate <= date < canonicalTerminalDate`.

- Closed: terminal date is `closeDate`.
- Expired worthless / expired ITM: terminal date is `expiration`.
- Assigned: terminal date is the established assignment resolution date.
- Open: its calculated state is bounded by `expiration`; it cannot remain exposed after expiry.
- Same-day entry and terminal activity creates no EOD exposure because the terminal boundary is exclusive.

An unsafe terminal record is excluded rather than guessed. Each state point reports open positions, represented Gross Risk, and coverage including excluded unsafe lifecycle records. Gross Risk Exposure is `0` when no positions are open. Avg Remaining DTE is `null` in that state because there is no valid weighting denominator.

## Missing data, coverage, and output

Weighted metrics exclude a missing or invalid metric from both numerator and denominator. Valid zero values remain represented, including signed Delta zero and zero Entry AY; Entry IV zero stays invalid under the canonical validator. Zero represented Gross Risk yields `null`.

Entry metrics expose eligible/represented trade and Gross Risk counts. Realized IRR exposes resolved represented trades and Gross Risk. Premium exposes originations, trailing Premium, the selected annualization factor, and annualized output. All returned values are raw numbers; formatting belongs to the chart.

`buildRollingHistoricalAnalyticsSeries` returns requested/effective window metadata and prefix/full status. `buildPortfolioHistoricalStateSeries` returns daily point-in-time state and lifecycle coverage. Selector, period, hover, and date changes are client-local: zero browser requests, zero function invocations, zero provider acquisitions, zero Supabase writes, and no Portfolio rewrite or schema migration.
