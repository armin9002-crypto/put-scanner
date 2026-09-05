import { calculateBidAskSpreadPercent, isFiniteNumber } from '../optionMetrics.ts';
import { resolvePutDelta } from '../putDelta.ts';
import type { OptionContract, OptionsChainData } from '../types.ts';
import { elapsedUsEquityTradingSessions } from '../usMarketCalendar.ts';
import type { RecommendationPolicy } from './policy.ts';
import { RECOMMENDATION_POLICY } from './policy.ts';
import type {
  NearbyTransactionProxy,
  PriceNeighborEvidence,
  RecommendationPricing,
  RecommendationReasonCode,
  TransactionRecency,
} from './types.ts';

function quote(value: number | null | undefined): number | null {
  return isFiniteNumber(value) && value >= 0 ? value : null;
}

function positiveQuote(value: number | null | undefined): number | null {
  return isFiniteNumber(value) && value > 0 ? value : null;
}

function timestampMs(value: number | null | undefined): number | null {
  if (!isFiniteNumber(value) || value <= 0) return null;
  const normalized = value < 100_000_000_000 ? value * 1_000 : value;
  return Number.isNaN(new Date(normalized).getTime()) ? null : normalized;
}

export function recommendationTradingSessionAge(lastTradeDate: number | null | undefined, asOf: string | number): number | null {
  const tradeMs = timestampMs(lastTradeDate);
  const asOfMs = typeof asOf === 'number' ? asOf : Date.parse(asOf);
  if (tradeMs == null || !Number.isFinite(asOfMs) || tradeMs > asOfMs) return null;
  const tradeDate = new Date(tradeMs).toISOString().slice(0, 10);
  const evaluationDate = new Date(asOfMs).toISOString().slice(0, 10);
  return elapsedUsEquityTradingSessions(tradeDate, evaluationDate);
}

function transactionRecency(age: number | null, policy: RecommendationPolicy): TransactionRecency {
  if (age == null) return 'UNAVAILABLE';
  if (age <= policy.pricing.recentTransactionMaximumTradingSessions) return 'RECENT';
  if (age <= policy.pricing.veryStaleTransactionTradingSessions) return 'STALE';
  return 'VERY_STALE';
}

function roundQuote(value: number, tick: number): number {
  return Number((Math.round(value / tick) * tick).toFixed(2));
}

function optionQuality(option: OptionContract): [number, number, string] {
  const bid = quote(option.bid);
  const ask = quote(option.ask);
  const spread = bid != null && ask != null && ask >= bid ? ask - bid : Number.POSITIVE_INFINITY;
  const twoSidedRank = bid != null && bid > 0 && ask != null && ask >= bid ? 0 : 1;
  return [twoSidedRank, spread, option.contractSymbol ?? ''];
}

function compareQuality(left: OptionContract, right: OptionContract): number {
  const a = optionQuality(left);
  const b = optionQuality(right);
  return a[0] - b[0] || a[1] - b[1] || a[2].localeCompare(b[2]);
}

function dedupeByStrike(options: readonly OptionContract[]): OptionContract[] {
  const byStrike = new Map<number, OptionContract[]>();
  options.forEach(option => {
    if (!isFiniteNumber(option.strike) || option.strike <= 0) return;
    const current = byStrike.get(option.strike) ?? [];
    current.push(option);
    byStrike.set(option.strike, current);
  });
  return [...byStrike.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([, duplicates]) => [...duplicates].sort(compareQuality)[0]);
}

function evidenceFor(
  option: OptionContract,
  side: PriceNeighborEvidence['side'],
  chain: OptionsChainData,
  dte: number,
  asOf: string,
  candidateStrike: number,
  policy: RecommendationPolicy,
): PriceNeighborEvidence {
  const bid = quote(option.bid);
  const ask = quote(option.ask);
  const last = quote(option.last);
  const lastTradeDate = positiveQuote(option.lastTradeDate);
  const tradingSessionAge = recommendationTradingSessionAge(lastTradeDate, asOf);
  const strikeDistanceRatio = Math.abs(option.strike - candidateStrike) / candidateStrike;
  return {
    strike: option.strike,
    side,
    bid,
    ask,
    last,
    lastTradeDate,
    tradingSessionAge,
    strikeDistanceRatio,
    recentTransaction: side !== 'CANDIDATE'
      && last != null
      && tradingSessionAge != null
      && tradingSessionAge <= policy.pricing.recentTransactionMaximumTradingSessions
      && strikeDistanceRatio <= policy.pricing.maximumNearbyStrikeDistanceRatio,
    delta: resolvePutDelta({
      providerDelta: option.delta,
      underlyingPrice: chain.currentPrice,
      strike: option.strike,
      dte,
      impliedVolatilityPercent: option.impliedVolatility,
    }),
    iv: positiveQuote(option.impliedVolatility),
    openInterest: quote(option.openInterest),
    volume: quote(option.volume),
    spreadPercent: calculateBidAskSpreadPercent(bid, ask),
  };
}

function hasUsableMarket(evidence: PriceNeighborEvidence, maximumSpread: number): boolean {
  return evidence.bid != null
    && evidence.bid > 0
    && evidence.ask != null
    && evidence.ask >= evidence.bid
    && evidence.spreadPercent != null
    && evidence.spreadPercent <= maximumSpread;
}

function midpoint(evidence: PriceNeighborEvidence): number | null {
  return evidence.bid != null && evidence.bid > 0 && evidence.ask != null && evidence.ask >= evidence.bid
    ? (evidence.bid + evidence.ask) / 2
    : null;
}

function isSurfaceMonotonic(points: PriceNeighborEvidence[], policy: RecommendationPolicy): boolean {
  const usable = points
    .filter(point => midpoint(point) != null)
    .sort((left, right) => left.strike - right.strike);
  for (let index = 1; index < usable.length; index += 1) {
    const previous = midpoint(usable[index - 1]) as number;
    const current = midpoint(usable[index]) as number;
    const tolerance = Math.max(policy.pricing.monotonicDollarTolerance, previous * policy.pricing.monotonicRelativeTolerance);
    if (current + tolerance < previous) return false;
  }
  return true;
}

function continuityIsCoherent(lower: PriceNeighborEvidence, candidate: PriceNeighborEvidence, upper: PriceNeighborEvidence, policy: RecommendationPolicy): boolean {
  const lowerDelta = lower.delta == null ? null : Math.abs(lower.delta);
  const candidateDelta = candidate.delta == null ? null : Math.abs(candidate.delta);
  const upperDelta = upper.delta == null ? null : Math.abs(upper.delta);
  if (lowerDelta != null && candidateDelta != null && candidateDelta + policy.pricing.maximumDeltaGap < lowerDelta) return false;
  if (candidateDelta != null && upperDelta != null && upperDelta + policy.pricing.maximumDeltaGap < candidateDelta) return false;
  if (lower.iv != null && candidate.iv != null && Math.abs(lower.iv - candidate.iv) > policy.pricing.maximumIvGapPct) return false;
  if (upper.iv != null && candidate.iv != null && Math.abs(upper.iv - candidate.iv) > policy.pricing.maximumIvGapPct) return false;
  return true;
}

function chainAgeMs(chain: OptionsChainData, asOf: string): number | null {
  const fetchedAt = chain.chainMeta?.fetchedAt;
  const asOfMs = Date.parse(asOf);
  if (!isFiniteNumber(fetchedAt) || !Number.isFinite(asOfMs)) return null;
  return Math.max(0, asOfMs - fetchedAt);
}

function indicativeRange(input: {
  strike: number;
  lower: PriceNeighborEvidence | null;
  upper: PriceNeighborEvidence | null;
  candidate: PriceNeighborEvidence;
  bracketed: boolean;
  coherent: boolean;
  policy: RecommendationPolicy;
}): { low: number; high: number } | null {
  const { lower, upper, candidate, policy } = input;
  if (!input.bracketed || !lower || !upper || !input.coherent) return null;
  const lowerMid = midpoint(lower) as number;
  const upperMid = midpoint(upper) as number;
  const weight = (input.strike - lower.strike) / (upper.strike - lower.strike);
  const interpolatedBid = (lower.bid as number) + weight * ((upper.bid as number) - (lower.bid as number));
  const interpolatedAsk = (lower.ask as number) + weight * ((upper.ask as number) - (lower.ask as number));
  let low = Math.max(lower.bid as number, Math.min(interpolatedBid, lowerMid + weight * (upperMid - lowerMid)));
  let high = Math.min(upper.ask as number, Math.max(interpolatedAsk, low));
  if (candidate.ask != null) {
    if (candidate.ask + policy.pricing.monotonicDollarTolerance < low) return null;
    high = Math.min(high, candidate.ask);
  }
  if (!Number.isFinite(low) || !Number.isFinite(high) || high < low) return null;
  low = roundQuote(low, policy.pricing.quoteTick);
  high = roundQuote(high, policy.pricing.quoteTick);
  return high >= low ? { low, high } : null;
}

function uniqueAuditNeighbors(points: PriceNeighborEvidence[]): PriceNeighborEvidence[] {
  const unique = new Map<string, PriceNeighborEvidence>();
  points.forEach(point => unique.set(`${point.side}|${point.strike}`, point));
  return [...unique.values()].sort((left, right) => left.strike - right.strike || left.side.localeCompare(right.side));
}

function discoveryReasonCodes(pricing: Pick<RecommendationPricing, 'discoveryTier' | 'exactTradeRecency'>): RecommendationReasonCode[] {
  const reasons: RecommendationReasonCode[] = [];
  if (pricing.discoveryTier === 'DIRECT_RECENT') reasons.push('RECENT_DIRECT_TRANSACTION');
  if (pricing.discoveryTier === 'RECENT_NEARBY_CONFIRMED') reasons.push('RECENT_NEARBY_TRANSACTION_PROXY');
  if (pricing.exactTradeRecency === 'STALE') reasons.push('STALE_TRANSACTION_EVIDENCE');
  if (pricing.exactTradeRecency === 'VERY_STALE') reasons.push('VERY_STALE_TRANSACTION_EVIDENCE');
  if (pricing.discoveryTier === 'INSUFFICIENT_PRICE_DISCOVERY') reasons.push('INSUFFICIENT_PRICE_DISCOVERY');
  return reasons;
}

export function discoverContractPricing(input: {
  strike: number;
  dte: number;
  chain: OptionsChainData;
  asOf: string;
  policy?: RecommendationPolicy;
}): RecommendationPricing {
  const policy = input.policy ?? RECOMMENDATION_POLICY;
  const options = dedupeByStrike(input.chain.puts);
  const option = options.find(contract => contract.strike === input.strike);
  const ageMs = chainAgeMs(input.chain, input.asOf);
  const source = input.chain.chainMeta?.source ?? 'unknown';
  const chainStale = source === 'stale'
    || input.chain.chainMeta?.freshness === 'stale'
    || (ageMs != null && ageMs > policy.pricing.maximumStaleAgeMs);
  const chainEvidence = {
    fetchedAt: input.chain.chainMeta?.fetchedAt ?? null,
    ageMs,
    source,
    stale: chainStale,
  };
  if (!option) {
    return {
      provenance: 'INSUFFICIENT_PRICING_EVIDENCE', directBid: null, directAsk: null, last: null, lastTradeDate: null,
      exactTradeSessionAge: null, exactTradeRecency: 'UNAVAILABLE', discoveryTier: 'INSUFFICIENT_PRICE_DISCOVERY', nearbyTransactionProxy: 'NONE',
      recentNeighborCount: 0, closestRecentNeighborDistanceRatio: null, recentLowerBracket: false, recentUpperBracket: false, chainEvidence,
      indicativeRange: null, confidence: 'LOW', actionability: 'LOW',
      surface: { bracketed: false, monotonic: false, coherent: false, neighbors: [], reasonCodes: ['PRICING_UNCERTAINTY', 'INSUFFICIENT_PRICE_DISCOVERY'] },
    };
  }

  const candidate = evidenceFor(option, 'CANDIDATE', input.chain, input.dte, input.asOf, input.strike, policy);
  const lowerEvidence = options
    .filter(contract => contract.strike < input.strike)
    .sort((left, right) => right.strike - left.strike)
    .map(contract => evidenceFor(contract, 'LOWER', input.chain, input.dte, input.asOf, input.strike, policy));
  const upperEvidence = options
    .filter(contract => contract.strike > input.strike)
    .sort((left, right) => left.strike - right.strike)
    .map(contract => evidenceFor(contract, 'UPPER', input.chain, input.dte, input.asOf, input.strike, policy));
  const lower = lowerEvidence.find(point => hasUsableMarket(point, policy.pricing.maximumNeighborSpreadPercent)) ?? null;
  const upper = upperEvidence.find(point => hasUsableMarket(point, policy.pricing.maximumNeighborSpreadPercent)) ?? null;
  const surfacePoints = [...lowerEvidence.slice(0, 2).reverse(), candidate, ...upperEvidence.slice(0, 2)];
  const monotonic = isSurfaceMonotonic(surfacePoints, policy);
  const candidateCorrupt = candidate.bid != null && candidate.ask != null && candidate.ask < candidate.bid;
  const spacingRatio = lower && upper
    ? Math.max(input.strike - lower.strike, upper.strike - input.strike) / Math.max(policy.pricing.quoteTick, Math.min(input.strike - lower.strike, upper.strike - input.strike))
    : Number.POSITIVE_INFINITY;
  const bracketed = lower != null && upper != null && spacingRatio <= policy.pricing.maximumBracketSpacingRatio;
  const continuity = lower && upper ? continuityIsCoherent(lower, candidate, upper, policy) : false;
  const coherent = monotonic && !candidateCorrupt && (!bracketed || continuity);
  const directBid = positiveQuote(candidate.bid);
  const directAsk = quote(candidate.ask);
  const directSpread = calculateBidAskSpreadPercent(directBid, directAsk);
  const directTwoSided = directBid != null && directAsk != null && directAsk >= directBid;
  const credibleDirectMarket = directTwoSided && directSpread != null && directSpread <= policy.pricing.acceptableSpreadPercent;
  const exactTradeSessionAge = candidate.last == null ? null : candidate.tradingSessionAge;
  const exactTradeRecency = transactionRecency(exactTradeSessionAge, policy);

  const recentNearby = [...lowerEvidence, ...upperEvidence]
    .filter(point => point.recentTransaction && hasUsableMarket(point, policy.pricing.maximumNeighborSpreadPercent))
    .sort((left, right) => left.strikeDistanceRatio - right.strikeDistanceRatio || left.strike - right.strike);
  const recentLower = recentNearby.filter(point => point.side === 'LOWER').sort((left, right) => left.strikeDistanceRatio - right.strikeDistanceRatio)[0] ?? null;
  const recentUpper = recentNearby.filter(point => point.side === 'UPPER').sort((left, right) => left.strikeDistanceRatio - right.strikeDistanceRatio)[0] ?? null;
  const closestRecentNeighborDistanceRatio = recentNearby[0]?.strikeDistanceRatio ?? null;
  const nearbyTransactionProxy: NearbyTransactionProxy = recentLower && recentUpper
    ? 'TWO_SIDED_RECENT'
    : closestRecentNeighborDistanceRatio != null && closestRecentNeighborDistanceRatio <= policy.pricing.veryCloseNearbyStrikeDistanceRatio
      ? 'ONE_VERY_CLOSE_RECENT'
      : closestRecentNeighborDistanceRatio != null
        ? 'ONE_DISTANT_RECENT'
        : 'NONE';
  const nearbyConfirmed = coherent && (nearbyTransactionProxy === 'TWO_SIDED_RECENT'
    || (nearbyTransactionProxy === 'ONE_VERY_CLOSE_RECENT' && credibleDirectMarket));
  const range = directBid == null && !candidateCorrupt
    ? indicativeRange({ strike: input.strike, lower, upper, candidate, bracketed, coherent, policy })
    : null;
  const provenance = directBid != null && !candidateCorrupt
    ? 'DIRECT_MARKET' as const
    : range
      ? 'INDICATIVE_RANGE' as const
      : 'INSUFFICIENT_PRICING_EVIDENCE' as const;
  const discoveryTier = provenance === 'INSUFFICIENT_PRICING_EVIDENCE'
    ? 'INSUFFICIENT_PRICE_DISCOVERY' as const
    : exactTradeRecency === 'RECENT'
      ? 'DIRECT_RECENT' as const
      : nearbyConfirmed
        ? 'RECENT_NEARBY_CONFIRMED' as const
        : provenance === 'DIRECT_MARKET' && exactTradeRecency !== 'UNAVAILABLE'
          ? 'QUOTED_TRANSACTION_STALE' as const
          : provenance === 'INDICATIVE_RANGE'
            ? 'INDICATIVE_SURFACE' as const
            : 'INSUFFICIENT_PRICE_DISCOVERY' as const;

  let confidence: RecommendationPricing['confidence'] = 'LOW';
  let actionability: RecommendationPricing['actionability'] = 'LOW';
  const chainFresh = !chainStale && ageMs != null && ageMs <= policy.pricing.maximumFreshAgeMs;
  if (provenance === 'DIRECT_MARKET' && !chainStale) {
    if (discoveryTier === 'DIRECT_RECENT') {
      confidence = directTwoSided && directSpread != null && directSpread <= policy.pricing.tightSpreadPercent && coherent && bracketed && chainFresh ? 'HIGH' : directTwoSided ? 'MODERATE' : 'LOW';
      actionability = credibleDirectMarket && chainFresh ? 'HIGH' : directBid != null ? 'MODERATE' : 'LOW';
    } else if (discoveryTier === 'RECENT_NEARBY_CONFIRMED') {
      const strongProxy = nearbyTransactionProxy === 'TWO_SIDED_RECENT'
        && directSpread != null
        && directSpread <= policy.pricing.tightSpreadPercent
        && chainFresh;
      confidence = strongProxy ? 'HIGH' : 'MODERATE';
      actionability = strongProxy ? 'HIGH' : credibleDirectMarket ? 'MODERATE' : 'LOW';
    } else if (discoveryTier === 'QUOTED_TRANSACTION_STALE' && exactTradeRecency !== 'VERY_STALE') {
      confidence = directTwoSided ? 'MODERATE' : 'LOW';
      actionability = credibleDirectMarket ? 'MODERATE' : 'LOW';
    }
  } else if (provenance === 'INDICATIVE_RANGE' && !chainStale) {
    confidence = 'MODERATE';
    actionability = 'LOW';
  }

  const pricingForReasons = { discoveryTier, exactTradeRecency };
  const surfaceReasonCodes: RecommendationReasonCode[] = [
    ...(provenance === 'DIRECT_MARKET' ? [coherent ? 'CLEAN_DIRECT_MARKET' as const : 'PRICING_UNCERTAINTY' as const] : []),
    ...(provenance === 'INDICATIVE_RANGE' ? ['COHERENT_PRICE_BRACKET' as const, 'NO_DIRECT_BID' as const] : []),
    ...(provenance === 'INSUFFICIENT_PRICING_EVIDENCE' ? ['PRICING_UNCERTAINTY' as const, 'NO_DIRECT_BID' as const] : []),
    ...discoveryReasonCodes(pricingForReasons),
  ];
  const neighbors = uniqueAuditNeighbors([
    ...surfacePoints,
    ...(recentLower ? [recentLower] : []),
    ...(recentUpper ? [recentUpper] : []),
  ]);

  return {
    provenance,
    directBid: provenance === 'DIRECT_MARKET' ? directBid : null,
    directAsk,
    last: candidate.last,
    lastTradeDate: candidate.lastTradeDate,
    exactTradeSessionAge,
    exactTradeRecency,
    discoveryTier,
    nearbyTransactionProxy,
    recentNeighborCount: recentNearby.length,
    closestRecentNeighborDistanceRatio,
    recentLowerBracket: recentLower != null,
    recentUpperBracket: recentUpper != null,
    chainEvidence,
    indicativeRange: range,
    confidence,
    actionability,
    surface: { bracketed, monotonic, coherent: provenance === 'INSUFFICIENT_PRICING_EVIDENCE' ? false : coherent, neighbors, reasonCodes: surfaceReasonCodes },
  };
}
