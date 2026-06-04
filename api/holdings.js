function normalizeWeight(value) {
  if (value == null) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return value <= 1 ? value * 100 : value;
  }
  if (typeof value === 'object' && value.raw != null) {
    return normalizeWeight(value.raw);
  }
  const parsed = Number(String(value).replace('%', '').trim());
  if (!Number.isFinite(parsed)) return null;
  return parsed <= 1 ? parsed * 100 : parsed;
}

function normalizeHolding(holding) {
  const symbol = holding?.symbol || holding?.holdingSymbol || holding?.ticker || '';
  const name = holding?.holdingName || holding?.name || holding?.longName || symbol;
  const weight = normalizeWeight(
    holding?.holdingPercent ??
    holding?.weight ??
    holding?.percent ??
    holding?.holdingPercentage
  );
  if (!symbol && !name) return null;
  return {
    symbol: String(symbol || '').toUpperCase(),
    name: String(name || symbol || 'Unknown'),
    weight,
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const rawTicker = Array.isArray(req.query.ticker) ? req.query.ticker[0] : req.query.ticker;
  const ticker = String(rawTicker || '').trim().toUpperCase();
  if (!ticker) {
    return res.status(400).json({ error: 'Missing ticker parameter' });
  }
  if (!/^[A-Z0-9.^-]{1,12}$/.test(ticker)) {
    return res.status(400).json({ error: 'Invalid ticker parameter' });
  }

  const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  try {
    const baseUrl = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=topHoldings,price`;
    let yahooRes = await fetch(baseUrl, {
      headers: {
        'User-Agent': userAgent,
        'Accept': 'application/json',
      },
    });

    if (!yahooRes.ok && (yahooRes.status === 401 || yahooRes.status === 403)) {
      const pageRes = await fetch(`https://finance.yahoo.com/quote/${ticker}/holdings/`, {
        headers: {
          'User-Agent': userAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
        redirect: 'follow',
      });
      const rawCookies = pageRes.headers.get('set-cookie') || '';
      const cookieStr = rawCookies.split(',').map(c => c.split(';')[0]).join('; ');
      const html = await pageRes.text();
      const crumbMatch = html.match(/"crumb":"([^"\\]+)"/);
      const crumb = crumbMatch ? crumbMatch[1].replace(/\\u002F/g, '/') : '';
      const fallbackUrl = crumb ? `${baseUrl}&crumb=${encodeURIComponent(crumb)}` : baseUrl;
      yahooRes = await fetch(fallbackUrl, {
        headers: {
          'User-Agent': userAgent,
          'Accept': 'application/json',
          'Cookie': cookieStr,
        },
      });
    }

    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');

    if (!yahooRes.ok) {
      return res.status(200).json({
        ticker,
        name: ticker,
        holdings: [],
        topHoldingsCount: 0,
        topHoldingsWeight: null,
        source: 'Yahoo Finance',
        fetchedAt: Date.now(),
        unavailableReason: `Yahoo holdings request failed for ${ticker}.`,
      });
    }

    const data = await yahooRes.json();
    const result = data?.quoteSummary?.result?.[0];
    const rawHoldings = Array.isArray(result?.topHoldings?.holdings)
      ? result.topHoldings.holdings
      : [];
    const holdings = rawHoldings
      .map(normalizeHolding)
      .filter(Boolean)
      .slice(0, 30);

    const topHoldingsWeight = holdings.reduce((sum, holding) => (
      typeof holding.weight === 'number' && Number.isFinite(holding.weight) ? sum + holding.weight : sum
    ), 0);

    return res.status(200).json({
      ticker,
      name: result?.price?.longName || result?.price?.shortName || ticker,
      holdings,
      topHoldingsCount: holdings.length,
      topHoldingsWeight: holdings.length ? topHoldingsWeight : null,
      source: 'Yahoo Finance',
      fetchedAt: Date.now(),
      unavailableReason: holdings.length ? undefined : `Yahoo did not return holdings for ${ticker}.`,
    });
  } catch (e) {
    res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=3600');
    return res.status(200).json({
      ticker,
      name: ticker,
      holdings: [],
      topHoldingsCount: 0,
      topHoldingsWeight: null,
      source: 'Yahoo Finance',
      fetchedAt: Date.now(),
      unavailableReason: e instanceof Error ? e.message : `Unable to load holdings for ${ticker}.`,
    });
  }
}
