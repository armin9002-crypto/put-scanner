exports.handler = async function(event, context) {
  const ticker = event.queryStringParameters.ticker;
  try {
    const res = await fetch(
      `https://query2.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`,
      { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } }
    );
    const data = await res.json();
    const meta = data.chart.result[0].meta;
    const price = meta.regularMarketPrice;
    const prev = meta.chartPreviousClose;
    const change = price - prev;
    const changePct = (change / prev) * 100;
    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ price, change, changePct })
    };
  } catch(e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
