export interface ETFInfo {
  ticker: string;
  name: string;
  leverage: string;
  underlying: string;
}

export interface PriceData {
  price: number;
  change: number;
  changePercent: number;
}

export interface OptionContract {
  strike: number;
  last: number;
  bid: number;
  ask: number;
  delta: number | null;
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

export type SortField = 'strike' | 'last' | 'bid' | 'ask' | 'delta' | 'nomYieldBid' | 'annYieldBid' | 'nomYieldAsk' | 'annYieldAsk' | 'nomYieldLast' | 'annYieldLast';
export type SortDirection = 'asc' | 'desc';
