exports.handler = async function(event, context) {
  const ticker = event.queryStringParameters.ticker;
  const range = event.queryStringParameters.range || '1d';
  const interval = event.queryStringParameters.interval || '1d';

  try {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=${interval}&range=${range}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
    });
    const data = await res.json();
    const result = data.chart.result[0];
    const meta = result.meta;
    const price = meta.regularMarketPrice;
    const prev = meta.chartPreviousClose;
    const change = price - prev;
    const changePct = (change / prev) * 100;

    const response = { price, change, changePct };

    // If intraday data requested, include sparkline
    if (interval === '1m' && range === '1d') {
      const closes = result.indicators?.quote?.[0]?.close || [];
      const sparkline = closes.filter(v => v != null);
      response.sparkline = sparkline;
    }

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify(response)
    };
  } catch(e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
