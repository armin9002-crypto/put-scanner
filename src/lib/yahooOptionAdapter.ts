import { normalizeFiniteNumber, normalizeNonNegativeNumber, normalizePositiveNumber, normalizeTimestampSeconds, normalizeYahooIvPercent } from './marketDataNormalize.ts';
import type { ExpirationDate, OptionChainSource, OptionContract, OptionsChainData } from './types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface YahooOptionContract {
  contractSymbol?: string | null;
  contractSize?: string | null;
  currency?: string | null;
  inTheMoney?: boolean | null;
  strike?: number | null;
  lastPrice?: number | null;
  lastTradeDate?: number | null;
  bid?: number | null;
  ask?: number | null;
  delta?: number | null;
  gamma?: number | null;
  theta?: number | null;
  vega?: number | null;
  greeks?: { delta?: number | null; gamma?: number | null; theta?: number | null; vega?: number | null };
  impliedVolatility?: number | null;
  volume?: number | null;
  openInterest?: number | null;
}

function calculateDte(expirationTimestamp: number): number {
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const expiry = new Date(expirationTimestamp * 1000);
  const expiryUtc = Date.UTC(expiry.getUTCFullYear(), expiry.getUTCMonth(), expiry.getUTCDate());
  return Math.max(0, Math.round((expiryUtc - todayUtc) / 86_400_000));
}

function formatExpirationLabel(timestamp: number, currentUtcYear: number): string {
  const date = new Date(timestamp * 1000);
  const monthDay = `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
  const year = date.getUTCFullYear();
  return year === currentUtcYear ? monthDay : `${monthDay} '${String(year % 100).padStart(2, '0')}`;
}

function strikeRange(contracts: YahooOptionContract[]): { min: number | null; max: number | null } {
  const strikes = contracts.map(contract => contract.strike).filter((strike): strike is number => Number.isFinite(strike));
  return strikes.length === 0 ? { min: null, max: null } : { min: Math.min(...strikes), max: Math.max(...strikes) };
}

function preferContract(existing: OptionContract, incoming: OptionContract): OptionContract {
  const existingHasMarket = existing.bid != null || existing.ask != null || existing.last != null;
  const incomingHasMarket = incoming.bid != null || incoming.ask != null || incoming.last != null;
  if (incomingHasMarket && !existingHasMarket) return incoming;
  return (incoming.lastTradeDate ?? 0) > (existing.lastTradeDate ?? 0) ? incoming : existing;
}

function normalizeYahooContract(contract: YahooOptionContract): YahooOptionContract {
  return {
    ...contract,
    strike: normalizePositiveNumber(contract.strike),
    lastPrice: normalizeNonNegativeNumber(contract.lastPrice),
    lastTradeDate: normalizeTimestampSeconds(contract.lastTradeDate),
    bid: normalizeNonNegativeNumber(contract.bid),
    ask: normalizeNonNegativeNumber(contract.ask),
    delta: normalizeFiniteNumber(contract.delta),
    gamma: normalizeFiniteNumber(contract.gamma),
    theta: normalizeFiniteNumber(contract.theta),
    vega: normalizeFiniteNumber(contract.vega),
    greeks: contract.greeks ? {
      delta: normalizeFiniteNumber(contract.greeks.delta),
      gamma: normalizeFiniteNumber(contract.greeks.gamma),
      theta: normalizeFiniteNumber(contract.greeks.theta),
      vega: normalizeFiniteNumber(contract.greeks.vega),
    } : undefined,
    impliedVolatility: normalizePositiveNumber(contract.impliedVolatility),
    volume: normalizeNonNegativeNumber(contract.volume),
    openInterest: normalizeNonNegativeNumber(contract.openInterest),
  };
}

function mapYahooPut(contract: YahooOptionContract & { strike: number }): OptionContract {
  const yahooDelta = normalizeFiniteNumber(contract.greeks?.delta ?? contract.delta);
  return {
    strike: contract.strike,
    last: normalizeNonNegativeNumber(contract.lastPrice),
    lastTradeDate: normalizeTimestampSeconds(contract.lastTradeDate),
    bid: normalizeNonNegativeNumber(contract.bid),
    ask: normalizeNonNegativeNumber(contract.ask),
    delta: yahooDelta != null && yahooDelta !== 0 ? (yahooDelta > 0 ? -yahooDelta : yahooDelta) : null,
    gamma: contract.greeks?.gamma ?? contract.gamma ?? null,
    theta: contract.greeks?.theta ?? contract.theta ?? null,
    vega: contract.greeks?.vega ?? contract.vega ?? null,
    impliedVolatility: normalizeYahooIvPercent(contract.impliedVolatility),
    volume: normalizeNonNegativeNumber(contract.volume),
    openInterest: normalizeNonNegativeNumber(contract.openInterest),
    contractSymbol: contract.contractSymbol ?? null,
    rawLastPrice: contract.lastPrice ?? null,
    rawBid: contract.bid ?? null,
    rawAsk: contract.ask ?? null,
    rawImpliedVolatility: contract.impliedVolatility ?? null,
    rawOpenInterest: contract.openInterest ?? null,
    rawVolume: contract.volume ?? null,
    rawLastTradeDate: contract.lastTradeDate ?? null,
  };
}

export function parseYahooOptionSymbol(symbol: string | null | undefined): { expiration: number | null; type: 'C' | 'P' | null; strike: number | null } {
  const match = symbol?.match(/(\d{6})([CP])(\d{8})$/);
  if (!match) return { expiration: null, type: null, strike: null };
  const [, yymmdd, rawType, strikeRaw] = match;
  const expiration = Math.floor(Date.UTC(2000 + Number(yymmdd.slice(0, 2)), Number(yymmdd.slice(2, 4)) - 1, Number(yymmdd.slice(4, 6))) / 1000);
  const strike = Number(strikeRaw) / 1000;
  return {
    expiration: Number.isFinite(expiration) ? expiration : null,
    type: rawType === 'P' || rawType === 'C' ? rawType : null,
    strike: Number.isFinite(strike) ? strike : null,
  };
}

function validateYahooPutContract(contract: YahooOptionContract, requestedExpiration: number | null, returnedExpiration: number | null): string[] {
  const warnings: string[] = [];
  if (!Number.isFinite(contract.strike)) warnings.push('Invalid or missing strike.');
  ([['lastPrice', contract.lastPrice], ['bid', contract.bid], ['ask', contract.ask], ['impliedVolatility', contract.impliedVolatility], ['openInterest', contract.openInterest], ['volume', contract.volume], ['lastTradeDate', contract.lastTradeDate]] as const)
    .forEach(([label, value]) => { if (value != null && !Number.isFinite(value)) warnings.push(`${label} is not finite.`); });
  const parsed = parseYahooOptionSymbol(contract.contractSymbol);
  if (parsed.type && parsed.type !== 'P') warnings.push(`Contract symbol appears to be a ${parsed.type === 'C' ? 'call' : parsed.type}.`);
  const expectedExpiration = requestedExpiration ?? returnedExpiration;
  if (parsed.expiration != null && expectedExpiration != null && parsed.expiration !== expectedExpiration) warnings.push(`Contract symbol expiration ${parsed.expiration} does not match expected ${expectedExpiration}.`);
  if (parsed.strike != null && Number.isFinite(contract.strike) && Math.abs(parsed.strike - Number(contract.strike)) > 0.001) warnings.push(`Contract symbol strike ${parsed.strike} does not match Yahoo strike ${contract.strike}.`);
  return warnings;
}

export function normalizeOptionChainData(data: unknown, ticker: string, date: number | undefined, cacheKey: string, source: OptionChainSource, previousCachedPutCount: number | null): OptionsChainData {
  const result = (data as { optionChain?: { result?: unknown[] } })?.optionChain?.result?.[0] as {
    quote?: { regularMarketPrice?: number | null };
    expirationDates?: number[];
    options?: Array<{ puts?: YahooOptionContract[]; calls?: YahooOptionContract[]; expirationDate?: number }>;
  } | undefined;
  const fetchedAt = Date.now();
  if (!result) return {
    expirations: [], puts: [], currentPrice: 0,
    chainMeta: { ticker, requestedExpiration: date ?? null, returnedExpiration: null, expirationDate: null, fetchedAt, source, fresh: source === 'fresh', cacheKey, putCount: 0, callCount: 0, putStrikeMin: null, putStrikeMax: null, callStrikeMin: null, callStrikeMax: null, yahooExpirationDatesCount: 0, previousCachedPutCount },
  };

  const currentPrice = normalizePositiveNumber(result.quote?.regularMarketPrice) ?? 0;
  const expirationDates = (result.expirationDates ?? []).map(normalizeTimestampSeconds).filter((value): value is number => value != null);
  const chain = result.options?.[0];
  const chainExpiration = normalizeTimestampSeconds(chain?.expirationDate) ?? date ?? null;
  const requestedExpiration = date ?? null;
  const validationWarnings: string[] = [];
  if (requestedExpiration != null && chainExpiration != null && requestedExpiration !== chainExpiration) validationWarnings.push(`Requested expiration ${requestedExpiration} but Yahoo returned ${chainExpiration}.`);
  const putsRaw = (chain?.puts ?? []).map(normalizeYahooContract);
  const callsRaw = (chain?.calls ?? []).map(normalizeYahooContract);
  const putRange = strikeRange(putsRaw);
  const callRange = strikeRange(callsRaw);
  const currentYear = new Date().getUTCFullYear();
  const expirations: ExpirationDate[] = expirationDates.map(timestamp => ({ date: timestamp, label: formatExpirationLabel(timestamp, currentYear), dte: calculateDte(timestamp) }));
  const putsByStrike = new Map<number, OptionContract>();
  putsRaw.filter((put): put is YahooOptionContract & { strike: number } => {
    validateYahooPutContract(put, requestedExpiration, chainExpiration).forEach(warning => validationWarnings.push(`${put.contractSymbol ?? `strike ${put.strike ?? 'unknown'}`}: ${warning}`));
    return Number.isFinite(put.strike) && parseYahooOptionSymbol(put.contractSymbol).type !== 'C';
  }).forEach(rawPut => {
    const put = mapYahooPut(rawPut);
    const existing = putsByStrike.get(put.strike);
    putsByStrike.set(put.strike, existing ? preferContract(existing, put) : put);
  });
  const puts = [...putsByStrike.values()].sort((a, b) => a.strike - b.strike);
  return {
    expirations, puts, currentPrice,
    chainMeta: { ticker, requestedExpiration, returnedExpiration: chainExpiration, expirationDate: chainExpiration, fetchedAt, source, fresh: source === 'fresh', cacheKey, putCount: puts.length, callCount: callsRaw.length, putStrikeMin: putRange.min, putStrikeMax: putRange.max, callStrikeMin: callRange.min, callStrikeMax: callRange.max, yahooExpirationDatesCount: expirationDates.length, previousCachedPutCount, validationWarnings },
  };
}
