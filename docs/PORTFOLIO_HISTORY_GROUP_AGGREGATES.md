# Portfolio History Group Aggregates

Implementation date: 2026-08-30

`buildHistoryGroupAggregates` is the sole financial aggregate model for grouped Portfolio History rows. `buildHistoryGroups` applies it unchanged to Year, Expiry, and Underlying buckets. The helper returns unformatted numbers; presentation and rounding belong to the UI.

## Additive fields

| Field | Canonical group value |
|---|---|
| Trade count | Number of History rows in the group. |
| Contracts | Sum of positive contract quantities. A standard equity-option contract remains 100 shares. |
| Gross Risk | Sum of `historyGrossRisk`, which delegates to the established `strike × 100 × contracts` helper. It is historical cash-secured notional and never uses a current quote. |
| Premium | Sum of canonical historical Premium. |
| Realized P&L | Sum of known canonical realized P&L values; unavailable when no row has known realized economics. |

## Weighted fields

| Field | Weight | Formula and rationale |
|---|---|---|
| Wtd. Avg. Days Held | Gross Risk | `sum(daysHeld × Gross Risk) / sum(known-days Gross Risk)`. This represents time at risk by historical exposure. |
| Wtd. Avg. NY | Original Net Risk | `sum(Entry NY × original Net Risk) / sum(known-NY original Net Risk)`. History NY is canonically `Premium / original Net Risk`, so this reconciles to `known Premium / known original Net Risk`. Gross-Risk weighting would change the established NY economics. |
| Wtd. Avg. VIX @ Entry | Gross Risk | `sum(stored entry VIX × Gross Risk) / sum(known-VIX Gross Risk)`. Only durable `entryVixClose` participates. |
| Wtd. Avg. Entry Delta | Gross Risk | Reuses the established historical Entry Delta helper: `sum(signed Entry Delta × Gross Risk) / sum(known-Delta Gross Risk)`. A valid zero participates. |
| Wtd. Avg. Realized IRR | Gross Risk | `sum(position Realized IRR × Gross Risk) / sum(known-IRR Gross Risk)`. This is an exposure-weighted average of individual position IRRs. It is not Total Realized IRR, group XIRR, or a combined money-weighted return. |
| Wtd. Avg. % Captured | Premium | `sum(position % Captured × Premium) / sum(known-capture Premium)`. Because canonical `% Captured = realized P&L / Premium`, complete applicable rows reconcile to `aggregate realized P&L / aggregate Premium`. Negative results and values above 100% remain valid and are not clamped. |

## Missing values and coverage

Missing and non-finite metric values are excluded from both the weighted numerator and that metric's denominator. They are never converted to zero. A known metric value of zero remains valid. Non-positive or unavailable weights cannot form a denominator. A weighted value is `null` when its valid denominator is zero.

VIX @ Entry and Entry Delta expose quiet coverage ratios:

```text
Gross Risk represented by known values / total valid group Gross Risk
```

Coverage is `null` when total valid Gross Risk is zero. Entry Delta continues to expose its underlying known and total Gross Risk through `calculateHistoryWeightedEntryDelta`; group consumers receive the coverage ratio from the canonical aggregate model.

## Deliberately unaggregated fields

The model does not total or average Strike, Sold Price, Entry Date, Expiration Date, Price @ Expiration, outcome/status, ticker identity, or any other field without a coherent group financial meaning. Year remains the option expiration year, not the entry, close, or archive year.

## Request and persistence boundaries

All inputs are durable History fields and existing local financial helpers. Building, switching, expanding, or collapsing groups causes zero browser requests, zero Vercel invocations, zero provider acquisitions, and zero Supabase writes. The helper does not mutate Portfolio records or change the durable schema, cloud authority, lifecycle states, position-level formulas, or Total Realized IRR.
