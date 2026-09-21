import {
  isPastWatchlistExpirationDte,
  formatWatchlistExpiry,
  type WatchlistItem,
  type WatchlistSnapshot,
  type WatchlistStatus,
} from './watchlist.ts';
import { calculateDte, calculateMoneyness, calculateVolumeOpenInterestRatio, calculateYieldPercent, isFiniteNumber, sanitizePositive } from './optionMetrics.ts';
import type { ShortPutMoneynessState } from './moneynessPresentation.ts';
import { executableOptionPrice } from './optionQuoteDisplay.ts';
import { getWatchlistStatusPresentation } from './watchlistPresentation.ts';

export interface WatchlistLiveRow extends WatchlistItem {
  dte: number | null;
  expired: boolean;
  currentPrice: number | null;
  moneynessPct: number | null;
  moneynessLabel: string;
  moneynessColor: string;
  moneynessState: ShortPutMoneynessState;
  bid: number | null;
  ask: number | null;
  last: number | null;
  lastTradeDate: number | null;
  delta: number | null;
  deltaSource: WatchlistSnapshot['deltaSource'];
  deltaModelVersion: string | null;
  iv: number | null;
  volume: number | null;
  openInterest: number | null;
  volOI: number | null;
  nomYieldBid: number | null;
  annYieldBid: number | null;
  nomYieldAsk: number | null;
  annYieldAsk: number | null;
  nomYieldLast: number | null;
  annYieldLast: number | null;
  status: WatchlistStatus;
  statusLabel: string;
  statusDetail: string | null;
  statusColor: string;
  evidenceFreshness?: 'current' | 'cached-current' | 'retained-stale' | 'unavailable';
  observedAt?: number | null;
}

export function buildWatchlistRow(item: WatchlistItem): WatchlistLiveRow {
  const snapshot: WatchlistSnapshot = item.snapshot ?? {};
  const rawDte = calculateDte(item.expiry);
  const dte = isFiniteNumber(rawDte) ? Math.max(0, rawDte) : null;
  const expired = isPastWatchlistExpirationDte(rawDte);
  const currentPrice = sanitizePositive(snapshot.underlyingPrice);
  const bid = snapshot.bid ?? null;
  const ask = snapshot.ask ?? null;
  const last = snapshot.last ?? null;
  const bidYield = calculateYieldPercent(executableOptionPrice(bid), item.strike, dte);
  const askYield = calculateYieldPercent(executableOptionPrice(ask), item.strike, dte);
  const lastYield = calculateYieldPercent(executableOptionPrice(last), item.strike, dte);
  const moneyness = calculateMoneyness(currentPrice, item.strike);
  const status = expired ? 'expired' : item.status ?? 'saved';
  const statusPresentation = getWatchlistStatusPresentation(status, expired, snapshot);

  return {
    ...item,
    dte,
    expired,
    currentPrice,
    moneynessPct: moneyness.pct,
    moneynessLabel: moneyness.label,
    moneynessColor: moneyness.color,
    moneynessState: moneyness.state,
    bid,
    ask,
    last,
    lastTradeDate: snapshot.lastTradeDate ?? null,
    delta: snapshot.delta ?? null,
    deltaSource: snapshot.deltaSource ?? null,
    deltaModelVersion: snapshot.deltaModelVersion ?? null,
    iv: snapshot.iv ?? null,
    volume: snapshot.volume ?? null,
    openInterest: snapshot.openInterest ?? null,
    volOI: calculateVolumeOpenInterestRatio(snapshot.volume, snapshot.openInterest),
    nomYieldBid: bidYield.nominal,
    annYieldBid: bidYield.annualized,
    nomYieldAsk: askYield.nominal,
    annYieldAsk: askYield.annualized,
    nomYieldLast: lastYield.nominal,
    annYieldLast: lastYield.annualized,
    expiryFormatted: formatWatchlistExpiry(item.expiry),
    status,
    statusLabel: statusPresentation.label,
    statusDetail: statusPresentation.detail,
    statusColor: statusPresentation.color,
    evidenceFreshness: snapshot.evidenceFreshness,
    observedAt: snapshot.observedAt ?? item.updatedAt ?? null,
  };
}
