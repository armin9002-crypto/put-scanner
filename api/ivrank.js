import {
  fetchYahooOptions,
  getYahooSession,
  normalizeFiniteNumber,
  normalizePositiveNumber,
  readYahooJson,
  yahooFetch,
} from './_lib/yahoo.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const rawTicker = Array.isArray(req.query.ticker) ? req.query.ticker[0] : req.query.ticker;
  const ticker = String(rawTicker || '').trim().toUpperCase();
  if (!ticker) return res.status(400).json({ error: 'Missing ticker parameter' });
  if (!/^[A-Z0-9.^-]{1,12}$/.test(ticker)) return res.status(400).json({ error: 'Invalid ticker parameter' });

  try {
    const optionData = await fetchYahooOptions(ticker);
    const result = optionData?.optionChain?.result?.[0];
    if (!result) {
      res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=21600');
      return res.status(200).json({ currentIV: null, ivRank: null, ivPercentile: null });
    }

    const currentPrice = normalizePositiveNumber(result.quote?.regularMarketPrice);
    const puts = Array.isArray(result.options?.[0]?.puts) ? result.options[0].puts : [];
    let atmIV = null;
    let minDistance = Infinity;
    if (currentPrice != null) {
      for (const put of puts) {
        const strike = normalizePositiveNumber(put.strike);
        const rawIv = normalizePositiveNumber(put.impliedVolatility);
        if (strike == null || rawIv == null) continue;
        const distance = Math.abs(strike - currentPrice);
        if (distance < minDistance) {
          minDistance = distance;
          atmIV = rawIv < 5 ? rawIv * 100 : rawIv;
        }
      }
    }

    if (atmIV == null) {
      res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=21600');
      return res.status(200).json({ currentIV: null, ivRank: null, ivPercentile: null });
    }

    const session = await getYahooSession(ticker);
    const oneYearAgo = Math.floor(Date.now() / 1000) - 365 * 24 * 60 * 60;
    const chartUrl = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${oneYearAgo}&period2=${Math.floor(Date.now() / 1000)}&interval=1wk&crumb=${encodeURIComponent(session.crumb)}`;
    const chartResponse = await yahooFetch(chartUrl, {
      endpoint: 'chart',
      fetchOptions: { headers: { Cookie: session.cookie } },
    });
    if (!chartResponse.ok) return res.status(chartResponse.status).json({ error: `Yahoo chart request failed for ${ticker}` });
    const chartData = await readYahooJson(chartResponse, 'chart');
    const closes = chartData?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [];
    const validCloses = closes.map(normalizeFiniteNumber).filter(value => value != null);

    if (validCloses.length < 20) {
      res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=21600');
      return res.status(200).json({ currentIV: atmIV, ivRank: null, ivPercentile: null });
    }

    const weeklyVols = [];
    for (let index = 4; index < validCloses.length; index += 1) {
      const window = validCloses.slice(index - 4, index + 1);
      const returns = [];
      for (let offset = 1; offset < window.length; offset += 1) {
        if (window[offset - 1] > 0) returns.push(Math.log(window[offset] / window[offset - 1]));
      }
      if (returns.length < 3) continue;
      const mean = returns.reduce((total, value) => total + value, 0) / returns.length;
      const variance = returns.reduce((total, value) => total + (value - mean) ** 2, 0) / returns.length;
      weeklyVols.push(Math.sqrt(variance) * Math.sqrt(52) * 100);
    }

    if (weeklyVols.length < 5) {
      res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=21600');
      return res.status(200).json({ currentIV: atmIV, ivRank: null, ivPercentile: null });
    }

    const ivLow = Math.min(...weeklyVols);
    const ivHigh = Math.max(...weeklyVols);
    const ivPercentile = weeklyVols.filter(value => value < atmIV).length / weeklyVols.length * 100;
    const ivRank = ivHigh > ivLow ? (atmIV - ivLow) / (ivHigh - ivLow) * 100 : 50;

    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=21600');
    return res.status(200).json({
      currentIV: Math.round(atmIV * 100) / 100,
      ivRank: Math.round(Math.max(0, Math.min(100, ivRank)) * 10) / 10,
      ivPercentile: Math.round(ivPercentile * 10) / 10,
    });
  } catch (error) {
    return res.status(error?.status || 500).json({ error: error?.message || 'Failed to calculate IV rank' });
  }
}
