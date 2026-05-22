export default async function handler(req, res) {
  const tickers = req.query.tickers;
  if (!tickers) return res.status(400).send('Missing tickers param');

  try {
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(tickers)}&fields=regularMarketPrice,regularMarketChange,regularMarketChangePercent,fiftyTwoWeekHigh,fiftyTwoWeekLow,shortName`;

    const yahooRes = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    });

    const data = await yahooRes.json();
    console.log('Quote response status:', yahooRes.status);
    console.log('Result count:', data?.quoteResponse?.result?.length);

    if (!data?.quoteResponse?.result) {
      console.log('Raw response:', JSON.stringify(data).substring(0, 300));
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(500).json({ error: 'No results from Yahoo' });
    }

    const prices = {};
    for (const item of data.quoteResponse.result) {
      prices[item.symbol] = {
        price: item.regularMarketPrice ?? null,
        change: item.regularMarketChange ?? null,
        changePct: item.regularMarketChangePercent ?? null,
        high52w: item.fiftyTwoWeekHigh ?? null,
        low52w: item.fiftyTwoWeekLow ?? null,
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
