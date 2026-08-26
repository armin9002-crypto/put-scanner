const LEVERAGED_ETF_ROWS = [
  ['AGQ', 'ProShares Ultra Silver', 2, 'Silver', 'Commodity'],
  ['BOIL', 'ProShares Ultra DJ-AIG Natural Gas', 2, 'Natural Gas', 'Commodity'],
  ['BRZU', 'Direxion MSCI Brazil Bull 2X', 2, 'Brazil', 'Country'],
  ['BULZ', 'MicroSectors FANG & Innovation 3X', 3, 'Tech/FANG', 'Sector'],
  ['CURE', 'Direxion Healthcare Bull 3X', 3, 'Healthcare', 'Sector'],
  ['CWEB', 'Direxion China Internet Bull 2X', 2, 'China Internet', 'Country'],
  ['DDM', 'ProShares Ultra Dow 30', 2, 'Dow Jones', 'Broad Index'],
  ['DFEN', 'Direxion Aerospace & Defense 3X', 3, 'Aerospace/Defense', 'Sector'],
  ['DIG', 'ProShares Ultra Oil & Gas', 2, 'Oil & Gas', 'Commodity'],
  ['DPST', 'Direxion Regional Banks Bull 3X', 3, 'Regional Banks', 'Sector'],
  ['DUSL', 'Direxion Industrials Bull 3X', 3, 'Industrials', 'Sector'],
  ['EDC', 'Direxion Emerging Markets Bull 3X', 3, 'Emerging Markets', 'Country'],
  ['ERX', 'Direxion Energy Bull 2X', 2, 'Energy', 'Commodity'],
  ['EURL', 'Direxion FTSE Europe Bull 3X', 3, 'Europe', 'Country'],
  ['FAS', 'Direxion Financial Bull 3X', 3, 'Financials', 'Sector'],
  ['FNGU', 'MicroSectors FANG+ 3X', 3, 'FANG+', 'Sector'],
  ['GUSH', 'Direxion Oil & Gas Bull 2X', 2, 'Oil & Gas E&P', 'Commodity'],
  ['HIBL', 'Direxion S&P 500 High Beta Bull 3X', 3, 'S&P High Beta', 'Broad Index'],
  ['INDL', 'Direxion MSCI India Bull 2X', 2, 'India', 'Country'],
  ['LABU', 'Direxion Biotech Bull 3X', 3, 'Biotech', 'Sector'],
  ['MIDU', 'Direxion Mid Cap Bull 3X', 3, 'Mid Cap', 'Broad Index'],
  ['NAIL', 'Direxion Homebuilders Bull 3X', 3, 'Homebuilders', 'Sector'],
  ['NUGT', 'Direxion Gold Miners Bull 2X', 2, 'Gold Miners', 'Commodity'],
  ['QLD', 'ProShares Ultra QQQ', 2, 'NASDAQ-100', 'Broad Index'],
  ['ROM', 'ProShares Ultra Technology', 2, 'Technology', 'Sector'],
  ['SOXL', 'Direxion Semiconductor Bull 3X', 3, 'Semiconductors', 'Sector'],
  ['SSO', 'ProShares Ultra S&P 500', 2, 'S&P 500', 'Broad Index'],
  ['TECL', 'Direxion Tech Bull 3X', 3, 'Technology', 'Sector'],
  ['TNA', 'Direxion Small Cap Bull 3X', 3, 'Russell 2000', 'Broad Index'],
  ['TQQQ', 'ProShares UltraPro QQQ', 3, 'NASDAQ-100', 'Broad Index'],
  ['UCO', 'ProShares Ultra Bloomberg Crude Oil', 2, 'Crude Oil', 'Commodity'],
  ['UDOW', 'ProShares UltraPro Dow 30', 3, 'Dow Jones', 'Broad Index'],
  ['UGL', 'ProShares Ultra Gold', 2, 'Gold', 'Commodity'],
  ['UPRO', 'ProShares UltraPro S&P 500', 3, 'S&P 500', 'Broad Index'],
  ['URTY', 'ProShares UltraPro Russell 2000', 3, 'Russell 2000', 'Broad Index'],
  ['USD', 'ProShares Ultra Semiconductors', 2, 'Semiconductors', 'Sector'],
  ['UTSL', 'Direxion Utilities Bull 3X', 3, 'Utilities', 'Sector'],
  ['UWM', 'ProShares Ultra Russell 2000', 2, 'Russell 2000', 'Broad Index'],
  ['UYG', 'ProShares Ultra Financials', 2, 'Financials', 'Sector'],
  ['UYM', 'ProShares Ultra Materials', 2, 'Materials', 'Sector'],
  ['WEBL', 'Direxion Dow Jones Internet Bull 3X', 3, 'Internet', 'Sector'],
  ['YINN', 'Direxion FTSE China Bull 3X', 3, 'China', 'Country'],
];

const ALL_DISCOVERY_UNIVERSES = Object.freeze(['scanner', 'screener', 'pulse']);

function freezeSymbol(symbol) {
  return Object.freeze({
    ...symbol,
    aliases: Object.freeze(symbol.aliases ?? []),
    universeMembership: Object.freeze(symbol.universeMembership),
  });
}

const leveragedEtfs = LEVERAGED_ETF_ROWS.map(([ticker, name, leverageMultiple, exposure, etfCategory]) => freezeSymbol({
  ticker,
  name,
  assetType: 'etf',
  etfCategory,
  exposure,
  leveraged: true,
  leverageMultiple,
  universeMembership: ALL_DISCOVERY_UNIVERSES,
}));

const contextSymbols = [
  freezeSymbol({
    ticker: 'QQQ',
    name: 'Invesco QQQ Trust',
    assetType: 'etf',
    etfCategory: 'Broad Index',
    exposure: 'Nasdaq 100',
    leveraged: false,
    leverageMultiple: 1,
    universeMembership: ['pulse', 'context'],
  }),
  freezeSymbol({
    ticker: 'SPY',
    name: 'SPDR S&P 500 ETF Trust',
    assetType: 'etf',
    etfCategory: 'Broad Index',
    exposure: 'S&P 500',
    leveraged: false,
    leverageMultiple: 1,
    universeMembership: ['pulse', 'context'],
  }),
  freezeSymbol({
    ticker: '^VIX',
    aliases: ['VIX'],
    name: 'CBOE Volatility Index',
    assetType: 'index',
    leveraged: false,
    leverageMultiple: null,
    universeMembership: ['context'],
  }),
  freezeSymbol({
    ticker: '^VXN',
    aliases: ['VXN'],
    name: 'CBOE Nasdaq-100 Volatility Index',
    assetType: 'index',
    leveraged: false,
    leverageMultiple: null,
    universeMembership: ['context'],
  }),
];

export const SYMBOL_REGISTRY = Object.freeze([...leveragedEtfs, ...contextSymbols]);

const symbolsByTicker = new Map();
for (const symbol of SYMBOL_REGISTRY) {
  symbolsByTicker.set(symbol.ticker, symbol);
  for (const alias of symbol.aliases) symbolsByTicker.set(alias, symbol);
}

export function normalizeSymbolTicker(ticker) {
  return String(ticker ?? '').trim().toUpperCase();
}

export function getSymbolMetadata(ticker) {
  return symbolsByTicker.get(normalizeSymbolTicker(ticker)) ?? null;
}

export function getSymbolsForUniverse(universe) {
  return Object.freeze(SYMBOL_REGISTRY
    .filter(symbol => symbol.universeMembership.includes(universe))
    .sort((left, right) => left.ticker.localeCompare(right.ticker)));
}

export const SCANNER_SYMBOLS = getSymbolsForUniverse('scanner');
export const SCREENER_SYMBOLS = getSymbolsForUniverse('screener');
export const ETF_PULSE_SYMBOLS = getSymbolsForUniverse('pulse');
export const CONTEXT_SYMBOLS = getSymbolsForUniverse('context');
