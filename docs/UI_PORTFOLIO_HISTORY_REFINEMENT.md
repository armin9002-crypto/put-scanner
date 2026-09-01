# Portfolio + History UI Refinement

## Scope

This pass refines the Portfolio Dashboard and historical trade review surfaces for desktop, phone, iOS-sized viewports, and phone landscape. It consumes the canonical semantics from `PORTFOLIO_HISTORY_SEMANTICS_REFINEMENT.md`; no formulas, lifecycle states, persistence, request behavior, or durable data were changed.

## Portfolio and trade entry

- User-facing Portfolio labels continue to use **Premium**; internal `premiumCollected` data names remain unchanged.
- Add Sold Put does not expose a manual Entry Delta input. Entry Delta capture remains the explicit post-save semantics path.
- Edit Sold Put keeps the optional signed Entry Delta field, including stored values and the ability to clear or replace them. The helper text describes the field as historical entry data without treating a missing value as an error.
- Trade-sheet inputs retain phone-safe 16px text and 44px touch targets, with the existing safe-area and scroll behavior.

## History review

- The filter keeps `Expired ITM` and `Assigned` distinct, as established by the lifecycle semantics audit.
- Headline metrics include Total Realized IRR (combined date-aware money-weighted XIRR), Avg. Days Held (one decimal), Wtd. Avg. Entry Delta (signed, with quiet Gross Risk coverage context), and Total Historical Notional (canonical Gross Risk across all History), alongside the existing resolved P&L/capture context.
- History defaults to Year grouping, based on expiration year. Year, Expiry, Underlying, and None use the same segmented-control language as Schedule of Positions. Group headers prioritize count, Premium, and realized P&L.
- Desktop table headers now use `Exp.`, `Entry`, and `Price @ Exp.`. Expiration and entry dates are deterministic compact values such as `Aug 21, '26`. NY and VIX @ Entry remain visible with formula/storage tooltips. The displayed Final Value column is removed; its canonical helper and durable data remain intact.
- The phone representation keeps ticker/strike/expiration, realized P&L, and status prominent, with Premium, NY, Entry Delta, VIX @ Entry, Entry date, and Price @ Exp. available as secondary/tertiary metadata.

## Responsive and theme notes

History controls scroll within their own segmented surfaces on narrow screens, so labels remain readable without page-level horizontal overflow. Summary cards stay compact in a two-column phone grid; desktop history uses a contained horizontal table scroller and dense tabular rows. Existing semantic theme tokens are used for Dark, Dark Blue, Light, and Sepia.

## Visual review

The repository visual script was invoked for the before capture. In this environment Vite could not start the harness because its config resolution attempted to read an inaccessible parent directory (`Cannot read directory "../../../.."`). Source-level review and deterministic tests were completed; runtime screenshot capture should be rerun in an environment where the visual web server can start.
