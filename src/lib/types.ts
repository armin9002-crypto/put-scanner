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
  contractSymbol?: string | null;
  rawLastPrice?: number | null;
  rawBid?: number | null;
  rawAsk?: number | null;
  rawImpliedVolatility?: number | null;
  rawOpenInterest?: number | null;
  rawVolume?: number | null;
  rawLastTradeDate?: number | null;
}

export interface ExpirationDate {
  date: number; // unix timestamp
  label: string;
  dte: number;
}

export type OptionChainSource = 'cache' | 'network' | 'fresh';

export interface OptionChainMeta {
  ticker: string;
  requestedExpiration: number | null;
  returnedExpiration: number | null;
  expirationDate: number | null;
  fetchedAt: number;
  source: OptionChainSource;
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
}

export interface OptionsChainData {
  expirations: ExpirationDate[];
  puts: OptionContract[];
  currentPrice: number;
  chainMeta?: OptionChainMeta;
}

export type SortField = 'strike' | 'last' | 'bid' | 'ask' | 'delta' | 'otmItm' | 'iv' | 'volume' | 'openInterest' | 'volOI' | 'nomYieldBid' | 'annYieldBid' | 'nomYieldAsk' | 'annYieldAsk' | 'nomYieldLast' | 'annYieldLast';
export type SortDirection = 'asc' | 'desc';
