import { fetchYahooChartHistory } from './_lib/chartHistory.js';
import { observeMarketRequest } from './_lib/requestObservability.js';

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

function parseDateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : null;
}

export default async function handler(req, res) {
  const observation = observeMarketRequest(req, res, { endpoint: 'chart-history', tickerCount: 1 });
  const ticker = typeof req.query.ticker === 'string' ? req.query.ticker.trim().toUpperCase() : '';
  const timeframe = typeof req.query.timeframe === 'string' ? req.query.timeframe : '1D';
  const start = parseDateOnly(req.query.start);
  const end = parseDateOnly(req.query.end);
  const hasDateRange = start != null && end != null && end > start;
  const config = hasDateRange
    ? {
      interval: '1d',
      maxPoints: 10000,
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
  res.setHeader('X-PutScanner-Upstream-Requests', '1');

  try {
    const body = await fetchYahooChartHistory({ ticker, timeframe, config, signal: observation.signal });
    res.setHeader('Cache-Control', config.cacheControl);
    res.setHeader('X-PutScanner-Cache-Strategy', config.cacheControl);
    return res.status(200).json(body);
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Failed to fetch chart history' });
  }
}
