# Portfolio density and realized P&L chart refinement

Implementation date: 2026-08-31

This focused pass keeps Portfolio calculations, expiration-month bucketing, lifecycle semantics, persistence, and request behavior unchanged. It tightens presentation only.

## Density results

At the repaired 1440×900 visual fixture viewport:

| Surface | Before | After | Result |
| --- | ---: | ---: | --- |
| Top Portfolio KPI cards | 66px | 54px | 18.2% shorter; values and order unchanged |
| Attention Queue / Close Candidates | 204.9px | 173.7px | 15.2% shorter; desktop cards remain exactly equal height and aligned |
| History KPI cards | 62px | 52px | 16.1% shorter; eight equal-width cards remain in the established order |
| Portfolio title → Schedule | 609.8px | 554.5px | 55.3px saved above the fold |
| History title → History table | 292px | 280px | 12px saved |
| Realized P&L chart | ≈162px | 162px | Height disciplined; label headroom is internal |

The 1280px, 1024px, phone portrait, and phone landscape fixtures show the same compact card treatment without page-level overflow. Phone History cards are 50px high (58px before).

The outcome distribution bar is retained as the four lifecycle-outcome summary and now uses a restrained 6px bottom gap before the chart.

## Chart presentation

- Title remains `Realized P&L by Expiration Month`.
- Ticks stay in compact `Mon 'YY` form (for example, `Jul '26`) and use the next readable token step (10px).
- Labels use the canonical monthly aggregate, rounded to whole dollars: positives such as `$170`; negatives such as `($150)` with no minus sign.
- Exact-zero buckets intentionally omit a dollar label; the bucket/month remains present.
- Positive and negative labels/bars use the shared semantic `--positive` / `--negative` tokens.
- A centered zero line and split plot keep labels at the natural end of each bar. Each month keeps a 48px minimum inside the chart’s bounded horizontal scroller, preventing collisions without creating page overflow.

## Responsive/theme review

The after matrix covered 1440×900, 1280×800, 1024×768, 430×932, 390×844, 375×667, 844×390, and 667×375. Dark, Light, Sepia, and Dark Blue captures retain the same hierarchy and semantic colors. Portrait and landscape layouts keep the chart contained and the existing touch-safe controls intact.

The first visual pass exposed excess card padding and a chart that had no visible monthly value context. The second pass reduced card/list padding and gaps, added the zero-line split layout, reserved internal label headroom, and tightened outcome-bar spacing. No financial semantics or source values were changed.
