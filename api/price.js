import { normalizeFiniteNumber, normalizePositiveNumber, readYahooJson, yahooFetch } from './_lib/yahoo.js';
import { observeMarketRequest } from './_lib/requestObservability.js';

export default async function handler(req, res) {
  const observation = observeMarketRequest(req, res, { endpoint: 'price', tickerCount: 1 });
  let upstreamRequests = 0;
  const noteProviderAttempt = () => {
    upstreamRequests += 1;
    res.setHeader('X-PutScanner-Upstream-Requests', String(upstreamRequests));
  };
  res.setHeader('Access-Control-Allow-Origin', '*');

  const rawTicker = Array.isArray(req.query.ticker) ? req.query.ticker[0] : req.query.ticker;
  const ticker = String(rawTicker || '').trim().toUpperCase();
  if (!ticker) {
    return res.status(400).json({ error: 'Missing ticker parameter' });
  }
  if (!/^[A-Z0-9.^-]{1,12}$/.test(ticker)) {
    return res.status(400).json({ error: 'Invalid ticker parameter' });
  }

  const range = req.query.range || '1d';
  const interval = req.query.interval || '1d';
  const extended = req.query.extended === 'true';
  const includeSparkline = req.query.includeSparkline === 'true';

  try {
    let url;
    if (extended) {
      url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1y`;
    } else {
      url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=${interval}&range=${range}`;
    }

    const yahooRes = await yahooFetch(url, {
      endpoint: 'price',
      fetchOptions: { signal: observation.signal },
      onAttempt: noteProviderAttempt,
    });
    if (!yahooRes.ok) {
      return res.status(yahooRes.status).json({ error: `Yahoo chart request failed for ${ticker}` });
    }
    const data = await readYahooJson(yahooRes, 'price');
    const result = data.chart?.result?.[0];
    if (!result) {
      return res.status(502).json({ error: `No chart result for ${ticker}` });
    }
    const meta = result.meta;
    const price = normalizePositiveNumber(meta.regularMarketPrice);
    const prev = normalizePositiveNumber(meta.chartPreviousClose ?? meta.previousClose);
    const change = price != null && prev != null ? price - prev : null;
    const changePct = change != null && prev != null ? (change / prev) * 100 : null;

    const response = { price, change, changePct, previousClose: prev };

    // If intraday data requested, include sparkline
    if (interval === '1m' && range === '1d') {
      const closes = result.indicators?.quote?.[0]?.close || [];
      response.sparkline = closes.map(normalizeFiniteNumber).filter(v => v != null);
    }

    // If extended data requested, include performance metrics. Intraday sparkline is opt-in.
    if (extended) {
      const dailyCloses = result.indicators?.quote?.[0]?.close || [];
      const filtered = dailyCloses.map(normalizeFiniteNumber).filter(v => v != null);
      const len = filtered.length;

      // 5-day change: compare current price to 5 trading days ago
      let fiveDay = null;
      if (len >= 6) {
        const past = filtered[len - 6];
        if (past > 0) fiveDay = ((price - past) / past) * 100;
      }

      // 1-month change: ~22 trading days ago
      let oneMonth = null;
      if (len >= 22) {
        const past = filtered[len - 22];
        if (past > 0) oneMonth = ((price - past) / past) * 100;
      }

      // 3-month change: ~66 trading days ago
      let threeMonth = null;
      if (len >= 66) {
        const past = filtered[len - 66];
        if (past > 0) threeMonth = ((price - past) / past) * 100;
      }

      // 52-week high
      const fiftyTwoWeekHigh = normalizePositiveNumber(meta.fiftyTwoWeekHigh) ?? (filtered.length > 0 ? Math.max(...filtered) : null);
      let fiftyTwoWeekHighPct = null;
      if (fiftyTwoWeekHigh != null && fiftyTwoWeekHigh > 0 && price != null) {
        fiftyTwoWeekHighPct = ((price - fiftyTwoWeekHigh) / fiftyTwoWeekHigh) * 100;
      }

      response.fiveDay = fiveDay;
      response.oneMonth = oneMonth;
      response.threeMonth = threeMonth;
      response.fiftyTwoWeekHighPct = fiftyTwoWeekHighPct;

      if (includeSparkline) {
        try {
          const intradayUrl = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1m&range=1d`;
          const intradayRes = await yahooFetch(intradayUrl, {
            endpoint: 'price',
            fetchOptions: { signal: observation.signal },
            onAttempt: noteProviderAttempt,
          });
          const intradayData = await readYahooJson(intradayRes, 'price');
          const intradayResult = intradayData.chart?.result?.[0];
          const intradayCloses = intradayResult?.indicators?.quote?.[0]?.close || [];
          response.sparkline = intradayCloses.map(normalizeFiniteNumber).filter(v => v != null);
          response.previousClose = normalizePositiveNumber(intradayResult?.meta?.chartPreviousClose) ?? response.previousClose;
        } catch {
          response.sparkline = [];
        }
      } else {
        response.sparkline = [];
      }
    }

    res.setHeader('Cache-Control', extended
      ? 'public, s-maxage=300, stale-while-revalidate=900'
      : 'public, s-maxage=120, stale-while-revalidate=300');
    return res.status(200).json(response);
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
