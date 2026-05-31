export interface ValuationProxy {
  proxyTicker: string | null;
  proxyName: string;
  reason: string;
  meaningful: boolean;
}

const NOT_MEANINGFUL: ValuationProxy = {
  proxyTicker: null,
  proxyName: 'N/A',
  reason: 'Forward P/E is not meaningful for this exposure.',
  meaningful: false,
};

const PROXY_MAP: Record<string, ValuationProxy> = {
  AGQ: { proxyTicker: null, proxyName: 'Silver', reason: 'Commodity exposure; forward P/E is not meaningful.', meaningful: false },
  BITO: { proxyTicker: null, proxyName: 'Bitcoin Futures', reason: 'Crypto exposure; forward P/E is not meaningful.', meaningful: false },
  IBIT: { proxyTicker: null, proxyName: 'Bitcoin', reason: 'Crypto exposure; forward P/E is not meaningful.', meaningful: false },
  BOIL: { proxyTicker: null, proxyName: 'Natural Gas', reason: 'Commodity exposure; forward P/E is not meaningful.', meaningful: false },
  BRZU: { proxyTicker: 'EWZ', proxyName: 'iShares MSCI Brazil ETF', reason: 'Brazil equity proxy for broad valuation context.', meaningful: true },
  BULZ: { proxyTicker: 'QQQ', proxyName: 'Invesco QQQ Trust', reason: 'Mega-cap growth proxy for FANG-style exposure.', meaningful: true },
  CURE: { proxyTicker: 'XLV', proxyName: 'Health Care Select Sector SPDR', reason: 'Healthcare sector proxy for valuation context.', meaningful: true },
  CWEB: { proxyTicker: 'KWEB', proxyName: 'KraneShares CSI China Internet ETF', reason: 'China internet equity proxy for valuation context.', meaningful: true },
  DDM: { proxyTicker: 'DIA', proxyName: 'SPDR Dow Jones Industrial Average ETF', reason: 'Dow Jones proxy for valuation context.', meaningful: true },
  DFEN: { proxyTicker: 'ITA', proxyName: 'iShares U.S. Aerospace & Defense ETF', reason: 'Aerospace and defense proxy for valuation context.', meaningful: true },
  DIG: { proxyTicker: 'XLE', proxyName: 'Energy Select Sector SPDR', reason: 'Energy sector proxy for valuation context.', meaningful: true },
  DPST: { proxyTicker: 'KRE', proxyName: 'SPDR S&P Regional Banking ETF', reason: 'Regional bank proxy for valuation context.', meaningful: true },
  DUSL: { proxyTicker: 'XLI', proxyName: 'Industrial Select Sector SPDR', reason: 'Industrials sector proxy for valuation context.', meaningful: true },
  EDC: { proxyTicker: 'EEM', proxyName: 'iShares MSCI Emerging Markets ETF', reason: 'Emerging markets proxy for valuation context.', meaningful: true },
  ERX: { proxyTicker: 'XLE', proxyName: 'Energy Select Sector SPDR', reason: 'Energy sector proxy for valuation context.', meaningful: true },
  EURL: { proxyTicker: 'VGK', proxyName: 'Vanguard FTSE Europe ETF', reason: 'Europe equity proxy for valuation context.', meaningful: true },
  FAS: { proxyTicker: 'XLF', proxyName: 'Financial Select Sector SPDR', reason: 'Financial sector proxy for valuation context.', meaningful: true },
  FNGU: { proxyTicker: 'QQQ', proxyName: 'Invesco QQQ Trust', reason: 'Mega-cap growth proxy for FANG-style exposure.', meaningful: true },
  GUSH: { proxyTicker: 'XOP', proxyName: 'SPDR S&P Oil & Gas Exploration & Production ETF', reason: 'Oil and gas E&P proxy for valuation context.', meaningful: true },
  HIBL: { proxyTicker: 'SPY', proxyName: 'SPDR S&P 500 ETF Trust', reason: 'S&P 500 proxy for broad high-beta equity exposure.', meaningful: true },
  INDL: { proxyTicker: 'INDA', proxyName: 'iShares MSCI India ETF', reason: 'India equity proxy for valuation context.', meaningful: true },
  LABU: { proxyTicker: 'XBI', proxyName: 'SPDR S&P Biotech ETF', reason: 'Biotech proxy for valuation context.', meaningful: true },
  MIDU: { proxyTicker: 'MDY', proxyName: 'SPDR S&P MidCap 400 ETF', reason: 'Mid-cap equity proxy for valuation context.', meaningful: true },
  NAIL: { proxyTicker: 'XHB', proxyName: 'SPDR S&P Homebuilders ETF', reason: 'Homebuilder proxy for valuation context.', meaningful: true },
  NUGT: { proxyTicker: 'GDX', proxyName: 'VanEck Gold Miners ETF', reason: 'Gold miners equity proxy for valuation context.', meaningful: true },
  QLD: { proxyTicker: 'QQQ', proxyName: 'Invesco QQQ Trust', reason: 'Nasdaq-100 proxy for valuation context.', meaningful: true },
  QQQ: { proxyTicker: 'QQQ', proxyName: 'Invesco QQQ Trust', reason: 'Direct benchmark proxy.', meaningful: true },
  ROM: { proxyTicker: 'XLK', proxyName: 'Technology Select Sector SPDR', reason: 'Technology sector proxy for valuation context.', meaningful: true },
  SOXL: { proxyTicker: 'SOXX', proxyName: 'iShares Semiconductor ETF', reason: 'Semiconductor proxy for valuation context.', meaningful: true },
  SPY: { proxyTicker: 'SPY', proxyName: 'SPDR S&P 500 ETF Trust', reason: 'Direct benchmark proxy.', meaningful: true },
  SSO: { proxyTicker: 'SPY', proxyName: 'SPDR S&P 500 ETF Trust', reason: 'S&P 500 proxy for valuation context.', meaningful: true },
  TECL: { proxyTicker: 'XLK', proxyName: 'Technology Select Sector SPDR', reason: 'Technology sector proxy for valuation context.', meaningful: true },
  TNA: { proxyTicker: 'IWM', proxyName: 'iShares Russell 2000 ETF', reason: 'Russell 2000 proxy for valuation context.', meaningful: true },
  TQQQ: { proxyTicker: 'QQQ', proxyName: 'Invesco QQQ Trust', reason: 'Nasdaq-100 proxy for valuation context.', meaningful: true },
  UCO: { proxyTicker: null, proxyName: 'Crude Oil', reason: 'Commodity exposure; forward P/E is not meaningful.', meaningful: false },
  UDOW: { proxyTicker: 'DIA', proxyName: 'SPDR Dow Jones Industrial Average ETF', reason: 'Dow Jones proxy for valuation context.', meaningful: true },
  UGL: { proxyTicker: null, proxyName: 'Gold', reason: 'Commodity exposure; forward P/E is not meaningful.', meaningful: false },
  UPRO: { proxyTicker: 'SPY', proxyName: 'SPDR S&P 500 ETF Trust', reason: 'S&P 500 proxy for valuation context.', meaningful: true },
  URTY: { proxyTicker: 'IWM', proxyName: 'iShares Russell 2000 ETF', reason: 'Russell 2000 proxy for valuation context.', meaningful: true },
  USD: { proxyTicker: 'SOXX', proxyName: 'iShares Semiconductor ETF', reason: 'Semiconductor proxy for valuation context.', meaningful: true },
  UTSL: { proxyTicker: 'XLU', proxyName: 'Utilities Select Sector SPDR', reason: 'Utilities sector proxy for valuation context.', meaningful: true },
  UWM: { proxyTicker: 'IWM', proxyName: 'iShares Russell 2000 ETF', reason: 'Russell 2000 proxy for valuation context.', meaningful: true },
  UYG: { proxyTicker: 'XLF', proxyName: 'Financial Select Sector SPDR', reason: 'Financial sector proxy for valuation context.', meaningful: true },
  UYM: { proxyTicker: 'XLB', proxyName: 'Materials Select Sector SPDR', reason: 'Materials sector proxy for valuation context.', meaningful: true },
  WEBL: { proxyTicker: 'FDN', proxyName: 'First Trust Dow Jones Internet Index Fund', reason: 'Internet equity proxy for valuation context.', meaningful: true },
  WGMI: { proxyTicker: null, proxyName: 'Crypto Miners', reason: 'Crypto-linked exposure; forward P/E is not meaningful.', meaningful: false },
  VIX: { proxyTicker: null, proxyName: 'Volatility Index', reason: 'Volatility exposure; forward P/E is not meaningful.', meaningful: false },
  VXN: { proxyTicker: null, proxyName: 'Nasdaq Volatility Index', reason: 'Volatility exposure; forward P/E is not meaningful.', meaningful: false },
  YINN: { proxyTicker: 'FXI', proxyName: 'iShares China Large-Cap ETF', reason: 'China large-cap proxy for valuation context.', meaningful: true },
};

export function getValuationProxyForTicker(ticker: string): ValuationProxy {
  const normalized = ticker.trim().toUpperCase();
  return PROXY_MAP[normalized] ?? NOT_MEANINGFUL;
}
