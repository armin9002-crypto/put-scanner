import { normalizeFiniteNumber, normalizePositiveNumber, readYahooJson, yahooFetch } from './_lib/yahoo.js';
import { mapWithConcurrency } from '../shared/concurrency.js';
import { observeMarketRequest } from './_lib/requestObservability.js';

function percentChange(current, past) {
  return current != null && past != null && past > 0 ? (current - past) / past * 100 : null;
}

export default async function handler(req, res) {
  const observation = observeMarketRequest(req, res, { endpoint: 'prices' });
  res.setHeader('Access-Control-Allow-Origin', '*');
  const rawTickers = Array.isArray(req.query.tickers) ? req.query.tickers[0] : req.query.tickers;
  if (!rawTickers) return res.status(400).json({ error: 'Missing tickers parameter' });

  const symbols = [...new Set(String(rawTickers).split(',').map(symbol => symbol.trim().toUpperCase()).filter(symbol => /^[A-Z0-9.^-]{1,12}$/.test(symbol)))];
  observation.setCounts({ tickerCount: symbols.length });
  if (symbols.length === 0) return res.status(400).json({ error: 'No valid ticker symbols' });

  const chunks = [];
  for (let index = 0; index < symbols.length; index += 20) chunks.push(symbols.slice(index, index + 20));
  res.setHeader('X-PutScanner-Upstream-Requests', String(chunks.length));

  const errors = [];
  const settled = await mapWithConcurrency(chunks, 3, async chunk => {
    try {
      const url = `https://query2.finance.yahoo.com/v7/finance/spark?symbols=${encodeURIComponent(chunk.join(','))}&range=3mo&interval=1d`;
      const response = await yahooFetch(url, { endpoint: 'prices', signal: observation.signal });
      if (!response.ok) throw new Error(`Yahoo prices failed (${response.status})`);
      const data = await readYahooJson(response, 'prices');
      return Array.isArray(data?.spark?.result) ? data.spark.result : [];
    } catch (error) {
      errors.push({ symbols: chunk, error: error?.message || 'Yahoo prices failed' });
      return [];
    }
  });
  const responses = settled.map(result => result.status === 'fulfilled' ? result.value : []);

  const results = responses.flat();
  if (results.length === 0) return res.status(502).json({ error: 'No results from Yahoo', errors });

  const prices = {};
  for (const item of results) {
    const response = item?.response?.[0];
    const meta = response?.meta || {};
    const closes = (response?.indicators?.quote?.[0]?.close || []).map(normalizeFiniteNumber).filter(value => value != null);
    const price = normalizePositiveNumber(meta.regularMarketPrice) ?? closes.at(-1) ?? null;
    const previousClose = normalizePositiveNumber(meta.chartPreviousClose ?? meta.previousClose);
    const high52w = normalizePositiveNumber(meta.fiftyTwoWeekHigh);
    const low52w = normalizePositiveNumber(meta.fiftyTwoWeekLow);
    const fiveDayBase = closes.length >= 6 ? closes[closes.length - 6] : null;
    const oneMonthBase = closes.length >= 22 ? closes[closes.length - 22] : null;
    const threeMonthBase = closes.length >= 2 ? closes[0] : null;
    const change = price != null && previousClose != null ? price - previousClose : null;

    prices[item.symbol] = {
      price,
      change,
      changePct: percentChange(price, previousClose),
      high52w,
      low52w,
      fiveDay: percentChange(price, fiveDayBase),
      oneMonth: percentChange(price, oneMonthBase),
      threeMonth: percentChange(price, threeMonthBase),
      fiftyTwoWeekHighPct: percentChange(price, high52w),
      posIn52wRange: price != null && high52w != null && low52w != null && high52w > low52w
        ? (price - low52w) / (high52w - low52w) * 100
        : null,
    };
  }

  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=900');
  res.setHeader('X-Upstream-Requests', String(chunks.length));
  res.setHeader('X-PutScanner-Cache-Strategy', 'public, s-maxage=300, stale-while-revalidate=900');
  return res.status(200).json(prices);
}
