# Device-local text size implementation and QA

Starting HEAD: `a83c861ebc8b75a91b700c63341931b21c85657c` (clean `main`). Recent brand metadata, Portfolio CSV export, market tables, ETF historical analytics, and recommendation refresh commits remain in history. Scope is text size only; motion is unchanged.

## Inventory before implementation

| Source | Inventory |
| --- | --- |
| Standard Tailwind | xs 269, sm 113, base 37, lg 17, xl 5, 2xl 4, 3xl 2 occurrences |
| Arbitrary Tailwind px | 9 (48), 10 (156), 11 (153), 12 (18), 13 (9), 15 (6), 16 (6), 17 (3), 18 (2), 20 (1), 21 (1), 26 (1) |
| Custom CSS | 189 font-size declarations; fixed 9/10/11/14/16px, rem values from 0.5 to 1.55, and two fluid clamps |
| Numeric SVG | ETF Pulse momentum labels: eight at 10px and two at 11px |
| Computed inline text | Portfolio realized-history value and period labels, base 10px |
| Other charts | Interactive price charts use Tailwind; rolling history uses CSS classes; sparklines have no labels |
| Canvas text | None |

Inspected App/navigation, Theme/storage feedback, main CSS/Tailwind, shared page/mobile primitives, all seven routes, option drawer, chart components, and account/import/maintenance/backup overlay typography. No backend or cloud implementation was changed.

## Architecture and fit

- `UiTextSize = 'small' | 'medium' | 'large'`, default Small. Exact scales: 1, 1.08, 1.16.
- Device-only storage key `put_scanner_text_size`; invalid or unavailable storage reads Small. Writes use the existing storage-failure notification. No account preference is introduced.
- `UiTextSizeProvider` applies `data-text-size` in a layout effect. Only `TextSizeControl` consumes the context, so switching does not rerender financial routes or regenerate their data.
- Tailwind's existing default font-size configuration is mapped to CSS-scaled sizes and default line heights. Responsive variants and explicit leading utilities keep normal Tailwind precedence. Twelve arbitrary sizes are handled in the utility layer, before the existing custom component overrides.
- All 189 custom declarations keep their original base values and order. Recurring exact values use seven semantic tokens; other legacy values multiply the existing px/rem/clamp expression by `--ui-text-scale`. There are no root-font, zoom, or application-scale changes.
- Shared migrations cover page headings, financial-table headers, status badges, controls, recommendation cards/board/evidence, mobile option/position rows, Scanner, Pulse, Portfolio summaries/history, and chart CSS.
- `uiTextCssPx` returns a CSS expression for numeric labels in Portfolio and Pulse. Chart datasets, domains, scales, heights, and request paths are unchanged.
- Rendered fit corrections apply only to Medium/Large: Scanner ticker/quote lines wrap; narrow phone option rows separate the watch action and wrap dates/status; mobile Portfolio identities wrap; the nine-metric Pulse tooltip gets a 280-unit viewport clamped inside its existing 360-unit chart. The new control shows its full label at desktop widths and compact Aa below 1280px, preserving Account access at 1024px.
- Icons, borders, radii, page maximums, chart heights, touch minimums, modal maximums, safe areas, navigation heights, and geometric spacing tokens are deliberately unscaled. Content may naturally require more height.
- Existing 16px iOS input rules become `calc(16px * var(--ui-text-scale))` in their existing cascade positions. Focused phone Account input coverage checks the minimum. Browser emulation does not replace a physical iOS device test.

## Reference and visual coverage

Baseline screenshots and complete text/geometry samples were captured from the starting build before production source edits. Small comparisons cover all seven routes at 1440×900, 390×844, 1024×768, and 844×390. The new navigation control is outside the content reference; wall-clock status strings are excluded. `e2e/fixtures/textSizeSmall.json` stores SHA-256 fingerprints of the complete remaining text, computed font/line height, and element rectangles. The test fixes its calendar date to September 5, 2026.

The visual suite uses existing deterministic market/account fixtures. Its price-chart fixture supplies the current corporate-action/timeframe response fields, allowing real chart rendering without external providers. Artifacts are in `e2e-artifacts/text-size/` (intentionally ignored by Git).

| Coverage | Sizes/themes | Viewports |
| --- | --- | --- |
| Scanner, populated Screener, Recommendations, Watchlist, Portfolio, Option Chain, ETF Pulse | All three sizes, Dark | All four |
| Option Drawer, Methodology, Account sheet/dialog | All three sizes, Dark | All four |
| Dense tables, expanded Portfolio analytics/history, price chart, momentum chart/tooltip, focused Account input | Medium Light, Large Sepia | All four |
| Cycle/persistence/invalid storage, keyboard operation, utility placement/bounds, unchanged root font, zero switching requests/cloud writes | Runtime assertions | All four |

Run the matrix in PowerShell:

```powershell
$env:UI_OVERHAUL_CAPTURE='final'
$env:TEXT_SIZE_CAPTURE='final'
npx.cmd playwright test e2e/text-size.visual.spec.ts --project=desktop-1440x900 --project=portrait-390x844 --project=tablet-1024x768 --project=landscape-844x390
```

Use the generated screenshots to inspect the actual table scroll surfaces, sticky headers, bottom navigation, overlays, and chart labels; root-overflow assertions alone do not prove that content fits. Reference fingerprint failures require inspecting the full generated JSON samples, not blindly replacing hashes.

## Verification and delivery

Final verification on September 5, 2026:

- `npm test`: 353 passed, zero failed.
- `npm run verify`: passed typecheck, all tests, selfcheck, responsive checklist, production build, and lint. Lint has zero errors and four Fast Refresh warnings (including the provider/hook pattern shared with Theme).
- `npm run responsive:check`: passed; rendered checks were additionally performed by Playwright.
- `npm run build:report`: passed, including production exclusion of Account UI fixtures and preservation of the cloud-authoritative bundle checks.
- Full visual matrix: eight tests passed across the four viewports. After the final tooltip correction, all four focused runtime/theme/chart tests passed again, including actual tooltip-content containment.
- 40 baseline and 208 final PNGs, with corresponding computed typography/geometry JSON artifacts. All 28 route/viewport Small fingerprints matched. Captured matching leaf text scaled at exactly 1.08/1.16 with no scale outliers.
- Reviewed the resulting screenshots, including phone option/Portfolio identities, desktop Scanner quote wrapping, tablet utilities, landscape navigation, Light/Sepia dense tables, price-chart labels, history charts, and all nine Pulse tooltip metrics.
- Request paths and financial calculation code are unchanged. Runtime tests count zero requests around settled text-size cycles and confirm identical cloud rows and financial display text before/after each cycle. Request ledger was not required: verify does not include it, and no production request-path code changed.

Production output: main JS 343.3 KiB (106.01 kB gzip), CSS 143.1 KiB, Portfolio 205.3 KiB, Pulse 47.8 KiB. Original baseline visual-build CSS was 135.1 KiB, so the centralized typography and fit rules add about 8.0 KiB uncompressed CSS. Original visual-build main JS was 342.4 KiB; this is a reference rather than an exact production-to-production delta because fixture inclusion differs. No dependencies were added; route splitting remains intact and the production fixture-exclusion checks pass.

The starting commit still matched freshly fetched `origin/main` before delivery. The final commit hash, pushed HEAD equality, and clean-worktree check are supplied in the delivery message (a document cannot contain its own commit hash).

Changed production files: `src/App.tsx`, `src/components/TextSizeControl.tsx`, `src/components/ETFCard.tsx`, `src/lib/uiTextSize.tsx`, `src/lib/uiTextSizePreference.ts`, `src/index.css`, `tailwind.config.js`, `src/pages/PortfolioPage.tsx`, and `src/pages/EtfPulsePage.tsx`. Supporting files: this report, `docs/UI_DESIGN_SYSTEM.md`, `tests/ui-text-size.test.mjs`, `tests/portfolio-density-chart-refinement.test.mjs`, `e2e/text-size.visual.spec.ts`, and `e2e/fixtures/textSizeSmall.json`.
