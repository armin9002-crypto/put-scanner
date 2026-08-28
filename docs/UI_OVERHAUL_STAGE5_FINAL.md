# UI-5 final design-director review

UI-5 reviewed the rendered product at commit `e9db89f` as an external design team would: the earlier stage documents were treated as intent, not proof. The baseline and final reviews used deterministic data across eight viewports, four themes, primary routes, overlays, and representative loading, partial, stale, and unavailable states. No financial or product behavior was changed.

## 1. Initial overall UI-5 score

**7.9 / 10.** The product already had a coherent, trustworthy workstation foundation, but a small group of conspicuous presentation defects still made parts of it look assembled rather than directed: truncated book metrics, weak landscape composition, an oversized Account sheet, noisy inactive sort chrome, and unclear access to the far-right columns of wide tables.

## 2. Initial route-by-route scores

| Surface | Initial | Primary limitation |
| --- | ---: | --- |
| Scanner | 8.0 | Different desktop gutter from adjacent routes; first landscape result started too late |
| Screener | 7.4 | Filter labels/group captions wrapped and aligned unevenly |
| Watchlist | 7.7 | Far-right state/note content had no discovery cue; sort chrome was noisy |
| Portfolio | 7.8 | Desktop and mobile summary labels truncated visibly |
| Portfolio Analytics | 7.8 | Strong content, but the summary/actions above it made the overall page feel compressed |
| Ticker Detail | 7.8 | Strong identity; price rail and sparse fixture tables left some visually inert area |
| Option Chain | 7.9 | Good scan structure; decorative strike tint and inactive sort markers added noise |
| Option Drawer | 8.4 | Strong hierarchy; native numeric spinners looked inconsistent with the control system |
| ETF Pulse | 8.1 | Excellent density, but all return columns carried equal color weight |
| Account | 7.2 | Synced mobile state occupied almost the full viewport; desktop QA rendered the wrong presentation |
| Desktop shell | 8.3 | Calm and compact, with one page-width rhythm exception |
| Mobile shell | 8.3 | Strong portrait shell; Scanner and Portfolio underused landscape height |

## 3. Five most amateur-looking remaining details, force-ranked

1. Portfolio summary labels were visibly ellipsized on both desktop and phone, including the longest and most important risk labels.
2. The Dark theme used a bare square icon that read as an unchecked checkbox rather than a theme control.
3. The synced mobile Account sheet reserved almost a full viewport for a short block of content, leaving a large unfinished-looking void.
4. Scanner and Portfolio consumed nearly the entire first phone-landscape screen before showing opportunities or priorities.
5. Wide Watchlist content disappeared beyond the right edge with no mid-width guidance, while every inactive sortable header still displayed an arrow.

All five were corrected.

## 4. Top concrete issues found

1. Scanner's `page-frame--standard` produced a different desktop left gutter from Screener, Watchlist, Portfolio, and Pulse.
2. The Dark theme square glyph was semantically ambiguous.
3. Scanner card names and supporting metadata remained dense enough to truncate in the four-column desktop layout.
4. At 1024px, Scanner market context and controls pushed opportunity results to the bottom of the first viewport.
5. Screener's “Fetch scope” caption could wrap against its explanatory text.
6. Screener local-filter labels did not share a stable label height.
7. Screener's initial table used a comparatively large empty container for a two-line prompt.
8. Watchlist's state and note columns were not discoverable at constrained desktop widths.
9. Watchlist's full-width red error rail carried more visual weight than the preserved data below it.
10. Watchlist phone rows plus editable notes were tall in landscape.
11. Every inactive Watchlist sort header showed a low-opacity arrow, producing spreadsheet-like visual noise.
12. Portfolio rendered ten equal-width KPI cards at 1280/1440 and clipped several labels.
13. Portfolio's four phone metrics clipped every long label.
14. Portfolio's utility actions formed a dense desktop row, though their hierarchy remained understandable.
15. Portfolio schedule headers used a sort marker on nearly every column, increasing header noise.
16. Wide Portfolio and Watchlist tables still depended on internal horizontal scrolling.
17. Ticker Detail's price rail left unused vertical space below compact fixtures.
18. The Option Chain's strike tint was slightly more decorative than the rest of the table system.
19. Option Drawer number inputs exposed native browser spin controls.
20. ETF Pulse's Market Read copy truncated at 1280px when status, details, freshness, and refresh shared one row.
21. ETF Pulse displayed every positive return in green with equal weight, reducing the selected-period hierarchy.
22. Repeated orange RSI values added color density to a table already carrying many semantic values.
23. The Account QA fixture always rendered the mobile sheet, even at desktop sizes.
24. Mobile Account used a fixed near-full-height sheet for short signed-in states.
25. Scanner's landscape control stack hid the opportunity header behind the bottom navigation.
26. Portfolio's landscape hero hid most of the decision queue.
27. Light was the least distinctive theme and risked looking like generic enterprise software.
28. Hidden freshness tooltips and intentional table scroll surfaces produced noisy results in the first auxiliary overflow detector.

## 5. Global shell findings

The desktop shell already disappeared appropriately behind the data and needed no structural redesign. Navigation density, utility placement, active-state contrast, and 44px mobile controls were strong. The one material rhythm defect was Scanner's narrower maximum width, which caused a left-edge jump during route changes; the standard frame now shares the 1600px data-page maximum. Mobile navigation remains five destinations, with Account correctly retained as a utility action.

## 6. Page rhythm findings

Title heights and first-content spacing were already broadly coherent. Aligning Scanner's desktop gutter removed the most noticeable route transition. Portfolio now uses two rows of readable KPIs at 1280/1440 instead of one compressed row, which adds height but creates a deliberate rhythm and improves comprehension. Phone landscape now changes composition rather than merely shrinking the portrait stack.

## 7. Density findings

The best surfaces—ETF Pulse, the Option Chain, Watchlist rows, and the Portfolio schedule—already carried substantial information without losing row identity. The weakest density was not excessive data; it was overly compressed labels and equally weighted secondary values. The final pass preserves all financial fields while giving labels enough space and selected comparison periods a clear anchor.

## 8. Whitespace findings

Useful whitespace was retained around page titles, decision rails, and overlays. Unproductive whitespace was reduced in the short Account sheet and both landscape hero areas. Sparse deterministic fixtures can still leave empty space below the Option Chain and Screener initial state, but the container geometry now remains proportionate to the eventual data surface and does not block primary controls.

## 9. Over-compression findings

The highest-risk compression occurred in Portfolio KPI labels, Screener group captions, phone summary labels, and landscape control stacks. These were corrected through wrapping, breakpoint-aware grids, concise equivalent mobile labels, stable label heights, and two-column landscape composition. Financial data was not removed to create space.

## 10. Surface and card findings

The product does not need a broad card-removal project. Scanner instruments and Portfolio decision rails are meaningful objects, while tables remain bounded work surfaces rather than collections of floating cards. The final changes avoid introducing new containers. Account instead became content-fit, and landscape layouts use grid composition inside existing surfaces.

## 11. Typography findings

The native/system type and tabular data face are consistent and trustworthy. Remaining weakness came from long uppercase labels forced onto one line. Portfolio summary labels now support two controlled lines, Screener captions stay intact, and mobile book labels use concise equivalent language. Page and section heading weight was already strong and was left unchanged.

## 12. Numeric presentation findings

Currency, percentage, signs, and right alignment were already consistent. Tabular numerals were preserved. Numeric spinners were removed from styled number inputs because they introduced non-system chrome, not because of any data-entry change. ETF Pulse now distinguishes the selected period through weight/background as well as semantic color.

## 13. Table findings

All major tables were compared side by side. None required replacement. Watchlist now shows only the active sort indicator, keeps the ticker sticky during horizontal scanning, exposes a keyboard-focus outline on the scroll region, and adds a constrained-width “Scroll for status & notes” cue. ETF Pulse marks the selected performance column and quiets other return periods. Page-root scrolling remains zero; wide financial data stays inside bounded scroll wrappers.

## 14. Color findings

Positive/negative semantics remain intact and no financial color meaning changed. Pulse was the only surface where repeated valid positives became a wall of equal emphasis; non-selected return periods are now quieter while retaining their semantic hue. Existing raw `rgba(...)` values remain in several legacy status/backdrop styles; they were not mechanically converted because the semantic token migration would create broad visual risk without a rendered defect.

## 15. Icon and micro-chrome findings

Lucide remains the only icon language. Dark now uses `Moon`; Dark Blue uses `MoonStar`, so both states read as themes rather than form controls. Inactive Watchlist sort icons are gone. Close-button geometry in Drawer, desktop Account, and mobile Account was already compatible and remained unchanged.

## 16. Control findings

Analyze Ticker, expiry, filter, mark-basis, grouping, timeframe, sort, theme, and Account controls remain visually subordinate to data. The Load and Analyze actions retain primary weight. Screener captions and field labels now align more deliberately. Mobile inputs retain 16px text and touch-safe dimensions; landscape compaction never reduces portrait targets.

## 17. Chart findings

SPY/VIX/QQQ/VXN rails, ticker chart, exposure bars, maturity bars, and Pulse visualizations already shared restrained grid, surface, and tooltip language. No chart calculation, scale, or SVG behavior was changed. The chart system was deliberately left stable.

## 18. Overlay findings

Option Drawer remained the strongest overlay. Its calculator chrome is cleaner without native spinners. The real desktop Account dialog is now represented in deterministic QA rather than a stretched mobile sheet. Mobile Account is content-fit up to a safe dynamic-viewport maximum, remains scrollable for long conflict/restore states, and keeps existing focus/body-lock behavior.

## 19. Mobile findings

At 390×844, Scanner begins opportunity discovery quickly, Screener communicates criteria and Load, Watchlist shows multiple contracts, Portfolio shows book status and both priority rails, Detail exposes contracts quickly, and Pulse begins with market context. Portfolio labels are readable, Account no longer looks unfinished, and no content is obstructed by bottom navigation.

## 20. Landscape findings

At 844×390 and 667×375, Scanner places Analyze beside expiry/search/filter controls and shows its first opportunity above the bottom navigation. Portfolio places headline P&L beside book metrics and mark basis, then exposes both decision queues. Watchlist rows and notes are denser without removing editability. Account remains contained and scrollable. The 42px navigation was retained.

## 21. State, loading, error, and stale findings

Loading, partial, stale, failed, retry, and unavailable states remain recognizable as one product. The final harness captures Scanner loading, Screener initial/populated/partial, Watchlist stale/partial, Pulse progress, stock no-options, and partial Portfolio marks. No state machine or request behavior changed. Error rails remain more colorful than ordinary status but correctly preserve visible data and retry context.

## 22. Theme-by-theme findings

- **Dark:** neutral, crisp, and the clearest general workstation theme; surface steps remain visible without “charcoal soup.”
- **Dark Blue:** sophisticated navy with restrained accent saturation; it does not read as neon or gaming UI.
- **Light:** clean with visible surface boundaries. It remains the most utilitarian theme, but no longer feels washed out at the primary Scanner/Portfolio/Detail/Screener surfaces.
- **Sepia:** warm, intentional, and particularly strong on Portfolio and Detail; semantic red/green remain distinct.

## 23. One-off CSS and design debt found

Raw alert/backdrop colors, old utility aliases, arbitrary page-specific spacing, and duplicate inline control styles remain. Low-risk final corrections were centralized in the existing semantic CSS layer. A broad alias removal or inline-style migration was deliberately rejected for UI-5 because it would produce high diff volume with low rendered value.

## 24. Changes made in the first polish pass

- Aligned Scanner's desktop page frame with the site-wide data gutter.
- Replaced the ambiguous Dark square icon and differentiated Dark Blue.
- Converted Portfolio summary labels from one-line truncation to controlled two-line labels.
- Moved the ten-card Portfolio grid to ten columns only at 2XL; 1280/1440 use five readable columns.
- Normalized the four phone Portfolio labels without changing their meaning.
- Made mobile Account content-fit and made desktop Account QA use the real dialog.
- Removed native number-input spin buttons.
- Stabilized Screener group captions and label heights.
- Removed inactive Watchlist sort arrows and made the ticker a sticky horizontal-scan anchor.
- Re-composed Scanner, Portfolio, and Watchlist for phone landscape.

## 25. Scores after the first pass

| Surface | After pass 1 |
| --- | ---: |
| Scanner | 8.5 |
| Screener | 8.0 |
| Watchlist | 8.2 |
| Portfolio | 8.5 |
| Portfolio Analytics | 8.2 |
| Ticker Detail | 8.1 |
| Option Chain | 8.2 |
| Option Drawer | 8.7 |
| ETF Pulse | 8.3 |
| Account | 8.5 |
| Desktop shell | 8.6 |
| Mobile shell | 8.7 |

Overall after pass 1: **8.4 / 10**.

## 26. Changes made in the second polish pass

- Added an explicit Watchlist mid-width cue for the hidden state/note columns.
- Added keyboard focus treatment to the Watchlist horizontal-scroll region.
- Emphasized ETF Pulse's selected performance column and quieted the other return periods.
- Hardened the layout detector against invisible tooltips, intentional internal scroll areas, and subpixel edge rounding.
- Isolated theme capture from deliberate error/cooldown states so every named theme artifact is accurate.

## 27. Final route-by-route scores

| Surface | Final | Change |
| --- | ---: | ---: |
| Scanner | 8.6 | +0.6 |
| Screener | 8.2 | +0.8 |
| Watchlist | 8.5 | +0.8 |
| Portfolio | 8.6 | +0.8 |
| Portfolio Analytics | 8.4 | +0.6 |
| Ticker Detail | 8.3 | +0.5 |
| Option Chain | 8.3 | +0.4 |
| Option Drawer | 8.8 | +0.4 |
| ETF Pulse | 8.6 | +0.5 |
| Account | 8.7 | +1.5 |
| Desktop shell | 8.7 | +0.4 |
| Mobile shell | 8.8 | +0.5 |

## 28. Final overall UI score

**8.6 / 10.** This is a polished, coherent, trustworthy dense financial workstation. It is not scored as a 9+ because some long financial tables remain inherently demanding, some legacy CSS aliases/inline styles remain, and the Light theme is still more utilitarian than distinctive.

## 29. Largest improvements

The largest perceived-quality gains came from readable Portfolio summaries, usable landscape first screens, a proportionate Account experience, clean theme iconography, and clearer wide-table behavior. These are small code changes with disproportionate impact because they occur in the first viewport or in repeated micro-chrome.

## 30. Areas deliberately left unchanged because they were already strong

The desktop navigation, mobile bottom navigation, core ticker identity, Option Drawer information hierarchy, option economics, chart calculations/chrome, Portfolio decision policies, Pulse visualizations, and semantic theme palettes were already strong. They received verification, not redesign.

## 31. What still prevents a perfect top-tier score

With no development history, the remaining tells would be the breadth of inline page-specific styling, a few table-specific sort/header conventions, dense wide-table learning cost, some repeated tiny uppercase copy, and Light's comparatively generic tone. None justify another broad UI rewrite. They are evolutionary system-debt items, not visible blockers.

## 32. Screenshot locations

- Baseline: `e2e-artifacts/ui-overhaul/ui5/baseline/`
- Final: `e2e-artifacts/ui-overhaul/ui5/final/`
- Each contains 82 PNGs across eight viewport directories.
- Final includes 36 desktop 1440 captures, including four themes across Scanner, Portfolio, Detail, and Screener.

## 33. Functional regression results

`npm run verify` passed: 304 unit/regression tests, 93 self-checks, all automated responsive guardrails, TypeScript, production build, and lint. No financial or persistence regression was observed.

## 34. E2E results

`npm run test:e2e` passed across all eight configured projects: 13 active deterministic product tests passed and 83 phase-gated visual tests skipped as intended. The dedicated final UI-5 harness passed 8/8 projects.

## 35. Responsive results

`npm run responsive:check` passed every automated guardrail. Final visual reports cover 1440×900, 1280×800, 1024×768, 430×932, 390×844, 375×667, 844×390, and 667×375. All eight reports show zero page-level overflow, zero horizontal page scroll, and no unbounded visible content.

## 36. Build, typecheck, and lint results

- TypeScript: passed.
- Production build: passed.
- Build report: passed; development Account/sync fixtures remain excluded from production assets.
- Lint: zero errors and three pre-existing Fast Refresh warnings in `ExpirationFilter.tsx` and `theme.tsx`.
- Browserslist emitted its existing stale-data notice; it does not affect the build result.

## 37. Exact files/components visually modified

**Eight presentation source files** participate in the visual result: six production presentation files (`App.tsx`, `index.css`, `EtfPulsePage.tsx`, `HomePage.tsx`, `PortfolioPage.tsx`, `WatchlistPage.tsx`) and two QA presentation/exposure files (`AccountControl.tsx`, `AccountUiTestFixture.tsx`). They affect ten rendered surfaces/components: ThemeToggle, Scanner, Screener, Watchlist, Portfolio summary, Portfolio landscape hero, Option Drawer numeric controls, ETF Pulse table, mobile Account, and desktop Account QA. Five additional files implement deterministic visual QA, and two documentation files record the result: **15 changed files total**.

## 38. Functional behavior changed

**No.** Financial formulas, metric definitions, Scanner/Screener behavior, persistence, Portfolio lifecycle/policies, request behavior, expiry behavior, Analyze Ticker, cloud sync, Supabase, authentication, schemas, routes, and ETF Pulse calculations are unchanged.

## 39. Recommendation on another broad UI stage

Another broad UI stage is **not warranted**. The current product clears the intended production-grade bar, and another global pass would risk churn and system regression for diminishing visual return.

## 40. Surgical future polish opportunities

- Continue migrating legacy raw alert/backdrop colors to semantic roles when those components are otherwise touched.
- Normalize the remaining inactive sort/header conventions in Schedule and Option Chain.
- Explore a slightly more distinctive Light-theme canvas/surface relationship through token-only experiments.
- Add scrollbar-position affordance to other exceptionally wide tables if user testing shows discovery problems.
- Validate dense layouts with longer real-world labels and larger datasets as part of ordinary feature work.

## Top-tier question

If this product appeared with no history, the remaining signs that it was not designed by a mature fintech team would be implementation debt more than composition: duplicated inline styles, a few route-specific table conventions, and some terse uppercase copy. The visible, safely correctable first-impression issues found in UI-5 were fixed. The remaining items should be addressed only alongside relevant product work.
