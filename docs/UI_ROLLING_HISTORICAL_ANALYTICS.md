# Historical Analytics UI

Portfolio History ends with one Historical Analytics surface derived from canonical in-memory `PortfolioTrade` facts. Controls, inspection, and chart changes are request-free and non-durable.

## Controls and information hierarchy

The Analytics selector is grouped into Rolling and Portfolio State families. Rolling offers Entry AY, Entry IV, Entry Delta, Realized IRR, Original DTE, and Annualized Premium Run Rate. Portfolio State offers Gross Risk Exposure and Avg Remaining DTE. Entry AY is the default.

Rolling metrics show a 3M / 6M / 12M control, defaulting to 6M. State metrics replace that control with **POINT IN TIME**, making the semantic change explicit. All choices retain the full strategy-history x-domain. The surface intentionally has no compare, overlay, or dual-axis mode.

The header promotes the metric, latest available value, date, and concise coverage context. Hover or touch temporarily inspects an exact observation; leaving the plot restores the latest value. Rolling tooltips distinguish **Partial** from **Full**, show requested and effective starts, available days, represented trades/risk, and whether the Premium factor comes from actual elapsed days or the complete selected window. State tooltips identify end-of-day state and open-book coverage.

## Line and axis semantics

The chart uses straight segments and real observations only:

- a solid line joins two full rolling-window observations;
- a dotted prefix joins valid partial observations and the partial-to-full transition;
- a lighter dotted bridge connects the real endpoints around an interior `null` gap;
- no synthetic point, smoothing, area fill, or interpolated tooltip is created.

This makes early usable history visible without implying a complete lookback. Sparse x-axis labels are selected from the actual domain: three on narrow phones, four at medium widths, and six on wider layouts. Multi-year labels use semantic month/year formatting. Currency, percent, percentage-point, signed Delta, and days formats follow the shared financial language. Zero is included where economically meaningful; other y-domains remain data-driven.

Portfolio State is daily-sampled. Gross Risk Exposure therefore visibly steps with EOD openings and terminal events; Avg Remaining DTE decays between entries and can jump when book composition changes. Zero exposure plots at zero, while no-position Avg Remaining DTE remains a gap.

## Realized P&L by expiration period

The existing History P&L chart has a local **Period** selector with Month, Quarter, and Year; Month is the default. Every bucket is assigned solely from `trade.expiration`, including early closes. Each bucket aggregates canonical Premium and Realized P&L, and `% Captured = aggregate P&L / aggregate Premium`.

The zero baseline is proportional to the true padded positive/negative data domain rather than visually centered. With 30 or fewer buckets, the chart fits the available width and never scrolls. More than 30 buckets use a contained horizontal scroller with bounded slot, bar, and font sizes. Labels thin responsively while tooltip/title evidence preserves period bounds, trade count, Premium, P&L, and capture.

## Responsive and accessibility rules

The chart fills its measured card width. Desktop and tablet pointers expose a crosshair and marker; touch users can tap or drag while vertical page panning remains available. Mobile compacts the heading and controls and uses readable axis type without widening the page. The SVG has a semantic label and a screen-reader description of full-history, partial, full, and missing-data behavior.

The engine owns event dates, window/state calculations, lifecycle boundaries, coverage, zero/null semantics, and sampling. The component owns presentation, local state, responsiveness, and inspection only. Adding persistence, provider requests, current-quote substitutions, overlays, or a second axis requires a separate product decision.
