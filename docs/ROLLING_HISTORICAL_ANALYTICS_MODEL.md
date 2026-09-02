# Rolling Historical Analytics Model

`src/lib/rollingHistoricalAnalytics.ts` is the canonical derived-data boundary for the Portfolio rolling-history chart. It consumes the Portfolio trades already present in application state and returns raw numeric series. It does not fetch, enrich, persist, or format data.

## Metrics

The initial product surface is deliberately limited to seven metrics:

| Metric | Event date | Eligibility | Calculation |
| --- | --- | --- | --- |
| Realized IRR | Canonical realization date | Resolved trades with valid position IRR and Gross Risk | Gross-Risk-weighted average of canonical position Realized IRR |
| Entry AY | Sold date | Open and realized trades | Gross-Risk-weighted average of canonical Entry AY |
| Annualized Premium Run Rate | Sold date | Open and realized trades | Canonical Premium originated in the window times `12 / windowMonths` |
| Annualized Gross Risk Deployed | Sold date | Open and realized trades | Initial Gross Risk originated in the window times `12 / windowMonths` |
| Entry Delta | Sold date | Open and realized trades | Gross-Risk-weighted signed canonical Entry Delta |
| Entry IV | Sold date | Open and realized trades | Gross-Risk-weighted canonical Entry IV in percentage points |
| Original DTE | Sold date | Open and realized trades | Gross-Risk-weighted canonical Original DTE |

Gross Risk is the canonical cash-secured initial notional, `strike × 100 × contracts`. The flow metric is new deployment, not current exposure or Net Risk. Premium is canonical entry Premium, `soldPrice × 100 × contracts`. Entry AY, Original DTE, position Realized IRR, Entry Delta validation, and Entry IV validation all come from their existing Portfolio helpers rather than chart-specific formulas.

Closed trades realize on their actual `closeDate`. Held/expired trades realize on `expiration`, even when maintenance archives them later. Assigned trades realize on their established `resolvedDate`, with `closeDate` as the existing lifecycle fallback. Open and pending trades have no realized event. `canonicalHistoricalRealizedDate` centralizes this derived rule; no durable realized-date field is added.

## Timeline and windows

Every metric and every period uses one x-domain: the earliest valid Portfolio `soldDate` through the current `America/New_York` date. Selecting 3M, 6M, or 12M changes the calculation window only; it never truncates chart history.

Observations occur on every Friday on or after the domain start. If the current New York date is not already that Friday observation, it is appended as a terminal observation. Date-only UTC arithmetic generates the Friday grid so daylight-saving transitions cannot move an endpoint.

The calculation interval is inclusive: `[asOfDate minus N calendar months, asOfDate]`. Calendar subtraction clamps month ends (for example, May 31 minus three months is February 28, or February 29 in a leap year). It does not substitute 90, 180, or 365 days.

A point remains `null` until the known strategy timeline reaches the entire selected lookback: `earliestEntryDate <= windowStartDate`. Early observation dates stay in the common x-domain but are unplotted. No partial-window values, smoothing, or interpolation are produced.

## Missing data, zero, and coverage

Weighted metrics exclude an invalid or missing metric value from both numerator and denominator. Canonical zero values remain represented (including signed Delta zero and zero Entry AY); Entry IV zero is invalid under the established validator. If represented Gross Risk is zero, the point value is `null`, not zero.

Entry-weighted points expose total eligible trades, represented trades, total eligible Gross Risk, represented Gross Risk, and represented-risk fraction. Incomplete coverage does not suppress a valid value or impose an arbitrary minimum sample.

Realized IRR points expose only resolved trades included, their represented Gross Risk, the value, and lookback fields already on the point. They do not mix in unrelated entry counts.

For Premium and Gross Risk, a complete window with no originations has the economically meaningful value `0`. Flow metadata supplies trades originated, raw trailing value, annualization factor (4, 2, or 1), and annualized value. A malformed canonical amount fails closed rather than silently becoming zero.

## Output and extension boundary

`buildRollingHistoricalAnalyticsSeries` returns the metric and window, its explicit metric configuration, the common domain, observation dates, and points. Each point includes:

- `date`, inclusive `windowStartDate`, `value`, `windowMonths`, and `metric`
- `fullWindow`, `tradesIncluded`, and `grossRiskRepresented`
- optional `coverage` for entry-weighted metrics
- optional `flow` for production/deployment metrics

Values are canonical numbers; UI formatting belongs to the chart layer. The seven-item configuration declares key, label, event-date basis, aggregation, formatter category, tooltip metadata, and window-aware title/subtitle copy. Adding a later single metric should extend this small configuration and the canonical value selector. This is not a plugin system, formula language, overlay engine, or dual-axis framework.

Metric and period changes recalculate local derived data only. They cause zero browser/provider requests, zero Vercel invocations, zero Supabase writes, no Portfolio rewrite, and no schema migration.
