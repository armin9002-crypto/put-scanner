import { fetchYahooExtendedPrice } from './_lib/extendedPrice.js';
import { fetchYahooVolatilityContext } from './_lib/ivRank.js';
import { fetchYahooOptions } from './_lib/yahoo.js';

function tickerFromRequest(req) {
  const rawTicker = Array.isArray(req.query.ticker) ? req.query.ticker[0] : req.query.ticker;
  return String(rawTicker || '').trim().toUpperCase();
}

function optionResult(optionData) {
  return optionData?.optionChain?.result?.[0] ?? null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const ticker = tickerFromRequest(req);
  if (!ticker || !/^[A-Z0-9.^-]{1,12}$/.test(ticker)) {
    return res.status(400).json({ code: 'INVALID_INPUT', message: 'Enter a valid ticker symbol.' });
  }
  const rawDate = Array.isArray(req.query.date) ? req.query.date[0] : req.query.date;
  const date = rawDate == null || rawDate === '' ? null : Number(rawDate);
  if (rawDate != null && rawDate !== '' && (!Number.isInteger(date) || date <= 0)) {
    return res.status(400).json({ code: 'INVALID_INPUT', message: 'The requested expiration is invalid.' });
  }
  const fresh = req.query.fresh === '1' || req.query.fresh === 'true';
  let upstreamAttempts = 0;
  const onAttempt = () => { upstreamAttempts += 1; };

  try {
    const extendedPromise = fetchYahooExtendedPrice(ticker, { includeSparkline: true, onAttempt }).catch(() => null);
    const options = await fetchYahooOptions(ticker, date, { fresh, onAttempt });
    const result = optionResult(options);
    if (!result) {
      const providerError = options?.optionChain?.error;
      const invalid = providerError?.code === 'Not Found' || providerError?.code === 'INVALID_SYMBOL';
      res.setHeader('X-PutScanner-Upstream-Requests', String(upstreamAttempts));
      return res.status(invalid ? 404 : 502).json({
        code: invalid ? 'INVALID_SYMBOL' : 'PROVIDER_FAILURE',
        message: invalid ? `We couldn't find ${ticker}.` : `Market data for ${ticker} is temporarily unavailable.`,
      });
    }

    const [extendedPrice, volatilityContext] = await Promise.all([
      extendedPromise,
      fetchYahooVolatilityContext(ticker, { optionData: options, onAttempt }).catch(() => null),
    ]);
    const expirationDates = Array.isArray(result.expirationDates) ? result.expirationDates : [];
    const puts = Array.isArray(result.options?.[0]?.puts) ? result.options[0].puts : [];
    const availability = expirationDates.length > 0 && puts.length > 0 ? 'optionable' : 'no_options';
    const cacheControl = fresh ? 'no-store' : 'public, s-maxage=300, stale-while-revalidate=900';
    res.setHeader('Cache-Control', cacheControl);
    res.setHeader('X-PutScanner-Cache-Strategy', cacheControl);
    res.setHeader('X-PutScanner-Upstream-Requests', String(upstreamAttempts));
    return res.status(200).json({ availability, options, extendedPrice, volatilityContext });
  } catch (error) {
    const status = error?.status === 404 ? 404 : 503;
    const code = status === 404 ? 'INVALID_SYMBOL' : 'PROVIDER_FAILURE';
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-PutScanner-Upstream-Requests', String(upstreamAttempts));
    return res.status(status).json({
      code,
      message: status === 404 ? `We couldn't find ${ticker}.` : `Market data for ${ticker} is temporarily unavailable.`,
    });
  }
}
