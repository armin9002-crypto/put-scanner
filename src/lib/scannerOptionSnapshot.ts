import type { ExpirationDate, OptionContract, OptionsChainData } from './types';

export type SnapshotConfidence = 'high' | 'normal' | 'reduced' | 'low';
export type ExpirationSelectionTier = 'ideal' | 'normal' | 'expanded' | 'broad';
export type LiquiditySelectionTier = 'ideal' | 'expanded' | 'broad' | 'nearest_usable';
export type AtmIvMethod = 'interpolated' | 'nearest_strike';
export type UnderlyingPriceSource = 'option_chain' | 'scanner_cache' | 'unavailable';
export type ScannerLiquidityLabel =
  | 'very_liquid'
  | 'liquid'
  | 'medium'
  | 'thin'
  | 'illiquid'
  | 'unavailable';

export interface ScannerExpirationCandidate {
  date: number;
  dte: number;
  tier: ExpirationSelectionTier;
  confidence: SnapshotConfidence;
}

export interface ScannerOptionSnapshot {
  schemaVersion: 2;
  ticker: string;
  underlyingPrice: number | null;
  underlyingPriceSource: UnderlyingPriceSource;
  expiration: number | null;
  dte: number | null;
  expirationSelectionTier: ExpirationSelectionTier | null;
  atmPutIv: number | null;
  atmIvMethod: AtmIvMethod | null;
  atmStrike: number | null;
  atmLowerStrike: number | null;
  atmUpperStrike: number | null;
  atmMoneynessPercent: number | null;
  atmConfidence: SnapshotConfidence;
  liquidityStrike: number | null;
  actualOtmPercent: number | null;
  liquiditySelectionTier: LiquiditySelectionTier | null;
  bid: number | null;
  ask: number | null;
  midpoint: number | null;
  last: number | null;
  lastTradeDate: number | null;
  openInterest: number | null;
  volume: number | null;
  absoluteSpread: number | null;
  spreadPercent: number | null;
  spreadGuardrail: string | null;
  neighboringStrikeCount: number;
  neighboringStrikesWithBid: number;
  neighboringStrikesWithTwoSidedMarket: number;
  distancePenalty: number;
  liquidityScore: number | null;
  liquidityLabel: ScannerLiquidityLabel;
  liquidityConfidence: SnapshotConfidence;
  confidence: SnapshotConfidence;
  usedSecondExpiration: boolean;
  fallbackReason: string | null;
  unavailableReason: string | null;
  updatedAt: string;
}

export interface ScannerSnapshotDiagnostic {
  status: 'failed' | 'unavailable';
  reason: string;
  updatedAt: string;
}

export interface ScannerSnapshotUpdateOutcome {
  status: 'updated' | 'unavailable' | 'failed';
  snapshot: ScannerOptionSnapshot | null;
  expanded: boolean;
  reason: string | null;
  requestCount: number;
  requestedExpirations: Array<number | null>;
}

interface CachedScannerExpirations {
  dates: number[];
  updatedAt: string;
}

const SNAPSHOT_CACHE_KEY = 'scanner_option_snapshots_v2';
const EXPIRATION_CACHE_KEY = 'scanner_option_expirations_v1';
const DIAGNOSTIC_CACHE_KEY = 'scanner_option_snapshot_diagnostics_v2';
export const SCANNER_OPTION_SNAPSHOT_TTL = 8 * 60 * 60 * 1000;
export const SCANNER_EXPIRATION_METADATA_TTL = 12 * 60 * 60 * 1000;

const CONFIDENCE_ORDER: SnapshotConfidence[] = ['low', 'reduced', 'normal', 'high'];
const LIQUIDITY_LABEL_ORDER: Array<Exclude<ScannerLiquidityLabel, 'unavailable'>> = ['illiquid', 'thin', 'medium', 'liquid', 'very_liquid'];

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function finitePositive(value: number | null | undefined): value is number {
  return Number.isFinite(value) && Number(value) > 0;
}

function finiteNonNegative(value: number | null | undefined): value is number {
  return Number.isFinite(value) && Number(value) >= 0;
}

function readRecord<T>(key: string): Record<string, T> {
  const target = storage();
  if (!target) return {};
  try {
    const parsed = JSON.parse(target.getItem(key) ?? '{}');
    return parsed && typeof parsed === 'object' ? parsed as Record<string, T> : {};
  } catch {
    return {};
  }
}

function writeRecord<T>(key: string, value: Record<string, T>): void {
  const target = storage();
  if (!target) return;
  try {
    target.setItem(key, JSON.stringify(value));
  } catch {
    // Storage may be unavailable or full.
  }
}

function lowerConfidence(confidence: SnapshotConfidence, steps = 1): SnapshotConfidence {
  return CONFIDENCE_ORDER[Math.max(0, CONFIDENCE_ORDER.indexOf(confidence) - steps)];
}

function minimumConfidence(...values: SnapshotConfidence[]): SnapshotConfidence {
  return CONFIDENCE_ORDER[Math.min(...values.map(value => CONFIDENCE_ORDER.indexOf(value)))];
}

export function calculateCalendarDte(expirationTimestamp: number, now = new Date()): number {
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const expiration = new Date(expirationTimestamp * 1000);
  const expirationUtc = Date.UTC(expiration.getUTCFullYear(), expiration.getUTCMonth(), expiration.getUTCDate());
  return Math.round((expirationUtc - todayUtc) / 86_400_000);
}

function expirationTier(dte: number): Pick<ScannerExpirationCandidate, 'tier' | 'confidence'> | null {
  if (dte >= 45 && dte <= 75) return { tier: 'ideal', confidence: 'high' };
  if (dte >= 30 && dte <= 90) return { tier: 'normal', confidence: 'normal' };
  if (dte >= 14 && dte <= 120) return { tier: 'expanded', confidence: 'reduced' };
  if (dte >= 7 && dte <= 180) return { tier: 'broad', confidence: 'low' };
  return null;
}

export function rankScannerSnapshotExpirations(
  expirations: Array<Pick<ExpirationDate, 'date'> | number>,
  now = new Date(),
): ScannerExpirationCandidate[] {
  const tierRank: Record<ExpirationSelectionTier, number> = { ideal: 0, normal: 1, expanded: 2, broad: 3 };
  return [...new Set(expirations.map(expiration => typeof expiration === 'number' ? expiration : expiration.date))]
    .map(date => {
      const dte = calculateCalendarDte(date, now);
      const selection = expirationTier(dte);
      return selection ? { date, dte, ...selection } : null;
    })
    .filter((expiration): expiration is ScannerExpirationCandidate => expiration != null && Number.isFinite(expiration.date))
    .sort((a, b) =>
      tierRank[a.tier] - tierRank[b.tier]
      || Math.abs(a.dte - 60) - Math.abs(b.dte - 60)
      || a.date - b.date
    );
}

export function selectScannerSnapshotExpiration(
  expirations: Array<Pick<ExpirationDate, 'date'> | number>,
  now = new Date(),
): ScannerExpirationCandidate | null {
  return rankScannerSnapshotExpirations(expirations, now)[0] ?? null;
}

function observedFixedHoliday(year: number, month: number, day: number): number {
  const holiday = new Date(Date.UTC(year, month, day));
  if (holiday.getUTCDay() === 6) holiday.setUTCDate(holiday.getUTCDate() - 1);
  if (holiday.getUTCDay() === 0) holiday.setUTCDate(holiday.getUTCDate() + 1);
  return holiday.getTime();
}

function nthWeekdayOfMonth(year: number, month: number, weekday: number, occurrence: number): number {
  const date = new Date(Date.UTC(year, month, 1));
  date.setUTCDate(1 + ((weekday - date.getUTCDay() + 7) % 7) + (occurrence - 1) * 7);
  return date.getTime();
}

function lastWeekdayOfMonth(year: number, month: number, weekday: number): number {
  const date = new Date(Date.UTC(year, month + 1, 0));
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() - weekday + 7) % 7));
  return date.getTime();
}

function easterSundayUtc(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function isUsMarketHoliday(date: Date): boolean {
  const year = date.getUTCFullYear();
  const goodFriday = easterSundayUtc(year);
  goodFriday.setUTCDate(goodFriday.getUTCDate() - 2);
  return new Set([
    observedFixedHoliday(year, 0, 1),
    observedFixedHoliday(year + 1, 0, 1),
    nthWeekdayOfMonth(year, 0, 1, 3),
    nthWeekdayOfMonth(year, 1, 1, 3),
    goodFriday.getTime(),
    lastWeekdayOfMonth(year, 4, 1),
    ...(year >= 2022 ? [observedFixedHoliday(year, 5, 19)] : []),
    observedFixedHoliday(year, 6, 4),
    nthWeekdayOfMonth(year, 8, 1, 1),
    nthWeekdayOfMonth(year, 10, 4, 4),
    observedFixedHoliday(year, 11, 25),
  ]).has(date.getTime());
}

function tradingDaysAgo(lastTradeTimestamp: number | null, now = new Date()): number | null {
  if (!finitePositive(lastTradeTimestamp)) return null;
  const last = new Date(lastTradeTimestamp * 1000);
  const cursor = new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), last.getUTCDate()));
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (cursor >= today) return 0;
  let tradingDays = 0;
  cursor.setUTCDate(cursor.getUTCDate() + 1);
  while (cursor <= today) {
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6 && !isUsMarketHoliday(cursor)) tradingDays += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return tradingDays;
}

function scoreOpenInterest(value: number | null): number {
  if (!finiteNonNegative(value) || value === 0) return 0;
  if (value >= 500) return 20;
  if (value >= 100) return 16;
  if (value >= 25) return 10;
  return 4;
}

function scoreVolume(value: number | null): number {
  if (!finiteNonNegative(value) || value === 0) return 0;
  if (value >= 20) return 10;
  if (value >= 5) return 7;
  return 3;
}

function scoreRecency(tradingDays: number | null): number {
  if (tradingDays == null) return 0;
  if (tradingDays <= 1) return 15;
  if (tradingDays <= 3) return 11;
  if (tradingDays <= 7) return 6;
  return 1;
}

function spreadScore(relativeSpread: number | null, absoluteSpread: number | null): { score: number; guardrail: string | null } {
  if (!finiteNonNegative(relativeSpread) || !finiteNonNegative(absoluteSpread)) return { score: 0, guardrail: null };
  let score = relativeSpread <= 0.15 ? 25
    : relativeSpread <= 0.25 ? 20
      : relativeSpread <= 0.40 ? 12
        : relativeSpread <= 0.60 ? 5
          : 0;
  let guardrail: string | null = null;
  if (absoluteSpread <= 0.05 && relativeSpread > 0.60) {
    score = Math.max(score, 5);
    guardrail = 'Tiny-premium guardrail: absolute spread ≤ $0.05.';
  }
  if (absoluteSpread > 2) {
    score = Math.min(score, 5);
    guardrail = 'Wide-market guardrail: absolute spread > $2.00.';
  } else if (absoluteSpread > 1) {
    score = Math.min(score, 12);
    guardrail = 'Wide-market guardrail: absolute spread > $1.00.';
  }
  return { score, guardrail };
}

function labelForScore(score: number): Exclude<ScannerLiquidityLabel, 'unavailable'> {
  if (score >= 85) return 'very_liquid';
  if (score >= 65) return 'liquid';
  if (score >= 45) return 'medium';
  if (score >= 25) return 'thin';
  return 'illiquid';
}

function capLabel(
  label: Exclude<ScannerLiquidityLabel, 'unavailable'>,
  maximum: Exclude<ScannerLiquidityLabel, 'unavailable'>,
): Exclude<ScannerLiquidityLabel, 'unavailable'> {
  return LIQUIDITY_LABEL_ORDER[Math.min(LIQUIDITY_LABEL_ORDER.indexOf(label), LIQUIDITY_LABEL_ORDER.indexOf(maximum))];
}

function downgradeLabel(label: Exclude<ScannerLiquidityLabel, 'unavailable'>): Exclude<ScannerLiquidityLabel, 'unavailable'> {
  return LIQUIDITY_LABEL_ORDER[Math.max(0, LIQUIDITY_LABEL_ORDER.indexOf(label) - 1)];
}

function resolveUnderlyingPrice(chain: OptionsChainData, scannerPrice: number | null | undefined): {
  price: number | null;
  source: UnderlyingPriceSource;
} {
  if (finitePositive(chain.currentPrice)) return { price: chain.currentPrice, source: 'option_chain' };
  if (finitePositive(scannerPrice)) return { price: scannerPrice, source: 'scanner_cache' };
  return { price: null, source: 'unavailable' };
}

function selectAtmIv(puts: OptionContract[], underlyingPrice: number): Pick<
  ScannerOptionSnapshot,
  'atmPutIv' | 'atmIvMethod' | 'atmStrike' | 'atmLowerStrike' | 'atmUpperStrike' | 'atmMoneynessPercent' | 'atmConfidence'
> & { reason: string | null } {
  const sorted = puts.filter(put => Number.isFinite(put.strike)).sort((a, b) => a.strike - b.strike);
  const lower = [...sorted].reverse().find(put => put.strike < underlyingPrice);
  const upper = sorted.find(put => put.strike > underlyingPrice);
  if (lower && upper && finitePositive(lower.impliedVolatility) && finitePositive(upper.impliedVolatility) && upper.strike > lower.strike) {
    const weight = (underlyingPrice - lower.strike) / (upper.strike - lower.strike);
    const interpolated = lower.impliedVolatility + (upper.impliedVolatility - lower.impliedVolatility) * weight;
    if (finitePositive(interpolated)) {
      return {
        atmPutIv: interpolated,
        atmIvMethod: 'interpolated',
        atmStrike: null,
        atmLowerStrike: lower.strike,
        atmUpperStrike: upper.strike,
        atmMoneynessPercent: 0,
        atmConfidence: 'high',
        reason: null,
      };
    }
  }

  const nearest = sorted
    .filter(put => finitePositive(put.impliedVolatility))
    .map(put => ({ put, distancePercent: Math.abs(put.strike - underlyingPrice) / underlyingPrice * 100 }))
    .filter(candidate => candidate.distancePercent <= 20)
    .sort((a, b) => a.distancePercent - b.distancePercent || a.put.strike - b.put.strike)[0];
  if (!nearest) {
    return {
      atmPutIv: null,
      atmIvMethod: null,
      atmStrike: null,
      atmLowerStrike: null,
      atmUpperStrike: null,
      atmMoneynessPercent: null,
      atmConfidence: 'low',
      reason: 'No valid put IV was available within 20% of spot.',
    };
  }
  const confidence: SnapshotConfidence = nearest.distancePercent <= 5 ? 'normal'
    : nearest.distancePercent <= 10 ? 'reduced'
      : 'low';
  return {
    atmPutIv: nearest.put.impliedVolatility,
    atmIvMethod: 'nearest_strike',
    atmStrike: nearest.put.strike,
    atmLowerStrike: null,
    atmUpperStrike: null,
    atmMoneynessPercent: (nearest.put.strike - underlyingPrice) / underlyingPrice * 100,
    atmConfidence: confidence,
    reason: `ATM interpolation unavailable; used nearest valid IV ${nearest.distancePercent.toFixed(1)}% from spot.`,
  };
}

function liquidityTierForOtm(otmPercent: number): { tier: LiquiditySelectionTier; confidence: SnapshotConfidence; penalty: number } | null {
  if (otmPercent >= 25 && otmPercent <= 35) return { tier: 'ideal', confidence: 'high', penalty: 0 };
  if (otmPercent >= 20 && otmPercent <= 40) return { tier: 'expanded', confidence: 'normal', penalty: 3 };
  if (otmPercent >= 15 && otmPercent <= 45) return { tier: 'broad', confidence: 'reduced', penalty: 7 };
  if (otmPercent >= 10 && otmPercent <= 50) return { tier: 'nearest_usable', confidence: 'low', penalty: 12 };
  return null;
}

function selectLiquidityZone(puts: OptionContract[], underlyingPrice: number): {
  primary: OptionContract;
  nearby: OptionContract[];
  actualOtmPercent: number;
  tier: LiquiditySelectionTier;
  confidence: SnapshotConfidence;
  penalty: number;
  reason: string | null;
} | null {
  const targetStrike = underlyingPrice * 0.70;
  const candidates = puts
    .filter(put => Number.isFinite(put.strike))
    .map(put => ({
      put,
      actualOtmPercent: (underlyingPrice - put.strike) / underlyingPrice * 100,
    }))
    .filter(candidate => candidate.actualOtmPercent >= 10 && candidate.actualOtmPercent <= 50);
  const tierOrder: LiquiditySelectionTier[] = ['ideal', 'expanded', 'broad', 'nearest_usable'];
  for (const tierName of tierOrder) {
    const tierCandidates = candidates
      .map(candidate => ({ ...candidate, selection: liquidityTierForOtm(candidate.actualOtmPercent) }))
      .filter(candidate => candidate.selection?.tier === tierName)
      .sort((a, b) => Math.abs(a.put.strike - targetStrike) - Math.abs(b.put.strike - targetStrike) || a.put.strike - b.put.strike);
    const selected = tierCandidates[0];
    if (!selected?.selection) continue;
    const sortedTier = tierCandidates.map(candidate => candidate.put).sort((a, b) => a.strike - b.strike);
    const index = sortedTier.findIndex(put => put.strike === selected.put.strike);
    const nearby = [
      index > 0 ? sortedTier[index - 1] : null,
      selected.put,
      index >= 0 && index < sortedTier.length - 1 ? sortedTier[index + 1] : null,
    ].filter((put): put is OptionContract => put != null);
    return {
      primary: selected.put,
      nearby,
      actualOtmPercent: selected.actualOtmPercent,
      tier: selected.selection.tier,
      confidence: selected.selection.confidence,
      penalty: selected.selection.penalty,
      reason: selected.selection.tier === 'ideal'
        ? null
        : `Target 30% OTM strike was unavailable in a tighter zone; used ${selected.actualOtmPercent.toFixed(1)}% OTM (${selected.selection.tier.replace('_', ' ')} tier).`,
    };
  }
  return null;
}

function emptySnapshot(
  ticker: string,
  expiration: ScannerExpirationCandidate | null,
  underlyingPrice: number | null,
  underlyingPriceSource: UnderlyingPriceSource,
  updatedAt: string,
  unavailableReason: string,
): ScannerOptionSnapshot {
  return {
    schemaVersion: 2,
    ticker,
    underlyingPrice,
    underlyingPriceSource,
    expiration: expiration?.date ?? null,
    dte: expiration?.dte ?? null,
    expirationSelectionTier: expiration?.tier ?? null,
    atmPutIv: null,
    atmIvMethod: null,
    atmStrike: null,
    atmLowerStrike: null,
    atmUpperStrike: null,
    atmMoneynessPercent: null,
    atmConfidence: 'low',
    liquidityStrike: null,
    actualOtmPercent: null,
    liquiditySelectionTier: null,
    bid: null,
    ask: null,
    midpoint: null,
    last: null,
    lastTradeDate: null,
    openInterest: null,
    volume: null,
    absoluteSpread: null,
    spreadPercent: null,
    spreadGuardrail: null,
    neighboringStrikeCount: 0,
    neighboringStrikesWithBid: 0,
    neighboringStrikesWithTwoSidedMarket: 0,
    distancePenalty: 0,
    liquidityScore: null,
    liquidityLabel: 'unavailable',
    liquidityConfidence: 'low',
    confidence: 'low',
    usedSecondExpiration: false,
    fallbackReason: expiration && expiration.tier !== 'ideal'
      ? `Used ${expiration.dte}-DTE ${expiration.tier} expiration tier.`
      : null,
    unavailableReason,
    updatedAt,
  };
}

export function buildScannerOptionSnapshot(
  ticker: string,
  chain: OptionsChainData,
  selectedExpiration: ScannerExpirationCandidate,
  now = new Date(),
  scannerPrice: number | null = null,
): ScannerOptionSnapshot {
  const normalizedTicker = ticker.trim().toUpperCase();
  const fetchedAt = chain.chainMeta?.fetchedAt;
  const updatedAt = Number.isFinite(fetchedAt) ? new Date(fetchedAt!).toISOString() : now.toISOString();
  const { price: underlyingPrice, source: underlyingPriceSource } = resolveUnderlyingPrice(chain, scannerPrice);
  if (!normalizedTicker) return emptySnapshot('', selectedExpiration, underlyingPrice, underlyingPriceSource, updatedAt, 'Ticker is unavailable.');
  const returnedExpiration = chain.chainMeta?.returnedExpiration ?? chain.chainMeta?.expirationDate ?? null;
  if (returnedExpiration !== selectedExpiration.date) {
    return emptySnapshot(normalizedTicker, selectedExpiration, underlyingPrice, underlyingPriceSource, updatedAt, 'The returned chain did not match the selected expiration.');
  }
  if (!finitePositive(underlyingPrice)) {
    return emptySnapshot(normalizedTicker, selectedExpiration, null, 'unavailable', updatedAt, 'Underlying price is unavailable.');
  }
  const puts = chain.puts.filter(put => Number.isFinite(put.strike));
  if (puts.length === 0) {
    return emptySnapshot(normalizedTicker, selectedExpiration, underlyingPrice, underlyingPriceSource, updatedAt, 'The option chain contains no usable put strikes.');
  }

  const atm = selectAtmIv(puts, underlyingPrice);
  const zone = selectLiquidityZone(puts, underlyingPrice);
  const fallbackReasons = [
    selectedExpiration.tier !== 'ideal' ? `Used ${selectedExpiration.dte}-DTE ${selectedExpiration.tier} expiration tier because no closer ideal expiration was available.` : null,
    atm.reason,
    zone?.reason ?? null,
  ].filter((reason): reason is string => Boolean(reason));

  if (!zone) {
    const unavailableReason = 'No usable put strike was available between 10% and 50% OTM.';
    const base = emptySnapshot(normalizedTicker, selectedExpiration, underlyingPrice, underlyingPriceSource, updatedAt, unavailableReason);
    return {
      ...base,
      atmPutIv: atm.atmPutIv,
      atmIvMethod: atm.atmIvMethod,
      atmStrike: atm.atmStrike,
      atmLowerStrike: atm.atmLowerStrike,
      atmUpperStrike: atm.atmUpperStrike,
      atmMoneynessPercent: atm.atmMoneynessPercent,
      atmConfidence: minimumConfidence(selectedExpiration.confidence, atm.atmConfidence),
      fallbackReason: fallbackReasons.length > 0 ? fallbackReasons.join(' ') : null,
      confidence: minimumConfidence(selectedExpiration.confidence, atm.atmConfidence, 'low'),
    };
  }

  const bid = finiteNonNegative(zone.primary.bid) ? zone.primary.bid : null;
  const ask = finiteNonNegative(zone.primary.ask) ? zone.primary.ask : null;
  const validBid = finitePositive(bid);
  const validAsk = finitePositive(ask);
  const twoSided = validBid && validAsk && ask >= bid;
  const midpoint = twoSided ? (bid + ask) / 2 : null;
  const absoluteSpread = twoSided ? ask - bid : null;
  const spreadPercent = twoSided && finitePositive(midpoint) ? absoluteSpread! / midpoint : null;
  const spread = spreadScore(spreadPercent, absoluteSpread);
  const nearbyWithBid = zone.nearby.filter(put => finitePositive(put.bid)).length;
  const nearbyTwoSided = zone.nearby.filter(put =>
    finitePositive(put.bid) && finitePositive(put.ask) && put.ask >= put.bid
  ).length;
  const recency = tradingDaysAgo(zone.primary.lastTradeDate, now);
  const quoteAvailability = twoSided ? 30 : validBid ? 12 : validAsk ? 5 : 0;
  const neighborAdjustment = nearbyWithBid >= 3 && nearbyTwoSided >= 2 ? 3 : nearbyWithBid === 1 ? -8 : 0;
  const rawScore = quoteAvailability
    + spread.score
    + scoreOpenInterest(zone.primary.openInterest)
    + scoreRecency(recency)
    + scoreVolume(zone.primary.volume)
    + neighborAdjustment
    - zone.penalty;
  const liquidityScore = Math.max(0, Math.min(100, rawScore));
  let liquidityLabel = labelForScore(liquidityScore);
  if (!validBid) liquidityLabel = capLabel(liquidityLabel, 'thin');
  if (!twoSided) liquidityLabel = capLabel(liquidityLabel, 'medium');
  if (zone.tier === 'nearest_usable') liquidityLabel = capLabel(liquidityLabel, 'medium');
  if (nearbyWithBid === 0) liquidityLabel = 'illiquid';
  else if (nearbyWithBid === 1) liquidityLabel = downgradeLabel(liquidityLabel);
  const exceptionallyStrongQuoteDepth = nearbyTwoSided >= 3 && spreadPercent != null && spreadPercent <= 0.15;
  const qualifiesVeryLiquid = twoSided
    && spreadPercent != null
    && spreadPercent <= 0.25
    && absoluteSpread != null
    && absoluteSpread <= 0.50
    && (finitePositive(zone.primary.openInterest) && zone.primary.openInterest >= 100 || exceptionallyStrongQuoteDepth)
    && recency != null
    && recency <= 3
    && nearbyWithBid >= 2;
  if (!qualifiesVeryLiquid) liquidityLabel = capLabel(liquidityLabel, 'liquid');

  let liquidityConfidence = zone.confidence;
  if (!twoSided || nearbyWithBid <= 1) liquidityConfidence = lowerConfidence(liquidityConfidence);
  if (zone.primary.openInterest == null || zone.primary.volume == null || zone.primary.lastTradeDate == null) {
    liquidityConfidence = lowerConfidence(liquidityConfidence);
  }
  const unavailableReason = atm.atmPutIv == null ? atm.reason : null;
  return {
    schemaVersion: 2,
    ticker: normalizedTicker,
    underlyingPrice,
    underlyingPriceSource,
    expiration: selectedExpiration.date,
    dte: selectedExpiration.dte,
    expirationSelectionTier: selectedExpiration.tier,
    atmPutIv: atm.atmPutIv,
    atmIvMethod: atm.atmIvMethod,
    atmStrike: atm.atmStrike,
    atmLowerStrike: atm.atmLowerStrike,
    atmUpperStrike: atm.atmUpperStrike,
    atmMoneynessPercent: atm.atmMoneynessPercent,
    atmConfidence: minimumConfidence(selectedExpiration.confidence, atm.atmConfidence),
    liquidityStrike: zone.primary.strike,
    actualOtmPercent: zone.actualOtmPercent,
    liquiditySelectionTier: zone.tier,
    bid,
    ask,
    midpoint,
    last: finiteNonNegative(zone.primary.last) ? zone.primary.last : null,
    lastTradeDate: finitePositive(zone.primary.lastTradeDate) ? zone.primary.lastTradeDate : null,
    openInterest: finiteNonNegative(zone.primary.openInterest) ? zone.primary.openInterest : null,
    volume: finiteNonNegative(zone.primary.volume) ? zone.primary.volume : null,
    absoluteSpread,
    spreadPercent,
    spreadGuardrail: spread.guardrail,
    neighboringStrikeCount: zone.nearby.length,
    neighboringStrikesWithBid: nearbyWithBid,
    neighboringStrikesWithTwoSidedMarket: nearbyTwoSided,
    distancePenalty: zone.penalty,
    liquidityScore,
    liquidityLabel,
    liquidityConfidence: minimumConfidence(selectedExpiration.confidence, liquidityConfidence),
    confidence: minimumConfidence(selectedExpiration.confidence, atm.atmConfidence, liquidityConfidence),
    usedSecondExpiration: false,
    fallbackReason: fallbackReasons.length > 0 ? fallbackReasons.join(' ') : null,
    unavailableReason,
    updatedAt,
  };
}

export function isScannerSnapshotUsable(snapshot: ScannerOptionSnapshot): boolean {
  return snapshot.atmPutIv != null && snapshot.liquidityLabel !== 'unavailable';
}

export function hasScannerSnapshotData(snapshot: ScannerOptionSnapshot): boolean {
  return snapshot.atmPutIv != null || snapshot.liquidityLabel !== 'unavailable';
}

function quoteCompleteness(snapshot: ScannerOptionSnapshot): number {
  return [
    snapshot.bid,
    snapshot.ask,
    snapshot.last,
    snapshot.openInterest,
    snapshot.volume,
  ].filter(value => value != null && Number.isFinite(value)).length + snapshot.neighboringStrikesWithBid;
}

export function chooseBestScannerSnapshot(snapshots: ScannerOptionSnapshot[]): ScannerOptionSnapshot | null {
  return [...snapshots].sort((a, b) => {
    const aBoth = isScannerSnapshotUsable(a) ? 1 : 0;
    const bBoth = isScannerSnapshotUsable(b) ? 1 : 0;
    return bBoth - aBoth
      || Math.abs((a.dte ?? 999) - 60) - Math.abs((b.dte ?? 999) - 60)
      || quoteCompleteness(b) - quoteCompleteness(a)
      || CONFIDENCE_ORDER.indexOf(b.liquidityConfidence) - CONFIDENCE_ORDER.indexOf(a.liquidityConfidence)
      || (b.liquidityScore ?? -1) - (a.liquidityScore ?? -1);
  })[0] ?? null;
}

export async function updateScannerSnapshotForTicker({
  ticker,
  scannerPrice,
  expirationDates,
  fetchChain,
  now = new Date(),
}: {
  ticker: string;
  scannerPrice: number | null;
  expirationDates: number[];
  fetchChain: (expiration?: number) => Promise<OptionsChainData>;
  now?: Date;
}): Promise<ScannerSnapshotUpdateOutcome> {
  const requestedExpirations: Array<number | null> = [];
  const chainsByExpiration = new Map<number, OptionsChainData>();
  const requestedKeys = new Set<string>();

  const request = async (expiration?: number): Promise<OptionsChainData> => {
    const key = expiration == null ? 'initial' : String(expiration);
    if (requestedKeys.has(key)) {
      const cached = expiration == null ? null : chainsByExpiration.get(expiration);
      if (cached) return cached;
      throw new Error('Duplicate option-chain request could not be resolved from the current update.');
    }
    if (requestedExpirations.length >= 2) throw new Error('Two-expiration request limit reached.');
    requestedKeys.add(key);
    requestedExpirations.push(expiration ?? null);
    const chain = await fetchChain(expiration);
    const returnedExpiration = chain.chainMeta?.returnedExpiration ?? chain.chainMeta?.expirationDate ?? null;
    if (returnedExpiration != null) chainsByExpiration.set(returnedExpiration, chain);
    return chain;
  };

  try {
    let dates = [...new Set(expirationDates.filter(Number.isFinite))];
    if (dates.length === 0) {
      const discovery = await request();
      dates = discovery.expirations.map(expiration => expiration.date);
    }
    const candidates = rankScannerSnapshotExpirations(dates, now);
    if (candidates.length === 0) {
      return {
        status: 'unavailable',
        snapshot: null,
        expanded: false,
        reason: 'No future expiration was available between 7 and 180 DTE.',
        requestCount: requestedExpirations.length,
        requestedExpirations,
      };
    }

    const primary = candidates[0];
    let primaryChain = chainsByExpiration.get(primary.date);
    if (!primaryChain) primaryChain = await request(primary.date);
    const evaluated: ScannerOptionSnapshot[] = [
      buildScannerOptionSnapshot(ticker, primaryChain, primary, now, scannerPrice),
    ];

    if (!isScannerSnapshotUsable(evaluated[0]) && requestedExpirations.length < 2) {
      const fallback = candidates.find(candidate => candidate.date !== primary.date);
      if (fallback) {
        let fallbackChain = chainsByExpiration.get(fallback.date);
        if (!fallbackChain) fallbackChain = await request(fallback.date);
        evaluated.push(buildScannerOptionSnapshot(ticker, fallbackChain, fallback, now, scannerPrice));
      }
    }

    const chosen = chooseBestScannerSnapshot(evaluated);
    if (!chosen || !hasScannerSnapshotData(chosen)) {
      const reason = chosen?.unavailableReason
        || evaluated.map(snapshot => snapshot.unavailableReason).filter(Boolean).join(' ')
        || 'The fetched option chains did not contain a usable IV or liquidity benchmark.';
      return {
        status: 'unavailable',
        snapshot: chosen,
        expanded: evaluated.length > 1 || primary.tier !== 'ideal',
        reason,
        requestCount: requestedExpirations.length,
        requestedExpirations,
      };
    }

    const usedSecondExpiration = evaluated.length > 1 && chosen.expiration !== primary.date;
    const secondExpirationNote = evaluated.length > 1
      ? usedSecondExpiration
        ? `Primary ${primary.dte}-DTE chain was incomplete; used the next-best ${chosen.dte}-DTE chain.`
        : 'A second expiration was evaluated but did not improve the combined snapshot.'
      : null;
    const snapshot: ScannerOptionSnapshot = {
      ...chosen,
      usedSecondExpiration,
      fallbackReason: [chosen.fallbackReason, secondExpirationNote].filter(Boolean).join(' ') || null,
    };
    const expanded = snapshot.expirationSelectionTier !== 'ideal'
      || snapshot.liquiditySelectionTier !== 'ideal'
      || snapshot.usedSecondExpiration;
    return {
      status: 'updated',
      snapshot,
      expanded,
      reason: null,
      requestCount: requestedExpirations.length,
      requestedExpirations,
    };
  } catch (error) {
    return {
      status: 'failed',
      snapshot: null,
      expanded: false,
      reason: error instanceof Error ? error.message : 'Snapshot update failed.',
      requestCount: requestedExpirations.length,
      requestedExpirations,
    };
  }
}

function isSnapshotV2(value: unknown): value is ScannerOptionSnapshot {
  const snapshot = value as Partial<ScannerOptionSnapshot> | null;
  return snapshot?.schemaVersion === 2
    && typeof snapshot.ticker === 'string'
    && typeof snapshot.updatedAt === 'string'
    && typeof snapshot.liquidityLabel === 'string';
}

export function getScannerOptionSnapshots(): Record<string, ScannerOptionSnapshot> {
  const raw = readRecord<unknown>(SNAPSHOT_CACHE_KEY);
  return Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, ScannerOptionSnapshot] => isSnapshotV2(entry[1])));
}

export function cacheScannerOptionSnapshot(snapshot: ScannerOptionSnapshot): boolean {
  if (!isSnapshotV2(snapshot) || !snapshot.ticker) return false;
  const snapshots = getScannerOptionSnapshots();
  const existing = snapshots[snapshot.ticker];
  const nextUseful = hasScannerSnapshotData(snapshot);
  const existingUseful = existing && hasScannerSnapshotData(existing);
  if (existingUseful && !nextUseful) return false;
  const existingUpdatedAt = Date.parse(existing?.updatedAt ?? '');
  const nextUpdatedAt = Date.parse(snapshot.updatedAt);
  if (Number.isFinite(existingUpdatedAt) && Number.isFinite(nextUpdatedAt) && nextUpdatedAt < existingUpdatedAt) return false;
  snapshots[snapshot.ticker] = snapshot;
  writeRecord(SNAPSHOT_CACHE_KEY, snapshots);
  if (nextUseful) clearScannerSnapshotDiagnostic(snapshot.ticker);
  return true;
}

export function isScannerOptionSnapshotStale(snapshot: ScannerOptionSnapshot | null | undefined, now = Date.now()): boolean {
  if (!snapshot || !isSnapshotV2(snapshot)) return true;
  const updatedAt = Date.parse(snapshot.updatedAt);
  return !Number.isFinite(updatedAt) || now - updatedAt > SCANNER_OPTION_SNAPSHOT_TTL;
}

function cacheExpirationMetadata(ticker: string, chain: OptionsChainData): void {
  if (chain.expirations.length === 0) return;
  const expirations = readRecord<CachedScannerExpirations>(EXPIRATION_CACHE_KEY);
  expirations[ticker] = {
    dates: [...new Set(chain.expirations.map(expiration => expiration.date))].sort((a, b) => a - b),
    updatedAt: new Date(chain.chainMeta?.fetchedAt ?? Date.now()).toISOString(),
  };
  writeRecord(EXPIRATION_CACHE_KEY, expirations);
}

export function cacheScannerOptionChain(ticker: string, chain: OptionsChainData): ScannerOptionSnapshot | null {
  const normalizedTicker = ticker.trim().toUpperCase();
  if (!normalizedTicker) return null;
  cacheExpirationMetadata(normalizedTicker, chain);
  const selectedExpiration = selectScannerSnapshotExpiration(chain.expirations);
  const returnedExpiration = chain.chainMeta?.returnedExpiration ?? chain.chainMeta?.expirationDate ?? null;
  if (!selectedExpiration || returnedExpiration !== selectedExpiration.date) return null;
  const snapshot = buildScannerOptionSnapshot(normalizedTicker, chain, selectedExpiration);
  cacheScannerOptionSnapshot(snapshot);
  return snapshot;
}

export function getCachedScannerExpirations(ticker: string): number[] | null {
  const cached = readRecord<CachedScannerExpirations>(EXPIRATION_CACHE_KEY)[ticker.trim().toUpperCase()];
  if (!cached || !Array.isArray(cached.dates)) return null;
  const updatedAt = Date.parse(cached.updatedAt);
  if (!Number.isFinite(updatedAt) || Date.now() - updatedAt > SCANNER_EXPIRATION_METADATA_TTL) return null;
  return cached.dates.filter(Number.isFinite);
}

export function getAllCachedScannerExpirations(): Record<string, number[]> {
  const cached = readRecord<CachedScannerExpirations>(EXPIRATION_CACHE_KEY);
  return Object.fromEntries(Object.entries(cached).map(([ticker, entry]) => [
    ticker,
    Array.isArray(entry?.dates) ? entry.dates.filter(date => Number.isFinite(date) && calculateCalendarDte(date) > 0) : [],
  ]));
}

export function recordScannerSnapshotDiagnostic(ticker: string, status: ScannerSnapshotDiagnostic['status'], reason: string): void {
  const normalizedTicker = ticker.trim().toUpperCase();
  if (!normalizedTicker) return;
  const diagnostics = readRecord<ScannerSnapshotDiagnostic>(DIAGNOSTIC_CACHE_KEY);
  diagnostics[normalizedTicker] = {
    status,
    reason: reason.trim().slice(0, 220) || (status === 'failed' ? 'Snapshot update failed.' : 'Snapshot data is unavailable.'),
    updatedAt: new Date().toISOString(),
  };
  writeRecord(DIAGNOSTIC_CACHE_KEY, diagnostics);
}

export function clearScannerSnapshotDiagnostic(ticker: string): void {
  const normalizedTicker = ticker.trim().toUpperCase();
  const diagnostics = readRecord<ScannerSnapshotDiagnostic>(DIAGNOSTIC_CACHE_KEY);
  if (!(normalizedTicker in diagnostics)) return;
  delete diagnostics[normalizedTicker];
  writeRecord(DIAGNOSTIC_CACHE_KEY, diagnostics);
}

export function getScannerSnapshotDiagnostics(): Record<string, ScannerSnapshotDiagnostic> {
  return readRecord<ScannerSnapshotDiagnostic>(DIAGNOSTIC_CACHE_KEY);
}

export function scannerLiquidityCompactText(label: ScannerLiquidityLabel): string {
  if (label === 'very_liquid') return 'V LIQUID';
  if (label === 'liquid') return 'LIQUID';
  if (label === 'medium') return 'MEDIUM';
  if (label === 'thin') return 'THIN';
  if (label === 'illiquid') return 'ILLIQUID';
  return 'LIQ —';
}

export function scannerLiquidityLabelText(label: ScannerLiquidityLabel): string {
  if (label === 'very_liquid') return 'Very Liquid';
  if (label === 'liquid') return 'Liquid';
  if (label === 'medium') return 'Medium';
  if (label === 'thin') return 'Thin';
  if (label === 'illiquid') return 'Illiquid';
  return 'Unavailable';
}
