# Put Scanner mobile discovery density — Stage 2

Stage 2 tightens the phone discovery surfaces without changing the Scanner or ETF Pulse data model. The mobile presentation remains a vertical, touch-first workflow; only the spacing and layout allocation of the existing rows changed.

## Scanner portrait

`MobileEtfRow` keeps the same decision order:

1. Ticker, leverage, fund name, price, and daily move.
2. 5D, 1M, 3M, and 52W performance.
3. IV60, compact liquidity state, and Assets/AUM.

The primary identity and quote share one two-column grid row. Supporting metrics and the footer flow underneath it, so a long fund name cannot push the quote into a separate vertical column. Names may wrap to two lines in portrait and expose the full value through the native title affordance.

The compact portrait row has no fixed minimum height. The visual guardrail keeps a populated Scanner card at or below 90px, while preserving the existing 44px controls, link target, filters, search, sorting, and routing behavior. Loading skeletons and the no-results state use the same reduced vertical rhythm.

## ETF Pulse List

Only the phone `List` view is compacted. Each item keeps ticker/name identity, price/trend, 1M/3M/YTD performance, and RSI/vs 50D/DD support metrics. Long names are clamped to two lines with a title affordance; in phone landscape they become a single ellipsized line so the quote remains visible.

List rows flow from content rather than a fixed minimum height. The deterministic visual guardrail keeps a populated phone row at or below 90px in portrait and at or below 100px in phone landscape. Loading skeletons, errors with existing data, and the empty state remain explicit but compact.

Heatmap and Momentum continue to render through their existing `UniverseHeatmap` and `MomentumQuadrant` components. The visual harness switches to each view on both phone projects to ensure the List density work does not remove or alter those paths.

## Phone landscape and desktop parity

The phone-landscape semantic breakpoint remains `max-height: 520px` and `max-width: 950px`, covering 667×375 and 844×390 layouts. Scanner and Pulse rows use a narrower rhythm there, with one-line names and no horizontal page overflow. Controls and touch targets remain unchanged.

Desktop Scanner cards, the desktop ETF Pulse table, filtering/reset/search, routing, universe selection, provider/cache behavior, and calculations are intentionally outside the Stage 2 mobile media queries. Existing 1440×900, 1280×800, and 1024×768 visual captures remain the regression reference.

## Verification

- `e2e/scanner-density.visual.spec.ts` records Scanner card height, visible cards, and horizontal overflow; final phone projects enforce the compact thresholds.
- `e2e/ui-overhaul-ui4.visual.spec.ts` records Pulse List row/skeleton metrics, enforces the compact thresholds, captures loading/List/Heatmap/Momentum states, and checks overflow.
- `tests/mobile-discovery-density-stage2.test.mjs` protects the semantic metric hierarchy, mobile-only scoping, and preserved visual component ownership.
- `scripts/responsive-checklist.mjs` remains the structural guardrail matrix for the full route and viewport set.
