# Historical trade entry UX

The Add Sold Put workflow separates the user's intent from the internal lifecycle states used by Portfolio.

## Open vs Historical / Realized

Open is the compact current-position path: Ticker, Expiration, Strike, Contracts, Sold Price, Sold Date, and Notes. A new Open trade does not ask for Entry Delta or Entry IV. One bounded contemporaneous exact-contract observation supplies both values before the trade's one initial durable save when eligible; lookup failure does not prevent the trade from saving.

Historical / Realized is the repetitive spreadsheet-entry path. Its primary fields are Ticker, Expiration, Strike, Contracts, Sold Price (Net), Sold Date / Entry Date, optional Entry Delta, optional Entry IV (%), and Notes. Every valid expiration change recomputes the automatic mode from the current `America/New_York` market date: past is Historical; today (including 0-DTE) and future are Open. A user may then explicitly select a compatible historical outcome such as an early close.

Internal states such as `expired_price_pending`, `expired_worthless`, and `expired_itm` are not manual choices.

## Historical outcome UX

The outcome control is labeled “How did it end?” and defaults to Held to Expiration.

- Held to Expiration resolves Price @ Exp., intrinsic option value, realized outcome, and Realized P&L through the canonical expiration process. A pending lookup is retained for Portfolio Maintenance rather than presented as a blocking form error.
- Closed / Bought Back reveals only Close Date and Close Price. Close Date may equal Expiration Date; a known buyback never requests an expiration close.
- Assigned (Confirmed) records only the user's confirmed assignment event. It is never inferred from an ITM expiration.

## Entry Delta

Historical Entry Delta accepts either spreadsheet-style positive magnitude or signed put Delta, for example `0.1235` or `-0.1235`. On blur and save it is normalized to the canonical signed put convention. Existing values are shown at a sensible four-decimal input precision while the durable numeric value is preserved when the field is unchanged. Missing legacy values remain optional.

## Entry IV

Historical Entry IV is optional and uses percentage units. The label **Entry IV (%)** makes the scale explicit: enter `65.4` for `65.4%`. The durable value uses the same percentage-point convention as normalized option-chain IV. Edit can fill, override, or explicitly clear it; current quote refresh cannot alter it. A valid stored legacy `entrySnapshot.iv` may be recovered explicitly, but current-chain substitution or historical IV reconstruction is prohibited.

## Reconciliation preview

The compact derived preview uses existing canonical helpers and is not independently editable. It shows Premium, Gross Risk, Net Risk, Breakeven, Original DTE, Entry NY, and Entry AY. Historical mode also shows Price @ Exp., Final Option Value, Realized P&L, and Realized IRR when calculable. Premium and realized dollar values retain cent precision so a spreadsheet typo is easy to spot.

## Repeated entry and edit behavior

Add Trade includes Save & Add Another. After a successful historical save it may temporarily retain Historical / Realized and resets Held to Expiration while clearing all trade-specific identity, economics, dates, notes, Delta, IV, and conditional outcome fields. Entering a future or same-day expiration immediately recomputes the next row to Open, preventing the retained workflow default from leaking into the saved trade. It is not offered while editing.

Edit Sold Put keeps the stored trade identity, lifecycle outcome, and optional Entry Delta/IV visible. Save failures leave the dialog open with concise feedback; successful saves close the dialog and immediately update History through the existing durable persistence path.

## Desktop and mobile rules

The workflow is a compact centered dialog on desktop and a scrollable bottom sheet on phones. Inputs remain at least 16px on phone layouts with 44px touch targets, signed Delta uses a decimal keyboard, and actions remain reachable while the sheet scrolls above the software keyboard and safe-area inset. The mode and outcome controls are keyboard-reachable radios with visible focus states.
