export default async function handler(req, res) {
  const tickers = req.query.tickers;
  if (!tickers) return res.status(400).send('Missing tickers param');

  try {
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(tickers)}&fields=regularMarketPrice,regularMarketChange,regularMarketChangePercent,fiftyTwoWeekHigh,fiftyTwoWeekLow,fiftyTwoWeekChangePercent,regularMarketDayHigh,regularMarketDayLow,shortName`;
    const sparkUrl = `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${encodeURIComponent(tickers)}&range=3mo&interval=1d`;

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
    };

    const [yahooRes, sparkRes] = await Promise.all([
      fetch(url, { headers }),
      fetch(sparkUrl, { headers }),
    ]);

    const data = await yahooRes.json();
    const sparkData = await sparkRes.json();
    console.log('Quote response status:', yahooRes.status);
    console.log('Result count:', data?.quoteResponse?.result?.length);
    console.log('Spark response status:', sparkRes.status);

    if (!data?.quoteResponse?.result) {
      console.log('Raw response:', JSON.stringify(data).substring(0, 300));
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(500).json({ error: 'No results from Yahoo' });
    }

    const sparkBySymbol = {};
    const sparkResults = sparkData?.spark?.result || [];
    for (const item of sparkResults) {
      const symbol = item.symbol;
      const closes = item.response?.[0]?.indicators?.quote?.[0]?.close || [];
      const filtered = closes.filter(v => v != null);
      const len = filtered.length;
      const last = len > 0 ? filtered[len - 1] : null;

      let fiveDay = null;
      if (last != null && len >= 6) {
        const past = filtered[len - 6];
        if (past > 0) fiveDay = ((last - past) / past) * 100;
      }

      let oneMonth = null;
      if (last != null && len >= 22) {
        const past = filtered[len - 22];
        if (past > 0) oneMonth = ((last - past) / past) * 100;
      }

      let threeMonth = null;
      if (last != null && len >= 2) {
        const first = filtered[0];
        if (first > 0) threeMonth = ((last - first) / first) * 100;
      }

      sparkBySymbol[symbol] = { fiveDay, oneMonth, threeMonth };
    }

    const prices = {};
    for (const item of data.quoteResponse.result) {
      const spark = sparkBySymbol[item.symbol] || {};
      const price = item.regularMarketPrice ?? null;
      const high52w = item.fiftyTwoWeekHigh ?? null;
      const fiftyTwoWeekHighPct = price != null && high52w != null && high52w > 0
        ? ((price - high52w) / high52w) * 100
        : null;

      prices[item.symbol] = {
        price,
        change: item.regularMarketChange ?? null,
        changePct: item.regularMarketChangePercent ?? null,
        high52w,
        low52w: item.fiftyTwoWeekLow ?? null,
        fiveDay: spark.fiveDay ?? null,
        oneMonth: spark.oneMonth ?? null,
        threeMonth: spark.threeMonth ?? null,
        fiftyTwoWeekChangePct: item.fiftyTwoWeekChangePercent ?? null,
        fiftyTwoWeekHighPct,
      };
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json(prices);

  } catch(e) {
    console.log('Error:', e.message);
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(500).json({ error: e.message });
  }
}
