import { normalizeFiniteNumber, normalizeTimestampSeconds, readYahooJson, yahooFetch } from './_lib/yahoo.js';

const TIMEFRAME_CONFIG = {
  '1D': {
    range: '1d',
    interval: '1m',
    maxPoints: 800,
    cacheControl: 'public, s-maxage=120, stale-while-revalidate=300',
  },
  '5D': {
    range: '5d',
    interval: '5m',
    maxPoints: 900,
    cacheControl: 'public, s-maxage=300, stale-while-revalidate=900',
  },
  '30D': {
    range: '1mo',
    interval: '1h',
    maxPoints: 800,
    cacheControl: 'public, s-maxage=1800, stale-while-revalidate=3600',
  },
  YTD: {
    range: '1y',
    interval: '1d',
    maxPoints: 800,
    filterYtd: true,
    cacheControl: 'public, s-maxage=14400, stale-while-revalidate=21600',
  },
  '3M': {
    range: '3mo',
    interval: '1d',
    maxPoints: 800,
    cacheControl: 'public, s-maxage=7200, stale-while-revalidate=21600',
  },
  '6M': {
    range: '6mo',
    interval: '1d',
    maxPoints: 800,
    cacheControl: 'public, s-maxage=7200, stale-while-revalidate=21600',
  },
  '1Y': {
    range: '1y',
    interval: '1d',
    maxPoints: 800,
    cacheControl: 'public, s-maxage=7200, stale-while-revalidate=21600',
  },
  '2Y': {
    range: '2y',
    interval: '1d',
    maxPoints: 800,
    cacheControl: 'public, s-maxage=3600, stale-while-revalidate=21600',
  },
  '3Y': {
    range: '3y',
    interval: '1wk',
    maxPoints: 800,
    cacheControl: 'public, s-maxage=43200, stale-while-revalidate=86400',
  },
  '5Y': {
    range: '5y',
    interval: '1wk',
    maxPoints: 800,
    cacheControl: 'public, s-maxage=43200, stale-while-revalidate=86400',
  },
  All: {
    range: 'max',
    interval: '1mo',
    maxPoints: 1000,
    cacheControl: 'public, s-maxage=43200, stale-while-revalidate=86400',
  },
};

function downsample(points, maxPoints) {
  if (points.length <= maxPoints) return points;
  const sampled = [];
  const step = (points.length - 1) / (maxPoints - 1);
  let lastIndex = -1;

  for (let i = 0; i < maxPoints; i += 1) {
    const index = Math.min(points.length - 1, Math.round(i * step));
    if (index !== lastIndex) {
      sampled.push(points[index]);
      lastIndex = index;
    }
  }

  return sampled;
}

function displayTickerFor(ticker) {
  if (ticker === '^VIX') return 'VIX';
  if (ticker === '^VXN') return 'VXN';
  return ticker;
}

function parseDateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : null;
}

export default async function handler(req, res) {
  const ticker = typeof req.query.ticker === 'string' ? req.query.ticker.trim().toUpperCase() : '';
  const timeframe = typeof req.query.timeframe === 'string' ? req.query.timeframe : '1D';
  const start = parseDateOnly(req.query.start);
  const end = parseDateOnly(req.query.end);
  const hasDateRange = start != null && end != null && end > start;
  const config = hasDateRange
    ? {
      interval: '1d',
      maxPoints: 32,
      cacheControl: 'public, s-maxage=86400, stale-while-revalidate=604800',
      period1: start,
      period2: end,
      rangeLabel: `${req.query.start}:${req.query.end}`,
    }
    : TIMEFRAME_CONFIG[timeframe];

  res.setHeader('Access-Control-Allow-Origin', '*');

  if (!ticker) {
    return res.status(400).json({ error: 'Missing ticker' });
  }

  if (!config) {
    return res.status(400).json({ error: 'Invalid timeframe' });
  }

  try {
    const rangeParams = hasDateRange
      ? `period1=${config.period1}&period2=${config.period2}`
      : `range=${config.range}`;
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=${config.interval}&${rangeParams}`;
    const yahooRes = await yahooFetch(url, { endpoint: 'chart' });

    if (!yahooRes.ok) {
      throw new Error(`Yahoo chart request failed with ${yahooRes.status}`);
    }

    const data = await readYahooJson(yahooRes, 'chart');
    const result = data?.chart?.result?.[0];
    if (!result) {
      throw new Error(data?.chart?.error?.description || 'No chart data returned');
    }

    const timestamps = result.timestamp || [];
    const closes = result.indicators?.quote?.[0]?.close || [];
    const startOfYear = Math.floor(Date.UTC(new Date().getUTCFullYear(), 0, 1) / 1000);
    const rawPoints = timestamps
      .map((timestamp, index) => {
        const price = closes[index];
        const normalizedTimestamp = normalizeTimestampSeconds(timestamp);
        const normalizedPrice = normalizeFiniteNumber(price);
        if (normalizedTimestamp == null || normalizedPrice == null) return null;
        if (config.filterYtd && normalizedTimestamp < startOfYear) return null;
        return {
          timestamp: normalizedTimestamp,
          date: new Date(normalizedTimestamp * 1000).toISOString(),
          price: normalizedPrice,
        };
      })
      .filter(Boolean);

    const points = downsample(rawPoints, config.maxPoints);
    const meta = result.meta || {};
    const latestPoint = points[points.length - 1];
    const normalizedLatest = normalizeFiniteNumber(meta.regularMarketPrice);
    const normalizedChartPrevious = normalizeFiniteNumber(meta.chartPreviousClose);
    const normalizedPrevious = normalizeFiniteNumber(meta.previousClose);
    const latestPrice = normalizedLatest != null
      ? normalizedLatest
      : latestPoint?.price ?? null;
    const previousClose = normalizedChartPrevious != null
      ? normalizedChartPrevious
      : normalizedPrevious != null
        ? normalizedPrevious
        : null;

    res.setHeader('Cache-Control', config.cacheControl);
    return res.status(200).json({
      ticker,
      displayTicker: displayTickerFor(ticker),
      timeframe: hasDateRange ? 'custom' : timeframe,
      points,
      previousClose,
      latestPrice,
      fetchedAt: Date.now(),
      metadata: {
        range: hasDateRange ? config.rangeLabel : config.range,
        interval: config.interval,
        filter: config.filterYtd ? 'year-to-date' : undefined,
        sourcePoints: rawPoints.length,
      },
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Failed to fetch chart history' });
  }
}
