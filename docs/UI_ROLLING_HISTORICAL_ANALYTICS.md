# Rolling Historical Analytics

Portfolio History ends with one dynamic Rolling Historical Analytics time series directly below the history table. It is derived from the canonical in-memory `PortfolioTrade` facts through `buildRollingHistoricalAnalyticsSeries`; changing the selector, lookback, hover, or touch position does not fetch data, persist preferences, or write to cloud storage.

## Controls and defaults

- Analytics defaults to Entry AY.
- Period defaults to 6M and offers only 3M, 6M, and 12M.
- The period changes the trailing calendar-month lookback. It does not change the full strategy-history x-domain, which is shared by every metric and period.
- The chart offers exactly Realized IRR, Entry AY, Annualized Premium Run Rate, Annualized Gross Risk Deployed, Entry Delta, Entry IV, and Original DTE. It intentionally does not add compare, overlay, or dual-axis modes.

The title and subtitle come from the engine metric configuration, so the selected metric and period are always explicit. On phones the heading, Analytics selector, and period control form a compact two-row surface; landscape uses a shorter plot and suppresses secondary copy to preserve the schedule/history workflow.

## Visual and interaction rules

The chart is one restrained straight-line series with faint horizontal gridlines, a small y-axis, and sparse full-domain date labels. Null observations stay gaps, including the early period before a complete rolling window; a genuine zero flow remains a plotted zero. There is no smoothing, area fill, legend, or duplicated metric formula in JSX.

Desktop and tablet pointer movement exposes a crosshair and marker. Touch users can tap or drag the same plot. The tooltip gives the full date, formatted metric value, selected rolling window, window start, and the engine’s metadata: resolved trades and Gross Risk for Realized IRR; represented trade/risk coverage for weighted entry metrics; and trailing raw value, originations, and annualization factor for flow metrics. A textual summary and screen-reader-only description expose the current state without making every point a tab stop.

Formatting follows the shared financial language: ratio metrics are percentages (Realized IRR is signed), Entry IV is percentage points, Entry Delta is a signed decimal, Original DTE is days, and Premium/Gross Risk use currency with compact axis ticks and full currency tooltip values.

## Data and extension boundary

The chart deliberately uses all loaded portfolio trades so its strategy-history context is not changed by the outcome/group filter used to read the table. The engine owns event dates, canonical calculations, weighting, coverage, partial-window suppression, and flow zero semantics. The component owns only presentation, local selector state, responsive layout, and pointer/touch inspection. New persistence, provider requests, current quote substitutions, compare modes, overlays, or secondary axes require a separate product decision and should not be introduced here.
