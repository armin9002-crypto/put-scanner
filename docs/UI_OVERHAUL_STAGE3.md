# Put Scanner UI Overhaul — Stage UI-3

## Scope

UI-3 refines the Watchlist → Portfolio → Portfolio Analytics review workflow. This is a presentation and composition pass only. Portfolio calculations, Mark Book basis semantics, lifecycle transitions, durable storage, cloud boundaries, quote request behavior, routes, history, analytics policies, and the default collapsed analytics state remain unchanged.

The dedicated capture harness is `e2e/ui-overhaul-ui3.visual.spec.ts`, invoked by `npm run visual:ui3 -- before|after`.

## UI-3 baseline

The baseline was captured from the UI-2 commit before the UI-3 source pass. The fixture contains four saved contracts (live, stale/refresh-failed, and unavailable outcomes), long notes, four open positions across three expiries and four tickers, mixed quote availability, and two resolved history records. The capture matrix covers 1440×900, 1280×800, 1024×768, 430×932, 390×844, 375×667, 844×390, and 667×375.

Baseline and after artifacts live in:

- `e2e-artifacts/ui-overhaul/ui3/before/`
- `e2e-artifacts/ui-overhaul/ui3/after/`

The dedicated after run includes Watchlist populated/mixed-status, loading, empty, Portfolio collapsed, Mark Book at Last, grouped and ungrouped schedules, analytics expanded, history, and the Portfolio trade drawer. Responsive captures include Watchlist, headline, analytics, history, and landscape variants. The desktop theme loop captures Watchlist, Portfolio collapsed/expanded, and the trade surface for Light, Dark, Sepia, and Dark Blue. The before folder contains the baseline populated/collapsed/expanded/history states captured before source changes; the additional state captures were added to the same deterministic harness for the after pass.

## Baseline critique

### Three heavy areas

1. The Portfolio summary presented ten equal metric cards, so the headline P&L and supporting ratios competed for the same attention.
2. The expanded analytics grid paired a wide chart with a narrow decision list, then repeated the same relationship below; it felt like two dashboards stacked together.
3. The Schedule table dominated the first screen with a very wide, high-density header before the user saw an explicit attention or close-priority cue.

### Three sparse areas

1. The collapsed Portfolio Analytics disclosure was only a small label and chevron with no indication of what would be revealed.
2. Watchlist left a large empty canvas below a short table without a compact table context line or saved-count anchor.
3. Mobile Portfolio used generous blank space in the hero while the first actionable position could fall below the fold.

### Three alignment problems

1. Watchlist numeric columns aligned correctly, but the far-right notes column was visually clipped and behaved differently from the bounded mobile note treatment.
2. Portfolio group subtotal rows, position rows, and history rows used similar borders without a consistent surface rhythm.
3. Mark Book controls, refresh, import, and backup actions formed a long desktop action run instead of a compact control cluster.

### Three hierarchy problems

1. Primary total gain/loss, captured percentage, capital, and DTE had nearly identical typographic weight.
2. Attention and Close Candidates were buried inside expanded analytics even though they are the first review decisions.
3. Live, stale, unavailable, and refresh-failed Watchlist states relied on muted rows or an error banner rather than an explicit state column.

### Table, mobile, and theme observations

- Table behavior was inconsistent: the dense Watchlist table used a horizontal scroll wrapper and a clipped single-line note, while mobile cards exposed notes as a separate full-width action. Portfolio schedule and history each had their own header rhythm.
- Mobile Portfolio opened directly into a schedule-heavy layout; the user had to scan several controls before reaching attention, close, and analytics context. Phone landscape retained the same density but had less vertical room.
- Theme weakness was most visible in Light and Sepia: low-contrast tertiary labels and warning/error states blended into inset surfaces, while Dark Blue needed clearer selected-state borders.

## First-pass changes

### Watchlist

- Added a compact saved-contract toolbar inside the table surface with a count and a plain-language reading cue.
- Added an explicit State column with semantic Live, Stale, Unavailable, and Refresh failed chips while preserving the existing status policy and retry behavior.
- Bounded notes to a two-line readable cell and kept mobile notes as a deliberate full-width edit target.
- Reduced remove-star chrome to a quiet icon action with hover/focus affordance.
- Reused the existing table overflow wrapper, snapshots, empty state, loading path, and refresh error path.

### Portfolio and analytics

- Added a priority rail above the review surfaces: Top Needs attention and Top Close candidates are concise, clickable summaries driven by the existing policy functions.
- Made the primary P&L card visually dominant in the desktop summary rail; supporting metrics remain compact and semantic.
- Added a partial-mark explanation whenever an unavailable quote makes aggregate mark-dependent P&L unavailable.
- Added explanatory copy to the collapsed analytics disclosure.
- Rebalanced expanded analytics into a paired Maturity Wall / Exposure by Ticker row, followed by Needs Attention / Close Candidates.
- Kept schedule grouping, sorting, Mark Book basis, toggles, totals, and history calculations untouched.
- Added page-specific surface rhythm for grouped rows, schedule tables, history summaries, and the existing Option Detail Drawer continuation.

### Mobile and landscape

- Mobile reading order is now headline → priority rail → open positions → analytics disclosure → history.
- Priority cards collapse to two concise items per rail on phone widths; position rows retain their existing hierarchy and 44px controls.
- Analytics remains a one-at-a-time segmented workflow and is scrollable in portrait and landscape.
- Phone landscape keeps the mobile presentation rather than forcing the desktop table.

## Second-pass critique and decisions

The first after capture showed the priority rail repeated too much visual weight when analytics was expanded, and the chart/list pairing still made the expanded view feel uneven. The second pass therefore hides the compact priority rail while the disclosure is open, puts the two quantitative charts side by side, and moves the policy lists into a balanced second row. Mobile retains the priority rail in the default collapsed reading order, while expanded analytics becomes the focused decision surface. The follow-up capture showed no page-level horizontal overflow in any project.

## Reusable system decision

No new global design-system primitive was introduced. UI-3 reuses `PageHeader`, `surface-card`, `surface-inset`, semantic status badges, button variants, `financial-table`, and `overlay-panel` from the established system. `portfolio-*` and `watchlist-*` classes are page-specific composition rules, so `docs/UI_DESIGN_SYSTEM.md` does not need a new rule.

## Visual QA

- Before: `e2e-artifacts/ui-overhaul/ui3/before/`
- After: `e2e-artifacts/ui-overhaul/ui3/after/`
- Representative after desktop files: `desktop-1440x900/watchlist-populated-mixed-status.png`, `desktop-1440x900/portfolio-analytics-collapsed.png`, `desktop-1440x900/portfolio-analytics-expanded.png`, `desktop-1440x900/portfolio-history.png`.
- Representative mobile files: `portrait-390x844/portfolio-mobile-headline.png`, `portrait-390x844/portfolio-mobile-analytics.png`, `landscape-844x390/portfolio-landscape-analytics.png`.
- Theme files use `theme-light-*`, `theme-dark-*`, `theme-sepia-*`, and `theme-dark-blue-*` in `desktop-1440x900/`.
- Every project writes an `overflow-report-*.json`; the completed after matrix reports no page-level horizontal overflow.

## Validation

The following checks pass after the UI-3 pass:

- `npm run verify` (304 tests pass; repository retains its three existing Fast Refresh warnings).
- `npm run visual:ui3 -- after` (8 projects pass).
- `npm run responsive:check`.
- `npm run build:report`.
- `npm run test:e2e -- e2e/product.spec.ts -g "Watchlist refresh|Portfolio analytics"` (2 changed-workflow scenarios pass across the configured projects; 14 projects are intentionally skipped by the grep).
- A full `npm run test:e2e` run was attempted; the desktop product smoke hit the repository’s known 45s Pulse wait and the following Account fixture navigation hit a 90s server timeout. The affected Watchlist/Portfolio scenarios pass directly as recorded above.
- `git diff --check`.

## Remaining weaknesses

The Portfolio schedule remains intentionally data-dense and still requires horizontal scanning on desktop. The priority rail is intentionally concise rather than a replacement for full analytics. Watchlist notes are bounded in the table but still live at the far-right end of a wide comparison table. These are known trade-offs for the current durable schema and remain outside UI-3.

## UI-4 boundary

UI-4 is not started. Any further work requires a new written brief and a new baseline; this commit stops at Watchlist → Portfolio review composition.
