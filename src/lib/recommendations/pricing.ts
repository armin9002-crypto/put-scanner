import { calculateBidAskSpreadPercent, isFiniteNumber } from '../optionMetrics.ts';
import { getOptionLastTradeFreshness } from '../optionLastTradeFreshness.ts';
import { resolvePutDelta } from '../putDelta.ts';
import type { OptionContract, OptionsChainData } from '../types.ts';
import type { RecommendationPolicyV1 } from './policy.ts';
import { RECOMMENDATION_POLICY_V1 } from './policy.ts';
import type { PriceNeighborEvidence, RecommendationPricing } from './types.ts';

function quote(value: number | null | undefined): number | null {
  return isFiniteNumber(value) && value >= 0 ? value : null;
}

function positiveQuote(value: number | null | undefined): number | null {
  return isFiniteNumber(value) && value > 0 ? value : null;
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

function evidenceFor(option: OptionContract, side: PriceNeighborEvidence['side'], chain: OptionsChainData, dte: number): PriceNeighborEvidence {
  const bid = quote(option.bid);
  const ask = quote(option.ask);
  return {
    strike: option.strike,
    side,
    bid,
    ask,
    last: quote(option.last),
    lastTradeDate: positiveQuote(option.lastTradeDate),
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

function isSurfaceMonotonic(points: PriceNeighborEvidence[], policy: RecommendationPolicyV1): boolean {
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

function continuityIsCoherent(lower: PriceNeighborEvidence, candidate: PriceNeighborEvidence, upper: PriceNeighborEvidence, policy: RecommendationPolicyV1): boolean {
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

export function discoverContractPricing(input: {
  strike: number;
  dte: number;
  chain: OptionsChainData;
  asOf: string;
  policy?: RecommendationPolicyV1;
}): RecommendationPricing {
  const policy = input.policy ?? RECOMMENDATION_POLICY_V1;
  const options = dedupeByStrike(input.chain.puts);
  const option = options.find(contract => contract.strike === input.strike);
  if (!option) {
    return {
      provenance: 'INSUFFICIENT_PRICING_EVIDENCE', directBid: null, directAsk: null, last: null, lastTradeDate: null,
      indicativeRange: null, confidence: 'LOW', actionability: 'LOW',
      surface: { bracketed: false, monotonic: false, coherent: false, neighbors: [], reasonCodes: ['PRICING_UNCERTAINTY'] },
    };
  }

  const candidate = evidenceFor(option, 'CANDIDATE', input.chain, input.dte);
  const lowerOptions = options.filter(contract => contract.strike < input.strike).sort((left, right) => right.strike - left.strike);
  const upperOptions = options.filter(contract => contract.strike > input.strike).sort((left, right) => left.strike - right.strike);
  const lowerEvidence = lowerOptions.map(contract => evidenceFor(contract, 'LOWER', input.chain, input.dte));
  const upperEvidence = upperOptions.map(contract => evidenceFor(contract, 'UPPER', input.chain, input.dte));
  const lower = lowerEvidence.find(point => hasUsableMarket(point, policy.pricing.maximumNeighborSpreadPercent)) ?? null;
  const upper = upperEvidence.find(point => hasUsableMarket(point, policy.pricing.maximumNeighborSpreadPercent)) ?? null;
  const neighbors = [...lowerEvidence.slice(0, 2).reverse(), candidate, ...upperEvidence.slice(0, 2)];
  const monotonic = isSurfaceMonotonic(neighbors, policy);
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
  const age = chainAgeMs(input.chain, input.asOf);
  const sourceStale = input.chain.chainMeta?.source === 'stale' || input.chain.chainMeta?.freshness === 'stale' || (age != null && age > policy.pricing.maximumStaleAgeMs);
  const freshEnough = !sourceStale && age != null && age <= policy.pricing.maximumFreshAgeMs;
  const asOfMs = Date.parse(input.asOf);
  const lastFreshness = Number.isFinite(asOfMs) ? getOptionLastTradeFreshness(candidate.lastTradeDate, asOfMs) : null;
  const staleEvidence = sourceStale || lastFreshness?.freshness === 'stale' || lastFreshness?.freshness === 'very_stale';

  if (directBid != null && !candidateCorrupt) {
    const confidence = directTwoSided
      && directSpread != null
      && directSpread <= policy.pricing.tightSpreadPercent
      && coherent
      && bracketed
      && freshEnough
      ? 'HIGH'
      : directTwoSided && !sourceStale
        ? 'MODERATE'
        : 'LOW';
    const actionability = sourceStale
      ? 'LOW'
      : directTwoSided && directSpread != null && directSpread <= policy.pricing.acceptableSpreadPercent
      ? 'HIGH'
      : 'MODERATE';
    return {
      provenance: 'DIRECT_MARKET', directBid, directAsk, last: candidate.last, lastTradeDate: candidate.lastTradeDate,
      indicativeRange: null, confidence, actionability,
      surface: {
        bracketed, monotonic, coherent, neighbors,
        reasonCodes: [coherent ? 'CLEAN_DIRECT_MARKET' : 'PRICING_UNCERTAINTY', ...(staleEvidence ? ['STALE_EVIDENCE' as const] : [])],
      },
    };
  }

  if (bracketed && lower && upper && coherent) {
    const lowerMid = midpoint(lower) as number;
    const upperMid = midpoint(upper) as number;
    const weight = (input.strike - lower.strike) / (upper.strike - lower.strike);
    const interpolatedBid = (lower.bid as number) + weight * ((upper.bid as number) - (lower.bid as number));
    const interpolatedAsk = (lower.ask as number) + weight * ((upper.ask as number) - (lower.ask as number));
    let low = Math.max(lower.bid as number, Math.min(interpolatedBid, lowerMid + weight * (upperMid - lowerMid)));
    let high = Math.min(upper.ask as number, Math.max(interpolatedAsk, low));
    if (candidate.ask != null) {
      if (candidate.ask + policy.pricing.monotonicDollarTolerance < low) {
        low = Number.POSITIVE_INFINITY;
      } else {
        high = Math.min(high, candidate.ask);
      }
    }
    if (Number.isFinite(low) && Number.isFinite(high) && high >= low) {
      const range = { low: roundQuote(low, policy.pricing.quoteTick), high: roundQuote(high, policy.pricing.quoteTick) };
      if (range.high >= range.low) {
        return {
          provenance: 'INDICATIVE_RANGE', directBid: null, directAsk, last: candidate.last, lastTradeDate: candidate.lastTradeDate,
          indicativeRange: range, confidence: sourceStale ? 'LOW' : 'MODERATE', actionability: 'LOW',
          surface: { bracketed, monotonic, coherent, neighbors, reasonCodes: ['COHERENT_PRICE_BRACKET', 'NO_DIRECT_BID', ...(staleEvidence ? ['STALE_EVIDENCE' as const] : [])] },
        };
      }
    }
  }

  return {
    provenance: 'INSUFFICIENT_PRICING_EVIDENCE', directBid: null, directAsk, last: candidate.last, lastTradeDate: candidate.lastTradeDate,
    indicativeRange: null, confidence: 'LOW', actionability: 'LOW',
    surface: { bracketed, monotonic, coherent: false, neighbors, reasonCodes: ['PRICING_UNCERTAINTY', 'NO_DIRECT_BID', ...(staleEvidence ? ['STALE_EVIDENCE' as const] : [])] },
  };
}
