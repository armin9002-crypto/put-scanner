# Historical Analytics restoration

Historical Analytics is restored to the pre-redesign experience, with restrained motion layered on top.

## References and scope

- Approved baseline: `106fd983ba9a013e2dba1304bc5d8058278504d7`.
- Starting local and remote `main`: `90e3e1c84b6d43052ff938185a32d9471bcfc135` (`upgrade historical analytics interactions`). Remote `main` was checked before editing.
- These were adjacent commits. All 17 files in their diff were inspected; none overlapped the five unrelated local modifications.
- Restoration used the historical file contents, not a blind whole-worktree revert. No changes to `PortfolioPage`, placement, financial formulas, durable account data, provider APIs, or dependencies.

## Change classification

| Files from the rejected commit | Decision |
| --- | --- |
| `src/components/RollingHistoricalAnalyticsChart.tsx` | Restore baseline architecture, information hierarchy, controls, geometry, labels, metadata and pointer/touch inspection; add keyed presentation layers for approved arrivals. |
| `src/index.css` | Restore only the baseline Historical Analytics styles, remove the entire 2.0 block, then add scoped line depth and motion. Shared styles otherwise match baseline. |
| `src/lib/historicalVisibleRange.ts` | Restore L3M/L6M/L1Y/L2Y/Since Inception and their original display-only slicing semantics. |
| `src/lib/rollingHistoricalAnalytics.ts` | Restore six rolling metrics and remove the unused rolling Blended Capture implementation. |
| `src/lib/optionsNavigation.ts` | Remove only the rolling Blended Capture allowlist addition. |
| `src/lib/historicalChartGeometry.ts` | Delete the redesign-only abstraction; restore the component's original single-series helpers. |
| `scripts/responsive-checklist.mjs` | Restore the baseline source guardrail. |
| `tests/historical-analytics-v11.test.mjs`, `tests/historical-visible-range.test.mjs`, `tests/rolling-historical-analytics.test.mjs`, `tests/xapp-011-options-navigation.test.mjs` | Restore original expectations. |
| `tests/historical-chart-geometry.test.mjs`, `tests/rolling-blended-capture.test.mjs`, `e2e/historical-analytics-v2.spec.ts` | Delete rejected-product tests. |
| `e2e/rolling-historical-analytics.visual.spec.ts` | Restore baseline expectations; freeze time to the fixture's September 2026 date for deterministic execution. |
| `docs/ROLLING_HISTORICAL_ANALYTICS_MODEL.md`, `docs/UI_ROLLING_HISTORICAL_ANALYTICS.md` | Restore baseline methodology and UI documentation; document only the approved polish. |

No independent correctness fix from `90e3e1c` required retention. In particular, canonical Blended Capture in the separate History summary/realized-history chart predates the redesign and remains unchanged. Other app timeframes are untouched.

New verification files are `e2e/historical-analytics-restoration.spec.ts` and `e2e/fixtures/historicalAnalyticsBaseline.json`; this report is also new.

## Restored product

The compact heading again shows Historical Analytics · Rolling, the complete rolling metric title beside its value, its methodological subtitle, and full baseline coverage metadata. Hover/held touch can temporarily drive the inspection context. The right-side Visible Range and grouped Analytics selectors, 3M/6M/12M buttons, and Portfolio State Point in Time treatment are restored.

Rolling metrics are Realized AY, Entry AY, Annualized Premium Run Rate, Entry Delta, Entry IV, and Original DTE. Portfolio State remains Gross Risk Exposure and Avg Remaining DTE. No Average Days Held metric was added.

Removed: separate Series/Metric architecture, Compare, View Data/dialog, methodology control/overlay, horizontal control scroller, YTD/3Y/All range presentation, rolling Blended Capture, pinning and pin-specific keyboard traversal, comparison geometry/legend, Gross Risk micro-bars, High/Low/Current-only labels, calendar-boundary axis rewrite, new area/step/gap/island semantics, and persistent explanatory keys.

The original straight line segments, temporal value-label selection, actual-observation X labels, lighter dotted gap bridges, partial-window prefixes, state rendering, tooltip content, latest marker and immediate pointer coordinates are restored. Baseline held-touch inspection dismisses on release; it does not pin.

## Approved polish

- New real path: shared 320ms chronological clip reveal and 210ms opacity arrival on initial mount or metric/window/range change.
- Value labels: 210ms opacity arrival; axes remain immediate.
- Line depth: original color and identical path geometry, 4.5px under-stroke at 9% opacity (5.5% for dotted gap bridges). No blur, filter, glow or fill.
- Tooltip: shared 90ms opacity/3px entrance, immediate dismissal.
- Crosshair and the existing inspection/latest marker: one-shot 90ms opacity arrival. Positions never transition; no scaling, rings, loops or pulses.
- Existing controls: shared 150ms color, background and border feedback; no geometry changes.
- Reduced motion: all new animations/transitions are absent; final states appear immediately. The static restrained under-stroke remains.

No dependencies, timers, animation frames, observers, request paths, persistent state or animation-driven financial recalculation were added. The original resize observer and memoized financial series remain.

## Verification evidence

- All 611 Node tests passed, including focused Historical Analytics and History/Portfolio regressions.
- Typecheck passed; all 94 self-checks passed; responsive guardrails and request ledger passed.
- Production build and build report passed. Lint passed with zero errors and four pre-existing React Refresh warnings outside this change. The initial sandboxed build could not read the Vite config; the authorized build outside the sandbox succeeded.
- Captured the exact restored baseline before adding motion, then compared 50 final states: 1440×900, 320×844, 375×812, 390×844, 430×932 and 844×390 at Small/Medium/Large text, plus eight metrics in Dark/Light/Sepia/Dark Blue.
- The final fingerprints match the baseline's section/plot dimensions, control rectangles/content, heading, original financial paths, and every axis/value label. The added under-stroke is intentionally excluded from the original-path comparison. Reference fingerprints are committed and required; a clean checkout cannot silently skip the comparison. They record system Chrome on Windows with the fixed fixture date.
- No page or controls overflow across the 18 viewport/text-size cases; baseline native `pan-y` remains. Layout, section height and location are unchanged.
- Browser interactions cover all eight metrics, all three windows, all five ranges, partial/missing/unavailable observations, hover context/reset, held-touch inspection/dismissal, native vertical scrolling, tooltip containment, real CSS animation timelines and reduced motion.
- Browser counters verify zero additional market requests or cloud requests during metric/window/range/inspection interactions. Fabricated fixtures intercept acquisition and account requests; unmocked external traffic is blocked in the restoration suite.
- The restored original visual regression also passed. Screenshots and detailed local logs are in ignored `e2e-artifacts/historical-restoration/`.

Financial helpers, navigation allowlist and Portfolio pages were compared directly with `106fd983`. Canonical Entry/Realized AY, risk weighting, Premium partial-window annualization, rolling calendar windows, realization dates, lifecycle semantics, and ETF scope remain unchanged.

## Unrelated local work

The initial local changes to `.bolt/prompt`, `README.md`, `docs/LEGACY_SUPABASE_ARTIFACTS.md`, `docs/SUPABASE_STAGE4_LIVE_TEST.md`, and `docs/UI_MOTION_QA.md` are excluded from this restoration. Their SHA-256 content fingerprints are checked again before committing.

The release commit and Vercel Production status/SHA are reported with the delivery, after verification and push.
