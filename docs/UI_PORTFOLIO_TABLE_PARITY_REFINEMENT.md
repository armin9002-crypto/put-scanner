# Portfolio table parity refinement

Implementation date: 2026-08-31

The active Schedule and realized History now share the same dense financial-table language without changing formulas, persistence, lifecycle behavior, freshness calculations, or requests.

- Fresh quote status is visually silent in Schedule rows. Aging, Stale, and Unavailable remain compact inline status text beside the current Delta/IV value, with the existing freshness title/details preserved.
- The local `Show Entry Deltas / IV` toggle still defaults off. When enabled, Delta and IV use two-line `Entry` / `Current` pairs without a third status line.
- History headers, dividers, hover treatment, tabular numerals, spacing, disclosure rows, and semantic colors follow the active Schedule table. Child rows target the active row density; desktop actions use compact icon/text controls while retaining keyboard labels and Delete distinction.
- History group subtotals use one financial value size. Normal aggregates use primary theme text, missing values remain unavailable/muted, and realized P&amp;L uses semantic color and stronger weight rather than a larger type size. Year remains the default, collapsed grouping; disclosure state is local and stable through rerenders/sorting.
- History ticker names are keyboard-actionable links to the safe current/default `/options/TICKER` route, matching active Schedule navigation and never forcing an expired historical contract into the chain.

The refinement is responsive across phone portrait/landscape and the four supported themes; mobile cards retain touch-safe actions and compact paired metrics.
