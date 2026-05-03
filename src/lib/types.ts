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
  bid: number | null;
  ask: number | null;
  delta: number | null;
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
}

export type SortField = 'strike' | 'last' | 'bid' | 'ask' | 'delta' | 'otmItm' | 'iv' | 'volume' | 'openInterest' | 'nomYieldBid' | 'annYieldBid' | 'nomYieldAsk' | 'annYieldAsk' | 'nomYieldLast' | 'annYieldLast';
export type SortDirection = 'asc' | 'desc';
