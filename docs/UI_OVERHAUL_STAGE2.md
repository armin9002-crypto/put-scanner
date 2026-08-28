# UI Overhaul Stage UI-2

## Scope

UI-2 refines the discovery workflow from Scanner to ticker detail to the option drawer. The work is presentation-only: calculations, request behavior, filtering semantics, routes, persistence, and data contracts are unchanged.

## UI-2 baseline

The dedicated deterministic capture lives under `e2e-artifacts/ui-overhaul/ui2/before/`. It covers the required viewport matrix: 1440×900, 1280×800, 1024×768, 430×932, 390×844, 375×667, 844×390, and 667×375.

Captured states include populated/default Scanner, active filters, a different expiry, loading, partial/error, leveraged ETF detail, normal ETF detail (SPY), expiry switching, the option table, and desktop/mobile drawer states with a populated calculator. The fixture does not contain a separate stock Analyze Ticker scenario; that asset-aware path remains covered by the existing product suite.

## Scanner critique before implementation

- Analyze Ticker occupied the strongest top-of-page surface even though it is a secondary utility.
- Search, filters, expiry, market context, and freshness competed as several similarly weighted boxes.
- Market cards were useful but read as four independent panels rather than one context rail.
- ETF cards were compact, but the ticker, price, performance, and supporting metadata had near-equal visual weight.
- The desktop result grid started below a tall control area, reducing useful above-the-fold comparison.

## Scanner changes

- Added a shared `PageHeader` composition with a compact secondary Analyze Ticker utility.
- Grouped SPY, VIX, QQQ, and VXN into one market-context rail with a single freshness affordance.
- Reframed expiry, search, leverage, type, sort, liquidity, and snapshot update as one compact “Opportunity set” control plane.
- Added a quiet active-control summary and a dedicated scanner freshness/error line.
- Added a result section header that states what to compare before drilling into a chain.
- Improved empty results with an inline explanation and Reset filters action.
- Refined ETF cards with stable minimum height, an identity/price primary column, a separated comparison metric column, and restrained hover/focus cues.
- Preserved all existing ETF metrics, tooltip detail, links, retry behavior, and filters.

## Detail and drawer changes

- Gave ticker detail a compact identity header and kept leverage/warning context subordinate to the chain.
- Styled the price, sparkline, performance, IV-vs-realized-range, holdings, and refresh controls as one metric rail.
- Added an explicit Expiry label and made DTE buttons a compact, scannable navigation row.
- Added a Put chain header with contract count, selected expiry, freshness, and row-drilldown guidance.
- Strengthened table surface, strike anchor, row rhythm, and selected-row continuity without removing columns or changing sorting.
- Styled the drawer as a continuation of the selected row: shared semantic surfaces, a quiet anchored header, a dominant first economics value, crisp quote selection, and an integrated calculator.
- Kept the mobile layouts purpose-built: horizontal expiry navigation, thumb-sized option rows, full-screen drawer, and reachable calculator controls.

## Second critique and polish pass

After the first implementation capture, the review found three remaining heavy areas: the control-plane border, the detail metric rail’s lower controls, and the drawer’s key-figure grid. Three areas still wasting space were the old scanner top stack, the option chain’s headerless blank lead-in, and excess drawer section padding. Hierarchy issues remained around the Analyze label, the selected expiry, and the primary option economics. The 390px drawer also needed a more obvious selected quote state. No horizontal overflow or sticky overlap appeared in the first capture.

The second pass reduced those containers, introduced the single market rail/control-plane reading order, added the chain header, separated ETF card columns, emphasized the first drawer economics tile, and tightened drawer section/quote styling. Mobile and landscape rules were preserved rather than squeezing the desktop grid.

## Visual QA

- Before: `e2e-artifacts/ui-overhaul/ui2/before/`
- After: `e2e-artifacts/ui-overhaul/ui2/after/`
- Representative after captures: `desktop-1440x900/scanner-default-populated.png`, `desktop-1440x900/detail-leveraged-etf.png`, `desktop-1440x900/option-drawer-calculator.png`, and `portrait-390x844/option-drawer-mobile.png`.
- The four theme captures are in `desktop-1440x900/` as `theme-light-*`, `theme-dark-*`, `theme-sepia-*`, and `theme-dark-blue-*`.
- Every capture wrote an overflow report; all completed UI-2 projects passed without page-level horizontal overflow.

## Reusable system decision

No new global design-system primitive was established. UI-2 reuses the UI-1 `PageHeader`, `SectionHeader`, `surface-card`, `surface-inset`, semantic status badges, button variants, table language, and overlay language. The new classes are intentionally page/workflow-specific, so `docs/UI_DESIGN_SYSTEM.md` does not need a page-specific expansion.

## Validation

The focused visual workflow and full UI-2 matrix pass in both `before` and `after` modes. TypeScript and ESLint pass (with the repository’s existing three Fast Refresh warnings). The full verification, responsive, build-report, E2E, and regression commands are recorded in the final handoff.

## Remaining weaknesses

The scanner card grid still contains many repeated metrics on very wide screens, and the desktop option table remains intentionally horizontally dense. A future pass could add richer asset-aware detail fixtures and progressive disclosure for less frequently used quote columns, but those are outside UI-2.

## Exact UI-3 scope

UI-3 should address the next workflow surface only after a new written brief and baseline: extend the same visual system to the Watchlist → Portfolio review workflow, including its desktop/tablet/mobile composition, stale/error states, and deterministic screenshots. UI-3 must not begin as part of UI-2.
