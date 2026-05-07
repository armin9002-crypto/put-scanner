exports.handler = async function(event, context) {
  const tickersParam = event.queryStringParameters.tickers;
  if (!tickersParam) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing tickers parameter' }) };
  }

  const tickers = tickersParam.split(',').map(t => t.trim()).filter(Boolean);
  if (tickers.length === 0) {
    return { statusCode: 400, body: JSON.stringify({ error: 'No tickers provided' }) };
  }

  try {
    const url = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(tickers.join(','))}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
    });
    const data = await res.json();
    const results = data.quoteResponse?.result || [];

    const output = {};
    for (const item of results) {
      output[item.symbol] = {
        price: item.regularMarketPrice ?? 0,
        change: item.regularMarketChange ?? 0,
        changePct: item.regularMarketChangePercent ?? 0,
        high52w: item.fiftyTwoWeekHigh ?? null,
        low52w: item.fiftyTwoWeekLow ?? null,
      };
    }

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify(output)
    };
  } catch(e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
