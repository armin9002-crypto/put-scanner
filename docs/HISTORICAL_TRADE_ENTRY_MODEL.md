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

The existing bounded Yahoo chart request asks for `div`, `splits`, and `capitalGains`. Put Scanner normalizes only `split`, `dividend`, and `capital_gain`, and checks the interval after the sold date through expiration: `(soldDate, expiration]`. An action before entry or after expiration does not block; an action effective on the sold date is assumed to be reflected in the contract terms available for trading that day.

| Provider result during the contract window | Policy |
|---|---|
| No normalized action and valid event coverage | Resolve from the unadjusted underlying close. |
| Forward split or reverse split | Pending. Strike, contract count, multiplier, or deliverable may have changed. |
| Yahoo `dividend` | Pending. Ordinary dividends normally do not adjust listed options, but Yahoo supplies only date and amount and does not distinguish ordinary, special, liquidation, return-of-capital, or other potentially adjustable cash distributions. |
| Yahoo `capital_gain` | Pending. OCC generally adjusts fund-share options for qualifying capital-gain distributions even when regularly scheduled. |
| Missing/invalid event coverage | Pending. |

This policy knowingly prefers some false-positive pending states over false historical P&L. OCC generally does not adjust options for ordinary cash dividends, but makes non-ordinary and special-distribution decisions case by case. The current Yahoo payload cannot prove that a `dividend` event was ordinary: known ordinary and OCC-adjusting special distributions have the same `{ amount, date }` shape, and an ETF capital-gain distribution may also be aggregated under Yahoo `dividends`. Whitelisting that label would therefore be unsafe.

The provider taxonomy is not an OCC contract-adjustment record and does not identify every merger, spinoff, rights distribution, liquidation, symbol/security change, or nonstandard deliverable. `provider_no_actions` means no normalized split/dividend/capital-gain event in the checked window; it is not a universal guarantee that no other contract event existed. Put Scanner does not guess an adjusted strike or deliverable.

Successful automatic resolution stores `provider_no_actions` basis provenance and the checked-from entry date. A later economic edit may reuse that close only when the marker covers the contract life. Any surfaced action or unverifiable coverage saves the trade as Expiration Price Pending for explicit Portfolio Maintenance. Existing realized History is never rewritten automatically.

The expiration comparison continues to use Yahoo `indicators.quote[0].close`, not `adjclose`. A standard historical strike is compared with the actual unadjusted underlying close on expiration (or the nearest prior trading close); Yahoo adjusted close deliberately rewrites earlier prices for splits and distributions and is not a substitute for knowing the option contract terms.

References: [Yahoo adjusted-close definition](https://help.yahoo.com/kb/SLN28256.html), [OCC Characteristics and Risks of Standardized Options](https://www.theocc.com/company-information/documents-and-archives/options-disclosure-document), [OCC cash-dividend and distribution guidance](https://www.theocc.com/getmedia/21ed2c99-ab15-472a-aef1-a142f140e2b7/Interpretative-Guidance-on-the-Adjustment-Policy-for-Cash-Dividends-and-Distributions.pdf), [OCC contract-adjustment information memos](https://infomemo.theocc.com/infomemo/search).

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
