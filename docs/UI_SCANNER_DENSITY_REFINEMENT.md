# Scanner Density Refinement

This is a Scanner-only composition refinement. It keeps the established design-system tokens and all market, filter, routing, cache, and request behavior unchanged.

## Scope and inspected components

- `src/pages/HomePage.tsx`: desktop/mobile Scanner composition, market context, filters, result status, and loading/error states.
- `src/components/ETFCard.tsx`: desktop opportunity-card hierarchy, metrics, metadata, and snapshot footer.
- `src/components/mobile/MobileEtfRow.tsx`: phone opportunity-row hierarchy and touch target.
- `src/components/mobile/MobileMarketStrip.tsx`: phone market ribbon.
- `src/components/ui/PageHeader.tsx`, `src/components/AnalyzeTickerForm.tsx`, `src/components/ExpirationFilter.tsx`, and `src/components/SparklineChart.tsx`: shared primitives used by Scanner.
- `src/index.css`: Scanner-specific density, responsive, landscape, and semantic-token rules.

No shared global design-system document was changed.

## Measured before/after geometry

The deterministic Playwright capture (`e2e/scanner-density.visual.spec.ts`) uses the same populated fixture for both passes. “Pre-results footprint” is the distance from the Scanner content root to the first opportunity card.

| Viewport | Header | Market context | Opportunity set | Results header | First card top | Card/row | Complete cards visible |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1440×900 before | 73.4 | 163.1 | 185.3 | 34.0 | 608.0 | 122.0 | 8 |
| 1440×900 after | 50.0 | 130.8 | 113.5 | 34.0 | 425.2 | 98.0 | 16 |
| 1280×800 before | 70.8 | 163.1 | 185.3 | 34.0 | 605.4 | 122.0 | 4 |
| 1280×800 after | 50.0 | 130.8 | 113.5 | 34.0 | 425.2 | 98.0 | 12 |
| 1024×768 before | 138.0 | 280.3 | 185.3 | 34.0 | 789.7 | 122.0 | 0 |
| 1024×768 after | 50.0 | 130.8 | 113.5 | 34.0 | 425.2 | 98.0 | 9 |
| 390×844 before | — | 58.0 | 228.8 | 55.7 | 398.5 | 120.9 | 3 |
| 390×844 after | — | 58.0 | 212.0 | 49.4 | 375.4 | 103.5 | 4 |
| 430×932 before | — | 58.0 | 228.8 | 55.7 | 398.5 | 120.9 | 4 |
| 430×932 after | — | 58.0 | 212.0 | 49.4 | 375.4 | 103.5 | 5 |
| 375×667 before | — | 58.0 | 228.8 | 55.7 | 398.5 | 120.9 | 2 |
| 375×667 after | — | 58.0 | 212.0 | 49.4 | 375.4 | 103.5 | 2 |
| 844×390 before | — | 58.0 | 94.2 | 47.2 | 244.4 | 115.3 | 1 |
| 844×390 after | — | 58.0 | 94.2 | 47.2 | 244.4 | 101.8 | 1 |
| 667×375 before | — | 58.0 | 94.2 | 47.2 | 244.4 | 115.3 | 1 |
| 667×375 after | — | 58.0 | 94.2 | 47.2 | 244.4 | 101.8 | 1 |

At 1440px, the pre-results footprint fell from 555.0px to 372.2px (32.9% reduction). At 390px it fell from 342.5px to 319.4px (6.7% reduction); the mobile controls retain 44px touch-safe fields and therefore use a smaller, intentional reduction. The representative desktop card fell from 122px to 98px (19.7%). Complete opportunities visible above the fold doubled from 8 to 16 at 1440px and increased from 3 to 4 at 390px.

## Composition decisions

### Command bar

The desktop `PageHeader` is a single horizontal composition: Scanner title and concise description on the left; result count/selected expiry and the compact Analyze Ticker control on the right. The count and expiry moved out of a separate meta row. At tablet widths 900–1100px the same row is retained because it fits without clipping. Phone Scanner continues to use its purpose-built header and a separate compact Analyze panel; the input remains `text-base`/16px for iOS zoom safety.

### Market ribbon

Desktop market context stays one shared rail with four cells across at 1440/1280/1024. Each cell keeps ticker, 1D marker, refresh, sparkline, value, and move; padding and the displayed sparkline height are compacted. At widths below 900px the desktop rail changes to two columns. Phones use the existing four-wide `MobileMarketStrip`, which the rendered 390px and landscape captures confirmed remains legible and materially more efficient than stacked cards.

### Opportunity-set toolbar

Search, leverage, expiration, sort, liquidity, type, and Update IV/Liquidity now share one aligned desktop toolbar beneath the opportunity-set heading. Controls use compact 32px visual heights and the same semantic selected-state language. At phone widths the existing bottom-sheet filter disclosure remains the progressive-disclosure path: no high-priority filter was hidden behind a new desktop-only popover, so no “More Filters” counter was added.

### Results transition

The standalone Scanner freshness/error row was removed. Freshness, error text, and result count now sit in the `ETF opportunities` SectionHeader action cluster, preserving status semantics while eliminating a stacked transition row.

### ETF cards

Desktop cards now use a 50/50 identity-to-metrics split, tighter surface padding, and a fixed 98px minimum geometry. The leverage badge is inline with the ticker. Price and daily move are colocated on the identity row; the 2×2 performance grid remains stable with tabular values; underlying/assets remain a quiet secondary line; IV/liquidity remain a compact bottom footer. Fund names use a controlled two-line clamp rather than premature one-line truncation, preventing uncontrolled card growth.

Phone rows remain a separate composition. They retain ticker/leverage and right-aligned price/move as the primary row, use a deliberate four-column performance strip (legible in the tested widths), clamp names to two lines, and tighten metric/footer spacing. The entire row remains the tap target.

## Responsive and iOS rules

- Desktop grid remains four columns at 1440/1280 and three at 1024; no extra column was added where card comparison would become cramped.
- Desktop market cells are four-up through 1024 and two-up below 900; phone rendering is owned by `MobileMarketStrip`.
- The dense desktop toolbar stays one row at the measured 1024px tablet width and wraps into two balanced rows below 980px to prevent clipping at intermediate tablet widths.
- Phone controls keep native 44px field/button hit areas and 16px input text; only surrounding spacing and panel chrome were reduced.
- Existing dynamic viewport units, safe-area padding, mobile bottom-nav clearance, sheet focus trapping, and landscape breakpoints remain in force.
- Landscape captures retain four market cells, a compact two-column control composition, and no page-level horizontal overflow. The Scanner result remains reachable within the short viewport.

## Loading, empty, stale, and error states

Market loading/unavailable placeholders now use the compact ribbon geometry. Scanner price freshness and errors remain visible in the results header. Existing reset buttons, retry actions, partial data behavior, and snapshot update controls are unchanged.

## Visual QA and self-critique

The first implementation pass successfully compressed the command bar, filter region, and mobile rows, but desktop cards still measured about 118px because price/change occupied a separate lower block. The second pass moved price/change beside ticker/leverage and reduced the chart display height through Scanner-only CSS; cards reached 98px and the market rail became a true status ribbon. A final landscape-specific spacing correction restored the 667×375 short viewport to the same compact two-column rhythm as 844×390. The final captures show:

1. No remaining large desktop gap before results; the main remaining vertical cost is intentionally touch-safe mobile controls.
2. Desktop horizontal space is used by the single filter toolbar and four-up market/card grids.
3. No tested section is cramped; labels, values, and type controls remain readable.
4. Long fund names receive a controlled second line instead of needless ellipses.
5. Cards compare consistently row-to-row: ticker/badge, price/move, identity metadata, metrics, footer.
6. Market Context reads as a ribbon rather than four dashboard panels.
7. Filters read as one coherent toolbar on desktop; mobile disclosure remains discoverable through the existing Filters button/sheet.
8. Mobile remains intentionally composed, with the original bottom navigation and safe-area behavior.
9. All tested viewports report `pageOverflow: false`.

## Validation

- Scanner density visual matrix: 8 passed across all requested viewports and populated/selected/filter/search/loading/partial/empty states.
- Existing UI-2 theme visual matrix: 1 passed, including Scanner/detail/drawer captures in light, dark, sepia, and dark-blue themes.
- Current browser E2E: 86 passed, 50 conditional skips (136 scheduled).
- TypeScript: passed.
- Lint: passed with the repository’s existing three Fast Refresh warnings and no errors.
- `npm run verify`: passed through typecheck, 165 Node tests, self-check (93/93), responsive guardrails, production build, and lint.
- `npm run responsive:check`: all guardrails passed.
- `npm run build`: passed (1715 modules transformed).
- `npm run build:report`: passed; production bundle contains no development fixture markers.
- `npm run request:ledger`: passed with the existing Scanner ceiling (6/6 browser/function, 8/8 provider acquisition, max 8 provider HTTP requests).

The four supported themes continue to use semantic tokens only; no raw dark-only colors or theme-specific business logic were introduced. No Scanner calculations, ETF universe, filter semantics, expiration routing, Analyze Ticker behavior, endpoints, request counts, caching, retries, cancellation, durable state, or non-Scanner surfaces were changed.

Screenshots are under `e2e-artifacts/scanner-density/baseline/` and `e2e-artifacts/scanner-density/final/`, with one folder per viewport and state.
