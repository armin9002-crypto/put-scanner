import { fetchYahooOptions } from './_lib/yahoo.js';
import { observeMarketRequest } from './_lib/requestObservability.js';

export default async function handler(req, res) {
  const observation = observeMarketRequest(req, res, { endpoint: 'options', tickerCount: 1 });
  let upstreamRequests = 0;
  res.setHeader('Access-Control-Allow-Origin', '*');

  const rawTicker = Array.isArray(req.query.ticker) ? req.query.ticker[0] : req.query.ticker;
  const ticker = String(rawTicker || '').trim().toUpperCase();
  if (!ticker) {
    return res.status(400).json({ error: 'Missing ticker parameter' });
  }
  if (!/^[A-Z0-9.^-]{1,12}$/.test(ticker)) {
    return res.status(400).json({ error: 'Invalid ticker parameter' });
  }

  const rawDate = Array.isArray(req.query.date) ? req.query.date[0] : req.query.date;
  const date = rawDate == null || rawDate === '' ? null : Number(rawDate);
  if (rawDate != null && rawDate !== '' && (!Number.isInteger(date) || date <= 0)) {
    return res.status(400).json({ error: 'Invalid date parameter' });
  }
  const rawFresh = Array.isArray(req.query.fresh) ? req.query.fresh[0] : req.query.fresh;
  const fresh = rawFresh === '1' || rawFresh === 'true';

  try {
    const data = await fetchYahooOptions(ticker, date, {
      fresh,
      signal: observation.signal,
      onAttempt: () => {
        upstreamRequests += 1;
        res.setHeader('X-PutScanner-Upstream-Requests', String(upstreamRequests));
      },
      onRetry: () => observation.noteRetry(),
    });

    const cacheControl = fresh
        ? 'no-store'
        : date
          ? 'public, s-maxage=600, stale-while-revalidate=1800'
          : 'public, s-maxage=300, stale-while-revalidate=900';
    res.setHeader('Cache-Control', cacheControl);
    res.setHeader('X-PutScanner-Cache-Strategy', cacheControl);
    return res.status(200).json(data);
  } catch(e) {
    return res.status(e?.status || 500).json({ error: e?.message || 'Failed to fetch options' });
  }
}
