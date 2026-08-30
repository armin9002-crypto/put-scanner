# UI Yield / Risk Nomenclature Reversal

Date: 2026-08-30

This release restores Put Scanner's canonical NY / AY terminology across the
current UI. It is a presentation-only change: calculations, quote selection,
sorting, filtering, persistence, requests, and schemas are unchanged.

## Terminology map

| Previous visible label | Canonical visible label |
|---|---|
| Secured Cash Yield / Secured-Cash Yield | Nominal Yield |
| SCY | NY |
| Ann. Secured-Cash Yield | Annualized Yield |
| Ann. SCY | AY |
| Show Secured Cash Yield | Show Nominal Yield |
| Gross Secured Cash | Gross Risk |
| Net Maximum-Loss Capital | Net Risk |
| Entry Net-Risk Return | Entry NY |
| Ann. Entry Net-Risk Return | Entry AY |
| Remaining Liability / Entry Net Risk | Current NY |
| Ann. Remaining Liability / Entry Net Risk | Current AY |
| Weighted Ann. Entry Net-Risk Return | Entry Wtd. Avg. AY |
| Weighted Ann. Remaining Liability / Entry Net Risk | Current Wtd. Avg. AY |

The compact option-table variants are `NY Last`, `NY Bid`, `NY Ask`, `AY Last`,
`AY Bid`, and `AY Ask`. The full tooltip variants use `Nominal Yield` and
`Annualized Yield`.

## Formula-preservation guarantee

No financial expression was changed. The existing `calculateSecuredCashYield`
and `calculateAnnualizedSecuredCashYield` helpers still use gross strike cash; portfolio Entry NY/AY
and Current NY/AY still use the same net-risk denominators and DTE values; and
the distinct remaining-AY-to-maturity calculation remains distinct. Internal
names such as `calculateSecuredCashYield`, `originalAnnualizedYield`, and
`netCapitalAtRisk` remain for compatibility and are not user-facing contracts.

## Option Drawer change

The Option Detail Drawer no longer renders either of these rows in desktop or
mobile position sections:

- `Net-Risk Return`
- `Annualized Net-Risk Return`

The underlying position metrics remain available to the calculation layer.
The drawer now presents `Gross Risk`, `Net Risk`, `Nominal Yield`, and
`Annualized Yield` where applicable.

## Surfaces audited and updated

- Scanner and ticker option-chain tables, headers, mobile cards, quote
  tooltips, and yield visibility controls.
- Option Detail Drawer, including desktop and phone layouts.
- Screener filters, sort controls, criteria summaries, empty states, and
  result cards.
- Watchlist sort controls and shared option-row labels.
- Portfolio summary cards, mobile metrics, schedule headers, sort headers,
  analytics bars, group tooltips, close-candidate labels, and history tooltips.
- Shared quote-display and metric-contract labels, so every consumer receives
  the same canonical copy.

## Tooltip and definition terminology

Current tooltips use `Gross Risk`, `Net Risk`, `Entry NY`, `Entry AY`,
`Current NY`, and `Current AY`. Formula text still identifies the exact
denominator (for example, entry net risk versus current net risk) so the
shorter labels do not hide a change in arithmetic.

## Mobile / iOS audit

Phone option rows, mobile sort menus, mobile filter sheets, mobile Portfolio
metrics, and the mobile Option Drawer were checked for the shorter NY/AY labels.
The shorter labels preserve the existing grid density and avoid introducing
new wrapping or horizontal overflow at 390×844 and 844×390.

## Intentional remaining occurrences

Internal identifiers and helper names retain historical terminology where
renaming would alter durable contracts (for example `calculateSecuredCashYield`
and `grossSecuredCash`). Formula prose may also say “gross secured cash” or
“cash-secured put” when describing the denominator or product mechanics rather
than a UI label. Older Stage 6A/6B audit documents intentionally preserve the
terminology that was accurate for those historical snapshots. These remaining
occurrences are not rendered labels and do not change application behavior.
