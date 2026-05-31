import type { EtfPulseRow } from '../etfPulseMetrics';
import type { RegimeAnalysis } from './types';

function median(values: Array<number | null | undefined>): number | null {
  const clean = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value)).sort((a, b) => a - b);
  if (clean.length === 0) return null;
  const middle = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[middle] : (clean[middle - 1] + clean[middle]) / 2;
}

function percent(count: number, total: number): number | null {
  return total > 0 ? count / total : null;
}

function formatPct(value: number | null): string {
  return value == null ? 'unavailable' : `${(value * 100).toFixed(1)}%`;
}

export function analyzeRegime(rows: EtfPulseRow[], fetchedAt: number | null): RegimeAnalysis {
  const valid = rows.filter(row => row.price != null);
  const spy = valid.find(row => row.ticker === 'SPY');
  const qqq = valid.find(row => row.ticker === 'QQQ');
  const above50 = valid.filter(row => (row.distance50 ?? -1) > 0).length;
  const above200 = valid.filter(row => (row.distance200 ?? -1) > 0).length;
  const downtrendCount = valid.filter(row => row.trend === 'Downtrend').length;
  const oversoldCount = valid.filter(row => row.isOversold).length;
  const medianThirtyDayReturn = median(valid.map(row => row.returns.thirtyDay));
  const medianRealizedVolatility20 = median(valid.map(row => row.realizedVolatility20));
  const breadthAbove50 = percent(above50, valid.length);
  const breadthAbove200 = percent(above200, valid.length);
  const warnings: string[] = [];

  if (!spy || !qqq) warnings.push('SPY or QQQ technical context is missing.');
  if (valid.length < 8) warnings.push('ETF Pulse cache is thin; regime confidence is reduced.');

  const spyAbove200 = (spy?.distance200 ?? -1) > 0;
  const qqqAbove200 = (qqq?.distance200 ?? -1) > 0;
  const spyAbove50 = (spy?.distance50 ?? -1) > 0;
  const qqqAbove50 = (qqq?.distance50 ?? -1) > 0;
  const broad200Strong = (breadthAbove200 ?? 0) >= 0.65;
  const broad200Weak = (breadthAbove200 ?? 1) < 0.45;
  const broad50Weak = (breadthAbove50 ?? 1) < 0.45;
  const volElevated = (medianRealizedVolatility20 ?? 0) >= 0.55;
  const oversoldShare = valid.length > 0 ? oversoldCount / valid.length : 0;

  let label: RegimeAnalysis['label'] = 'Mixed / No Edge';
  if (oversoldShare >= 0.25 && (medianThirtyDayReturn ?? 0) < -0.08 && volElevated) {
    label = 'Oversold Panic';
  } else if ((!spyAbove200 || !qqqAbove200 || broad200Weak) && (medianThirtyDayReturn ?? 0) < 0) {
    label = 'Risk-Off';
  } else if ((broad50Weak || volElevated) && (spyAbove200 || qqqAbove200)) {
    label = 'Choppy / Elevated Vol';
  } else if (spyAbove200 && qqqAbove200 && (!spyAbove50 || !qqqAbove50) && (breadthAbove200 ?? 0) >= 0.55) {
    label = 'Healthy Pullback';
  } else if (spyAbove50 && qqqAbove50 && spyAbove200 && qqqAbove200 && broad200Strong && (medianThirtyDayReturn ?? 0) > 0) {
    label = 'Risk-On';
  }

  const confidence: RegimeAnalysis['confidence'] = warnings.length > 0 || valid.length < 12
    ? 'Low'
    : label === 'Mixed / No Edge'
      ? 'Low'
      : (spy && qqq && breadthAbove200 != null && medianThirtyDayReturn != null ? 'High' : 'Medium');

  const drivers = [
    `SPY ${spy?.trend ?? 'unavailable'}, QQQ ${qqq?.trend ?? 'unavailable'}`,
    `${formatPct(breadthAbove200)} of tracked ETFs above 200D`,
    `${oversoldCount} oversold ETFs; median 30D return ${formatPct(medianThirtyDayReturn)}`,
  ];

  return {
    label,
    confidence,
    explanation: label === 'Risk-On'
      ? 'Trend and breadth are supportive, but cushion and liquidity still matter.'
      : label === 'Healthy Pullback'
        ? 'Major indices remain structurally constructive while some weakness may be improving put premiums.'
        : label === 'Choppy / Elevated Vol'
          ? 'Mixed breadth or elevated realized volatility argues for smaller, cleaner, more liquid trades.'
          : label === 'Risk-Off'
            ? 'Trend damage is broad enough that put selling should be selective and defensive.'
            : label === 'Oversold Panic'
              ? 'Oversold conditions can create premium, but gap risk and falling-knife behavior are elevated.'
              : 'The current cached technical picture does not provide a clear edge.',
    drivers,
    warnings,
    stats: {
      spyTrend: spy?.trend ?? '—',
      qqqTrend: qqq?.trend ?? '—',
      breadthAbove50,
      breadthAbove200,
      downtrendCount,
      oversoldCount,
      medianThirtyDayReturn,
      medianRealizedVolatility20,
    },
    fetchedAt,
  };
}
