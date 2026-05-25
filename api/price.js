export default async function handler(req, res) {
  const ticker = req.query.ticker;
  const range = req.query.range || '1d';
  const interval = req.query.interval || '1d';
  const extended = req.query.extended === 'true';

  try {
    let url;
    if (extended) {
      url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1y`;
    } else {
      url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=${interval}&range=${range}`;
    }

    const yahooRes = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
    });
    const data = await yahooRes.json();
    const result = data.chart.result[0];
    const meta = result.meta;
    const price = meta.regularMarketPrice;
    const prev = meta.chartPreviousClose;
    const change = price - prev;
    const changePct = (change / prev) * 100;

    const response = { price, change, changePct, previousClose: prev };

    // If intraday data requested, include sparkline
    if (interval === '1m' && range === '1d') {
      const closes = result.indicators?.quote?.[0]?.close || [];
      response.sparkline = closes.filter(v => v != null);
    }

    // If extended data requested, include performance metrics and intraday sparkline
    if (extended) {
      const dailyCloses = result.indicators?.quote?.[0]?.close || [];
      const filtered = dailyCloses.filter(v => v != null);
      const len = filtered.length;

      // 5-day change: compare current price to 5 trading days ago
      let fiveDay = null;
      if (len >= 6) {
        const past = filtered[len - 6];
        if (past > 0) fiveDay = ((price - past) / past) * 100;
      }

      // 1-month change: ~22 trading days ago
      let oneMonth = null;
      if (len >= 22) {
        const past = filtered[len - 22];
        if (past > 0) oneMonth = ((price - past) / past) * 100;
      }

      // 3-month change: ~66 trading days ago
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

      // Also fetch intraday sparkline for extended requests
      try {
        const intradayUrl = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1m&range=1d`;
        const intradayRes = await fetch(intradayUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
        });
        const intradayData = await intradayRes.json();
        const intradayResult = intradayData.chart?.result?.[0];
        const intradayCloses = intradayResult?.indicators?.quote?.[0]?.close || [];
        response.sparkline = intradayCloses.filter(v => v != null);
        response.previousClose = intradayResult?.meta?.chartPreviousClose ?? response.previousClose;
      } catch {
        response.sparkline = [];
      }
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json(response);
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
