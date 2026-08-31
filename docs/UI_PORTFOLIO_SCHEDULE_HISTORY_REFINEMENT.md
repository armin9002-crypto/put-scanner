# Portfolio Schedule + History density refinement

Implementation date: 2026-08-30

This focused presentation pass keeps Portfolio economics, lifecycle behavior, durable fields, and request behavior unchanged.

## Schedule of Positions

- The new **Show Entry Deltas** checkbox sits between Show Nominal Yield and Show OI / Volume.
- It is unchecked by default and is session-only, matching the transient presentation behavior of the neighboring OI / Volume and Notes / Errors controls. It does not add an account preference or change durable Portfolio data.
- When unchecked, the table header is **Current Delta** and each row shows only the canonical current option-chain Delta plus its existing freshness line. The compact column width reclaims the old two-value width.
- When checked, the pre-existing **Entry / Current Delta** presentation returns, including historical Entry Delta provenance, missing-value handling, and freshness semantics.
- Phone active-position rows use the same display state. The control remains a 44px touch target; unchecked rows prioritize Current Delta while checked rows restore Entry Delta detail.

## History groups

History group rows consume `buildHistoryGroupAggregates` without reimplementing weighting in JSX. Desktop columns now include **Gross Risk**, and group subtotal cells align with the columns they summarize:

- additive Contracts, Gross Risk, Premium, and Realized P&L;
- Gross-Risk-weighted Days Held, VIX @ Entry, Entry Delta, and individual-position Realized IRR;
- canonical Entry NY weighting and Premium-weighted % Captured.

Missing optional fields remain `—`; zero remains a valid value. Strike, Sold Price, dates, prices at expiration, outcomes, and actions remain blank in subtotal rows because they have no meaningful group aggregate. The group Realized P&L cell receives the strongest semantic emphasis. Its weighted IRR cell has a tooltip describing it as a gross-risk-weighted average of individual position Realized IRRs, distinct from the headline Total Realized IRR/XIRR.

Year, Expiry, and Underlying groups expose **Collapse All** / **Expand All**. The action operates only on the active grouping and keeps each individual disclosure button available. Group = None remains a flat table with no bulk control. Phone group headers use a compact hierarchy: identity/trade count, P&L, Premium/Risk, then the key weighted values.

## Header compaction

The Portfolio subtitle “Sold-put positions, capital exposure, and lifecycle analytics.” was removed. The existing title, freshness metadata, actions, and summary retain their hierarchy without a replacement sentence or spacer.
