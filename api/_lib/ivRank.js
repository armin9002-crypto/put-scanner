import {
  fetchYahooOptions,
  getYahooSession,
  normalizeFiniteNumber,
  normalizePositiveNumber,
  readYahooJson,
  yahooFetch,
} from './yahoo.js';

export function currentAtmIvFromOptionData(optionData) {
  const result = optionData?.optionChain?.result?.[0];
  if (!result) return null;
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
  return atmIV;
}

export function calculateIvRankFromCloses(atmIV, closes) {
  const validCloses = closes.map(normalizeFiniteNumber).filter(value => value != null);
  if (validCloses.length < 20) return { currentIV: atmIV, ivRank: null, ivPercentile: null };

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

  if (weeklyVols.length < 5) return { currentIV: atmIV, ivRank: null, ivPercentile: null };
  const ivLow = Math.min(...weeklyVols);
  const ivHigh = Math.max(...weeklyVols);
  const ivPercentile = weeklyVols.filter(value => value < atmIV).length / weeklyVols.length * 100;
  const ivRank = ivHigh > ivLow ? (atmIV - ivLow) / (ivHigh - ivLow) * 100 : 50;
  return {
    currentIV: Math.round(atmIV * 100) / 100,
    ivRank: Math.round(Math.max(0, Math.min(100, ivRank)) * 10) / 10,
    ivPercentile: Math.round(ivPercentile * 10) / 10,
  };
}

export async function fetchYahooIvRank(ticker, options = {}) {
  const optionData = options.optionData ?? await fetchYahooOptions(ticker, null, options);
  const atmIV = currentAtmIvFromOptionData(optionData);
  if (atmIV == null) return { currentIV: null, ivRank: null, ivPercentile: null };

  const session = await getYahooSession(ticker, false, { onAttempt: options.onAttempt, timeoutMs: options.timeoutMs, signal: options.signal });
  const now = Math.floor(Date.now() / 1000);
  const oneYearAgo = now - 365 * 24 * 60 * 60;
  const chartUrl = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${oneYearAgo}&period2=${now}&interval=1wk&crumb=${encodeURIComponent(session.crumb)}`;
  const chartResponse = await yahooFetch(chartUrl, {
    endpoint: 'chart',
    timeoutMs: options.timeoutMs,
    signal: options.signal,
    onAttempt: options.onAttempt,
    fetchOptions: { headers: { Cookie: session.cookie } },
  });
  if (!chartResponse.ok) {
    const error = new Error(`Yahoo chart request failed for ${ticker}`);
    error.status = chartResponse.status;
    throw error;
  }
  const chartData = await readYahooJson(chartResponse, 'chart');
  const closes = chartData?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [];
  return calculateIvRankFromCloses(atmIV, closes);
}
