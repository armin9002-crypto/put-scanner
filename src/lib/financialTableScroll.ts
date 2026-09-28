import type { UIEvent } from 'react';

/** One native scroll owner; update presentation only when crossing the start edge.
 * No React state, row work, observers, timers, or geometry measurements.
 */
export function updateFinancialTableScroll(event: UIEvent<HTMLDivElement>) {
  const owner = event.currentTarget;
  const displaced = owner.scrollLeft > 1 ? 'true' : 'false';
  if (owner.dataset.scrolledInline !== displaced) owner.dataset.scrolledInline = displaced;
}
