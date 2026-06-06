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
