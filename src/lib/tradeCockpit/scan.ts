import { fetchOptions } from '../api';
import { getCached } from '../cache';
import type { EtfPulseRow } from '../etfPulseMetrics';
import { calculateAnnualizedYield, calculateBidAskSpreadPercent, calculateBreakeven, calculateDownsideCushion, calculateNominalYield, isFiniteNumber } from '../optionMetrics';
import type { PortfolioTrade } from '../portfolioStorage';
import type { ExpirationDate, OptionsChainData } from '../types';
import { getWatchlist } from '../watchlist';
import { scoreCandidate, sortCandidates, styleAllowsMissingDelta } from './scoring';
import type { ScanCriteria, TradeCandidate, TradeScanResult } from './types';

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
  return tickers.length * (1 + Math.max(0, criteria.maxExpirationsPerTicker));
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

  const tickerTasks = normalizedTickers.map(ticker => async () => {
    try {
      const initialWasCached = hasCachedOptionChain(ticker);
      const initial = await fetchOptions(ticker);
      if (initialWasCached) cacheHits += 1;
      else requestsMade += 1;

      const selectedExpirations = selectExpirations(initial.expirations, criteria);
      expirationsScanned += selectedExpirations.length;
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
          if (!isFiniteNumber(put.bid) || put.bid <= 0) return;
          if (!isFiniteNumber(currentPrice) || put.strike >= currentPrice) return;
          const absDelta = put.delta != null ? Math.abs(put.delta) : null;
          if (absDelta == null && !styleAllowsMissingDelta(criteria.tradeStyle)) return;
          if (absDelta != null && absDelta > criteria.maxDelta) return;

          const distanceToStrike = currentPrice > 0 ? (currentPrice - put.strike) / currentPrice : null;
          if (distanceToStrike == null || distanceToStrike < criteria.minDistanceToStrike) return;
          if ((put.openInterest ?? 0) < criteria.minOpenInterest) return;

          const spreadPercent = calculateBidAskSpreadPercent(put.bid, put.ask);
          if (spreadPercent != null && spreadPercent > criteria.maxSpreadPercent) return;
          const breakeven = calculateBreakeven(put.strike, put.bid);
          const breakevenCushion = calculateDownsideCushion(currentPrice, breakeven);
          const annualizedYieldBid = calculateAnnualizedYield(put.bid, put.strike, exp.dte);
          const nominalYieldBid = calculateNominalYield(put.bid, put.strike);

          const base: Omit<TradeCandidate, 'opportunityScore' | 'riskScore' | 'fitScore' | 'score' | 'label' | 'bucket' | 'reason' | 'warnings' | 'alreadyExposed'> = {
            id: `${ticker}|${exp.date}|${put.strike}`,
            ticker,
            expiryTimestamp: exp.date,
            expiryIso: isoFromTimestamp(exp.date),
            expiryLabel: exp.label,
            dte: exp.dte,
            strike: put.strike,
            bid: put.bid,
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
          perTickerCandidates.push(scoreCandidate({ base, pulseRow, criteria, portfolioTrades }));
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

  return {
    criteria,
    scannedTickers: normalizedTickers,
    candidates: sortCandidates(candidates),
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
