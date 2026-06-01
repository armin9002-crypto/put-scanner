export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const rawTickers = Array.isArray(req.query.tickers) ? req.query.tickers[0] : req.query.tickers;
  if (!rawTickers) return res.status(400).json({ error: 'Missing tickers parameter' });

  const symbols = [...new Set(String(rawTickers)
    .split(',')
    .map(symbol => symbol.trim().toUpperCase())
    .filter(symbol => /^[A-Z0-9.^-]{1,12}$/.test(symbol)))];

  if (symbols.length === 0) {
    return res.status(400).json({ error: 'No valid ticker symbols' });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const chunks = [];
    for (let i = 0; i < symbols.length; i += 20) {
      chunks.push(symbols.slice(i, i + 20));
    }

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
    };

    const sparkResults = [];
    const errors = [];
    for (const chunk of chunks) {
      try {
        const url = `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${encodeURIComponent(chunk.join(','))}&range=1d&interval=1d`;
        const yahooRes = await fetch(url, { headers, signal: controller.signal });
        if (!yahooRes.ok) throw new Error(`1d spark failed (${yahooRes.status})`);
        const rawText = await yahooRes.text();

        const data = JSON.parse(rawText);
        if (data?.spark?.result?.length) {
          sparkResults.push(...data.spark.result);
        }
      } catch (error) {
        errors.push({ symbols: chunk, error: error.message });
      }
    }
    if (sparkResults.length === 0) {
      return res.status(502).json({ error: 'No results from Yahoo', errors });
    }

    const prices = {};
    for (const item of sparkResults) {
      const meta = item.response?.[0]?.meta || {};
      const price = meta.regularMarketPrice ?? null;
      const prev = meta.chartPreviousClose ?? null;
      const change = price != null && prev != null ? price - prev : null;
      const changePct = change != null && prev != null && prev > 0 ? (change / prev) * 100 : null;
      const high52w = meta.fiftyTwoWeekHigh ?? null;
      const low52w = meta.fiftyTwoWeekLow ?? null;
      const posIn52wRange = price != null && high52w != null && low52w != null && high52w > low52w
        ? ((price - low52w) / (high52w - low52w)) * 100
        : null;
      const fiftyTwoWeekHighPct = price != null && high52w != null && high52w > 0
        ? ((price - high52w) / high52w) * 100
        : null;

      prices[item.symbol] = {
        price,
        change,
        changePct,
        high52w,
        low52w,
        fiveDay: null,
        oneMonth: null,
        threeMonth: null,
        fiftyTwoWeekHighPct,
        posIn52wRange,
      };
    }

    const historicalResults = [];
    for (const chunk of chunks) {
      try {
        const url = `https://query2.finance.yahoo.com/v7/finance/spark?symbols=${encodeURIComponent(chunk.join(','))}&range=3mo&interval=1d`;
        const yahooRes = await fetch(url, { headers, signal: controller.signal });
        if (!yahooRes.ok) throw new Error(`3mo spark failed (${yahooRes.status})`);
        const rawText = await yahooRes.text();

        const data = JSON.parse(rawText);
        if (data?.spark?.result?.length) {
          historicalResults.push(...data.spark.result);
        }
      } catch (error) {
        errors.push({ symbols: chunk, error: error.message });
      }
    }

    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=900');
    for (const item of historicalResults) {
      const symbol = item.symbol;
      const closes = item.response?.[0]?.indicators?.quote?.[0]?.close ?? [];
      const validCloses = closes.filter(c => c !== null && c !== undefined);
      if (validCloses.length > 0) {
        const currentPrice = prices[symbol]?.price ?? validCloses[validCloses.length - 1];
        const fiveDay = validCloses.length >= 6
          ? ((currentPrice - validCloses[validCloses.length - 6]) / validCloses[validCloses.length - 6]) * 100
          : null;
        const oneMonth = validCloses.length >= 22
          ? ((currentPrice - validCloses[validCloses.length - 22]) / validCloses[validCloses.length - 22]) * 100
          : null;
        const threeMonth = validCloses.length >= 2
          ? ((currentPrice - validCloses[0]) / validCloses[0]) * 100
          : null;

        if (prices[symbol]) {
          prices[symbol].fiveDay = fiveDay;
          prices[symbol].oneMonth = oneMonth;
          prices[symbol].threeMonth = threeMonth;
        }
      }
    }

    return res.status(200).json(prices);

  } catch(e) {
    return res.status(500).json({ error: e.message });
  } finally {
    clearTimeout(timeout);
  }
}
