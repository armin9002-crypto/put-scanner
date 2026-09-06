# Premium microinteraction pass

Starting HEAD: `95bb3268fe82ec231e5cf72e4325bca55dba89bf` (completed text-size architecture). Work began on clean `main`.

## Behavior

- Reuses `--transition-ui`, `.pressable`, semantic surface/border colors, hover/focus styles and the existing global reduced-motion protection.
- Adds 110ms fast / 170ms medium durations and restrained UI/lift easing tokens.
- Enabled shared buttons lift 1px on fine-pointer hover and press to .99 with immediate feedback. Disabled controls do not lift. Touch layout dimensions remain unchanged. Nav and utility selected-state colors remain intact.
- Instrument, market-context and Pulse heatmap links receive small lift/border/shadow feedback. Recommendation summaries and editable position affordances use existing backgrounds with short transitions. Static analytical surfaces remain still.
- Table rows, mobile discovery/option rows and sortable headers do not scale or translate. Tabs and segmented controls transition colors, backgrounds, borders and opacity.
- Custom Account, trade/editor, maintenance, backup, chart, holdings, methodology, evidence, market-read and option overlays use brief entrances. Separate backdrops fade; integrated backdrops animate their background color so children do not fade twice. Modal movement is 5px, sheets/drawers 6px. No retained exit state or interaction delay.
- Existing glass stays sparse. Navigation/header surfaces have solid fallbacks when backdrop filtering is unsupported. No new blur on cards/tables.
- Charts retain their existing rendering, data values, period behavior and scrolling. No counting, interpolation, route entrances, delayed loading/error states or financial recomputation.
- New spatial motion only exists under `prefers-reduced-motion: no-preference`. The existing global reduction still handles other transitions/spinners. Dialog centering and chart-positioning transforms are preserved by using individual CSS translate/scale properties.
- No dependencies, requests, animation timers, RAF loops or permanent will-change hints were added. No request ledger was needed because request code is untouched.

## Verification and artifacts

Repository Playwright/Chrome harness: desktop 1440x900 and phone 390x844. The in-app browser connection was unavailable. Fixtures contain deterministic synthetic data only.

The existing route/overlay matrix covers Scanner, Screener, Recommendations, Watchlist, Portfolio, Options and Pulse at Small, Medium and Large. Additional checks cover chart tooltips, portfolio analytics/history, account inputs, persistence, request isolation and Light/Sepia dense layouts. Motion checks cover Dark, Dark Blue, Light and Sepia, keyboard focus, mouse hover/down, actual emulated mobile taps, unchanged touch layout height, still mobile discovery rows, Account entrance names and reduced-motion removal of scale/lift/entrance animation.

Rendered screenshots are in ignored `e2e-artifacts/text-size/final/` and `e2e-artifacts/text-size/motion/`. Representative desktop/phone screenshots were visually inspected, including Large text, option rows, recommendations, portfolio, Pulse, Account sheets and Dark Blue navigation. Browser emulation is not physical iOS device testing. Motion assertions verify computed styles; screenshots capture final layout rather than a video of animation timing.

Required commands: `npm test`, `npm run verify`, `npm run responsive:check`, `npm run build:report`, and the existing text-size visual suite with its added motion regression. The final visual run passed all six tests (2.6 minutes), producing 104 route/chart captures plus 16 motion/theme captures. The unit suite passed all 353 tests. Final `verify`, `responsive:check`, and production `build:report` passed. Lint reports zero errors and four existing Fast Refresh warnings. The production asset guard confirms visual fixtures are excluded. Commit/remote status is reported with delivery. The responsive script emits the project's checklist; rendered overflow assertions run in Playwright.

## File scope

- `src/index.css`: shared motion tokens, scoped controls/cards/overlays, glass fallbacks; replaces old broad touch scaling and unused fade utility.
- AccountControl, MobileAccountSheet, MobileBottomSheet, DataBackupModal, PortfolioMaintenanceModal, InteractivePriceChartModal, OptionDetailDrawer, RecommendationEvidenceDrawer and UnderlyingHoldingsModal: CSS class hooks only.
- PortfolioPage: modal/backdrop class hooks. EtfPulsePage: shared heatmap/backdrop classes. OptionsPage: removes card scaling. WatchlistPage: replaces 95% compression with shared feedback.
- `e2e/text-size.visual.spec.ts`: extends existing fixture-based visual tests with motion assertions.
- `docs/UI_DESIGN_SYSTEM.md` and this report: document the resulting conventions and QA scope.
