# UI Overhaul Stage UI-1

## Scope and baseline

UI-1 establishes the global visual foundation without changing routes, financial calculations, market-data requests, cloud sync, persistence, or product features. The requested starting commit `881afc0` is an ancestor of the working baseline `5441288`; the intervening commit adds deterministic request observability and browser e2e coverage and does not change the product direction.

The rendered audit used production-mode Vite output, system Chrome, Playwright route interception, deterministic market fixtures, seeded Watchlist/Portfolio data, and visual-only Account fixtures. It did not use Yahoo, Supabase, or production data.

## Before assessment

The application was functionally mature and information-rich, but the visible system read as page-by-page accumulation. Dark mode was usable, while typography, surface weight, gutters, controls, status, and table language varied enough that users had to re-learn visual structure across routes. The product looked engineered first and designed second.

### Top visual inconsistencies

1. Desktop used condensed Arial-like typography while phone layouts used the native system stack, making the two shells feel like different products.
2. Scanner opened with three similarly heavy full-width surfaces—Analyze, search, and filters—before the primary instruments, so control chrome competed with data.
3. Screener had no desktop page title/context and its VIX card wrapped the filter row into a roughly 260px band with large unused space.
4. Desktop navigation utilities sat immediately after route links instead of balancing the shell at the right edge.
5. Active navigation, theme controls, bottom navigation, and page-local segmented controls used several unrelated selected-state treatments.
6. Pages used unrelated maximum widths (1280, 1400, 1600, and 1800px) and three gutter conventions.
7. Themes exposed only coarse `bg/surface/border` roles; raised, inset, subtle border, and emphasized border semantics were missing.
8. `--border-strong` was referenced by overlays but not defined in the token layer.
9. Dark, Dark Blue, Light, and Sepia used materially different border/shadow strength, especially very weak Dark Blue separation and comparatively strong neutral-dark outlines.
10. ETF cards used a shadow plus a thick three-pixel performance border, producing heavier chrome than their financial content required.
11. Financial numbers used a strongly code-like monospace treatment nearly everywhere; label/value hierarchy was often solved with weight and saturated color.
12. Inputs and selects ranged from 32 to 44px with inconsistent focus behavior and one-off radii.
13. Freshness appeared as dotted-underlined microcopy rather than the same restrained status language used elsewhere.
14. Tables differed in header height, casing, hover language, row separators, and numeric typography across Screener, Watchlist, Options, Portfolio, Pulse, and import modals.
15. Account, chart, detail, and bottom-sheet overlays used different backgrounds, radii, shadow strength, and close-button treatments.

Additional findings included over-boxed chart metric strips, inconsistent empty-state padding, excessive all-caps section labels in some routes, and phone active navigation relying on color alone.

## Implemented foundation

### Token architecture

`src/index.css` now defines primary/secondary/elevated/inset backgrounds, three text levels, three border levels, interaction colors, semantic financial/status colors, a small radius scale, and separate contained/overlay elevation. Legacy variables resolve to the semantic system for staged page migration.

### Typography and numbers

Desktop and mobile now use one system sans stack. Data classes use tabular lining figures without forcing a source-code aesthetic. Page titles, supporting copy, section labels, status, and table headers have explicit shared roles.

### Spacing, radius, and elevation

Shared page frames normalize gutters and standard/wide maximums. Regular surfaces use 12px radii and nearly flat elevation. Controls use 8px radii, compact desktop heights, and 44px phone targets. Strong shadow is limited to overlay panels.

### Application shell

The desktop shell is 52px, uses an accent-bordered brand mark, clearer active route treatment, and right-aligned theme/account utilities separated by a subtle divider. Phone headers and bottom navigation use the same surface hierarchy, with a selected container that does not add routes or change safe-area behavior.

### Shared headers and primitives

`PageHeader` and `SectionHeader` provide title, description, metadata, and action slots. Screener, Watchlist, and Portfolio now use the shared page-header language. CSS primitives cover page frames, surfaces, buttons, statuses, financial tables, and overlays.

### Controls and interaction

Inputs/selects share border transition, focus halo, and radius. Primary, secondary, ghost, and icon treatments are explicit. Hover is restrained and static; focus is keyboard-visible; reduced motion remains honored.

### Cards, tables, charts, and overlays

Scanner cards use two-pixel semantic range emphasis, subtle border, and minimal elevation. Every product data table and table-bearing modal uses the shared financial table foundation. Chart calculation/rendering is unchanged; its modal now uses the common overlay surface. Option drawer, Account dialog, mobile sheets, and shared tooltips use the overlay token and close-control language.

### Wasted-space reductions

- Screener VIX sparkline changed from 160×60 to 120×36 and the filter group uses tighter, non-wrapping wide-desktop spacing.
- Analyze Ticker loses one layer of desktop padding and uses 40px desktop/44px phone controls.
- Options price-header padding and section gap are reduced.
- Shared status badges replace detached dotted timestamps.
- Page gutters and header/action rows no longer create inconsistent empty side bands.

## Theme findings

- **Dark:** now uses neutral stepped charcoal surfaces and quieter borders; financial colors remain legible without neon dominance.
- **Dark Blue:** surface and border steps are strengthened enough to match Dark hierarchy while retaining the navy identity.
- **Light:** the cool gray canvas separates white content objects with restrained borders and minimal shadow.
- **Sepia:** warm surfaces keep the same elevation/border hierarchy; accent and semantic colors are moderated for paper-like contrast.

All four themes share geometry, hierarchy, focus, selected, positive/negative, and overlay behavior.

## Deterministic screenshot workflow

Run from the repository root:

```bash
npm run visual:ui1 -- before
npm run visual:ui1 -- after
```

The command builds production-mode assets with `VITE_UI_VISUAL_FIXTURES=true`, starts local Vite preview at `127.0.0.1:4317`, intercepts every market request with `e2e/fixtures/marketApi.ts`, seeds local durable records, and captures with system Chrome.

Screenshots are ignored local QA artifacts:

- Before: `e2e-artifacts/ui-overhaul/before/<viewport>/`
- After: `e2e-artifacts/ui-overhaul/after/<viewport>/`
- Overflow checks: `e2e-artifacts/ui-overhaul/<phase>/overflow-report-<viewport>.json`
- Playwright failures/traces: `e2e-artifacts/test-results/`

Covered viewports:

- 1440×900 and 1280×800 desktop
- 1024×768 tablet
- 430×932, 390×844, and 375×667 portrait
- 844×390 and 667×375 landscape

The 1440 matrix includes Scanner/default+active filters, Screener empty+populated, Watchlist, Portfolio collapsed+expanded+history, ticker detail/table, option drawer, ETF Pulse, signed-in Account fixture, representative empty/error states, and all four themes. Phone and landscape runs cover their required core routes and overlays.

## Validation

UI-1 validation includes:

- `npm run verify`
- `npm run responsive:check`
- `npm run build:report`
- `npm run test:e2e`
- `npm run visual:ui1 -- after`

Final results:

- `npm run verify`: passed. TypeScript passed; 304 unit/integration tests passed; 93/93 self-checks passed; responsive guardrails passed; the production build passed.
- Lint completed with 0 errors and the same 3 pre-existing `react-refresh/only-export-components` warnings in `ExpirationFilter.tsx` and `theme.tsx`.
- `npm run responsive:check`: all 34 automated responsive guardrails passed.
- `npm run build:report`: passed; production exclusion guards confirmed that development fixtures and cloud-sync test harnesses are absent from the feature-disabled bundle.
- `npm run test:e2e`: 13 applicable browser scenarios passed across the eight configured viewport projects; 43 deliberate project/visual-capture skips; 0 failures.
- `npm run visual:ui1 -- before` and `npm run visual:ui1 -- after`: 8/8 viewport captures passed in each phase, producing 39 PNGs and 8 overflow reports per phase.
- Every after-capture surface reported `pageOverflow: false` at 1440×900, 1280×800, 1024×768, 430×932, 390×844, 375×667, 844×390, and 667×375.

The visual harness keeps fixtures local and does not alter Supabase, Vercel configuration, or production state.

## Deliberately unchanged

- Financial formulas, labels, definitions, price basis, expiration selection, and sort/filter behavior.
- Scanner/Screener acquisition architecture and request budgets.
- Watchlist and Portfolio durable schemas and lifecycle behavior.
- Supabase authentication, cloud sync, conflict recovery, and backup semantics.
- Routes, navigation destinations, and feature inventory.
- Chart calculations and data-series construction.

## Recommended UI-2 scope

UI-2 should focus on Scanner and ticker detail composition using this foundation:

1. Re-evaluate Scanner control ordering and the relationship between Analyze Ticker, search, filters, market strip, freshness, and results.
2. Refine instrument-card information hierarchy and responsive column behavior without removing metrics.
3. Redesign ticker-detail price/volatility/holdings grouping as one composition.
4. Refine expiry navigation and option-table primary/secondary cells while preserving columns, density, and preferences.
5. Polish Scanner/ticker-detail empty, loading, stale, and partial-error states.
6. Re-run the same before/after matrix and do not begin Screener/Portfolio deep composition until their dedicated stages.
