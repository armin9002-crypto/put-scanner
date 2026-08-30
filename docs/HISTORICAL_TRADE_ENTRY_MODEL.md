# Historical Trade Entry Model

## User-facing lifecycle

Manual entry separates the user's intent from internal lifecycle states:

- **Open** is an unexpired current position.
- **Historical / Realized** offers **Held to Expiration**, **Closed / Bought Back**, and **Assigned (Confirmed)**.

A newly entered past expiration switches to Historical / Realized and defaults to Held to Expiration. `expired`, `expired_price_pending`, `expired_worthless`, and `expired_itm` remain compatible internal states; they are not manual outcome choices.

## Historical outcomes

### Held to Expiration

Save performs one cache-first canonical expiration-close lookup. The underlying price is Yahoo chart `indicators.quote[0].close` for the expiration date, or the nearest prior trading-day close. The adjusted-close series is not used.

Once the close is safe, the existing expiration resolver derives:

- `finalOptionValue = max(strike - expirationClose, 0) * contracts * 100`
- Expired Worthless when final option value is zero
- Expired ITM when final option value is positive
- realized short-put P&L from canonical Premium less final option value

Moneyness never implies assignment.

### Corporate-action safety

The Yahoo chart request also asks for split, dividend, and capital-gain events over the contract life. Automatic expiration math runs only when that provider event set is present and contains no event after entry through expiration.

This is intentionally conservative. OCC adjustments may change strike, deliverable, multiplier, or the underlying itself, while Put Scanner stores a standard 100-share put and does not store an adjusted option symbol or OCC deliverable. If Yahoo reports an in-contract action, or the event basis cannot be validated, the trade saves as internal Expiration Price Pending. The user can review it through Portfolio Maintenance; Put Scanner does not fabricate normalized economics.

Successful automatic resolution stores `provider_no_actions` basis provenance and the checked-from entry date. A later economic edit may reuse that close only when the marker covers the contract life. Legacy resolved records without the marker remain displayable; changing only Notes or Entry Delta is request-free, while an edit that changes their realized economics revalidates the expiration basis before reuse.

References: [Yahoo adjusted-close definition](https://help.yahoo.com/kb/adjusted-close-sln28256.html), [Options Industry Council corporate-action guidance](https://www.optionseducation.org/referencelibrary/faq/splits-mergers-spinoffs-bankruptcies).

### Closed / Bought Back

Close Price and Close Date are required. Close Date is the realized exit date, including when a buyback occurs on the expiration date. A known buyback never requests an expiration close. Realized P&L is `(Sold Price - Close Price) * contracts * 100`.

### Assigned (Confirmed)

Assigned records only an event the user confirms. Existing assignment economics are preserved when unrelated fields change. Put Scanner does not infer assignment from moneyness and does not invent stock-position proceeds or cost basis.

## Historical Entry Delta

Current/Open Add does not expose a manual Entry Delta; contemporaneous capture remains unchanged. Historical Add and all Edit flows expose the optional field.

Historical manual entry accepts either a positive magnitude or a negative put Delta. A finite magnitude from 0 through 1 is normalized to the canonical negative put convention; explicitly entered zero remains valid. A changed value is stored with `manual` provenance and a capture timestamp. Quote refresh, maintenance, and lifecycle resolution preserve it.

Contract-identity edits clear automatically captured contract Delta and entry/market snapshots. An explicitly manual Delta remains durable unless the user clears or replaces it.

## Sources of truth and precision

- **Sold Price** is the canonical net per-share option premium and retains JavaScript numeric precision, including four or more decimals.
- **Premium** is derived as `Sold Price * contracts * 100`.
- **Gross Risk** is `strike * contracts * 100`.
- Premium is not independently editable. Legacy stored Premium, realized P&L, percent captured, final value, and days-held fields are reconciled from canonical trade/lifecycle fields on Add/Edit.

A broker's exact aggregate Premium can differ by a cent from a rounded per-share Sold Price. Entering the more precise net Sold Price is the supported reconciliation path; there is no second Premium override.

The form previews Premium, Gross Risk, Net Risk, Breakeven, Original DTE, Entry NY, and Entry AY. Historical records also preview Price @ Exp., final option value, realized P&L, and realized IRR when those values are already resolved or directly known.

## Pending resolution and requests

- Cached held-to-expiration Save: zero provider acquisitions.
- Cold held-to-expiration Save: at most one chart-history acquisition.
- Closed / Bought Back Save: zero expiration acquisitions.
- Opening Edit or History: zero expiration acquisitions.
- Notes/Entry Delta edits on an unchanged resolved or pending trade: zero expiration acquisitions.

Lookup failure never blocks trade creation. The durable record enters `expired_price_pending` with a warning and remains eligible for explicit Portfolio Maintenance.

## Edit persistence architecture

The prior bug came from spreading an edited trade over archived redundant fields. Sold Price changed, but stale stored `premiumCollected`, `realizedPnl`, `percentCaptured`, and `daysHeld` still won in History helpers after the cloud write.

All Add/Edit writes now pass through canonical realized-economics reconciliation before Portfolio persistence. History/group/summary helpers also calculate from canonical Sold Price, contracts, close economics, and expiration resolution first, using stored realized values only where the model has no derivation (such as established assignment economics or limited legacy fallback).

The resulting Portfolio namespace mutation continues through the Stage 7A in-memory account adapter, revision/CAS update, rollback on conflict, and cloud-authoritative bootstrap. There is no durable browser fallback or local/cloud merge path.
