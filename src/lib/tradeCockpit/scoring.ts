import type { EtfPulseRow } from '../etfPulseMetrics';
import type { PortfolioTrade } from '../portfolioStorage';
import type { CandidateBucket, CandidateLabel, ScanCriteria, TradeCandidate, TradeStyle } from './types';

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function finite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function portfolioHasTicker(ticker: string, trades: PortfolioTrade[]): boolean {
  return trades.some(trade => trade.status === 'open' && trade.ticker.toUpperCase() === ticker.toUpperCase());
}

function portfolioTickerGrossRisk(ticker: string, trades: PortfolioTrade[]): number {
  return trades
    .filter(trade => trade.status === 'open' && trade.ticker.toUpperCase() === ticker.toUpperCase())
    .reduce((sum, trade) => sum + (trade.strike * 100 * trade.contracts), 0);
}

export function scoreCandidate(input: {
  base: Omit<TradeCandidate, 'opportunityScore' | 'riskScore' | 'fitScore' | 'score' | 'label' | 'bucket' | 'reason' | 'warnings' | 'alreadyExposed'>;
  pulseRow: EtfPulseRow | null;
  criteria: ScanCriteria;
  portfolioTrades: PortfolioTrade[];
}): TradeCandidate {
  const { base, pulseRow, criteria, portfolioTrades } = input;
  const warnings: string[] = [];
  const annYield = base.annualizedYieldBid;
  const spread = base.spreadPercent;
  const distance = base.distanceToStrike;
  const absDelta = finite(base.delta) ? Math.abs(base.delta) : null;
  const alreadyExposed = portfolioHasTicker(base.ticker, portfolioTrades);
  const tickerGrossRisk = portfolioTickerGrossRisk(base.ticker, portfolioTrades);

  if (base.delta == null) warnings.push('Missing delta; scored with cushion and trend context.');
  if (spread == null) warnings.push('Missing spread data.');
  if ((base.openInterest ?? 0) < criteria.minOpenInterest) warnings.push('Open interest below preferred threshold.');

  const opportunityScore = clamp(
    (finite(annYield) ? Math.min(annYield / 0.35, 1) * 42 : 0) +
    (base.bid > 0 ? 12 : 0) +
    (finite(spread) ? Math.max(0, 1 - spread / criteria.maxSpreadPercent) * 18 : 6) +
    (finite(base.openInterest) ? Math.min(base.openInterest / 500, 1) * 16 : 0) +
    (base.dte >= criteria.minDte && base.dte <= criteria.maxDte ? 12 : 0)
  );

  const riskPenalty =
    (absDelta != null ? Math.min(absDelta / Math.max(criteria.maxDelta, 0.01), 1.5) * 30 : 10) +
    (finite(distance) ? Math.max(0, 1 - distance / Math.max(criteria.minDistanceToStrike, 0.01)) * 25 : 12) +
    ((pulseRow?.trend === 'Downtrend') ? 18 : 0) +
    ((pulseRow?.distance200 ?? 0) < 0 ? 12 : 0) +
    ((pulseRow?.recentDrawdown30 ?? 0) < -0.15 ? 10 : 0) +
    (finite(spread) && spread > criteria.maxSpreadPercent ? 18 : 0);
  const riskScore = clamp(100 - riskPenalty);

  const fitScore = clamp(
    55 +
    (base.watchlisted ? 8 : 0) -
    (alreadyExposed ? 20 : 0) +
    (pulseRow?.trend === 'Strong Uptrend' ? 14 : 0) +
    (pulseRow?.trend === 'Uptrend' ? 8 : 0) +
    (pulseRow?.trend === 'Weakening' ? -6 : 0) +
    (pulseRow?.trend === 'Downtrend' ? -18 : 0) +
    ((pulseRow?.rsi14 ?? 50) >= 35 && (pulseRow?.rsi14 ?? 50) <= 62 ? 8 : 0)
  );

  const score = clamp((opportunityScore * 0.36) + (riskScore * 0.38) + (fitScore * 0.26));
  let label: CandidateLabel = 'Clean';
  let bucket: CandidateBucket = 'Best Clean Setups';

  if (alreadyExposed) {
    label = 'Already Exposed';
    bucket = 'Already Exposed';
  } else if ((spread != null && spread > criteria.maxSpreadPercent) || (base.openInterest ?? 0) < criteria.minOpenInterest) {
    label = 'Illiquid';
    bucket = 'Avoid / Falling Knives';
  } else if (pulseRow?.trend === 'Downtrend' || (pulseRow?.distance50 ?? 0) < 0 && (pulseRow?.distance200 ?? 0) < 0 || (pulseRow?.recentDrawdown30 ?? 0) < -0.18) {
    label = criteria.tradeStyle === 'Speculative' ? 'Speculative' : 'Avoid';
    bucket = criteria.tradeStyle === 'Speculative' ? 'High Yield / High Risk' : 'Avoid / Falling Knives';
  } else if ((annYield ?? 0) >= 0.35 || (pulseRow?.realizedVolatility20 ?? 0) >= 0.8) {
    label = 'High Yield / High Risk';
    bucket = 'High Yield / High Risk';
  } else if (pulseRow?.trend === 'Weakening' || ((pulseRow?.rsi14 ?? 99) >= 35 && (pulseRow?.rsi14 ?? 99) <= 55 && (pulseRow?.distance200 ?? -1) > 0)) {
    label = 'Healthy Pullback';
    bucket = 'Healthy Pullbacks';
  }

  const reason = label === 'Already Exposed'
    ? `Good setup may exist, but portfolio already has ${tickerGrossRisk.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })} gross risk in ${base.ticker}.`
    : label === 'Illiquid'
      ? 'Liquidity or spread is weaker than the current scan settings.'
      : label === 'Healthy Pullback'
        ? `Pulled back with long-term trend context intact; ${finite(distance) ? `${(distance * 100).toFixed(1)}% cushion` : 'cushion unavailable'}.`
        : label === 'High Yield / High Risk' || label === 'Speculative'
          ? `High bid-side yield, but ${pulseRow?.trend ?? 'trend'} and volatility/drawdown risk deserve caution.`
          : label === 'Avoid'
            ? 'Technical setup or liquidity makes this a poor fit for the current posture.'
            : `${pulseRow?.trend ?? 'Supportive trend'}, ${finite(distance) ? `${(distance * 100).toFixed(1)}% cushion` : 'cushion ok'}, acceptable spread and liquidity.`;

  return {
    ...base,
    opportunityScore,
    riskScore,
    fitScore,
    score,
    label,
    bucket,
    reason,
    warnings,
    alreadyExposed,
  };
}

export function sortCandidates(candidates: TradeCandidate[]): TradeCandidate[] {
  return [...candidates].sort((a, b) => b.score - a.score);
}

export function styleAllowsMissingDelta(style: TradeStyle): boolean {
  return style === 'Aggressive' || style === 'Speculative';
}
