import { normalizeFiniteNumber, normalizePositiveNumber, normalizeProviderTimestampSeconds, readYahooJson, yahooFetch } from './yahoo.js';

export async function fetchYahooExtendedPrice(ticker, options = {}) {
  const dailyUrl = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1y`;
  const dailyResponse = await yahooFetch(dailyUrl, { endpoint: 'price', signal: options.signal, timeoutMs: options.timeoutMs, onAttempt: options.onAttempt });
  if (!dailyResponse.ok) {
    const error = new Error(`Yahoo chart request failed (${dailyResponse.status})`);
    error.status = dailyResponse.status;
    throw error;
  }
  const dailyData = await readYahooJson(dailyResponse, 'price');
  const result = dailyData?.chart?.result?.[0];
  if (!result) {
    const error = new Error('No chart result returned');
    error.status = dailyData?.chart?.error?.code === 'Not Found' ? 404 : 502;
    throw error;
  }

  const meta = result.meta || {};
  const price = normalizePositiveNumber(meta.regularMarketPrice);
  const previousClose = normalizePositiveNumber(meta.chartPreviousClose ?? meta.previousClose);
  const change = price != null && previousClose != null ? price - previousClose : null;
  const changePercent = change != null && previousClose != null ? change / previousClose * 100 : null;
  const closes = (result.indicators?.quote?.[0]?.close || []).map(normalizeFiniteNumber).filter(value => value != null);

  const performance = offset => {
    const past = closes.length >= offset ? closes[closes.length - offset] : null;
    return price != null && past != null && past > 0 ? (price - past) / past * 100 : null;
  };
  const fiftyTwoWeekHigh = normalizePositiveNumber(meta.fiftyTwoWeekHigh) ?? (closes.length ? Math.max(...closes) : null);

  let sparkline = [];
  if (options.includeSparkline) {
    try {
      const intradayUrl = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1m&range=1d`;
      const intradayResponse = await yahooFetch(intradayUrl, { endpoint: 'price', signal: options.signal, timeoutMs: options.timeoutMs, onAttempt: options.onAttempt });
      if (intradayResponse.ok) {
        const intradayData = await readYahooJson(intradayResponse, 'price');
        const intraday = intradayData?.chart?.result?.[0];
        sparkline = (intraday?.indicators?.quote?.[0]?.close || []).map(normalizeFiniteNumber).filter(value => value != null);
      }
    } catch {
      sparkline = [];
    }
  }

  return {
    price,
    change,
    changePercent,
    fiveDay: performance(6),
    oneMonth: performance(22),
    threeMonth: performance(66),
    fiftyTwoWeekHighPct: price != null && fiftyTwoWeekHigh != null ? (price - fiftyTwoWeekHigh) / fiftyTwoWeekHigh * 100 : null,
    previousClose,
    providerMarketTime: normalizeProviderTimestampSeconds(meta.regularMarketTime),
    sparkline,
  };
}
