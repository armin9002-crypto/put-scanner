# Rolling Historical Analytics

Portfolio History ends with one dynamic Rolling Historical Analytics time series directly below the history table. It is derived from the canonical in-memory `PortfolioTrade` facts through `buildRollingHistoricalAnalyticsSeries`; changing the selector, lookback, hover, or touch position does not fetch data, persist preferences, or write to cloud storage.

## Controls and defaults

- Analytics defaults to Entry AY.
- Period defaults to 6M and offers only 3M, 6M, and 12M.
- The period changes the trailing calendar-month lookback. It does not change the full strategy-history x-domain, which is shared by every metric and period.
- The chart offers exactly Realized IRR, Entry AY, Annualized Premium Run Rate, Annualized Gross Risk Deployed, Entry Delta, Entry IV, and Original DTE. It intentionally does not add compare, overlay, or dual-axis modes.

The title and subtitle come from the engine metric configuration, so the selected metric and period are always explicit. The header also promotes the latest available value, methodology, date context, trade count, and represented Gross Risk. Pointer hover temporarily replaces that value/date context; leaving the plot clears the hover and restores the latest point. On phones the heading, value, Analytics selector, and period control form a compact two-row surface; landscape uses a shorter plot and suppresses secondary copy to preserve the schedule/history workflow.

## Visual and interaction rules

The chart is one restrained straight-line series with faint horizontal gridlines, a small y-axis, and sparse full-domain date labels. Desktop uses the available card width; the SVG viewBox follows the measured plot so the line and axes do not letterbox inside a wide card. Null observations stay gaps, including the early period before a complete rolling window; a genuine zero flow remains a plotted zero. Y domains are metric-aware (currency and signed Delta include a zero reference; realized IRR includes zero when the series crosses it), and long histories use calendar-oriented labels such as `Jan '24`. There is no smoothing, area fill, legend, or duplicated metric formula in JSX.

Desktop and tablet pointer movement exposes a crosshair and marker. Touch users can tap or drag the same plot. The tooltip gives the full date, formatted metric value, selected rolling window, window start, and the engine’s metadata: resolved trades and Gross Risk for Realized IRR; represented trade/risk coverage for weighted entry metrics; and trailing raw value, originations, and annualization factor for flow metrics. The header and screen-reader-only description expose the current state without making every point a tab stop.

Formatting follows the shared financial language: ratio metrics are percentages (Realized IRR is signed), Entry IV is percentage points, Entry Delta is a signed decimal, Original DTE is shown as DTE in the header/tooltip and plain days on the axis, and Premium/Gross Risk use currency with compact axis ticks and full currency tooltip values. The existing Realized P&L-by-expiration-month chart keeps the canonical labels and negative formatting while sizing each bar from measured available width, with a bounded band/bar width and label size; its mobile overflow is horizontal only. Expired / Closed History adds one filter-sensitive grand totals row after the grouped rows (or a compact mobile summary), using `buildHistoryGroupAggregates(visibleTrades)` so grouping, sorting, and collapse state never change the totals.

## Data and extension boundary

The chart deliberately uses all loaded portfolio trades so its strategy-history context is not changed by the outcome/group filter used to read the table. The engine owns event dates, canonical calculations, weighting, coverage, partial-window suppression, and flow zero semantics. The component owns only presentation, local selector state, responsive layout, and pointer/touch inspection. New persistence, provider requests, current quote substitutions, compare modes, overlays, or secondary axes require a separate product decision and should not be introduced here.
