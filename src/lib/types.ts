export type ETFType = 'Broad Index' | 'Sector' | 'Commodity' | 'Country';

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
}

export interface ExpirationDate {
  date: number; // unix timestamp
  label: string;
  dte: number;
}

export interface OptionsChainData {
  expirations: ExpirationDate[];
  puts: OptionContract[];
  currentPrice: number;
  chainMeta?: {
    ticker: string;
    expirationDate: number | null;
    fetchedAt: number;
    source: 'cache' | 'network' | 'fresh';
    cacheKey: string;
    putCount: number;
    callCount?: number;
    putStrikeMin?: number | null;
    putStrikeMax?: number | null;
    callStrikeMin?: number | null;
    callStrikeMax?: number | null;
    yahooExpirationDatesCount?: number;
    previousCachedPutCount?: number | null;
  };
}

export type SortField = 'strike' | 'last' | 'bid' | 'ask' | 'delta' | 'otmItm' | 'iv' | 'volume' | 'openInterest' | 'volOI' | 'nomYieldBid' | 'annYieldBid' | 'nomYieldAsk' | 'annYieldAsk' | 'nomYieldLast' | 'annYieldLast';
export type SortDirection = 'asc' | 'desc';
