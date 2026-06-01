import { fetchOptions } from '../api';
import { getCached } from '../cache';
import type { EtfPulseRow } from '../etfPulseMetrics';
import { calculateAnnualizedYield, calculateBidAskSpreadPercent, calculateBreakeven, calculateDownsideCushion, calculateNominalYield, isFiniteNumber } from '../optionMetrics';
import type { PortfolioTrade } from '../portfolioStorage';
import type { ExpirationDate, OptionsChainData } from '../types';
import { getWatchlist } from '../watchlist';
import { scoreCandidate, sortCandidates, styleAllowsMissingDelta } from './scoring';
import type { ScanCriteria, ScanDiagnostics, TradeCandidate, TradeScanResult } from './types';

const OPTIONS_LS_TTL = 15 * 60 * 1000;

function isoFromTimestamp(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString().split('T')[0];
}

function optionCacheKey(ticker: string, date?: number): string {
  return `options_v2_${ticker}_${date ?? 'initial'}`;
}

function hasCachedOptionChain(ticker: string, date?: number): boolean {
  return getCached<OptionsChainData>(optionCacheKey(ticker, date), OPTIONS_LS_TTL) != null;
}

export function normalizePercentInput(value: number | null | undefined): number | null {
  if (!isFiniteNumber(value)) return null;
  return value > 1 ? value / 100 : value;
}

export function safeAbsDelta(value: number | null | undefined): number | null {
  return isFiniteNumber(value) ? Math.abs(value) : null;
}

export function getDistanceToStrikeDecimal(underlying: number | null | undefined, strike: number | null | undefined): number | null {
  if (!isFiniteNumber(underlying) || underlying <= 0 || !isFiniteNumber(strike)) return null;
  return (underlying - strike) / underlying;
}

export function getBidAskSpreadDecimal(bid: number | null | undefined, ask: number | null | undefined): number | null {
  return calculateBidAskSpreadPercent(bid, ask);
}

function increment(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

async function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results: T[] = [];
  const executing: Promise<void>[] = [];
  for (const task of tasks) {
    const promise = task().then(result => {
      results.push(result);
    });
    const tracked = promise.finally(() => {
      const index = executing.indexOf(tracked);
      if (index >= 0) executing.splice(index, 1);
    });
    executing.push(tracked);
    if (executing.length >= limit) await Promise.race(executing);
  }
  await Promise.all(executing);
  return results;
}

function selectExpirations(expirations: ExpirationDate[], criteria: ScanCriteria): ExpirationDate[] {
  return expirations
    .filter(exp => exp.dte >= criteria.minDte && exp.dte <= criteria.maxDte)
    .sort((a, b) => a.dte - b.dte)
    .slice(0, criteria.maxExpirationsPerTicker);
}

export function estimateOptionRequests(tickers: string[], criteria: ScanCriteria): number {
  const initialLookupPerTicker = 1;
  const initialChainLikelyUsable = criteria.minDte <= 45;
  const additionalDatedChains = initialChainLikelyUsable
    ? Math.max(0, criteria.maxExpirationsPerTicker - 1)
    : criteria.maxExpirationsPerTicker;
  return tickers.length * (initialLookupPerTicker + additionalDatedChains);
}

export async function runTradeScan({
  tickers,
  pulseRows,
  portfolioTrades,
  criteria,
  onProgress,
}: {
  tickers: string[];
  pulseRows: EtfPulseRow[];
  portfolioTrades: PortfolioTrade[];
  criteria: ScanCriteria;
  onProgress?: (progress: { completed: number; total: number; ticker?: string }) => void;
}): Promise<TradeScanResult> {
  const normalizedTickers = [...new Set(tickers.map(ticker => ticker.trim().toUpperCase()).filter(Boolean))].slice(0, criteria.maxTickers);
  const pulseByTicker = new Map(pulseRows.map(row => [row.ticker.toUpperCase(), row]));
  const watchlistTickers = new Set(getWatchlist().map(item => item.ticker.toUpperCase()));
  const failures: Array<{ ticker: string; message: string }> = [];
  const candidates: TradeCandidate[] = [];
  let completed = 0;
  let total = normalizedTickers.length;
  let requestsMade = 0;
  let cacheHits = 0;
  let expirationsScanned = 0;
  const nearMisses: TradeCandidate[] = [];
  const diagnostics: ScanDiagnostics = {
    tickersSelected: normalizedTickers.length,
    expirationsSelected: 0,
    optionChainsRequested: 0,
    chainsLoadedFromCache: 0,
    chainsFetchedFromNetwork: 0,
    rawPutContracts: 0,
    otmPuts: 0,
    passedDte: 0,
    passedBid: 0,
    passedDelta: 0,
    passedCushion: 0,
    passedOpenInterest: 0,
    passedSpread: 0,
    finalCandidates: 0,
    exclusionReasons: {},
  };
  const maxDelta = normalizePercentInput(criteria.maxDelta) ?? 0.2;
  const minCushion = normalizePercentInput(criteria.minDistanceToStrike) ?? 0.2;
  const maxSpread = normalizePercentInput(criteria.maxSpreadPercent) ?? 0.35;

  const tickerTasks = normalizedTickers.map(ticker => async () => {
    try {
      const initialWasCached = hasCachedOptionChain(ticker);
      const initial = await fetchOptions(ticker);
      if (initialWasCached) cacheHits += 1;
      else requestsMade += 1;

      const selectedExpirations = selectExpirations(initial.expirations, criteria);
      expirationsScanned += selectedExpirations.length;
      diagnostics.expirationsSelected += selectedExpirations.length;
      total += Math.max(0, selectedExpirations.length - 1);
      const chains: Array<{ exp: ExpirationDate; data: OptionsChainData }> = [];

      for (const exp of selectedExpirations) {
        if (exp.date === initial.expirations[0]?.date) {
          chains.push({ exp, data: initial });
          continue;
        }
        const wasCached = hasCachedOptionChain(ticker, exp.date);
        const data = await fetchOptions(ticker, exp.date);
        if (wasCached) cacheHits += 1;
        else requestsMade += 1;
        chains.push({ exp, data });
        completed += 1;
        onProgress?.({ completed, total, ticker });
      }

      const pulseRow = pulseByTicker.get(ticker) ?? null;
      const perTickerCandidates: TradeCandidate[] = [];

      chains.forEach(({ exp, data }) => {
        const currentPrice = data.currentPrice || pulseRow?.price || null;
        data.puts.forEach(put => {
          diagnostics.rawPutContracts += 1;
          const failedFilters: string[] = [];
          const bid = isFiniteNumber(put.bid) ? put.bid : null;
          const absDelta = safeAbsDelta(put.delta);
          const distanceToStrike = getDistanceToStrikeDecimal(currentPrice, put.strike);
          const spreadPercent = getBidAskSpreadDecimal(bid, put.ask);
          const bidOk = bid != null && bid > 0;
          const dteOk = exp.dte >= criteria.minDte && exp.dte <= criteria.maxDte;
          const otmOk = isFiniteNumber(currentPrice) && put.strike < currentPrice;
          const deltaOk = absDelta == null ? styleAllowsMissingDelta(criteria.tradeStyle) : absDelta <= maxDelta;
          const cushionOk = distanceToStrike != null && distanceToStrike >= minCushion;
          const oiOk = (put.openInterest ?? 0) >= criteria.minOpenInterest;
          const spreadOk = spreadPercent == null || spreadPercent <= maxSpread;

          if (otmOk) diagnostics.otmPuts += 1;
          else failedFilters.push('not OTM');
          if (dteOk) diagnostics.passedDte += 1;
          else failedFilters.push(`DTE ${exp.dte} outside ${criteria.minDte}-${criteria.maxDte}`);
          if (bidOk) diagnostics.passedBid += 1;
          else failedFilters.push('no bid');
          if (deltaOk) diagnostics.passedDelta += 1;
          else failedFilters.push(absDelta == null ? 'missing delta' : `delta ${absDelta.toFixed(2)} above ${maxDelta.toFixed(2)}`);
          if (cushionOk) diagnostics.passedCushion += 1;
          else failedFilters.push(distanceToStrike == null ? 'missing cushion' : `cushion ${(distanceToStrike * 100).toFixed(1)}% below ${(minCushion * 100).toFixed(1)}%`);
          if (oiOk) diagnostics.passedOpenInterest += 1;
          else failedFilters.push(`OI ${put.openInterest ?? 0} below ${criteria.minOpenInterest}`);
          if (spreadOk) diagnostics.passedSpread += 1;
          else failedFilters.push(`spread ${spreadPercent == null ? 'missing' : `${(spreadPercent * 100).toFixed(1)}%`} above ${(maxSpread * 100).toFixed(1)}%`);

          failedFilters.forEach(reason => increment(diagnostics.exclusionReasons, reason.split(' below ')[0].split(' above ')[0]));
          if (!bidOk || !otmOk || !dteOk) return;

          const breakeven = calculateBreakeven(put.strike, bid);
          const breakevenCushion = calculateDownsideCushion(currentPrice, breakeven);
          const annualizedYieldBid = calculateAnnualizedYield(bid, put.strike, exp.dte);
          const nominalYieldBid = calculateNominalYield(bid, put.strike);

          const base: Omit<TradeCandidate, 'opportunityScore' | 'riskScore' | 'fitScore' | 'score' | 'label' | 'bucket' | 'reason' | 'warnings' | 'alreadyExposed'> = {
            id: `${ticker}|${exp.date}|${put.strike}`,
            ticker,
            expiryTimestamp: exp.date,
            expiryIso: isoFromTimestamp(exp.date),
            expiryLabel: exp.label,
            dte: exp.dte,
            strike: put.strike,
            bid,
            ask: put.ask,
            last: put.last,
            delta: put.delta,
            currentPrice,
            distanceToStrike,
            breakeven,
            breakevenCushion,
            nominalYieldBid,
            annualizedYieldBid,
            spreadPercent,
            openInterest: put.openInterest,
            volume: put.volume,
            etfTrend: pulseRow?.trend ?? '—',
            rsi14: pulseRow?.rsi14 ?? null,
            distance50: pulseRow?.distance50 ?? null,
            distance200: pulseRow?.distance200 ?? null,
            recentDrawdown30: pulseRow?.recentDrawdown30 ?? null,
            realizedVolatility20: pulseRow?.realizedVolatility20 ?? null,
            watchlisted: watchlistTickers.has(ticker),
          };
          const scored = scoreCandidate({ base, pulseRow, criteria: { ...criteria, maxDelta, minDistanceToStrike: minCushion, maxSpreadPercent: maxSpread }, portfolioTrades });
          if (failedFilters.length === 0) {
            perTickerCandidates.push(scored);
          } else if (failedFilters.length <= 2) {
            nearMisses.push({
              ...scored,
              label: 'Avoid',
              bucket: 'Near Misses',
              failedFilters,
              reason: `Near miss: ${failedFilters.join('; ')}.`,
            });
          }
        });
      });

      candidates.push(...sortCandidates(perTickerCandidates).slice(0, criteria.maxCandidatesPerTicker));
    } catch (error) {
      failures.push({ ticker, message: error instanceof Error ? error.message : 'Option chain unavailable' });
    } finally {
      completed += 1;
      onProgress?.({ completed, total, ticker });
    }
  });

  await runWithConcurrency(tickerTasks, 4);
  diagnostics.optionChainsRequested = requestsMade + cacheHits;
  diagnostics.chainsLoadedFromCache = cacheHits;
  diagnostics.chainsFetchedFromNetwork = requestsMade;
  diagnostics.finalCandidates = candidates.length;

  return {
    criteria,
    scannedTickers: normalizedTickers,
    candidates: sortCandidates(candidates),
    nearMisses: sortCandidates(nearMisses).slice(0, 25),
    diagnostics,
    usage: {
      tickersScanned: normalizedTickers.length,
      expirationsScanned,
      estimatedRequests: estimateOptionRequests(normalizedTickers, criteria),
      requestsMade,
      cacheHits,
      failures,
    },
    fetchedAt: Date.now(),
  };
}
