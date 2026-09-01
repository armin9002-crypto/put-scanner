# Put Scanner mobile design-director audit — Stage 3

Stage 3 is the final whole-app mobile density pass after the Stage 1 financial-table and Stage 2 discovery-density work. The objective was to remove clear mobile waste and clipping while preserving the existing data model, canonical NY/AY/IRR calculations, request boundaries, durable cloud state, and overlay architecture.

## Design principles

- Dense but calm: use padding, composition, grouping, and disclosure before reducing type size.
- Comparison surfaces use compact rows/tables; discovery surfaces may remain cards.
- Phone landscape is a real mode, not a narrow desktop afterthought: preserve horizontal table workflows, freeze only the identity column, and keep vertical chrome short.
- Every mobile action remains touch-safe, keyboard/iOS-safe, and reachable above the bottom navigation.
- Secondary option and analytics detail stays in the existing drawer/disclosure paths.
- Compact rules are scoped to phone portrait or the explicit phone-landscape breakpoint (`max-height: 520px`, `max-width: 950px`).

## Audit matrix

The first pass covered 375×667, 390×844, 430×932, 667×375, 844×390, and the 1024×768 tablet boundary. The deterministic UI-5 matrix also retained 1440×900 and 1280×800 desktop references.

| Route / surface | Viewport | Finding | Severity | Approved fix | Files |
| --- | --- | --- | --- | --- | --- |
| Scanner | All phone sizes | Compact discovery rows already expose identity, quote, four periods, IV60, liquidity, and assets; no blocking density issue. | P2 | Preserve Stage 2 composition. | `HomePage.tsx`, `MobileEtfRow.tsx`, `index.css` |
| Screener | Portrait + landscape | Ready/error/no-match states sat farther from the results toolbar than necessary. | P1 | Add explicit compact state hooks; use 2rem portrait / 1rem landscape block padding. | `ScreenerPage.tsx`, `index.css` |
| Screener | All phone sizes | Filter, load, retry, sort, and result-row hierarchy remain clear and touch-safe. | — | No behavioral change. | `ScreenerPage.tsx` |
| Watchlist | 375/390/430 portrait | The shared first cell could visually prioritize ticker, strike, and expiry instead of shrinking them beside the star. | P1 | Give the identity column more minimum width and stack identity fields in portrait. | `MobileOptionRow.tsx`, `index.css` |
| Watchlist | 667/844 landscape | Ticker/strike/expiry were clipped to unreadable fragments in the first identity cell. | P0 | Widen the landscape identity column and use an inline identity layout while retaining the independent star target. | `MobileOptionRow.tsx`, `index.css` |
| Portfolio | Portrait | Stage 1 grouped position/history disclosures, analytics disclosure, and action sheet remain compact and readable. | — | Preserve. | `PortfolioPage.tsx` |
| Portfolio | 667/844 landscape | The shell title and desktop page title repeated, consuming scarce vertical space. | P1 | Hide only the repeated inner title/description in phone landscape, retain freshness and every action, and reduce frame top padding. | `index.css` |
| Portfolio Analytics | Phone portrait/landscape | Disclosure-first analytics keeps secondary concentration/timing/policy content local and reachable. | — | Preserve existing disclosure. | `PortfolioPage.tsx` |
| Portfolio Maintenance | Phone portrait/landscape | Existing bottom-sheet/modal flow has bounded viewport height, scroll, and explicit recovery actions. | — | No new overlay work. | `PortfolioMaintenanceModal.tsx`, `index.css` |
| ETF Pulse List | Phone portrait/landscape | Stage 2 rows now flow compactly while retaining trend, performance, RSI, and support context. | — | Preserve Stage 2. | `EtfPulsePage.tsx`, `index.css` |
| ETF Pulse Heatmap/Momentum | Phone portrait/landscape | Card/heatmap composition is intentional for spatial comparison; no clipping or broken view ownership found. | P2 | Deliberate non-fix. | `EtfPulsePage.tsx`, `UniverseHeatmap`, `MomentumQuadrant` |
| Ticker Detail / Option Chain | All required sizes | Instrument warnings, expiry controls, six-column phone chain, and wide landscape table remained legible. | — | Preserve table-first architecture. | `OptionsPage.tsx`, `MobileOptionRow.tsx` |
| Option Drawer | 390/844 reference plus landscape | Full-screen phone trade sheet keeps primary quote, canonical yield/risk data, calculator, and action reachable. | — | Preserve existing sheet. | `OptionDetailDrawer.tsx` |
| Add/Edit Sold Put | Phone portrait/landscape | Existing trade sheet uses dynamic viewport bounds, 44px controls, scroll, and visible save/cancel actions. | — | No redesign; verify through product E2E. | `PortfolioPage.tsx`, `index.css` |
| Import Screenshot / Data Backup | Phone portrait/landscape | Existing modal flows remain bounded and confirmation-oriented. | — | No new functionality or overlay framework. | `PortfolioScreenshotImportModal.tsx`, `DataBackupModal.tsx` |
| Account / sign-in / cloud loading-error | Phone portrait/landscape | Body portal, safe-area sizing, internal scroll, focus restoration, and truthful cloud conflict/retry states remain intact. | — | Preserve Stage 7A architecture. | `MobileAccountSheet.tsx`, `AccountControl.tsx`, `CloudSyncSection.tsx` |
| History grouped/ungrouped | Portrait + landscape | Collapsed groups, compact rows, chart, and sticky identity column remain consistent with Schedule. | — | Preserve existing local grouping/sorting. | `PortfolioPage.tsx`, history components |
| Mobile shell / bottom nav | All phone sizes | Contextual header, utility Account control, safe-area padding, selected state, and fixed five-destination nav remain usable. | — | No destination removal. | `App.tsx`, `MobilePageHeader.tsx`, `index.css` |

## Findings by priority

### P0

- Watchlist and Screener shared option rows could clip the primary identity cell. On phone landscape the ticker/strike became unreadable fragments, which is a direct usability failure. The identity cell now has an explicit hierarchy and a wider landscape allocation; the star remains an independent control.

### P1

- Screener initial, error, and no-match states had unnecessary vertical padding below the results toolbar. The state surface now uses named hooks with a shorter rhythm in portrait and an even tighter rhythm in phone landscape.
- Portfolio phone landscape repeated the shell title in the inner desktop `PageHeader`. The inner title/description are hidden only in the semantic phone-landscape media query; freshness and the full action toolbar remain available.

### P2

- Heatmap/Momentum remain visually card-heavy because spatial comparison is their purpose.
- Empty-state pages still contain expected unused viewport area when there are no rows. Removing the content-height shell or inventing filler would make the state less calm and would alter navigation behavior, so this is intentionally not changed.
- Long Watchlist notes wrap to preserve the complete note; truncating them would hide review context.

## Changes made

- Recomposed `MobileOptionRow` identity markup into ticker, strike, and expiry roles.
- Increased the shared phone identity column minimum and introduced a wider inline phone-landscape identity allocation.
- Added explicit compact Screener state classes and responsive block padding.
- Removed duplicate Portfolio page title/description only in phone landscape and tightened the frame/header chrome.
- Added Stage 3 source guardrails in `tests/mobile-design-audit-stage3.test.mjs` and extended `scripts/responsive-checklist.mjs`.

No formulas, labels, lifecycle rules, persistence, cloud requests, provider behavior, universe membership, or overlay architecture changed.

## Portrait guidance

At 375–430px, keep primary financial rows around 48–56px where possible, stack identity metadata rather than shrinking it into an unreadable line, and use the drawer/disclosure for secondary Greeks, IV, OI, and volume. Maintain 44px controls and dynamic viewport/safe-area padding. Scanner and Pulse remain card/list discovery surfaces; Option Chain, Watchlist, Schedule, and History remain comparison surfaces.

## Landscape guidance

At 667×375 and 844×390, keep the shell header near 40px, bottom navigation near 42px, and eliminate repeated titles/descriptions. Wide tables may scroll horizontally, but only the ticker identity column is sticky and opaque. Actions must remain reachable without forcing a portrait-style stacked toolbar, and sheets must stay within `96dvh` with internal scrolling.

## Comparative measurements

Measurements below come from deterministic visual artifacts; counts are reported only where the harness captured a reliable visible set.

| Surface at 390×844 | Before/reference | Final | Notes |
| --- | ---: | ---: | --- |
| Scanner cards visible | 4 | 5 | Stage 2 compact row result; cards remain readable. |
| Pulse List items visible | — | 6 | Final row height 86.5px; page overflow false. |
| Pulse loading skeletons visible | — | 6 | Skeleton height 50.6px; page overflow false. |
| Option Chain contracts visible | — | 2 | 48px rows plus 30px header. |
| Portfolio active rows | — | 4 | Stage 1 fixture; collapsed rows ~55–56px, first expanded row is intentionally taller. |
| Portfolio History rows | — | 4 | Stage 1 fixture; collapsed summary rows 50px. |
| Watchlist rows | — | 4 | Final fixture rows retain ticker, strike, expiry, star, quote state, and notes. |
| Screener results | — | Initial state | The dedicated initial state is measured for chrome/overflow; result counts depend on the explicit Run Screener action. |

Scanner Stage 2 reference reduced the representative populated card from roughly 103px / four visible cards to 76px / five visible cards. The Stage 3 Watchlist identity correction does not reduce row height; it restores readable identity information at the same compact density.

## Second design-director pass

The post-fix review re-ran the deterministic UI-5 whole-app matrix and focused UI-3 Watchlist/Portfolio matrix. The clipped identity fragments were gone at 390 portrait and 667 landscape; Portfolio landscape now shows one shell title with the complete action toolbar; Screener state content sits closer to Results. Desktop 1440/1280 and tablet 1024 references retained their existing page/table compositions.

Remaining weaknesses are deliberate: Heatmap/Momentum are comparison cards, empty states have calm unused space, long notes remain readable rather than truncated, and the phone-landscape wide-table model still asks users to horizontal-scroll secondary fields.

## Verification and artifacts

- Source/unit guardrails: `npm test` (231 passing tests after Stage 3 additions), `npm run responsive:check` (all guardrails pass).
- Dedicated whole-app matrix: `npm run visual:ui5 -- final` across 375×667, 390×844, 430×932, 667×375, 844×390, tablet 1024×768, and desktop references. Artifacts: `e2e-artifacts/ui-overhaul/ui5/final/`.
- Focused financial matrix: UI-3 after-run across portrait and landscape projects. Artifacts: `e2e-artifacts/ui-overhaul/ui3/after/`.
- Stage 2 Scanner/Pulse references remain under `e2e-artifacts/ui-overhaul/ui4/after/` and the Stage 1 Option/Portfolio references under `e2e-artifacts/ui-overhaul/ui2/after/` and `ui3/after/`.
- Full product browser E2E, production build, typecheck, lint, build report, and request ledger are run as the final handoff checks.
