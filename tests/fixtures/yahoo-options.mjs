export const EXPIRATIONS = [1792108800, 1795132800, 1797552000];

const symbol = (strike, type = 'P', expiration = '261016') => `TST${expiration}${type}${String(Math.round(strike * 1000)).padStart(8, '0')}`;
const contract = (strike, overrides = {}) => ({
  contractSymbol: symbol(strike), strike, lastPrice: 1.9, lastTradeDate: 1791936000,
  bid: 1.8, ask: 2, impliedVolatility: 0.48, volume: 30, openInterest: 600,
  greeks: { delta: -0.2, gamma: 0.01, theta: -0.03, vega: 0.08 }, ...overrides,
});

export const normalLiquidResponse = {
  optionChain: { result: [{ quote: { regularMarketPrice: 100 }, expirationDates: EXPIRATIONS,
    options: [{ expirationDate: EXPIRATIONS[0], puts: [contract(68), contract(70), contract(72), contract(98, { impliedVolatility: 0.40 }), contract(102, { impliedVolatility: 0.60 })], calls: [contract(110, { contractSymbol: symbol(110, 'C') })] }] }] },
};

export const sparseResponse = {
  optionChain: { result: [{ quote: { regularMarketPrice: 100 }, expirationDates: EXPIRATIONS,
    options: [{ expirationDate: EXPIRATIONS[0], puts: [contract(70), contract(100, { impliedVolatility: 0.52 })], calls: [] }] }] },
};

export const oneSidedResponse = {
  optionChain: { result: [{ quote: { regularMarketPrice: 100 }, expirationDates: EXPIRATIONS,
    options: [{ expirationDate: EXPIRATIONS[0], puts: [contract(70, { ask: null }), contract(98), contract(102)], calls: [] }] }] },
};

export const zeroBidResponse = {
  optionChain: { result: [{ quote: { regularMarketPrice: 100 }, expirationDates: EXPIRATIONS,
    options: [{ expirationDate: EXPIRATIONS[0], puts: [contract(70, { bid: 0 }), contract(98), contract(102)], calls: [] }] }] },
};

export const missingFieldsResponse = {
  optionChain: { result: [{ quote: { regularMarketPrice: 100 }, expirationDates: EXPIRATIONS,
    options: [{ expirationDate: EXPIRATIONS[0], puts: [contract(70, { volume: null, lastTradeDate: null }), { contractSymbol: symbol(75), strike: 75 }], calls: [] }] }] },
};

export const staleTradeResponse = {
  optionChain: { result: [{ quote: { regularMarketPrice: 100 }, expirationDates: EXPIRATIONS,
    options: [{ expirationDate: EXPIRATIONS[0], puts: [contract(70, { lastTradeDate: 1704067200 }), contract(98), contract(102)], calls: [] }] }] },
};

export const malformedResponse = { optionChain: { result: [] } };
export const rateLimitError = Object.assign(new Error('Yahoo rate limited'), { status: 429 });
