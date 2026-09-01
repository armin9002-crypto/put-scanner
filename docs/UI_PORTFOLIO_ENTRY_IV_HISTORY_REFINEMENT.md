# Portfolio Entry IV, Schedule, and History refinement

Implementation date: 2026-08-31

This UI pass keeps the existing Portfolio formulas, durable trade schema, market-data request graph, and persistence boundaries intact while making Entry IV and historical context easier to scan.

## Schedule

- The active Schedule has an `Entry` column sourced from the trade's Sold/Written Date. It uses the compact History date formatter and sorts by the date-only value, with unavailable dates last in either direction.
- The existing `Show Entry Deltas / IV` presentation toggle is local component state and defaults unchecked. It adds no durable preference or cloud field.
- Unchecked rows show `Current Delta` and `IV` values only. Checked rows show paired `Entry / Current Delta` and `Entry / Current IV` values. Entry values use the canonical formatters; a missing Entry IV is `—`, and current IV remains the latest market quote.
- The mobile position row mirrors the desktop data hierarchy without removing its 44px Edit touch target. Entry date, Delta, and IV remain compact secondary metadata.
- User-facing active Schedule `Total Gain/Loss` labels are shortened to `Gain/Loss` wherever the same active-position concept appears.
- New Open trades still explain that exact-contract Entry Delta and Entry IV are captured automatically when eligible. Historical mode and Edit retain the optional manual snapshot fields from the historical-entry model, including percentage-point Entry IV input (`65.4` means `65.4%`).

## History

- History Entry IV remains a durable value rendered with the same percentage-point formatter. Missing values render as `—`; History does not fetch or reconstruct IV.
- Group subtotals and headline cards reuse the canonical Gross-Risk-weighted Entry IV helper and its coverage. No aggregate arithmetic is performed in JSX.
- Desktop grouped History uses one disclosure/subtotal row per group. The row retains the existing group totals, collapse behavior, Collapse/Expand All controls, and child-row sorting; the former duplicate disclosure row is gone.
- Year is the default grouping and newly encountered groups start collapsed. Switching grouping modes does not create durable disclosure state; `None` remains flat.
- Headline metrics are ordered: Realized P&L, Total Realized IRR, Blended Capture, Total Historical Notional, Resolved Trades, Avg. Days Held, Wtd. Avg. Entry Delta, and Wtd. Avg. Entry IV. The responsive grid remains equal-width on wide screens and uses 4×2 / 2×4 layouts at smaller widths rather than a carousel.
- Mobile History keeps disclosure and action controls touch-safe while retaining the dense metric treatment used by active Schedule rows.

## Expiration-month chart and outcome bar

The chart title remains `Realized P&L by Expiration Month`. Labels use compact month-plus-year text such as `Jul '26`; the redundant `N months` count is removed. Month grouping and bar height/math are unchanged and continue to use option expiration month.

The small colored bar below the headline cards is a four-outcome distribution (Expired Worthless, Closed, Expired ITM, Assigned), not a capture-versus-remaining bar. It is retained, with the existing tooltip naming each segment, because it summarizes lifecycle composition rather than duplicating Blended Capture.

## Verification boundaries

This pass does not change financial definitions, historical resolution, Entry IV capture, cloud synchronization, request ceilings, or durable preference storage. Focused source/unit tests cover Schedule date sorting, toggle copy/defaults, canonical Entry IV rendering, grouped History collapse/subtotal structure, headline order, and chart labeling.
