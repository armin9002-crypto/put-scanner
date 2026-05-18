exports.handler = async function(event, context) {
  const tickers = event.queryStringParameters.tickers;
  if (!tickers) return { statusCode: 400, body: 'Missing tickers param' };

  try {
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(tickers)}&fields=regularMarketPrice,regularMarketChange,regularMarketChangePercent,fiftyTwoWeekHigh,fiftyTwoWeekLow,shortName`;

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    });

    const data = await res.json();
    console.log('Quote response status:', res.status);
    console.log('Result count:', data?.quoteResponse?.result?.length);

    if (!data?.quoteResponse?.result) {
      console.log('Raw response:', JSON.stringify(data).substring(0, 300));
      return {
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'No results from Yahoo' })
      };
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

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify(prices)
    };

  } catch(e) {
    console.log('Error:', e.message);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: e.message })
    };
  }
};
