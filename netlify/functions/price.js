exports.handler = async function(event, context) {
  const ticker = event.queryStringParameters.ticker;
  const range = event.queryStringParameters.range || '1d';
  const interval = event.queryStringParameters.interval || '1d';
  const extended = event.queryStringParameters.extended === 'true';

  try {
    let url;
    if (extended) {
      url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1y`;
    } else {
      url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=${interval}&range=${range}`;
    }

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
      response.sparkline = closes.filter(v => v != null);
    }

    // If extended data requested, include performance metrics
    if (extended) {
      const closes = result.indicators?.quote?.[0]?.close || [];
      const filtered = closes.filter(v => v != null);
      const len = filtered.length;

      // 5-day change: compare current price to 5 trading days ago
      let fiveDay = null;
      if (len >= 6) {
        const past = filtered[len - 6];
        if (past > 0) fiveDay = ((price - past) / past) * 100;
      }

      // 1-month change: ~30 calendar days ago
      let oneMonth = null;
      if (len >= 22) {
        const past = filtered[len - 22];
        if (past > 0) oneMonth = ((price - past) / past) * 100;
      }

      // 3-month change: ~90 calendar days ago
      let threeMonth = null;
      if (len >= 66) {
        const past = filtered[len - 66];
        if (past > 0) threeMonth = ((price - past) / past) * 100;
      }

      // 52-week high
      const fiftyTwoWeekHigh = meta.fiftyTwoWeekHigh || Math.max(...filtered);
      let fiftyTwoWeekHighPct = null;
      if (fiftyTwoWeekHigh > 0) {
        fiftyTwoWeekHighPct = ((price - fiftyTwoWeekHigh) / fiftyTwoWeekHigh) * 100;
      }

      response.fiveDay = fiveDay;
      response.oneMonth = oneMonth;
      response.threeMonth = threeMonth;
      response.fiftyTwoWeekHighPct = fiftyTwoWeekHighPct;
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
