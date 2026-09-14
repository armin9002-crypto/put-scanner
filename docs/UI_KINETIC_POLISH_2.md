# UI / motion / interaction polish 2.0

Starting HEAD: `3557d0f` (scoped agent configuration). Existing edits to `.bolt/prompt`, `QA_CHECKLIST.md`, `README.md`, `docs/LEGACY_SUPABASE_ARTIFACTS.md`, `docs/SUPABASE_STAGE4_LIVE_TEST.md`, and `docs/UI_MOTION_QA.md` were preserved.

## Interaction language

The existing composition, dimensions, density, typography, four themes, text-size preferences, calculations and acquisition paths remain intact. The CSS-first vocabulary now includes:

- 320ms directional entrances: 24px for modals, 48px for sheets, 64px for drawers, using the existing emphasized easing. Opening never waits for animation before enabling controls.
- 140ms coordinated panel/backdrop dismissal for option analysis, charts, evidence, shared mobile sheets, Account, backup, maintenance and Market Read. The original dialog retains focus containment and scroll locking during its exit. Actions are suppressed after dismissal is requested. Repeated closes are deduplicated; identity replacement/unmount cancels pending work. Closing during entrance snapshots the current compositor state rather than jumping to the resting position.
- Selection markers that expand within existing navigation and segmented controls, rotating disclosure chevrons, contained detail reveals, and contact edges on dense rows. Existing two-pixel hover lift and immediate .985 press response remain canonical.
- An accent activity edge driven solely by existing refresh state on Scanner market context, Portfolio metrics, ETF Pulse and Recommendations. It is not a progress percentage or a success/freshness claim.
- A chronological reveal of the actual returned chart path, retaining immediate axes, labels, warnings and displayed-timeframe semantics. Summary values crossfade as complete strings; they never count through invented prices or percentages.

No animation framework, observers, per-row animation state, persistent loops, new provider calls or permanent `will-change` hints were added. Reduced motion removes spatial treatments and bypasses dismissal waiting, including when the preference changes during an exit.

## Coverage and deliberate limits

Shared controls and overlays cover Scanner, Options, Screener, Watchlist, Pulse, Recommendations and Portfolio. Targeted disclosure adoption covers mobile positions, history, Recommendation frontiers, Screener popovers and historical import source details. Account and chart opening/closing were checked separately; chart initial focus now goes to Close instead of opening a freshness tooltip over the controls.

Dense table bodies, deterministic ordering, warning/provenance labels, chart calculations, import staging/commit behavior and financial workflow callbacks remain immediate. Successful saves and workflow actions do not wait on the dismiss animation. Import dialogs receive the stronger shared entrance; their transactional close/commit lifecycles are not rewritten for animation. Static analytical surfaces do not float or animate on every render.

## Verification

Browser work used the repository's Playwright/Chrome harness with deterministic synthetic market/account fixtures and external traffic blocked. The in-app browser connection failed at initialization. The baseline was used at desktop and phone sizes before implementation. A built fixture app was then used for repeatable final checks.

- Route/interaction walkthroughs: 1440×900 desktop, 1024×768 tablet, 390×844 phone portrait, 844×390 phone landscape. Scanner chart opening, option drawer opening/closing, all seven primary routes and page overflow checks passed.
- Reviewed dismissal regressions: all four viewports passed. Tests interrupt an entrance at 80ms, verify that the CSS exit starts at the captured visible state, attempt an action after closing begins, check repeated Escape, request isolation, focus restoration and reduced motion. The desktop nested Evidence → Option Drawer regression passed.
- Existing dense-content/text-size/request-isolation browser checks passed on desktop and phone, covering loaded Portfolio/Watchlist, charts and display preferences.
- Existing motion checks passed on desktop and phone in Dark, Dark Blue, Light and Sepia, including real emulated taps (pressed-state sampling during contact), unchanged touch targets, visible focus and reduced motion. The explicit Scanner market refresh test passed with exactly four existing market-context requests and no animation-triggered acquisitions.
- Typecheck, production build, bundle/fixture-exclusion report, lint (zero errors; four existing Fast Refresh warnings), responsive source guardrails, request ledger and 94/94 selfchecks passed.
- The broad Node run executed 532 tests: 529 passed initially. The motion-related exact-class assertion was updated and passed; the Recommendation performance case passed in isolation. One untouched test remains failing: `tests/portfolio-phase-a-derived-metrics.test.mjs:81` compares `0.058870967741935475` with `0.05887096774193548` using strict equality. Its imported financial modules and test were not changed. Consequently `npm run verify` is not reported as wholly green; its remaining stages were executed separately.

The configured independent Reviewer identified two edge cases (actions during dismissal and interruption snapping); both were fixed, covered by browser regressions and re-reviewed with no remaining actionable findings. Physical iOS/device performance is outside this Chrome-emulation verification.

Screenshots and logs are retained under ignored `e2e-artifacts/kinetic/` and `e2e-artifacts/text-size/`. The reusable regression lives in `e2e/kinetic-polish.spec.ts`; the updated existing motion test lives in `e2e/text-size.visual.spec.ts`.
