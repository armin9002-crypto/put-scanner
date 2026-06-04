export interface UnderlyingHoldingsProxy {
  sourceTicker: string;
  proxyTicker: string | null;
  proxyName?: string;
  meaningful: boolean;
  reason: string;
}

const EQUITY_PROXY_MAP: Record<string, Omit<UnderlyingHoldingsProxy, 'sourceTicker' | 'meaningful'>> = {
  BRZU: { proxyTicker: 'EWZ', proxyName: 'iShares MSCI Brazil ETF', reason: 'Brazil equity exposure proxy.' },
  BULZ: { proxyTicker: 'QQQ', proxyName: 'Invesco QQQ Trust', reason: 'Large-cap growth / Nasdaq proxy for FANG-style exposure.' },
  CURE: { proxyTicker: 'XLV', proxyName: 'Health Care Select Sector SPDR Fund', reason: 'Healthcare sector exposure proxy.' },
  CWEB: { proxyTicker: 'KWEB', proxyName: 'KraneShares CSI China Internet ETF', reason: 'China internet equity exposure proxy.' },
  DDM: { proxyTicker: 'DIA', proxyName: 'SPDR Dow Jones Industrial Average ETF Trust', reason: 'Dow Jones equity exposure proxy.' },
  DFEN: { proxyTicker: 'ITA', proxyName: 'iShares U.S. Aerospace & Defense ETF', reason: 'Aerospace and defense equity exposure proxy.' },
  DPST: { proxyTicker: 'KRE', proxyName: 'SPDR S&P Regional Banking ETF', reason: 'Regional banks equity exposure proxy.' },
  DUSL: { proxyTicker: 'XLI', proxyName: 'Industrial Select Sector SPDR Fund', reason: 'Industrials sector exposure proxy.' },
  EDC: { proxyTicker: 'EEM', proxyName: 'iShares MSCI Emerging Markets ETF', reason: 'Emerging markets equity exposure proxy.' },
  EURL: { proxyTicker: 'VGK', proxyName: 'Vanguard FTSE Europe ETF', reason: 'Europe equity exposure proxy.' },
  FAS: { proxyTicker: 'XLF', proxyName: 'Financial Select Sector SPDR Fund', reason: 'Financial sector exposure proxy.' },
  FNGU: { proxyTicker: 'QQQ', proxyName: 'Invesco QQQ Trust', reason: 'Large-cap growth / Nasdaq proxy for FANG-style exposure.' },
  HIBL: { proxyTicker: 'SPHB', proxyName: 'Invesco S&P 500 High Beta ETF', reason: 'S&P 500 high-beta equity exposure proxy.' },
  INDL: { proxyTicker: 'INDA', proxyName: 'iShares MSCI India ETF', reason: 'India equity exposure proxy.' },
  LABU: { proxyTicker: 'XBI', proxyName: 'SPDR S&P Biotech ETF', reason: 'Biotech equity exposure proxy.' },
  MIDU: { proxyTicker: 'MDY', proxyName: 'SPDR S&P MidCap 400 ETF Trust', reason: 'Mid-cap equity exposure proxy.' },
  NAIL: { proxyTicker: 'XHB', proxyName: 'SPDR S&P Homebuilders ETF', reason: 'Homebuilders equity exposure proxy.' },
  NUGT: { proxyTicker: 'GDX', proxyName: 'VanEck Gold Miners ETF', reason: 'Gold miners equity exposure proxy.' },
  QLD: { proxyTicker: 'QQQ', proxyName: 'Invesco QQQ Trust', reason: 'Nasdaq-100 underlying exposure proxy.' },
  QQQ: { proxyTicker: 'QQQ', proxyName: 'Invesco QQQ Trust', reason: 'Direct ETF holdings.' },
  ROM: { proxyTicker: 'XLK', proxyName: 'Technology Select Sector SPDR Fund', reason: 'Technology sector exposure proxy.' },
  SOXL: { proxyTicker: 'SOXX', proxyName: 'iShares Semiconductor ETF', reason: 'Semiconductor equity exposure proxy.' },
  SPY: { proxyTicker: 'SPY', proxyName: 'SPDR S&P 500 ETF Trust', reason: 'Direct ETF holdings.' },
  SSO: { proxyTicker: 'SPY', proxyName: 'SPDR S&P 500 ETF Trust', reason: 'S&P 500 underlying exposure proxy.' },
  TECL: { proxyTicker: 'XLK', proxyName: 'Technology Select Sector SPDR Fund', reason: 'Technology sector exposure proxy.' },
  TNA: { proxyTicker: 'IWM', proxyName: 'iShares Russell 2000 ETF', reason: 'Small-cap equity exposure proxy.' },
  TQQQ: { proxyTicker: 'QQQ', proxyName: 'Invesco QQQ Trust', reason: 'Nasdaq-100 underlying exposure proxy.' },
  UDOW: { proxyTicker: 'DIA', proxyName: 'SPDR Dow Jones Industrial Average ETF Trust', reason: 'Dow Jones equity exposure proxy.' },
  UPRO: { proxyTicker: 'SPY', proxyName: 'SPDR S&P 500 ETF Trust', reason: 'S&P 500 underlying exposure proxy.' },
  URTY: { proxyTicker: 'IWM', proxyName: 'iShares Russell 2000 ETF', reason: 'Russell 2000 equity exposure proxy.' },
  USD: { proxyTicker: 'SOXX', proxyName: 'iShares Semiconductor ETF', reason: 'Semiconductor equity exposure proxy.' },
  UTSL: { proxyTicker: 'XLU', proxyName: 'Utilities Select Sector SPDR Fund', reason: 'Utilities sector exposure proxy.' },
  UWM: { proxyTicker: 'IWM', proxyName: 'iShares Russell 2000 ETF', reason: 'Russell 2000 equity exposure proxy.' },
  UYG: { proxyTicker: 'XLF', proxyName: 'Financial Select Sector SPDR Fund', reason: 'Financial sector exposure proxy.' },
  UYM: { proxyTicker: 'XLB', proxyName: 'Materials Select Sector SPDR Fund', reason: 'Materials sector exposure proxy.' },
  WEBL: { proxyTicker: 'FDN', proxyName: 'First Trust Dow Jones Internet Index Fund', reason: 'Internet equity exposure proxy.' },
  YINN: { proxyTicker: 'FXI', proxyName: 'iShares China Large-Cap ETF', reason: 'China large-cap equity exposure proxy.' },
};

const NON_MEANINGFUL_MAP: Record<string, string> = {
  AGQ: 'Leveraged silver exposure; equity holdings are not meaningful.',
  BOIL: 'Natural gas futures exposure; equity holdings are not meaningful.',
  DIG: 'Leveraged oil and gas exposure; ETF holdings are not a clean underlying equity basket.',
  ERX: 'Leveraged energy exposure; use sector holdings only if you specifically want an equity proxy.',
  GUSH: 'Leveraged oil and gas exploration exposure; ETF holdings are not a clean underlying equity basket.',
  UCO: 'Crude oil futures exposure; equity holdings are not meaningful.',
  UGL: 'Leveraged gold exposure; equity holdings are not meaningful.',
  USO: 'Crude oil futures exposure; equity holdings are not meaningful.',
  VIX: 'Volatility index exposure; equity holdings are not meaningful.',
  VXN: 'Volatility index exposure; equity holdings are not meaningful.',
};

export function getUnderlyingHoldingsProxy(ticker: string): UnderlyingHoldingsProxy {
  const sourceTicker = ticker.trim().toUpperCase();
  const nonMeaningfulReason = NON_MEANINGFUL_MAP[sourceTicker];
  if (nonMeaningfulReason) {
    return {
      sourceTicker,
      proxyTicker: null,
      meaningful: false,
      reason: nonMeaningfulReason,
    };
  }

  const proxy = EQUITY_PROXY_MAP[sourceTicker];
  if (proxy) {
    return {
      sourceTicker,
      proxyTicker: proxy.proxyTicker,
      proxyName: proxy.proxyName,
      meaningful: true,
      reason: proxy.reason,
    };
  }

  return {
    sourceTicker,
    proxyTicker: sourceTicker,
    proxyName: `${sourceTicker} holdings`,
    meaningful: true,
    reason: 'Direct ETF holdings are used as the underlying exposure proxy.',
  };
}
