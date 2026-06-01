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

function topMoves(rows: EtfPulseRow[], direction: 'winners' | 'losers'): Array<{ ticker: string; value: number }> {
  return rows
    .filter(row => typeof row.returns.thirtyDay === 'number' && Number.isFinite(row.returns.thirtyDay))
    .sort((a, b) => direction === 'winners'
      ? (b.returns.thirtyDay as number) - (a.returns.thirtyDay as number)
      : (a.returns.thirtyDay as number) - (b.returns.thirtyDay as number))
    .slice(0, 3)
    .map(row => ({ ticker: row.ticker, value: row.returns.thirtyDay as number }));
}

export function analyzeRegime(rows: EtfPulseRow[], fetchedAt: number | null): RegimeAnalysis {
  const valid = rows.filter(row => row.price != null);
  const spy = valid.find(row => row.ticker === 'SPY');
  const qqq = valid.find(row => row.ticker === 'QQQ');
  const above50 = valid.filter(row => (row.distance50 ?? -1) > 0).length;
  const above200 = valid.filter(row => (row.distance200 ?? -1) > 0).length;
  const downtrendCount = valid.filter(row => row.trend === 'Downtrend').length;
  const oversoldCount = valid.filter(row => row.isOversold).length;
  const overboughtCount = valid.filter(row => row.isOverbought).length;
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
  const spyExtended = (spy?.position52Week ?? 0) >= 0.9 || (spy?.rsi14 ?? 0) >= 68;
  const qqqExtended = (qqq?.position52Week ?? 0) >= 0.9 || (qqq?.rsi14 ?? 0) >= 68;
  const extensionCount = valid.filter(row => (row.position52Week ?? 0) >= 0.9 || row.isOverbought).length;
  const vix = valid.find(row => row.ticker === 'VIX');
  const vxn = valid.find(row => row.ticker === 'VXN');

  let label: RegimeAnalysis['label'] = 'Mixed / No Edge';
  if (oversoldShare >= 0.25 && (medianThirtyDayReturn ?? 0) < -0.08 && volElevated) {
    label = 'Oversold Panic';
  } else if ((!spyAbove200 || !qqqAbove200 || broad200Weak) && (medianThirtyDayReturn ?? 0) < 0) {
    label = 'Risk-Off';
  } else if ((broad50Weak || volElevated) && (spyAbove200 || qqqAbove200)) {
    label = 'Choppy / Elevated Vol';
  } else if (spyAbove200 && qqqAbove200 && (!spyAbove50 || !qqqAbove50) && (breadthAbove200 ?? 0) >= 0.55) {
    label = 'Healthy Pullback';
  } else if (spyAbove50 && qqqAbove50 && spyAbove200 && qqqAbove200 && broad200Strong && (spyExtended || qqqExtended || extensionCount >= Math.max(5, valid.length * 0.2))) {
    label = 'Complacent Risk-On';
  } else if (spyAbove50 && qqqAbove50 && spyAbove200 && qqqAbove200 && broad200Strong && (medianThirtyDayReturn ?? 0) > 0) {
    label = 'Healthy Risk-On';
  }

  const confidence: RegimeAnalysis['confidence'] = warnings.length > 0 || valid.length < 12
    ? 'Low'
    : label === 'Mixed / No Edge'
      ? 'Low'
      : (spy && qqq && breadthAbove200 != null && medianThirtyDayReturn != null ? 'High' : 'Medium');

  const drivers = [
    `SPY ${spy?.trend ?? 'unavailable'}, QQQ ${qqq?.trend ?? 'unavailable'}`,
    `${formatPct(breadthAbove200)} of tracked ETFs above 200D`,
    `${overboughtCount} overbought and ${oversoldCount} oversold ETFs; median 30D return ${formatPct(medianThirtyDayReturn)}`,
    vix || vxn ? `Volatility proxies: VIX ${vix?.trend ?? 'unavailable'}, VXN ${vxn?.trend ?? 'unavailable'}` : 'Volatility context unavailable from ETF Pulse cache',
  ];

  const marketRead = label === 'Complacent Risk-On'
    ? 'SPY and QQQ are in strong uptrends, breadth is healthy, and major benchmarks are extended toward the upper part of their 52-week ranges. That supports risk assets, but it can also compress put premium unless volatility is elevated.'
    : label === 'Healthy Risk-On'
      ? 'Trend and breadth are supportive without an obvious panic or extension signal. This is a constructive environment, but bid quality and cushion still determine whether a put is worth selling.'
      : label === 'Healthy Pullback'
        ? 'The long-term trend is still intact, but short-term weakness has reset some names. This is often a better setup than chasing fully extended strength, provided the pullback is controlled.'
        : label === 'Choppy / Elevated Vol'
          ? 'The tape is mixed and realized volatility is elevated. Premiums may be better, but the chance of fast adverse moves is higher.'
          : label === 'Risk-Off'
            ? 'Trend damage is broad enough that new short puts should be treated defensively. Yield may be rising because risk is rising.'
            : label === 'Oversold Panic'
              ? 'Many names are oversold with elevated volatility. Premium can look attractive, but assignment and gap risk are unusually high.'
              : 'The cached technical picture is mixed. There is no obvious market-wide put-selling edge.';

  const putSellingImplication = label === 'Complacent Risk-On'
    ? 'Do not chase low-premium puts just because the trend is strong. Favor wider cushions, smaller size, and pullbacks with still-healthy long-term trend support.'
    : label === 'Healthy Risk-On'
      ? 'Balanced put selling can make sense, especially in liquid underlyings with clean trend support and enough bid-side yield.'
      : label === 'Healthy Pullback'
        ? 'Favor above-200D names where RSI has reset and premium improved. Avoid assuming every dip is automatically safe.'
        : label === 'Choppy / Elevated Vol'
          ? 'Require extra cushion, smaller size, tighter spreads, and avoid weak underlyings below their 200D average.'
          : label === 'Risk-Off'
            ? 'Prioritize portfolio defense over new premium. Only consider very wide, liquid, small-size trades or explicitly speculative setups.'
            : label === 'Oversold Panic'
              ? 'Rich premiums are compensation for real downside risk. Treat new trades as tactical and size accordingly.'
              : 'Use tighter rules, demand clear compensation, and wait when setups are marginal.';

  const favor = label === 'Complacent Risk-On'
    ? ['strong trend plus modest pullback', 'above 200D with RSI not extreme', 'liquid chains with real bid', 'wider cushion over headline yield']
    : ['above 200D underlyings', 'acceptable spreads and OI', 'bid-based annualized yield with real cushion', 'portfolio diversification'];
  const avoid = label === 'Complacent Risk-On'
    ? ['low-premium puts with poor compensation', 'extended ETFs near highs with compressed vol', 'falling knives with high headline yield', 'already concentrated exposures']
    : ['wide spreads', 'no-bid contracts', 'broken downtrends unless speculative', 'adding to concentrated ticker risk'];

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
    stats: {
      spyTrend: spy?.trend ?? '—',
      qqqTrend: qqq?.trend ?? '—',
      breadthAbove50,
      breadthAbove200,
      downtrendCount,
      oversoldCount,
      overboughtCount,
      medianThirtyDayReturn,
      medianRealizedVolatility20,
      spyRsi: spy?.rsi14 ?? null,
      qqqRsi: qqq?.rsi14 ?? null,
      spyPosition52Week: spy?.position52Week ?? null,
      qqqPosition52Week: qqq?.position52Week ?? null,
      vixTrend: vix?.trend ?? null,
      vxnTrend: vxn?.trend ?? null,
      biggestThirtyDayWinners: topMoves(valid, 'winners'),
      biggestThirtyDayLosers: topMoves(valid, 'losers'),
    },
    fetchedAt,
  };
}
