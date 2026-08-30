# Scanner and History Composition Refinement

This focused refinement keeps the existing scanner, portfolio, request, and financial semantics intact while tightening the two highest-density review surfaces.

## Scanner

- The Scanner command bar now has one `Filter / Search by Ticker` control. Typing updates the existing local ETF search across ticker, underlying, and fund name without making a request.
- Submit with Enter or `Go to Option Chain` reuses the existing direct ticker-detail route and normalization, so provider-supported symbols such as `TSLA`, `NVDA`, and ETF tickers remain valid even when they are not in the local ETF universe. Invalid symbols use the existing inline error and preserve the query.
- The former Opportunity Set search field, `Analyze Ticker` micro-label, Scanner subtitle, and duplicate opportunity/date summary were removed. The result header retains the current price freshness and result count.
- Opportunity Set and Market Context share one responsive analytical surface. Desktop uses a roughly 44/56 split with a structural divider; tablet stacks both sections within that surface. Phone portrait places Opportunity Set before a 2×2 market strip, while landscape keeps the compact four-across market ribbon when legible.
- SPY, VIX, QQQ, and VXN retain their value, move, sparkline, timeframe, refresh, and chart behavior. Market freshness remains associated with Market Context.

## Wordmark

The supplied `src/assets/put-scanner-wordmark.png` is used as an alpha mask. Its semantic fill is `var(--text-primary)`, so the same asset adopts the active Dark, Dark Blue, Light, or Sepia theme without manually recolored image variants. The navigation brand remains an accessible `Put Scanner` home link and keeps the existing shell height.

## Portfolio History

- Year remains the default grouping. Year, Expiry, and Underlying groups each use a session-local disclosure button with the same chevron/focus language as Schedule of Positions. None remains a flat, ungrouped list.
- Grouped desktop tables render a true header row and an aligned subtotal row. Only additive values are shown: group identity/trade count, Contracts, Premium, and Realized P&amp;L. P&amp;L receives the strongest semantic color and emphasis; NY, VIX @ Entry, Price @ Exp., Realized IRR, % Captured, and Entry Delta remain blank rather than receiving misleading averages or sums.
- Mobile grouped headers expose identity, trade count, Premium, Realized P&amp;L, and the disclosure affordance in a compact structured row. Trade cards are hidden while a group is collapsed.
- History continues to read durable `entryVixClose`. Missing values render as `—`; no row-render fetch, automatic repair, or History-side backfill UI was added. Existing Portfolio Maintenance remains the explicit recovery path.

## Responsive and iOS behavior

The unified input retains the existing 16px mobile text sizing, explicit form submission, and touch-safe button. Shared surfaces use semantic theme tokens, avoid horizontal page overflow, and preserve compact landscape spacing.
