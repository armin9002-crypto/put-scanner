import type { EtfPulseRow } from '../etfPulseMetrics';
import {
  ETF_PULSE_CONTEXT_BENCHMARK_COUNT,
  ETF_PULSE_CONTEXT_BENCHMARK_TICKERS,
  ETF_PULSE_DISPLAYED_ROW_COUNT,
  ETF_PULSE_LEVERAGED_UNIVERSE_SIZE,
} from '../../../shared/etfPulseUniverse.js';
import type { CanonicalPulseSnapshot, RegimeAnalysis, RegimeMetricPopulation } from './types';

const CONTEXT_BENCHMARKS = new Set(ETF_PULSE_CONTEXT_BENCHMARK_TICKERS);
const CURRENT_EVIDENCE = new Set(['current', 'cached-current']);

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const clean = [...values].sort((a, b) => a - b);
  const middle = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[middle] : (clean[middle - 1] + clean[middle]) / 2;
}

function percent(count: number, total: number): number | null {
  return total > 0 ? count / total : null;
}

function formatPct(value: number | null): string {
  return value == null ? 'unavailable' : `${(value * 100).toFixed(1)}%`;
}

function evidenceFreshness(snapshot: CanonicalPulseSnapshot, row: EtfPulseRow): string {
  return snapshot.rowEvidence?.[row.ticker]?.freshness ?? row.evidenceFreshness ?? (row.price != null ? 'current' : 'unavailable');
}

function isCurrent(snapshot: CanonicalPulseSnapshot, row: EtfPulseRow): boolean {
  return CURRENT_EVIDENCE.has(evidenceFreshness(snapshot, row));
}

function isRetained(snapshot: CanonicalPulseSnapshot, row: EtfPulseRow): boolean {
  return evidenceFreshness(snapshot, row) === 'retained-stale';
}

function benchmarkTrendNarrative(snapshot: CanonicalPulseSnapshot, row: EtfPulseRow | undefined): string {
  if (!row) return 'unavailable';
  const freshness = evidenceFreshness(snapshot, row);
  if (CURRENT_EVIDENCE.has(freshness)) return row.trend || 'unavailable';
  if (freshness !== 'retained-stale') return 'unavailable';
  const observedAt = snapshot.rowEvidence?.[row.ticker]?.observedAt ?? row.observedAt ?? null;
  const observed = observedAt != null && Number.isFinite(observedAt)
    ? `, observed ${new Date(observedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC`
    : '';
  return `retained/stale ${row.trend || 'trend unavailable'}${observed}`;
}

function populationRows(snapshot: CanonicalPulseSnapshot, context: boolean): EtfPulseRow[] {
  return snapshot.rows.filter(row => CONTEXT_BENCHMARKS.has(row.ticker) === context);
}

function rowCounts(snapshot: CanonicalPulseSnapshot, rows: EtfPulseRow[], intended: number) {
  const current = rows.filter(row => isCurrent(snapshot, row)).length;
  const retained = rows.filter(row => isRetained(snapshot, row)).length;
  return { current, retained, unavailable: Math.max(0, intended - current - retained) };
}

function metricPopulation(
  snapshot: CanonicalPulseSnapshot,
  rows: EtfPulseRow[],
  intended: number,
  valueOf: (row: EtfPulseRow) => number | null,
  predicate?: (value: number, row: EtfPulseRow) => boolean,
): RegimeMetricPopulation {
  const currentValues = rows
    .filter(row => isCurrent(snapshot, row))
    .flatMap(row => {
      const value = valueOf(row);
      return value == null ? [] : [{ value, row }];
    });
  const retainedValues = rows
    .filter(row => isRetained(snapshot, row))
    .map(row => valueOf(row))
    .filter((value): value is number => value != null);
  const numerator = predicate ? currentValues.filter(item => predicate(item.value, item.row)).length : null;
  const denominator = currentValues.length;
  return {
    intended,
    currentValid: denominator,
    retained: retainedValues.length,
    unavailable: Math.max(0, intended - denominator - retainedValues.length),
    numerator,
    denominator,
    value: predicate ? percent(numerator ?? 0, denominator) : median(currentValues.map(item => item.value)),
  };
}

function booleanMetric(
  snapshot: CanonicalPulseSnapshot,
  rows: EtfPulseRow[],
  intended: number,
  valueOf: (row: EtfPulseRow) => boolean | null,
): RegimeMetricPopulation {
  return metricPopulation(snapshot, rows, intended, row => valueOf(row) == null ? null : 1, (_, row) => valueOf(row) === true);
}

function topMoves(snapshot: CanonicalPulseSnapshot, rows: EtfPulseRow[], direction: 'winners' | 'losers'): Array<{ ticker: string; value: number }> {
  return rows
    .filter(row => isCurrent(snapshot, row) && finite(row.returns.thirtyDay) != null)
    .sort((a, b) => direction === 'winners'
      ? (b.returns.thirtyDay as number) - (a.returns.thirtyDay as number)
      : (a.returns.thirtyDay as number) - (b.returns.thirtyDay as number))
    .slice(0, 3)
    .map(row => ({ ticker: row.ticker, value: row.returns.thirtyDay as number }));
}

function currentContextValue(snapshot: CanonicalPulseSnapshot, row: EtfPulseRow | undefined, valueOf: (row: EtfPulseRow) => number | null): number | null {
  return row && isCurrent(snapshot, row) ? valueOf(row) : null;
}

function currentContextDirection(snapshot: CanonicalPulseSnapshot, row: EtfPulseRow | undefined, valueOf: (row: EtfPulseRow) => number | null): boolean | null {
  const value = currentContextValue(snapshot, row, valueOf);
  return value == null ? null : value > 0;
}

function currentContextExtended(snapshot: CanonicalPulseSnapshot, row: EtfPulseRow | undefined): boolean {
  const position = currentContextValue(snapshot, row, item => finite(item.position52Week));
  const rsi = currentContextValue(snapshot, row, item => finite(item.rsi14));
  return (position != null && position >= 0.9) || (rsi != null && rsi >= 68);
}

export function deriveMarketRegime(snapshot: CanonicalPulseSnapshot): RegimeAnalysis {
  const leveragedRows = populationRows(snapshot, false);
  const contextRows = populationRows(snapshot, true);
  const leveragedCounts = rowCounts(snapshot, leveragedRows, ETF_PULSE_LEVERAGED_UNIVERSE_SIZE);
  const contextCounts = rowCounts(snapshot, contextRows, ETF_PULSE_CONTEXT_BENCHMARK_COUNT);
  const spy = snapshot.rows.find(row => row.ticker === 'SPY');
  const qqq = snapshot.rows.find(row => row.ticker === 'QQQ');

  const rsi = metricPopulation(snapshot, leveragedRows, ETF_PULSE_LEVERAGED_UNIVERSE_SIZE, row => finite(row.rsi14));
  const movingAverage50 = metricPopulation(snapshot, leveragedRows, ETF_PULSE_LEVERAGED_UNIVERSE_SIZE, row => finite(row.distance50), value => value > 0);
  const movingAverage200 = metricPopulation(snapshot, leveragedRows, ETF_PULSE_LEVERAGED_UNIVERSE_SIZE, row => finite(row.distance200), value => value > 0);
  const return30 = metricPopulation(snapshot, leveragedRows, ETF_PULSE_LEVERAGED_UNIVERSE_SIZE, row => finite(row.returns.thirtyDay));
  const realizedVolatility20 = metricPopulation(snapshot, leveragedRows, ETF_PULSE_LEVERAGED_UNIVERSE_SIZE, row => finite(row.realizedVolatility20));
  const trend = booleanMetric(snapshot, leveragedRows, ETF_PULSE_LEVERAGED_UNIVERSE_SIZE, row => typeof row.trend === 'string' && row.trend.length > 0 ? row.trend === 'Downtrend' : null);
  const oversold = booleanMetric(snapshot, leveragedRows, ETF_PULSE_LEVERAGED_UNIVERSE_SIZE, row => finite(row.rsi14) == null ? null : row.isOversold);
  const overbought = booleanMetric(snapshot, leveragedRows, ETF_PULSE_LEVERAGED_UNIVERSE_SIZE, row => finite(row.rsi14) == null ? null : row.isOverbought);
  const spyAbove200 = currentContextDirection(snapshot, spy, row => finite(row.distance200));
  const qqqAbove200 = currentContextDirection(snapshot, qqq, row => finite(row.distance200));
  const spyAbove50 = currentContextDirection(snapshot, spy, row => finite(row.distance50));
  const qqqAbove50 = currentContextDirection(snapshot, qqq, row => finite(row.distance50));
  const breadthAbove50 = movingAverage50.value;
  const breadthAbove200 = movingAverage200.value;
  const medianThirtyDayReturn = return30.value;
  const medianRealizedVolatility20 = realizedVolatility20.value;
  const downtrendCount = trend.numerator ?? 0;
  const oversoldCount = oversold.numerator ?? 0;
  const overboughtCount = overbought.numerator ?? 0;
  const currentLeveragedRows = leveragedRows.filter(row => isCurrent(snapshot, row));
  const spyExtended = currentContextExtended(snapshot, spy);
  const qqqExtended = currentContextExtended(snapshot, qqq);
  const extensionCount = currentLeveragedRows.filter(row => {
    const position = finite(row.position52Week);
    const rsi = finite(row.rsi14);
    return (position != null && position >= 0.9) || (rsi != null && row.isOverbought);
  }).length;
  const vix = snapshot.rows.find(row => row.ticker === 'VIX' || row.ticker === '^VIX');
  const vxn = snapshot.rows.find(row => row.ticker === 'VXN' || row.ticker === '^VXN');
  const spyTrend = benchmarkTrendNarrative(snapshot, spy);
  const qqqTrend = benchmarkTrendNarrative(snapshot, qqq);
  const vixTrend = benchmarkTrendNarrative(snapshot, vix);
  const vxnTrend = benchmarkTrendNarrative(snapshot, vxn);
  const warnings: string[] = [];

  if (spyAbove200 == null || qqqAbove200 == null) warnings.push('SPY or QQQ current technical context is missing.');
  if (Math.min(movingAverage200.currentValid, return30.currentValid) < 8) warnings.push('ETF Pulse cache is thin; regime confidence is reduced.');

  const broad200Strong = breadthAbove200 != null && breadthAbove200 >= 0.65;
  const broad200Weak = breadthAbove200 != null && breadthAbove200 < 0.45;
  const broad50Weak = breadthAbove50 != null && breadthAbove50 < 0.45;
  const volElevated = medianRealizedVolatility20 != null && medianRealizedVolatility20 >= 0.55;
  const oversoldShare = oversold.value;

  let label: RegimeAnalysis['label'] = 'Mixed / No Edge';
  if ((oversoldShare ?? 0) >= 0.25 && (medianThirtyDayReturn ?? 0) < -0.08 && volElevated) {
    label = 'Oversold Panic';
  } else if ((spyAbove200 === false || qqqAbove200 === false || broad200Weak) && (medianThirtyDayReturn ?? 0) < 0) {
    label = 'Risk-Off';
  } else if ((broad50Weak || volElevated) && (spyAbove200 === true || qqqAbove200 === true)) {
    label = 'Choppy / Elevated Vol';
  } else if (spyAbove200 === true && qqqAbove200 === true && (spyAbove50 === false || qqqAbove50 === false) && (breadthAbove200 ?? 0) >= 0.55) {
    label = 'Healthy Pullback';
  } else if (spyAbove50 === true && qqqAbove50 === true && spyAbove200 === true && qqqAbove200 === true && broad200Strong && (spyExtended || qqqExtended || extensionCount >= Math.max(5, currentLeveragedRows.length * 0.2))) {
    label = 'Complacent Risk-On';
  } else if (spyAbove50 === true && qqqAbove50 === true && spyAbove200 === true && qqqAbove200 === true && broad200Strong && (medianThirtyDayReturn ?? 0) > 0) {
    label = 'Healthy Risk-On';
  }

  const currentMetricCoverage = [rsi, movingAverage50, movingAverage200, return30, realizedVolatility20, trend, oversold, overbought];
  const sparseCurrentEvidence = Math.min(...currentMetricCoverage.map(metric => metric.currentValid)) < 12;
  const incompleteCurrentEvidence = currentMetricCoverage.some(metric => metric.currentValid < ETF_PULSE_LEVERAGED_UNIVERSE_SIZE);
  const contextIncomplete = spyAbove200 == null || qqqAbove200 == null;
  const confidence: RegimeAnalysis['confidence'] = sparseCurrentEvidence || contextIncomplete || label === 'Mixed / No Edge'
    ? 'Low'
    : incompleteCurrentEvidence
      ? 'Medium'
      : 'High';

  const drivers = [
    `SPY ${spyTrend}, QQQ ${qqqTrend}`,
    `${formatPct(breadthAbove200)} of leveraged ETFs above 200D`,
    `${overboughtCount} overbought and ${oversoldCount} oversold leveraged ETFs; median 30D return ${formatPct(medianThirtyDayReturn)}`,
    vix || vxn ? `Volatility proxies: VIX ${vixTrend}, VXN ${vxnTrend}` : 'Volatility context unavailable from ETF Pulse cache',
  ];

  const marketRead = label === 'Complacent Risk-On'
    ? 'Risk assets are trending well, but extension and low volatility can make put premiums less attractive.'
    : label === 'Healthy Risk-On'
      ? 'Trend and breadth are supportive, with no obvious stress signal.'
      : label === 'Healthy Pullback'
        ? 'Trend remains intact while short-term weakness has reset some premium and entry levels.'
        : label === 'Choppy / Elevated Vol'
          ? 'Trend is mixed and realized volatility is elevated. Premiums may improve, but adverse moves can happen quickly.'
          : label === 'Risk-Off'
            ? 'Breadth and trend are weak. High yields are likely compensation for real drawdown risk.'
            : label === 'Oversold Panic'
              ? 'Oversold conditions can improve premiums, but assignment and gap risk are elevated.'
              : 'Signals are not decisive. The environment does not offer a clear broad-market edge.';

  const putSellingImplication = label === 'Complacent Risk-On'
    ? 'Be selective. Do not sell low-premium puts just because the tape is strong.'
    : label === 'Healthy Risk-On'
      ? 'Balanced put-selling environment, but still require cushion and liquidity.'
      : label === 'Healthy Pullback'
        ? 'This can be a better put-selling setup if the underlying remains above key trend levels.'
        : label === 'Choppy / Elevated Vol'
          ? 'Use smaller size, wider cushions, and stricter liquidity filters.'
          : label === 'Risk-Off'
            ? 'Prioritize defense over new premium. Only sell puts with very wide cushions or clear tactical intent.'
            : label === 'Oversold Panic'
              ? 'Premiums can be rich, but treat new trades as tactical and size for gap risk.'
              : 'Be selective and let individual ETF setup quality drive decisions.';

  const favor = label === 'Complacent Risk-On'
    ? ['healthy pullbacks', 'strong trends', 'wider cushions', 'liquid chains']
    : label === 'Choppy / Elevated Vol'
      ? ['above-200D setups', 'RSI resets', 'tight spreads', 'lower delta']
      : label === 'Risk-Off'
        ? ['cash', 'smaller size', 'very low delta', 'strongest underlyings']
        : label === 'Healthy Pullback'
          ? ['RSI 35-55', 'above 200D', 'reasonable spread', '25-35% cushion']
          : label === 'Healthy Risk-On'
            ? ['clean trends', 'moderate deltas', 'liquid expirations', 'portfolio diversification']
            : label === 'Oversold Panic'
              ? ['small tactical size', 'very wide cushion', 'liquid chains', 'clear assignment plan']
              : ['clean single-name setups', 'high liquidity', 'wider cushions', 'patient entries'];
  const avoid = label === 'Complacent Risk-On'
    ? ['chasing extended ETFs', 'low-yield contracts', 'crowded portfolio exposures', 'thin compensation']
    : label === 'Choppy / Elevated Vol'
      ? ['weak underlyings below 200D', 'wide spreads', 'high-yield falling knives', 'oversized trades']
      : label === 'Risk-Off'
        ? ['broken trends', 'high-beta leverage', 'near-the-money puts', 'headline yield traps']
        : label === 'Healthy Pullback'
          ? ['breaks below 200D', 'severe drawdown acceleration', 'illiquid strikes', 'assuming every dip is safe']
          : label === 'Healthy Risk-On'
            ? ['overconcentration', 'low premium', 'illiquid strikes', 'poor cushion']
            : label === 'Oversold Panic'
              ? ['near-the-money puts', 'oversized risk', 'unplanned assignment', 'illiquid panic premium']
              : ['forcing trades', 'weak liquidity', 'unclear technicals', 'marginal compensation'];

  return {
    label,
    confidence,
    explanation: label === 'Complacent Risk-On'
      ? 'Trend is supportive, but the better decision may be patience when premium is thin.'
      : label === 'Healthy Risk-On'
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
    marketRead,
    putSellingImplication,
    favor,
    avoid,
    drivers,
    warnings,
    intendedUniverse: {
      leveragedUniverseSize: ETF_PULSE_LEVERAGED_UNIVERSE_SIZE,
      contextBenchmarkCount: ETF_PULSE_CONTEXT_BENCHMARK_COUNT,
      displayedRowCount: ETF_PULSE_DISPLAYED_ROW_COUNT,
    },
    currentEvidence: { leveraged: leveragedCounts.current, contextBenchmarks: contextCounts.current },
    retainedEvidence: { leveraged: leveragedCounts.retained, contextBenchmarks: contextCounts.retained },
    unavailableEvidence: { leveraged: leveragedCounts.unavailable, contextBenchmarks: contextCounts.unavailable },
    coverage: {
      intendedLeveraged: ETF_PULSE_LEVERAGED_UNIVERSE_SIZE,
      currentLeveraged: leveragedCounts.current,
      retainedLeveraged: leveragedCounts.retained,
      unavailableLeveraged: leveragedCounts.unavailable,
      currentContextBenchmarks: contextCounts.current,
      retainedContextBenchmarks: contextCounts.retained,
      unavailableContextBenchmarks: contextCounts.unavailable,
      currentRatio: percent(leveragedCounts.current, ETF_PULSE_LEVERAGED_UNIVERSE_SIZE),
    },
    metrics: { rsi, movingAverage50, movingAverage200, return30, realizedVolatility20, trend, oversold, overbought },
    evidenceObservedAt: snapshot.fetchedAt,
    marketDataThrough: snapshot.marketDataThrough ?? null,
    stats: {
      spyTrend,
      qqqTrend,
      breadthAbove50,
      breadthAbove200,
      downtrendCount,
      oversoldCount,
      overboughtCount,
      medianThirtyDayReturn,
      medianRealizedVolatility20,
      spyRsi: currentContextValue(snapshot, spy, row => finite(row.rsi14)),
      qqqRsi: currentContextValue(snapshot, qqq, row => finite(row.rsi14)),
      spyPosition52Week: currentContextValue(snapshot, spy, row => finite(row.position52Week)),
      qqqPosition52Week: currentContextValue(snapshot, qqq, row => finite(row.position52Week)),
      vixTrend: vix ? vixTrend : null,
      vxnTrend: vxn ? vxnTrend : null,
      biggestThirtyDayWinners: topMoves(snapshot, leveragedRows, 'winners'),
      biggestThirtyDayLosers: topMoves(snapshot, leveragedRows, 'losers'),
    },
    fetchedAt: snapshot.fetchedAt,
  };
}

/** Compatibility entry point for existing callers and older fixtures. */
export function analyzeRegime(rows: EtfPulseRow[], fetchedAt: number | null): RegimeAnalysis {
  return deriveMarketRegime({ rows, fetchedAt });
}
