# Put Scanner UI Overhaul — Stage UI-4

## Scope and baseline

UI-4 completes the Screener, ETF Pulse, and cross-site mobile/landscape interaction pass on top of commit `1496afe` (`style: refine portfolio and watchlist review workflow`). It is presentation and interaction polish only: financial formulas, request scope, filtering semantics, persistence, routes, refresh behavior, and all UI-1–UI-3 product workflows remain intact.

The deterministic harness is `e2e/ui-overhaul-ui4.visual.spec.ts`, invoked with `npm run visual:ui4 -- before|after`. It covers 1440×900, 1280×800, 1024×768, 430×932, 390×844, 375×667, 844×390, and 667×375. Every capture writes an overflow report.

Before artifacts were captured from the clean UI-3 baseline in `e2e-artifacts/ui-overhaul/ui4/before/`. After artifacts are in `e2e-artifacts/ui-overhaul/ui4/after/`.

## 1. Screener before critique

The baseline had a single heavy filter card with no visible distinction between criteria that changed the fetched dataset and criteria that only re-filtered loaded rows. The Load action competed with VIX and the long control row. After loading, result count and dataset scope were easy to miss, while contract identity required reconstructing ticker, expiry, and strike across distant columns. Mobile had a good sheet model but little loaded-state context.

## 2–9. Screener changes

- Added a compact “Define the scan” header and scope summary without introducing a hero.
- Grouped ETF/expiration as “Fetch scope — Changes require Load” and Delta, moneyness, yield, OI, volume, and IV-vs-realized-range as “Refine loaded data — Updates instantly.” Existing controls and values are unchanged.
- Preserved desktop workstation density while aligning control tops; phone widths retain the existing filter sheet and 44px controls.
- Added loaded-contract context showing raw contracts, visible rows after local filters, the loaded ETF/expiration scope, pending scope changes, and calm incomplete-batch status.
- Kept Load visually primary but compact; loading retains geometry and exposes bounded progress, while retry remains a secondary action after a partial scan.
- Added a two-line ticker/expiry/strike identity anchor to the sticky Symbol cell. Existing financial-table alignment, sorting, Bid/Ask/Last, spread, volume, OI, canonical Annualized Secured-Cash Yield labels, and drawer behavior remain unchanged.
- Partial failure remains calm and useful: successful rows stay primary and Retry failed results remains available. Fatal failure and empty results preserve their existing copy and recovery actions.

## 10. ETF Pulse before critique

Pulse originally mixed title, Market Read, freshness, filters, and refresh into a cramped header, then placed the timeframe selector far below the table. Cold load collapsed into a single text line. Mobile cards exposed the correct data but repeated dense tiles and gave the market-read block disproportionate height.

## 11–17. ETF Pulse changes

- Added a compact regime-overview subtitle and kept Market Read integrated in the title/control plane.
- Added one deliberate control rail containing the performance window, current universe count, active-filter count, sort field, and sort direction. The existing mobile period and filter controls remain available.
- Added a reserved loading table geometry, semantic `role="status"` readiness signal, progress percentage bar, and updating freshness state. Rows do not collapse while cold acquisition runs.
- Preserved the current table/heatmap/momentum interaction model. Desktop rows use shared financial-table rhythm and restrained striping; numeric columns remain tabular and right-aligned.
- Mobile Pulse keeps identity first (ticker/name/price/trend), selected-period movement second, and RSI/MA/drawdown support third with quieter dividers and no new metrics.
- Cached/revisit, partial, stale, and error states keep useful rows visible and use the shared status language. Market Read remains the existing data and request surface.

## 18. Landscape findings

Phone landscape remains the mobile product model at 844×390 and 667×375. The compact header and 42px navigation leave usable content; Pulse controls remain horizontally bounded; bottom-nav clearance, sheets, chart/drawer headers, and table wrappers show no page-level overflow.

## 19. Cross-site mobile-shell changes

The shared shell now clips accidental route-root overflow while preserving explicit table scrolling. Existing sticky mobile headers, safe-area padding, bottom-navigation clearance, selected-state treatment, and route gutters remain consistent across Scanner, Screener, Watchlist, Portfolio, Detail, and Pulse. No navigation destination was added or removed.

## 20. Keyboard/input findings

Existing 16px phone inputs and 44px targets remain intact. The new deterministic interaction check opens Screener and Pulse filter sheets, types into their real search inputs, verifies Escape closes each sheet, and confirms focus restoration. Existing Option Drawer calculator, Account email, Analyze Ticker, and Portfolio input coverage remains covered by the product suite.

## 21. Overlay interaction findings

No UI-2 Option Drawer or UI-1 Account redesign was needed. Existing backdrop, body scroll lock, Escape handling, close controls, focus trapping/restoration, safe-area padding, and z-index behavior remain the shared implementation. Market Read continues to use the same modal contract.

## 22. Sticky/scroll findings

Sticky navigation and mobile control offsets were checked in portrait and landscape. Wide Screener/Pulse data stays inside explicit overflow wrappers; route roots do not pan horizontally. Sticky ticker identifiers and table headers remain available where the existing architecture supports them.

## 23. Touch-target findings

The harness and product suite exercise real nav links, filter controls, Load/Run Screener, Pulse filters/refresh, sort controls, row links, option-detail opening, and drawer/overlay close actions. Phone controls retain at least 44px targets.

## 24–26. E2E timeout investigation

- Pulse root cause: the UI-3 product test waited on `.last()` of a generic loading-text locator. Desktop keeps a hidden mobile loading node in the DOM, so the selector resolved to a hidden element; after the loading copy changed, the wait timed out. The fix is a semantic visible `role="status"` with `aria-label="ETF Pulse loading"`, and the test now waits on that signal.
- Account root cause: the earlier Account timeout was a cascading test-server/browser lifecycle failure after the Pulse wait aborted the page, not an Account product defect. The complete deterministic desktop product suite now reaches signed-out, synced, and conflict Account states successfully.
- Product bug vs harness bug: this was a harness readiness/selector bug, so production behavior was not changed to add arbitrary delay. No timeout was increased.

## 27–30. Cross-site visual result

Legacy one-off styling was not reintroduced. New page-specific classes reuse semantic tokens, `PageHeader`, `surface-card`, `surface-inset`, `financial-table`, `status-badge`, and `overlay-panel`. Typography stays system sans with tabular lining numerals; borders, radii, shadows, and status colors map to the existing four-theme roles. Dark, Dark Blue, Light, and Sepia Screener/Pulse captures are present, plus portrait and landscape Pulse theme captures.

## 31–32. First-pass critique and second pass

The first pass still aligned the two Screener group labels against a bottom-aligned flex row and left the Pulse loading state dependent on text. The second pass aligned filter tops, reserved the Pulse table geometry, moved timeframe/sort context into one rail, added semantic loading readiness, and re-ran the visual matrix. Remaining intentional density is limited to wide financial tables and the existing Pulse visualizations.

## 33. BEFORE/AFTER screenshot locations

- Before: `e2e-artifacts/ui-overhaul/ui4/before/`
- After: `e2e-artifacts/ui-overhaul/ui4/after/`
- Representative Screener: `desktop-1440x900/screener-initial.png`, `screener-populated.png`, `screener-partial-failure.png`, `screener-option-drawer.png`
- Representative Pulse: `desktop-1440x900/pulse-loading.png`, `pulse-populated.png`, `pulse-market-read.png`, `pulse-error-existing-data.png`
- Mobile shell: `portrait-390x844/mobile-screener.png`, `mobile-pulse.png`; landscape: `landscape-844x390/mobile-pulse.png`
- Themes: `desktop-1440x900/theme-{dark,dark-blue,light,sepia}-{screener,pulse}.png` and matching portrait/landscape `theme-*-mobile-pulse.png`

## 34–37. Validation

- `npm run visual:ui4 -- after`: 9 Playwright tests pass (8 viewport projects plus the focused phone interaction check); all overflow reports are clean.
- `npm run test:e2e -- e2e/product.spec.ts --project=desktop-1440x900`: 6/6 product scenarios pass, including request-count, metric, cloud-boundary, Pulse cancellation, and Account states.
- Full product matrix: 13 applicable scenarios pass across the configured viewports; 35 existing viewport-guarded scenarios are skipped with 0 failures.
- Final repository checks pass: typecheck, 304 tests with 0 failures, 93/93 self-checks, all responsive guardrails, the production build, and `build:report`. Lint retains only the repository’s three pre-existing Fast Refresh warnings.

## 38. Remaining UI weaknesses

The Screener/Pulse tables remain intentionally wide on desktop and require contained horizontal scanning. Pulse heatmap tiles still inherit the data’s strong semantic color range, and the mobile Pulse route is necessarily long for the full ETF universe. These are bounded trade-offs; no new metrics, charts, requests, or product capabilities were added.

## 39. Recommended UI-5 review scope

UI-5 should be an independent design-director review of the complete product: compare UI-1 through UI-4 as one system, challenge whether the remaining wide-table and visualization density is justified, review four-theme contrast and hierarchy, and inspect the captured before/after states plus real interaction paths. Do not begin that review as part of UI-4.
