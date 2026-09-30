# Historical Analytics UI

Portfolio History ends with one Historical Analytics surface derived from canonical in-memory `PortfolioTrade` facts. Controls, inspection, and chart changes are request-free and non-durable.

## Controls and information hierarchy

Series selects Rolling or Portfolio State. Metric groups Rolling into Entry / Strategy (Entry AY, Entry IV, Entry Delta, Original DTE, Annualized Premium Run Rate) and Outcomes (Realized AY, Blended Capture). Portfolio State offers Gross Risk Exposure and Avg Remaining DTE. Entry AY is the default.

Rolling metrics show a 3M / 6M / 12M Window control, defaulting to 6M; State hides it and identifies EOD state. Range offers 3M, 6M, YTD, 1Y, 2Y, 3Y, and All. All retains the full strategy-history domain. Ranges slice computed observations without altering calculations; YTD starts January 1 of the canonical current New York market year. Compare is off by default; it overlays 3M/6M/12M for the same metric and units on one axis. The selected Window remains primary, and additional windows are computed only when enabled.

The headline and its through-date always represent the primary series' latest available observation, independent of inspection or display range. Metadata is a compact, horizontally scrollable line. Hover temporarily inspects; click or tap pins. Leaving restores the pin, or current when unpinned. Click the same observation, Clear pin, or Escape to clear. Arrow keys explore dates, Home/End reach endpoints, Enter/Space pins; only deliberate selections are announced. Tooltips preserve unavailable values and show exact supporting risk, requested/effective dates, coverage, and flow annualization. Comparison inspection lists all windows at that exact date without substituting nearby observations.

View data reuses the displayed observations, including null rows, in a focus-trapped modal (desktop) or bottom sheet (phone), with date, value, represented trades/open positions, Gross Risk, coverage/exclusions, and window/state basis. Comparison adds one row per window/date. No constituent trades or provider requests are involved. Methodology is available in a contained chart overlay.

## Line and axis semantics

The chart uses straight segments and real observations only:

- a solid line joins two full rolling-window observations;
- a dashed prefix joins valid partial observations and the partial-to-full transition;
- missing/nonfinite observations break the path entirely; singleton valid islands remain visible;
- no invented point, smoothing, or interpolated tooltip is created;
- Premium Run Rate uses a restrained area fill; EOD state uses steps, with a restrained area for Gross Risk Exposure.

Calendar ticks occupy actual year, month, week, or day boundaries, thinning with measured width and text size. Primary value labels identify Current, visible High, and visible Low; shared points deduplicate, and collisions hide lower-priority labels. Axes and values use 12px base type on desktop and 11px on narrow plots, respecting global text scale. Currency, percent, percentage-point, signed Delta, and days formats follow the shared financial language. Zero is included where economically meaningful; other y-domains remain data-driven.

Only visible special states receive in-chart keys. Incomplete coverage is explicitly identified with its percentage and quiet dotted emphasis; missing Delta/IV is never zero. Faint Gross Risk micro-bars sit within the primary plot on wider charts; narrow plots retain supporting data through inspection and View data. These are exposure context, not statistical confidence.

Portfolio State is daily-sampled. Gross Risk Exposure therefore visibly steps with EOD openings and terminal events; Avg Remaining DTE decays between entries and can jump when book composition changes. Zero exposure plots at zero, while no-position Avg Remaining DTE remains a gap.

## Realized P&L by expiration period

The existing History P&L chart has a local **Period** selector with Month, Quarter, and Year; Month is the default. Every bucket is assigned solely from `trade.expiration`, including early closes. Each bucket aggregates canonical Premium and Realized P&L, and `% Captured = aggregate P&L / aggregate Premium`.

The zero baseline is proportional to the true padded positive/negative data domain rather than visually centered. With 30 or fewer buckets, the chart fits the available width and never scrolls. More than 30 buckets use a contained horizontal scroller with bounded slot, bar, and font sizes. Labels thin responsively while tooltip/title evidence preserves period bounds, trade count, Premium, P&L, and capture.

## Responsive and accessibility rules

The chart fills its measured card width. Touch users tap to pin while vertical page panning remains available. Controls scroll in one contained row at narrow widths and large text. Plot heights remain 18.25rem desktop, 13.25rem portrait mobile, and 9.75rem compact phone landscape. Legends, help, and inspection remain inside the chart; no persistent lower panels or additional subplot are introduced. Dialog dismissal reuses the shared reduced-motion-aware overlay and focus behavior.

The engine owns event dates, window/state calculations, lifecycle boundaries, coverage, zero/null semantics, and sampling. The component owns presentation, local state, responsiveness, and inspection only. Financial series and geometry are memoized separately from pointer state. No persistence, additional requests, current-quote substitutions, new dependencies, or perpetual animation are introduced. Average Days Held was deliberately omitted because History headline and grouped weighting differ; Blended Capture reuses canonical History aggregation on the exact realized-window population.
