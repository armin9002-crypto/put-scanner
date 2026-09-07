import type { PortfolioTrade } from './portfolioStorage.ts';
import type { MarkBasis } from './portfolioMetrics.ts';

function positive(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/** Portfolio valuation only. This is never executable option-price evidence. */
export function resolvePortfolioMark(trade: PortfolioTrade, basis: MarkBasis): { value: number | null; source: 'selected' | 'last_fallback' | 'unavailable' } {
  const md = trade.latestMarketData;
  if (!md) return { value: null, source: 'unavailable' };
  let selected: number | null = null;
  if (trade.status !== 'open' || (md.optionIntegrityStatus !== 'invalid' && !md.lastFallbackOnly)) {
    selected = basis === 'bid' ? positive(md.optionBid) : basis === 'ask' ? positive(md.optionAsk) : basis === 'last' ? positive(md.optionLast) : positive(md.optionMid);
    if (basis === 'mid' && selected == null) {
      const bid = positive(md.optionBid), ask = positive(md.optionAsk);
      if (bid != null && ask != null && ask >= bid) selected = (bid + ask) / 2;
    }
  }
  if (selected != null) return { value: selected, source: 'selected' };
  if (trade.status !== 'open' && basis === 'mid') return { value: positive(md.optionLast), source: positive(md.optionLast) != null ? 'selected' : 'unavailable' };
  const last = trade.status === 'open' && md.availabilityStatus !== 'imported_snapshot' ? positive(md.optionLast) : null;
  return last != null ? { value: last, source: 'last_fallback' } : { value: null, source: 'unavailable' };
}
