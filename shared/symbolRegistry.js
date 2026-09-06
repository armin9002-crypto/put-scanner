const LEVERAGED_ETF_ROWS = [
  ['AGQ', 'ProShares Ultra Silver', 2, 'Silver', 'Commodity'],
  ['BIB', 'ProShares Ultra Nasdaq Biotechnology', 2, 'Nasdaq Biotechnology Index; large biotech and pharmaceutical companies', 'Sector'],
  ['BITX', 'Volatility Shares 2x Bitcoin ETF', 2, 'Bitcoin, primarily through Bitcoin futures', 'Crypto'],
  ['BOIL', 'ProShares Ultra DJ-AIG Natural Gas', 2, 'Natural Gas', 'Commodity'],
  ['BRZU', 'Direxion MSCI Brazil Bull 2X', 2, 'Brazil', 'Country'],
  ['BULZ', 'MicroSectors FANG & Innovation 3X', 3, 'Tech/FANG', 'Sector'],
  ['CHAU', 'Direxion Daily CSI 300 China A Share Bull 2X ETF', 2, 'CSI 300; large-cap mainland Chinese A-shares', 'Country'],
  ['CURE', 'Direxion Healthcare Bull 3X', 3, 'Healthcare', 'Sector'],
  ['CWEB', 'Direxion China Internet Bull 2X', 2, 'China Internet', 'Country'],
  ['DDM', 'ProShares Ultra Dow 30', 2, 'Dow Jones', 'Broad Index'],
  ['DFEN', 'Direxion Aerospace & Defense 3X', 3, 'Aerospace/Defense', 'Sector'],
  ['DIG', 'ProShares Ultra Oil & Gas', 2, 'Oil & Gas', 'Commodity'],
  ['DPST', 'Direxion Regional Banks Bull 3X', 3, 'Regional Banks', 'Sector'],
  ['DRN', 'Direxion Daily Real Estate Bull 3X ETF', 3, 'U.S. real-estate companies / Real Estate Select Sector', 'Sector'],
  ['DUSL', 'Direxion Industrials Bull 3X', 3, 'Industrials', 'Sector'],
  ['EDC', 'Direxion Emerging Markets Bull 3X', 3, 'Emerging Markets', 'Country'],
  ['EFO', 'ProShares Ultra MSCI EAFE', 2, 'Developed international equities outside U.S./Canada', 'Country'],
  ['EQQQ', 'ProShares Ultra QQQ Equal Weight', 2, 'Equal-weighted Nasdaq-100', 'Broad Index'],
  ['ERX', 'Direxion Energy Bull 2X', 2, 'Energy', 'Commodity'],
  ['ETHU', 'Volatility Shares 2x Ether ETF', 2, 'Ethereum (ETH)', 'Crypto'],
  ['EURL', 'Direxion FTSE Europe Bull 3X', 3, 'Europe', 'Country'],
  ['EZJ', 'ProShares Ultra MSCI Japan', 2, 'Japanese equities / MSCI Japan', 'Country'],
  ['FAS', 'Direxion Financial Bull 3X', 3, 'Financials', 'Sector'],
  ['FNGG', 'Direxion Daily NYSE FANG+ Bull 2X ETF', 2, 'NYSE FANG+; mega-cap technology/growth companies', 'Sector'],
  ['FNGU', 'MicroSectors FANG+ 3X', 3, 'FANG+', 'Sector'],
  ['GUSH', 'Direxion Oil & Gas Bull 2X', 2, 'Oil & Gas E&P', 'Commodity'],
  ['HIBL', 'Direxion S&P 500 High Beta Bull 3X', 3, 'S&P High Beta', 'Broad Index'],
  ['INDL', 'Direxion MSCI India Bull 2X', 2, 'India', 'Country'],
  ['JNUG', 'Direxion Daily Junior Gold Miners Index Bull 2X ETF', 2, 'Global junior gold- and silver-mining companies', 'Commodity'],
  ['KORU', 'Direxion Daily MSCI South Korea Bull 3X ETF', 3, 'South Korean equities / MSCI Korea', 'Country'],
  ['LABU', 'Direxion Biotech Bull 3X', 3, 'Biotech', 'Sector'],
  ['MEXX', 'Direxion Daily MSCI Mexico Bull 3X ETF', 3, 'Mexican equities', 'Country'],
  ['MIDU', 'Direxion Mid Cap Bull 3X', 3, 'Mid Cap', 'Broad Index'],
  ['NAIL', 'Direxion Homebuilders Bull 3X', 3, 'Homebuilders', 'Sector'],
  ['NUGT', 'Direxion Gold Miners Bull 2X', 2, 'Gold Miners', 'Commodity'],
  ['PILL', 'Direxion Daily Pharmaceutical & Medical Bull 3X ETF', 3, 'U.S. pharmaceutical and medical stocks', 'Sector'],
  ['QLD', 'ProShares Ultra QQQ', 2, 'NASDAQ-100', 'Broad Index'],
  ['QQQU', 'Direxion Daily Magnificent 7 Bull 2X ETF', 2, 'Magnificent Seven mega-cap stocks', 'Sector'],
  ['QQUP', 'ProShares Ultra QQQ Mega', 2, 'Largest mega-cap constituents of the Nasdaq-100', 'Sector'],
  ['QQXL', 'ProShares Ultra QQQ Top 30', 2, '30 largest Nasdaq-100 constituents', 'Sector'],
  ['RETL', 'Direxion Daily Retail Bull 3X ETF', 3, 'U.S. retail stocks', 'Sector'],
  ['ROM', 'ProShares Ultra Technology', 2, 'Technology', 'Sector'],
  ['RXL', 'ProShares Ultra Health Care', 2, 'U.S. health-care sector', 'Sector'],
  ['SAA', 'ProShares Ultra SmallCap600', 2, 'S&P SmallCap 600', 'Broad Index'],
  ['SKYU', 'ProShares Ultra Cloud Computing', 2, 'Cloud-computing companies', 'Sector'],
  ['SOLT', 'Volatility Shares 2x Solana ETF', 2, 'Solana cryptocurrency (SOL)', 'Crypto'],
  ['SOXL', 'Direxion Semiconductor Bull 3X', 3, 'Semiconductors', 'Sector'],
  ['SPXL', 'Direxion Daily S&P 500 Bull 3X Shares', 3, 'S&P 500', 'Broad Index'],
  ['SSO', 'ProShares Ultra S&P 500', 2, 'S&P 500', 'Broad Index'],
  ['TBXU', 'Direxion Daily Biotech Top 5 Bull 2X ETF', 2, 'Five large biotechnology companies', 'Sector'],
  ['TECL', 'Direxion Tech Bull 3X', 3, 'Technology', 'Sector'],
  ['TEXU', 'Direxion Daily Energy Top 5 Bull 2X ETF', 2, 'Five large U.S. energy companies', 'Commodity'],
  ['TNA', 'Direxion Small Cap Bull 3X', 3, 'Russell 2000', 'Broad Index'],
  ['TPOR', 'Direxion Daily Transportation Bull 3X ETF', 3, 'U.S. transportation companies', 'Sector'],
  ['TQQQ', 'ProShares UltraPro QQQ', 3, 'NASDAQ-100', 'Broad Index'],
  ['TSXU', 'Direxion Daily Semiconductors Top 5 Bull 2X ETF', 2, 'Five large semiconductor companies', 'Sector'],
  ['TTXU', 'Direxion Daily Technology Top 5 Bull 2X ETF', 2, 'Five large U.S. technology companies', 'Sector'],
  ['UBOT', 'Direxion Daily Robotics, Artificial Intelligence & Automation Index Bull 2X ETF', 2, 'Global robotics, AI and automation companies', 'Sector'],
  ['UCC', 'ProShares Ultra Consumer Discretionary', 2, 'U.S. consumer-discretionary sector', 'Sector'],
  ['UCO', 'ProShares Ultra Bloomberg Crude Oil', 2, 'Crude Oil', 'Commodity'],
  ['UCOP', 'ProShares Ultra Copper K-1 Free ETF', 2, 'Copper', 'Commodity'],
  ['UCYB', 'ProShares Ultra Nasdaq Cybersecurity', 2, 'Cybersecurity companies', 'Sector'],
  ['UDOW', 'ProShares UltraPro Dow 30', 3, 'Dow Jones', 'Broad Index'],
  ['UGE', 'ProShares Ultra Consumer Staples', 2, 'U.S. consumer-staples sector', 'Sector'],
  ['UGL', 'ProShares Ultra Gold', 2, 'Gold', 'Commodity'],
  ['UMDD', 'ProShares UltraPro MidCap400', 3, 'S&P MidCap 400', 'Broad Index'],
  ['UPAL', 'ProShares Ultra Palladium K-1 Free ETF', 2, 'Palladium', 'Commodity'],
  ['UPLT', 'ProShares Ultra Platinum K-1 Free ETF', 2, 'Platinum', 'Commodity'],
  ['UPRO', 'ProShares UltraPro S&P 500', 3, 'S&P 500', 'Broad Index'],
  ['UPV', 'ProShares Ultra FTSE Europe', 2, 'Developed European equities', 'Country'],
  ['URAA', 'Direxion Daily Uranium Industry Bull 2X ETF', 2, 'Uranium mining, nuclear-energy and related companies', 'Commodity'],
  ['URE', 'ProShares Ultra Real Estate', 2, 'U.S. real-estate sector', 'Sector'],
  ['URSP', 'ProShares Ultra S&P 500 Equal Weight', 2, 'Equal-weighted S&P 500', 'Broad Index'],
  ['URTY', 'ProShares UltraPro Russell 2000', 3, 'Russell 2000', 'Broad Index'],
  ['USD', 'ProShares Ultra Semiconductors', 2, 'Semiconductors', 'Sector'],
  ['UTSL', 'Direxion Utilities Bull 3X', 3, 'Utilities', 'Sector'],
  ['UWM', 'ProShares Ultra Russell 2000', 2, 'Russell 2000', 'Broad Index'],
  ['UXI', 'ProShares Ultra Industrials', 2, 'U.S. industrials sector', 'Sector'],
  ['UYG', 'ProShares Ultra Financials', 2, 'Financials', 'Sector'],
  ['UYM', 'ProShares Ultra Materials', 2, 'Materials', 'Sector'],
  ['WANT', 'Direxion Daily Consumer Discretionary Bull 3X ETF', 3, 'U.S. consumer-discretionary sector', 'Sector'],
  ['WEBL', 'Direxion Dow Jones Internet Bull 3X', 3, 'Internet', 'Sector'],
  ['XPP', 'ProShares Ultra FTSE China 50', 2, '50 large-cap Chinese companies', 'Country'],
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
