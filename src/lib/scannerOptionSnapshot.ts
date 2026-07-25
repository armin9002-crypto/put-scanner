import type { ExpirationDate, OptionContract, OptionsChainData } from './types';

export type ScannerLiquidityLabel =
  | 'very_liquid'
  | 'liquid'
  | 'medium'
  | 'thin'
  | 'illiquid'
  | 'unavailable';

export interface ScannerOptionSnapshot {
  ticker: string;
  underlyingPrice: number;
  expiration: number;
  dte: number;
  atmStrike: number | null;
  atmPutIv: number | null;
  liquidityStrike: number | null;
  actualOtmPercent: number | null;
  bid: number | null;
  ask: number | null;
  midpoint: number | null;
  last: number | null;
  lastTradeDate: number | null;
  openInterest: number | null;
  volume: number | null;
  spreadPercent: number | null;
  nearbyValidBidCount: number;
  liquidityScore: number | null;
  liquidityLabel: ScannerLiquidityLabel;
  updatedAt: string;
}

interface CachedScannerExpirations {
  dates: number[];
  updatedAt: string;
}

const SNAPSHOT_CACHE_KEY = 'scanner_option_snapshots_v1';
const EXPIRATION_CACHE_KEY = 'scanner_option_expirations_v1';
export const SCANNER_OPTION_SNAPSHOT_TTL = 8 * 60 * 60 * 1000;
export const SCANNER_EXPIRATION_METADATA_TTL = 12 * 60 * 60 * 1000;

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
    // Keep the application usable if storage is unavailable or full.
  }
}

export function calculateCalendarDte(expirationTimestamp: number, now = new Date()): number {
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const expiration = new Date(expirationTimestamp * 1000);
  const expirationUtc = Date.UTC(expiration.getUTCFullYear(), expiration.getUTCMonth(), expiration.getUTCDate());
  return Math.round((expirationUtc - todayUtc) / 86_400_000);
}

export function selectScannerSnapshotExpiration(
  expirations: Array<Pick<ExpirationDate, 'date'> | number>,
  now = new Date(),
): { date: number; dte: number } | null {
  const candidates = [...new Set(expirations.map(expiration => typeof expiration === 'number' ? expiration : expiration.date))]
    .map(date => ({ date, dte: calculateCalendarDte(date, now) }))
    .filter(expiration => Number.isFinite(expiration.date));
  const preferred = candidates.filter(expiration => expiration.dte >= 45 && expiration.dte <= 75);
  const fallback = candidates.filter(expiration => expiration.dte >= 30 && expiration.dte <= 90);
  const pool = preferred.length > 0 ? preferred : fallback;
  if (pool.length === 0) return null;
  return [...pool].sort((a, b) => Math.abs(a.dte - 60) - Math.abs(b.dte - 60) || a.date - b.date)[0];
}

function observedFixedHoliday(year: number, month: number, day: number): number {
  const holiday = new Date(Date.UTC(year, month, day));
  if (holiday.getUTCDay() === 6) holiday.setUTCDate(holiday.getUTCDate() - 1);
  if (holiday.getUTCDay() === 0) holiday.setUTCDate(holiday.getUTCDate() + 1);
  return holiday.getTime();
}

function nthWeekdayOfMonth(year: number, month: number, weekday: number, occurrence: number): number {
  const date = new Date(Date.UTC(year, month, 1));
  const offset = (weekday - date.getUTCDay() + 7) % 7;
  date.setUTCDate(1 + offset + (occurrence - 1) * 7);
  return date.getTime();
}

function lastWeekdayOfMonth(year: number, month: number, weekday: number): number {
  const date = new Date(Date.UTC(year, month + 1, 0));
  const offset = (date.getUTCDay() - weekday + 7) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
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
  const timestamp = date.getTime();
  const goodFriday = easterSundayUtc(year);
  goodFriday.setUTCDate(goodFriday.getUTCDate() - 2);
  const holidays = new Set([
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
  ]);
  return holidays.has(timestamp);
}

function isTradingDay(date: Date): boolean {
  const weekday = date.getUTCDay();
  return weekday !== 0 && weekday !== 6 && !isUsMarketHoliday(date);
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
    if (isTradingDay(cursor)) tradingDays += 1;
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

function scoreSpread(spreadPercent: number | null): number {
  if (!finiteNonNegative(spreadPercent)) return 0;
  if (spreadPercent <= 0.15) return 25;
  if (spreadPercent <= 0.25) return 20;
  if (spreadPercent <= 0.40) return 12;
  if (spreadPercent <= 0.60) return 5;
  return 0;
}

function scoreRecency(tradingDays: number | null): number {
  if (tradingDays == null) return 0;
  if (tradingDays <= 1) return 15;
  if (tradingDays <= 3) return 11;
  if (tradingDays <= 7) return 6;
  return 1;
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
  const order: Array<Exclude<ScannerLiquidityLabel, 'unavailable'>> = ['illiquid', 'thin', 'medium', 'liquid', 'very_liquid'];
  return order[Math.min(order.indexOf(label), order.indexOf(maximum))];
}

function downgradeLabel(label: Exclude<ScannerLiquidityLabel, 'unavailable'>): Exclude<ScannerLiquidityLabel, 'unavailable'> {
  const order: Array<Exclude<ScannerLiquidityLabel, 'unavailable'>> = ['illiquid', 'thin', 'medium', 'liquid', 'very_liquid'];
  return order[Math.max(0, order.indexOf(label) - 1)];
}

function closestContract(puts: OptionContract[], target: number, predicate?: (put: OptionContract) => boolean): OptionContract | null {
  return puts
    .filter(put => Number.isFinite(put.strike) && (!predicate || predicate(put)))
    .sort((a, b) => Math.abs(a.strike - target) - Math.abs(b.strike - target) || a.strike - b.strike)[0] ?? null;
}

export function buildScannerOptionSnapshot(
  ticker: string,
  chain: OptionsChainData,
  selectedExpiration: { date: number; dte: number },
  now = new Date(),
): ScannerOptionSnapshot | null {
  const normalizedTicker = ticker.trim().toUpperCase();
  const returnedExpiration = chain.chainMeta?.returnedExpiration ?? chain.chainMeta?.expirationDate ?? null;
  if (!normalizedTicker || returnedExpiration !== selectedExpiration.date || !finitePositive(chain.currentPrice)) return null;

  const puts = chain.puts.filter(put => Number.isFinite(put.strike));
  if (puts.length === 0) return null;

  const atmPut = closestContract(puts, chain.currentPrice, put => finitePositive(put.impliedVolatility));
  const targetStrike = chain.currentPrice * 0.70;
  const liquidityPut = closestContract(puts, targetStrike);
  const actualOtmPercent = liquidityPut
    ? ((chain.currentPrice - liquidityPut.strike) / chain.currentPrice) * 100
    : null;
  const representative = liquidityPut != null
    && actualOtmPercent != null
    && actualOtmPercent >= 25
    && actualOtmPercent <= 35;

  let liquidityLabel: ScannerLiquidityLabel = 'unavailable';
  let liquidityScore: number | null = null;
  let midpoint: number | null = null;
  let spreadPercent: number | null = null;
  let nearbyValidBidCount = 0;

  if (liquidityPut && representative) {
    const bid = liquidityPut.bid;
    const ask = liquidityPut.ask;
    const validBid = finitePositive(bid);
    const validAsk = finitePositive(ask);
    const twoSided = validBid && validAsk && ask >= bid;
    midpoint = twoSided ? (bid + ask) / 2 : null;
    spreadPercent = twoSided && finitePositive(midpoint)
      ? (ask - bid) / midpoint
      : null;

    const sorted = [...puts].sort((a, b) => a.strike - b.strike);
    const selectedIndex = sorted.findIndex(put => put.strike === liquidityPut.strike);
    const nearby = [
      selectedIndex > 0 ? sorted[selectedIndex - 1] : null,
      liquidityPut,
      selectedIndex >= 0 && selectedIndex < sorted.length - 1 ? sorted[selectedIndex + 1] : null,
    ].filter((put): put is OptionContract => put != null);
    nearbyValidBidCount = nearby.filter(put => finitePositive(put.bid)).length;

    const marketAvailability = twoSided ? 30 : validBid ? 12 : 0;
    const recency = tradingDaysAgo(liquidityPut.lastTradeDate, now);
    liquidityScore = marketAvailability
      + scoreSpread(spreadPercent)
      + scoreOpenInterest(liquidityPut.openInterest)
      + scoreRecency(recency)
      + scoreVolume(liquidityPut.volume);

    let scoredLabel = labelForScore(liquidityScore);
    if (!validBid) scoredLabel = capLabel(scoredLabel, 'thin');
    if (!twoSided) scoredLabel = capLabel(scoredLabel, 'liquid');
    const qualifiesVeryLiquid = twoSided
      && spreadPercent != null
      && spreadPercent <= 0.25
      && finiteNonNegative(liquidityPut.openInterest)
      && liquidityPut.openInterest >= 100
      && recency != null
      && recency <= 3;
    if (!qualifiesVeryLiquid) scoredLabel = capLabel(scoredLabel, 'liquid');
    if (nearbyValidBidCount === 0) {
      scoredLabel = 'illiquid';
    } else if (nearbyValidBidCount === 1) {
      scoredLabel = downgradeLabel(scoredLabel);
    }
    liquidityLabel = scoredLabel;
  }

  const fetchedAt = chain.chainMeta?.fetchedAt;
  const updatedAt = Number.isFinite(fetchedAt) ? new Date(fetchedAt!).toISOString() : now.toISOString();
  return {
    ticker: normalizedTicker,
    underlyingPrice: chain.currentPrice,
    expiration: selectedExpiration.date,
    dte: selectedExpiration.dte,
    atmStrike: atmPut?.strike ?? null,
    atmPutIv: finitePositive(atmPut?.impliedVolatility) ? atmPut.impliedVolatility : null,
    liquidityStrike: representative ? liquidityPut?.strike ?? null : null,
    actualOtmPercent: representative ? actualOtmPercent : null,
    bid: representative && finiteNonNegative(liquidityPut?.bid) ? liquidityPut.bid : null,
    ask: representative && finiteNonNegative(liquidityPut?.ask) ? liquidityPut.ask : null,
    midpoint,
    last: representative && finiteNonNegative(liquidityPut?.last) ? liquidityPut.last : null,
    lastTradeDate: representative && finitePositive(liquidityPut?.lastTradeDate) ? liquidityPut.lastTradeDate : null,
    openInterest: representative && finiteNonNegative(liquidityPut?.openInterest) ? liquidityPut.openInterest : null,
    volume: representative && finiteNonNegative(liquidityPut?.volume) ? liquidityPut.volume : null,
    spreadPercent,
    nearbyValidBidCount,
    liquidityScore,
    liquidityLabel,
    updatedAt,
  };
}

export function getScannerOptionSnapshots(): Record<string, ScannerOptionSnapshot> {
  return readRecord<ScannerOptionSnapshot>(SNAPSHOT_CACHE_KEY);
}

export function isScannerOptionSnapshotStale(snapshot: ScannerOptionSnapshot | null | undefined, now = Date.now()): boolean {
  if (!snapshot) return true;
  const updatedAt = Date.parse(snapshot.updatedAt);
  return !Number.isFinite(updatedAt) || now - updatedAt > SCANNER_OPTION_SNAPSHOT_TTL;
}

export function cacheScannerOptionChain(ticker: string, chain: OptionsChainData): ScannerOptionSnapshot | null {
  const normalizedTicker = ticker.trim().toUpperCase();
  if (!normalizedTicker) return null;

  if (chain.expirations.length > 0) {
    const expirations = readRecord<CachedScannerExpirations>(EXPIRATION_CACHE_KEY);
    expirations[normalizedTicker] = {
      dates: [...new Set(chain.expirations.map(expiration => expiration.date))].sort((a, b) => a - b),
      updatedAt: new Date(chain.chainMeta?.fetchedAt ?? Date.now()).toISOString(),
    };
    writeRecord(EXPIRATION_CACHE_KEY, expirations);
  }

  const selectedExpiration = selectScannerSnapshotExpiration(chain.expirations);
  if (!selectedExpiration) return null;
  const snapshot = buildScannerOptionSnapshot(normalizedTicker, chain, selectedExpiration);
  if (!snapshot) return null;
  const snapshots = getScannerOptionSnapshots();
  const existingUpdatedAt = Date.parse(snapshots[normalizedTicker]?.updatedAt ?? '');
  const nextUpdatedAt = Date.parse(snapshot.updatedAt);
  if (!Number.isFinite(existingUpdatedAt) || nextUpdatedAt >= existingUpdatedAt) {
    snapshots[normalizedTicker] = snapshot;
    writeRecord(SNAPSHOT_CACHE_KEY, snapshots);
  }
  return snapshot;
}

export function getCachedScannerExpirations(ticker: string): number[] | null {
  const cached = readRecord<CachedScannerExpirations>(EXPIRATION_CACHE_KEY)[ticker.trim().toUpperCase()];
  if (!cached || !Array.isArray(cached.dates)) return null;
  const updatedAt = Date.parse(cached.updatedAt);
  if (!Number.isFinite(updatedAt) || Date.now() - updatedAt > SCANNER_EXPIRATION_METADATA_TTL) return null;
  return cached.dates.filter(Number.isFinite);
}

export function scannerLiquidityLabelText(label: ScannerLiquidityLabel): string {
  switch (label) {
    case 'very_liquid': return 'VERY LIQUID';
    case 'liquid': return 'LIQUID';
    case 'medium': return 'MEDIUM';
    case 'thin': return 'THIN';
    case 'illiquid': return 'ILLIQUID';
    default: return 'LIQ —';
  }
}
