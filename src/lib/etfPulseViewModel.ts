import type { EtfPulseRow } from './etfPulseMetrics';
import { technicalStateLabel, type UnderlyingTechnicalState } from './underlyingTechnical.ts';

export type PulseSortField = 'ticker' | 'name' | 'type' | 'leverage' | 'price' | 'oneDay' | 'fiveDay' | 'thirtyDay' | 'threeMonth' | 'sixMonth' | 'yearToDate' | 'oneYear' | 'recentDrawdown30' | 'rsi14' | 'realizedVolatility20' | 'distance20' | 'distance50' | 'distance200' | 'high52Week' | 'percentOf52WeekHigh' | 'position52Week' | 'drawdown52Week' | 'trend';
export type TrendFilter = 'All' | UnderlyingTechnicalState;
export type VisualPeriod = '1D' | '5D' | '30D' | '3M' | '6M' | 'YTD' | '1Y';

export function getReturnForPeriod(row: EtfPulseRow, period: VisualPeriod): number | null {
  const field = { '1D': 'oneDay', '5D': 'fiveDay', '30D': 'thirtyDay', '3M': 'threeMonth', '6M': 'sixMonth', YTD: 'yearToDate', '1Y': 'oneYear' }[period] as keyof EtfPulseRow['returns'];
  return row.returns[field];
}

export function heatmapTileStyle(value: number | null): { backgroundColor: string; borderColor: string; color: string } {
  if (!Number.isFinite(value)) return { backgroundColor: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text-dim)' };
  if (value! >= 0.2) return { backgroundColor: 'rgba(34,197,94,0.28)', borderColor: 'rgba(34,197,94,0.42)', color: 'var(--green)' };
  if (value! >= 0.05) return { backgroundColor: 'rgba(34,197,94,0.18)', borderColor: 'rgba(34,197,94,0.30)', color: 'var(--green)' };
  if (value! >= 0) return { backgroundColor: 'rgba(34,197,94,0.08)', borderColor: 'rgba(34,197,94,0.18)', color: 'var(--text-secondary)' };
  if (value! > -0.05) return { backgroundColor: 'rgba(249,115,22,0.08)', borderColor: 'rgba(249,115,22,0.18)', color: 'var(--text-secondary)' };
  if (value! > -0.2) return { backgroundColor: 'rgba(249,115,22,0.18)', borderColor: 'rgba(249,115,22,0.32)', color: 'var(--orange)' };
  return { backgroundColor: 'rgba(239,68,68,0.24)', borderColor: 'rgba(239,68,68,0.42)', color: 'var(--red)' };
}

export function trendStyle(row: EtfPulseRow): { label: string; color: string; bg: string; border: string } {
  const state = row.technicalAssessment.state;
  const label = technicalStateLabel(state);
  if (state === 'STRONG_TREND') return { label, color: 'var(--green)', bg: 'rgba(34,197,94,0.10)', border: 'rgba(34,197,94,0.25)' };
  if (state === 'CONSTRUCTIVE_PULLBACK' || state === 'RECOVERY_RECLAIM') return { label, color: 'var(--green)', bg: 'rgba(34,197,94,0.06)', border: 'rgba(34,197,94,0.18)' };
  if (state === 'OVERSOLD_INTACT') return { label, color: 'var(--accent-light)', bg: 'var(--accent-bg)', border: 'var(--accent-border)' };
  if (state === 'EXTENDED') return { label, color: 'var(--orange)', bg: 'rgba(251,146,60,0.10)', border: 'rgba(251,146,60,0.28)' };
  if (state === 'TRANSITION_DETERIORATING') return { label, color: 'var(--yellow)', bg: 'rgba(250,204,21,0.10)', border: 'rgba(250,204,21,0.25)' };
  if (state === 'BROKEN_TREND') return { label, color: 'var(--red)', bg: 'rgba(239,68,68,0.10)', border: 'rgba(239,68,68,0.25)' };
  return { label, color: 'var(--text-muted)', bg: 'var(--surface-alt)', border: 'var(--border)' };
}

export function sortValue(row: EtfPulseRow, field: PulseSortField): number | string | null {
  if (field in row.returns) return row.returns[field as keyof EtfPulseRow['returns']];
  if (field === 'trend') return trendStyle(row).label;
  const value = row[field as keyof EtfPulseRow];
  return typeof value === 'number' || typeof value === 'string' ? value : null;
}

export function matchesTrend(row: EtfPulseRow, filter: TrendFilter): boolean {
  if (filter === 'All') return true;
  return row.technicalAssessment.state === filter;
}
