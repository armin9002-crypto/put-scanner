function normalizeNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && typeof value === 'object' && typeof value.raw === 'number' && Number.isFinite(value.raw)) return value.raw;
  return null;
}

export default async function handler(req, res) {
  const tickersParam = req.query.tickers;
  if (!tickersParam) return res.status(400).json({ error: 'Missing tickers param' });

  const tickers = [...new Set(String(tickersParam)
    .split(',')
    .map(ticker => ticker.trim().toUpperCase())
    .filter(Boolean))]
    .slice(0, 50);

  if (tickers.length === 0) return res.status(400).json({ error: 'No valid tickers' });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(tickers.join(','))}`;
    const yahooRes = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    if (!yahooRes.ok) {
      throw new Error(`Yahoo valuation request failed with ${yahooRes.status}`);
    }

    const data = await yahooRes.json();
    const results = data?.quoteResponse?.result ?? [];
    const bySymbol = new Map(results.map(item => [String(item.symbol ?? '').toUpperCase(), item]));
    const fetchedAt = new Date().toISOString();

    const valuations = {};
    for (const ticker of tickers) {
      const quote = bySymbol.get(ticker);
      const forwardPe = normalizeNumber(quote?.forwardPE ?? quote?.forwardPe);
      const trailingPe = normalizeNumber(quote?.trailingPE ?? quote?.trailingPe);
      valuations[ticker] = {
        proxyTicker: ticker,
        forwardPe,
        trailingPe,
        source: quote ? 'yahoo' : 'unavailable',
        fetchedAt,
        error: quote ? undefined : 'Valuation unavailable',
      };
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
    return res.status(200).json({ valuations });
  } catch (error) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to fetch proxy valuations' });
  } finally {
    clearTimeout(timeout);
  }
}
