# Device-local text-size QA contract

The retune starts from fetched `main` at `0e5bc99d9d80b682cc20ec94d74ba4fe2a777cc2`. Fresh pre-edit captures covered Small, old Medium, and old Large across seven routes, four viewports, and overlays (120 PNGs plus computed text/geometry samples). The current contract is Small `1`, Medium `1.16`, and Large `1.32`; stored strings, `put_scanner_text_size`, and the three-state cycle remain unchanged. Existing stored `medium` and `large` values receive their new scales without migration. There is no fourth state, route context consumption, root zoom, or global geometry scaling.

## Fit contract

All new accommodations below are scoped to Large; existing Medium/Large rules remain intact.

- Desktop navigation destinations can scroll internally while retaining utility space.
- Portfolio identities wrap long reasons; mobile metrics use two columns and wrap labels/values.
- Narrow portrait bottom navigation uses unequal tracks below 360px.
- Option Drawer risk and market sections use two columns without truncating values.
- Pulse phone tabs occupy the full row; Filters move to the next row and tabs use automatic track widths.
- Scanner two-line names use line clamping without the former partial-line max-height rule.
- The 280-unit Momentum tooltip already contains all nine metrics at 1.32; no geometry change is needed.

Explorer review found no unscaled new font declarations in compact financial tables, Scanner rows, the installed shell, Portfolio controls, Watchlist indicators, Option Drawer, tooltips, or charts. Existing arbitrary pixel utilities remain centralized in the CSS utility layer; computed chart labels retain `uiTextCssPx`. The provider, storage helper, Tailwind scaling, and control implementation are unchanged. Phone inputs retain scaled 16px text (21.12px at Large). Safe-area insets and touch interactions are simulated in Chromium; physical iOS behavior is not claimed.

## Capture and comparison workflow

Capture the fresh baseline before production edits:

```powershell
$env:UI_OVERHAUL_CAPTURE='baseline'
$env:TEXT_SIZE_CAPTURE='baseline'
npx.cmd playwright test e2e/text-size.visual.spec.ts --grep 'route and overlay matrix' --project=desktop-1440x900 --project=portrait-390x844 --project=tablet-1024x768 --project=landscape-844x390
```

Then set both capture variables to `final`, set `TEXT_SIZE_COMPARE=true`, and run `e2e/text-size.visual.spec.ts` and `e2e/text-size-fit.visual.spec.ts` across the same projects. Comparisons are exact: POST Small/PRE Small and POST Medium/PRE Large each passed all 28 route/viewport content samples. Navigation is checked separately for accessibility, bounds, label overlap, and restored Small geometry during real control cycles. Dynamic time/status strings and the size control are excluded from equivalence comparisons.

Artifacts stay under ignored `e2e-artifacts/text-size/`; do not commit large PNGs. The obsolete `e2e/fixtures/textSizeSmall.json` full-page September 5 hashes are retired, not overwritten: compact tables, the installed shell, and the intervening Scanner/Portfolio/Pulse/Drawer changes made those hashes stale. The fresh fixture also supplies a past expiration observation timestamp so the current Scanner validity rules render its populated universe. Keep baseline capture explicit and review the rendered screenshots and JSON differences before accepting a future UI change.

Runtime checks always cover exact font scales, Small-cycle geometry, zero requests/cloud writes, unchanged chart output, navigation, mobile tables, the 320px fit case, and overlays. The visual compare is optional and enabled by `TEXT_SIZE_COMPARE=true`.

| Coverage | Sizes/themes | Viewports |
| --- | --- | --- |
| Scanner, populated Screener, Recommendations, Watchlist, Portfolio, Options, ETF Pulse | All three sizes, Dark | 1440×900, 390×844, 1024×768, 844×390 |
| Option Drawer, Methodology, Account | All three sizes, Dark | All four |
| Dense tables, expanded Portfolio analytics/history, price charts, Momentum labels/tooltip, Account inputs | Large, Light/Sepia/Dark Blue | All four |
| Add Trade, Maintenance, Backup, Historical Excel, mobile Filters, recommendation evidence, Market Read | Large, Dark | All four where applicable |
| Scanner and all four compact financial tables | Large, Dark | Additional 320px portrait |

Mobile table checks verify actual horizontal scrolling, opaque frozen identity cells, sticky headers, aligned cells, unclipped financial values, and independent actions. The existing option-table row rule remains `34 × scale`, giving 44.88px at Large; the former 40px test ceiling was obsolete. Pulse label checks use the visible segmented group and adjacent text because approved old Large paints into the group padding. Chart checks wait for a rendered frame after changing inherited CSS properties and verify unchanged SVG paths and request counts.

## Validation status

Verified September 20, 2026:

- Unit suite: 579 passed, including all seven text-size tests. Selfcheck: 94/94. Typecheck and responsive guardrails passed.
- Both visual specs: all 17 applicable cases passed across the four projects after targeted reruns; three duplicate 320px cases are intentionally skipped. The reruns corrected an overly strict Pulse button-box assertion and waited for SVG font paint. An overlapping preview-server shutdown caused one interrupted run; the dedicated-server rerun passed.
- The final phone matrix passed both cases, including exact Small/Medium baseline comparisons, persistence, invalid storage fallback, keyboard control, theme/chart checks, unchanged financial text and cloud rows, and zero preference-induced requests. The final note-sheet/320px fit run passed both cases.
- Existing responsive suites covered mobile Option Chain, Screener/Watchlist, Pulse, Option Drawer yield, Portfolio density, touch/keyboard actions, and safe-area simulation. The obsolete option-row height ceiling was updated to the exact existing scale rule and its complete four-width/three-size case passed on rerun.
- Full lint: zero errors, four existing Fast Refresh warnings in `ExpirationFilter.tsx`, `theme.tsx`, and `uiTextSize.tsx`.
- Production build and build report passed; visual fixtures and retired test harnesses are absent from production assets. Main JS: 360.55 kB (108.80 kB gzip); CSS: 165.3 KiB. No dependency or financial/request-path changes.

Rendered review includes all seven route/size/viewports in Dark, additional Light/Sepia/Dark Blue dense surfaces, 320px tables before/after internal scrolling, full mobile metric labels, chart labels/tooltips, and representative overlays. Primary reviewed fit and final integration; Explorer inventoried typography; Fast Worker handled bounded documentation/unit-test edits.

No production data or cloud state is involved in this workflow. Changes remain presentation-only and device-local.
