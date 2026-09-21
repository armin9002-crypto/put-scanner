# Compact portrait financial tables

Portrait Options uses `src/components/mobile/MobileFinancialTable.tsx` and the
`.mobile-financial-table*` styles in `src/index.css`. One contract is one semantic
`tr`; every metric occupies a consistent column. Screener and Watchlist still use
their existing `MobileOptionRow` presentation and are intentionally not migrated.

The shared component owns the labeled, keyboard-focusable native scroll region,
table, colgroup, and column headers. Surface-specific columns supply a key, label,
and Small-size width in rem. Surfaces render their own rows/cells and actions;
the first column alone uses `mobile-financial-table-identity`. Use a scoped row
header, a focusable row with Enter/Space selection, and ignore bubbled keyboard
events from nested actions. Actions stop click propagation. The divider helper
uses one colSpan cell with a horizontally sticky label.

The Options route is a viewport-height flex column. Its existing safe-area-aware
header, expiration controls, sort bar, and evidence notices occupy their actual
height; the table scroll region fills the remainder. The header cells stick at
top zero inside that region. There is no measured offset, duplicate safe-area
padding, scroll synchronization, transform, observer, or new request path.
Empty/error states retain route scrolling. AppShell's Options bottom-spacing
exception and Option Detail's home-indicator handling remain unchanged.

Header/body share a fixed-layout native table and scaled colgroup widths. Only
Strike freezes left, with an opaque theme background and a separation edge.
The corner header layers above frozen body cells and the scrolling headers.
Rows are 34px at Small, approximately 36.7px at Medium, and 39.4px at Large.
Financial text is 12px times the existing text scale, with tabular numerals.

Column order: Strike, Last, Bid, Ask, Delta, IV, Moneyness, AY Last, AY Bid,
AY Ask, Last Trade. Optional NY Last/NY Bid/NY Ask and Volume/OI/Vol-OI follow
to the right. The compact Columns disclosure uses the existing preference/state
handlers. A 390px Medium viewport fits Strike and the three quotes plus Delta.
Strike includes the compact independent watchlist star.

The current-price divider appears at the strike/underlying boundary for both
strike sort directions, including before/after the chain when appropriate.
Sorting remains local. Selection passes the original enriched option object to
the unchanged drawer, preserving exact expiration, contract identity, and Add to
Portfolio semantics. Freshness, calculated Delta, moneyness, and integrity retain
their canonical colors, titles, and accessible descriptions without extra lines.

## Verification

`e2e/mobile-option-table.spec.ts` replaces the old card-era
`option-chain-sticky.visual.spec.ts`. Run with the existing deterministic visual
market/account fixture environment and the repository Playwright server:

```powershell
$env:VITE_UI_VISUAL_FIXTURES='true'
$env:VITE_SUPABASE_URL='https://visual-fixture.supabase.co'
$env:VITE_SUPABASE_PUBLISHABLE_KEY='sb_publishable_visual_fixture'
npx.cmd playwright test e2e/mobile-option-table.spec.ts --project=portrait-390x844
```

The focused suite changes viewport internally: 320/375/390/430px, all three
text sizes, Dark and Light, landscape 844x390, tablet 1024x768, desktop 1440x900.
It checks row density, column alignment, sole frozen Strike, sticky header,
contained overflow, native touch and keyboard scrolling, independent star,
exact contract/expiration detail, scroll restoration, optional columns, current
price divider, no sorting requests, and no Options bottom-nav spacing.
Screenshots are written to each test's output directory for visual inspection.

Standalone QA simulates 59px top and 34px bottom insets using the existing header
and sheet padding properties; physical iOS standalone/browser chrome is not
emulated. Device Home-Screen confirmation remains a manual check. The manifest,
viewport-fit, Apple metadata, AppShell, and financial/provider/cache systems were
not modified.

Implementation verification passed the focused browser checks, Options/mobile
and integrity Node tests, responsive guardrails, typecheck, targeted lint,
production build, and build report. The Stage 3 mobile source guard confirms
that Portfolio contains no retired `Import Screenshot` label.
