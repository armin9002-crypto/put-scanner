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


## Motion V2 follow-up

Actual starting HEAD: `2e805bde5a942f18684bc692439fd73746a3af8a`; the named V1 prerequisite is HEAD itself, with no later commits. The existing user-authored `AGENTS.md` changes were read and preserved.

Source audit confirmed 110/170ms tokens, 1px control/card lift, .99 press, 5px modals and 6px sheets/drawers. Lift was limited to instrument, market and heatmap cards; recommendations, position summaries, tabs and rows used color feedback. Scanner snapshot tooltips reused the modal entrance; freshness tooltips used opacity. Charts kept their existing period/metric controls and spatially static data. All added movement was gated by no-preference, with global reduced-motion protection retained.

V2 uses 90/150/210ms tiers and emphasized easing with a quick start and soft settle. Lift is 2px; cards have a modestly deeper shadow. Press reaches .985 immediately, then releases in 90ms: a timed press was rejected after actual short-tap testing showed it could disappear before reaching its target. Modals enter by 8px, sheets/drawers by 12px; compact snapshot tooltips have their own 3px/90ms entrance. Non-tab quote segments are explicitly excluded from scaling. The final interaction review removed a redundant inline instrument-card shadow that masked the hover elevation; the shared surface class preserves its resting shadow. No layout, financial, request, persistence, chart-rendering or dependency changes were made.

The existing motion test now checks V2 amplitudes and samples the actual CSS overlay entrance halfway through its 210ms duration. Desktop and phone checks retain four themes, Small/Large text, keyboard focus, actual touch taps, still rows and reduced motion. The existing dense-theme/chart/request-isolation test supplies representative cross-route regression coverage. V2 results: all four representative Playwright checks passed (1.5 minutes); `npm run verify` passed, including 353 unit tests, typecheck, selfcheck, responsive checklist, production build and lint (zero errors, four existing warnings). The production bundle report passed. Physical iOS testing is outside this browser-emulation run.
