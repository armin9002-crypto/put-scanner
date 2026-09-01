# Portfolio History Semantics and Entry Snapshot Lifecycle

Implementation date: 2026-08-30

This refinement changes Portfolio financial semantics and the minimum History controls needed to expose them. It does not change the durable schema, add market-data retention, or redesign the Portfolio surface.

## Entry Delta and Entry IV lifecycle

Entry Delta and Entry IV are frozen properties of one durable `PortfolioTrade`, identified by its unique `id`. They are never properties of a display group or merely a ticker/strike/expiration tuple. Two trades in the same contract therefore retain independent values through grouping, quote refresh, maintenance, edits, archive, backup/restore, and cloud CAS. Entry IV uses percentage points: `65.4` means `65.4%`.

The audited creation paths are:

- Options/detail creation reuses its already-loaded exact chain and captures Delta plus IV synchronously with no extra request.
- Manual **Add Sold Put** exposes no current-entry snapshot fields. It performs at most one cache-first exact-contract lookup before the initial durable add, uses one exact row for both Delta and IV, and then writes the final trade once. Failure leaves both values unavailable but never prevents the valid trade from saving.
- Same-day brokerage screenshot imports perform the same bounded capture for each newly created durable trade; historical imports remain ineligible.
- JSON restore preserves a supplied valid snapshot but performs no lookup.

Automatic capture requires an open position entered on the current New York market date, a valid exact ticker/expiry/strike, and a contemporaneous non-stale chain. Provider Delta is preferred with the established calculated fallback; IV comes from the same row's normalized `impliedVolatility`. Current data is never used to repair an old position. Zero-request historical recovery is limited to actual stored `entrySnapshot.delta` and `entrySnapshot.iv` values.

**Historical Add / Edit Sold Put** exposes optional Entry Delta and clearly labeled **Entry IV (%)** fields. Supplying or changing a value stores `manual` provenance and a new override timestamp. Leaving an existing value unchanged preserves its value, source, and timestamp across unrelated edits. Explicitly clearing a field removes its value and metadata; it does not trigger an automatic refill because capture is creation-time behavior. Current quote refresh changes only `latestMarketData.delta` / `.iv` and cannot replace either durable entry value.

Archive/lifecycle transitions spread the original trade fields, so Entry Delta, Entry IV, and provenance remain in realized History. Schema-v1 Portfolio normalization, backup-v2, restore, cloud validation, canonical comparison, and Stage 7A CAS all retain the optional fields without a migration. Identity changes invalidate provider/calculated/stored snapshot values, while explicit manual historical values are retained.

## Expired ITM and Assigned

The states are genuinely different and remain separate, including their History filters:

- **Expired ITM** is the terminal expiration economic result calculated from the underlying expiration close (or nearest prior trading close). It means assignment is likely, but Put Scanner has no broker confirmation.
- **Assigned** records user-confirmed assignment. Confirmation requires broker information that cannot be inferred from the expiration price.

An Expired ITM trade can have expiration payoff and realized option P&L. An Assigned record participates in realized-return analytics only when its durable record contains complete realized P&L economics; assignment share lots and later stock disposition are not modeled.

## Total Realized IRR

Total Realized IRR is a combined, date-aware, money-weighted XIRR. It is not an average of position IRRs.

For every History trade with known realized P&L, the established cash-secured convention produces two cash flows:

```text
entry date:      -original Net Risk
resolution date: +original Net Risk + realized P&L
```

This is economically equivalent to posting Gross Risk while receiving Premium at entry, then receiving the released collateral net of close cost or expiration payoff at resolution. Cash flows on the same date are aggregated across all positions. XIRR solves the combined NPV using actual dates and a 365.25-day year.

Pending records and Assigned records without known realized economics are excluded. Invalid/non-positive capital, malformed or reversed dates, same-day-only flows, no History, no positive/negative flow pair, no real root in the supported domain, or multiple real roots produce unavailable. The solver never substitutes a weighted average of individual IRRs.

Per-position Realized IRR remains available with its existing formula. Average Days Held retains its current arithmetic and is displayed to one decimal place.

## Entry Delta and notional summaries

**Wtd. Avg. Entry Delta** uses canonical historical Gross Risk:

```text
sum(entryDelta × Gross Risk) / sum(Gross Risk with known Entry Delta)
```

Delta retains its sign. A valid zero participates. Missing values are excluded from both weighted numerator and denominator rather than treated as zero. Coverage is `Gross Risk with known Entry Delta / total historical Gross Risk` and is exposed quietly in the card context. With no known Delta, the result is unavailable.

**Total Historical Notional** is the sum of canonical Gross Risk (`strike × 100 × contracts`) across every closed/history position. It is not Net Risk, current value, or premium-adjusted exposure. Canonical positive contract quantities prevent signed cancellation.

**Wtd. Avg. Entry IV** uses the same Gross Risk weighting and coverage rule as Entry Delta. Only finite Entry IV values greater than zero participate; missing/invalid values are excluded from numerator and denominator rather than treated as zero. Year, Expiry, Underlying, and headline summaries all reuse the same canonical helper.

## Trade mode and chart date semantics

The automatic Add/Edit mode compares date-only expiration strings with the current `America/New_York` market date. Expiration before that date defaults to Historical; expiration today or later defaults to Open. Every valid expiration change recomputes the mode, including the Save & Add Another historical-to-future regression. 0-DTE remains Open.

The monthly realized chart groups resolved trades by option expiration `YYYY-MM`, not close, resolution, or archive month. Early closes therefore remain in their contract's expiration month, years remain distinct, losses are included, and pending rows are excluded. The existing `N months` label counts distinct displayed expiration-month buckets after filtering; it is not a rolling horizon.

## History grouping and fields

History supports **Year**, **Expiry**, **Underlying**, and **None**, with local component default **Year**. No new durable preference or account state is introduced. Year is the option expiration year, not entry, close, or archive year. It is one aggregate level, not nested expiries. Invalid expiration data maps deterministically to **Unknown**. Every group reuses canonical History realized P&L and reports trade/contract totals.

History field semantics are:

- **NY**: entry Premium divided by original Net Risk through the canonical Portfolio Entry NY helper; it never uses current quotes.
- **VIX @ Entry**: the existing stored `entryVixClose` only. Rendering performs no lookup; explicit Portfolio Maintenance remains the enrichment path.
- **Expiration**: the actual option expiration date.
- **Entry Date**: the actual written/sold date.
- **Price @ Exp.**: the durable underlying close used for expiration resolution. It is the close on the expiration date when available, otherwise the nearest prior trading close with source/warning metadata. It is normally unavailable for positions closed early.
- **Final Value**: stored expiration option payoff, or the known close cost for a closed trade. The helper and durable field remain because lifecycle/P&L/backup/tests use them; a later UI-only pass may remove the displayed table column.

User-facing `Premium Collected` wording is now `Premium`; persisted property names and arithmetic are unchanged.

## Request and authority boundaries

All History summaries, grouping, NY, stored VIX, Price @ Exp., and Entry Delta displays are pure calculations over durable data. They issue no render-time requests. Entry capture retains the Stage 6B.4 request ceiling. Supabase remains the only signed-in durable authority under Stage 7A; no local durable account database, namespace, migration, or CAS behavior changes.
