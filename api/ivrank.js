import { fetchYahooVolatilityContext } from './_lib/ivRank.js';
import { observeMarketRequest } from './_lib/requestObservability.js';

export default async function handler(req, res) {
  const observation = observeMarketRequest(req, res, { endpoint: 'volatility-context', tickerCount: 1 });
  let upstreamRequests = 0;
  const onAttempt = () => {
    upstreamRequests += 1;
    res.setHeader('X-PutScanner-Upstream-Requests', String(upstreamRequests));
  };
  res.setHeader('Access-Control-Allow-Origin', '*');
  const rawTicker = Array.isArray(req.query.ticker) ? req.query.ticker[0] : req.query.ticker;
  const ticker = String(rawTicker || '').trim().toUpperCase();
  if (!ticker) return res.status(400).json({ error: 'Missing ticker parameter' });
  if (!/^[A-Z0-9.^-]{1,12}$/.test(ticker)) return res.status(400).json({ error: 'Invalid ticker parameter' });

  try {
    const result = await fetchYahooVolatilityContext(ticker, { signal: observation.signal, onAttempt });
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=21600');
    return res.status(200).json(result);
  } catch (error) {
    return res.status(error?.status || 500).json({ error: error?.message || 'Failed to calculate volatility context' });
  }
}
