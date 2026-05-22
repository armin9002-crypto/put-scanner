export default async function handler(req, res) {
  const tickers = req.query.tickers;
  if (!tickers) return res.status(400).send('Missing tickers param');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const url = `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${encodeURIComponent(tickers)}&range=1d&interval=1d`;

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
    };

    const yahooRes = await fetch(url, { headers, signal: controller.signal });
    const rawText = await yahooRes.text();
    console.log('Yahoo prices response status:', yahooRes.status);
    console.log('Yahoo prices raw response:', rawText.substring(0, 500));

    const data = JSON.parse(rawText);
    console.log('Result count:', data?.spark?.result?.length);

    if (!data?.spark?.result) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(500).json({ error: 'No results from Yahoo' });
    }

    const prices = {};
    for (const item of data.spark.result) {
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
        fiftyTwoWeekHighPct,
        posIn52wRange,
      };
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json(prices);

  } catch(e) {
    console.log('Error:', e.message);
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(500).json({ error: e.message });
  } finally {
    clearTimeout(timeout);
  }
}
