import YahooFinance from 'yahoo-finance2';
import { normalizePositiveNumber } from './_lib/yahoo.js';

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const rawSymbols = Array.isArray(req.query.symbols) ? req.query.symbols[0] : req.query.symbols;
  if (!rawSymbols) return res.status(400).json({ error: 'Missing symbols parameter' });

  const symbols = [...new Set(String(rawSymbols).split(',').map(symbol => symbol.trim().toUpperCase()).filter(symbol => /^[A-Z0-9.^-]{1,12}$/.test(symbol)))];
  if (symbols.length === 0) return res.status(400).json({ error: 'No valid symbols' });
  if (symbols.length > 100) return res.status(400).json({ error: 'Too many symbols' });

  try {
    const quotes = await yahooFinance.quote(symbols, { fields: ['symbol', 'quoteType', 'netAssets'] });
    const assets = Object.fromEntries(symbols.map(symbol => [symbol, null]));
    for (const quote of quotes) {
      const symbol = String(quote?.symbol || '').trim().toUpperCase();
      if (symbol in assets && quote?.quoteType === 'ETF') assets[symbol] = normalizePositiveNumber(quote.netAssets);
    }
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=518400');
    res.setHeader('X-Upstream-Requests', '1');
    return res.status(200).json(assets);
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Fund metadata unavailable' });
  }
}
