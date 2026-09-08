import type { MarketTimestampSource } from './marketTimestamp';

export type ETFType = 'Broad Index' | 'Sector' | 'Commodity' | 'Country' | 'Crypto';

export interface ETFInfo {
  ticker: string;
  name: string;
  leverage: string;
  underlying: string;
  type: ETFType;
}

export interface PriceData {
  price: number;
  change: number;
  changePercent: number;
  providerMarketTime?: number | null;
}

export type OptionIntegrityStatus = 'clean' | 'degraded' | 'invalid';
export type OptionIntegrityReasonCode =
  | 'CROSSED_MARKET'
  | 'PUT_EXECUTABLE_MONOTONICITY'
  | 'PUT_VERTICAL_MAX_VALUE'
  | 'CONTRACT_IDENTITY_MISMATCH'
  | 'CHAIN_EXPIRATION_MISMATCH'
  | 'PERVASIVE_CONTRACT_FAILURE'
  | 'VERY_WIDE_MARKET';

export interface OptionContractIntegrity {
  status: OptionIntegrityStatus;
  reasonCodes: OptionIntegrityReasonCode[];
}

export interface OptionChainIntegrity extends OptionContractIntegrity {
  contractCount: number;
  cleanCount: number;
  degradedCount: number;
  invalidCount: number;
}

export interface OptionContract {
  strike: number;
  last: number | null;
  lastTradeDate: number | null;
  bid: number | null;
  ask: number | null;
  delta: number | null;
  gamma?: number | null;
  theta?: number | null;
  vega?: number | null;
  impliedVolatility: number | null;
  volume: number | null;
  openInterest: number | null;
  contractSymbol?: string | null;
  rawLastPrice?: number | null;
  rawBid?: number | null;
  rawAsk?: number | null;
  rawImpliedVolatility?: number | null;
  rawOpenInterest?: number | null;
  rawVolume?: number | null;
  rawLastTradeDate?: number | null;
  integrity?: OptionContractIntegrity;
}

export interface ExpirationDate {
  date: number; // unix timestamp
  label: string;
  dte: number;
}

export type OptionChainSource = 'cache' | 'stale' | 'network' | 'fresh';

export interface OptionChainMeta {
  ticker: string;
  requestedExpiration: number | null;
  returnedExpiration: number | null;
  expirationDate: number | null;
  fetchedAt: number;
  /** Provider market event time for the underlying, never a per-contract bid/ask timestamp. */
  providerMarketTime?: number | null;
  cachedAt?: number | null;
  timestampSource?: MarketTimestampSource;
  source: OptionChainSource;
  freshness?: 'fresh' | 'stale' | 'expired';
  staleFallbackUsed?: boolean;
  retentionReason?: string | null;
  fresh?: boolean;
  cacheKey?: string;
  putCount: number;
  callCount?: number;
  putStrikeMin?: number | null;
  putStrikeMax?: number | null;
  callStrikeMin?: number | null;
  callStrikeMax?: number | null;
  yahooExpirationDatesCount?: number;
  previousCachedPutCount?: number | null;
  validationWarnings?: string[];
  integrity?: OptionChainIntegrity;
}

export interface OptionsChainData {
  expirations: ExpirationDate[];
  puts: OptionContract[];
  currentPrice: number;
  instrument?: {
    name: string | null;
    quoteType: string | null;
  };
  chainMeta?: OptionChainMeta;
}

export type SortField = 'strike' | 'lastTradeDate' | 'last' | 'bid' | 'ask' | 'delta' | 'otmItm' | 'iv' | 'volume' | 'openInterest' | 'volOI' | 'nomYieldBid' | 'annYieldBid' | 'nomYieldAsk' | 'annYieldAsk' | 'nomYieldLast' | 'annYieldLast';
export type SortDirection = 'asc' | 'desc';
