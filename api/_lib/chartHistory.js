import { normalizeFiniteNumber, normalizeTimestampSeconds, readYahooJson, yahooFetch } from './yahoo.js';

function downsample(points, maxPoints) {
  if (points.length <= maxPoints) return points;
  const sampled = [];
  const step = (points.length - 1) / (maxPoints - 1);
  let lastIndex = -1;
  for (let index = 0; index < maxPoints; index += 1) {
    const sourceIndex = Math.min(points.length - 1, Math.round(index * step));
    if (sourceIndex !== lastIndex) sampled.push(points[sourceIndex]);
    lastIndex = sourceIndex;
  }
  return sampled;
}

function displayTickerFor(ticker) {
  if (ticker === '^VIX') return 'VIX';
  if (ticker === '^VXN') return 'VXN';
  return ticker;
}

export async function fetchYahooChartHistory({ ticker, timeframe, config, endpoint = 'chart', timeoutMs, signal }) {
  const hasDateRange = config.period1 != null && config.period2 != null;
  const rangeParams = hasDateRange ? `period1=${config.period1}&period2=${config.period2}` : `range=${config.range}`;
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=${config.interval}&${rangeParams}`;
  const yahooRes = await yahooFetch(url, { endpoint, signal, ...(timeoutMs ? { timeoutMs } : {}) });
  if (!yahooRes.ok) throw new Error(`Yahoo chart request failed with ${yahooRes.status}`);
  const data = await readYahooJson(yahooRes, endpoint);
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error(data?.chart?.error?.description || 'No chart data returned');

  const timestamps = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];
  const startOfYear = Math.floor(Date.UTC(new Date().getUTCFullYear(), 0, 1) / 1000);
  const rawPoints = timestamps.map((timestamp, index) => {
    const normalizedTimestamp = normalizeTimestampSeconds(timestamp);
    const normalizedPrice = normalizeFiniteNumber(closes[index]);
    if (normalizedTimestamp == null || normalizedPrice == null) return null;
    if (config.filterYtd && normalizedTimestamp < startOfYear) return null;
    return { timestamp: normalizedTimestamp, date: new Date(normalizedTimestamp * 1000).toISOString(), price: normalizedPrice };
  }).filter(Boolean);
  const points = downsample(rawPoints, config.maxPoints);
  const meta = result.meta || {};
  return {
    ticker,
    displayTicker: displayTickerFor(ticker),
    timeframe: hasDateRange ? 'custom' : timeframe,
    points,
    previousClose: normalizeFiniteNumber(meta.chartPreviousClose) ?? normalizeFiniteNumber(meta.previousClose) ?? null,
    latestPrice: normalizeFiniteNumber(meta.regularMarketPrice) ?? points.at(-1)?.price ?? null,
    fetchedAt: Date.now(),
    metadata: {
      range: hasDateRange ? config.rangeLabel : config.range,
      interval: config.interval,
      filter: config.filterYtd ? 'year-to-date' : undefined,
      sourcePoints: rawPoints.length,
    },
  };
}
