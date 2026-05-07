exports.handler = async function(event, context) {
  const ticker = event.queryStringParameters.ticker;
  if (!ticker) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing ticker parameter' }) };
  }

  const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  try {
    // Step 1: Get cookies + crumb from Yahoo Finance
    const pageRes = await fetch(`https://finance.yahoo.com/quote/${ticker}/options/`, {
      headers: {
        'User-Agent': userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      },
      redirect: 'follow'
    });

    const rawCookies = pageRes.headers.get('set-cookie') || '';
    const cookieStr = rawCookies.split(',').map(c => c.split(';')[0]).join('; ');
    const html = await pageRes.text();
    const crumbMatch = html.match(/"crumb":"([^"\\]+)"/);
    const crumb = crumbMatch ? crumbMatch[1].replace(/\\u002F/g, '/') : '';

    // Step 2: Get current ATM IV from nearest expiry options chain
    const optUrl = `https://query2.finance.yahoo.com/v7/finance/options/${ticker}?crumb=${encodeURIComponent(crumb)}`;
    const optRes = await fetch(optUrl, {
      headers: { 'User-Agent': userAgent, 'Accept': 'application/json', 'Cookie': cookieStr }
    });
    const optData = await optRes.json();

    const result = optData?.optionChain?.result?.[0];
    if (!result) {
      return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }, body: JSON.stringify({ currentIV: null, ivRank: null, ivPercentile: null }) };
    }

    const currentPrice = result.quote?.regularMarketPrice ?? 0;
    const puts = result.options?.[0]?.puts || [];

    // Find ATM put (closest strike to current price)
    let atmIV = null;
    let minDist = Infinity;
    for (const p of puts) {
      const dist = Math.abs(p.strike - currentPrice);
      if (dist < minDist && p.impliedVolatility != null && p.impliedVolatility > 0) {
        minDist = dist;
        let iv = p.impliedVolatility;
        if (iv < 5) iv = iv * 100; // normalize to percentage
        atmIV = iv;
      }
    }

    if (atmIV == null) {
      return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }, body: JSON.stringify({ currentIV: null, ivRank: null, ivPercentile: null }) };
    }

    // Step 3: Get 1 year of historical data for IV range calculation
    const oneYearAgo = Math.floor(Date.now() / 1000) - 365 * 24 * 60 * 60;
    const chartUrl = `https://query2.finance.yahoo.com/v8/finance/chart/${ticker}?period1=${oneYearAgo}&period2=${Math.floor(Date.now() / 1000)}&interval=1wk&crumb=${encodeURIComponent(crumb)}`;
    const chartRes = await fetch(chartUrl, {
      headers: { 'User-Agent': userAgent, 'Accept': 'application/json', 'Cookie': cookieStr }
    });
    const chartData = await chartRes.json();

    const closes = chartData?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [];
    const validCloses = closes.filter(c => c != null);

    if (validCloses.length < 20) {
      return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }, body: JSON.stringify({ currentIV: atmIV, ivRank: null, ivPercentile: null }) };
    }

    // Calculate rolling 20-day (4-week) annualized volatility for each week
    const weeklyVols: number[] = [];
    for (let i = 4; i < validCloses.length; i++) {
      const window = validCloses.slice(i - 4, i + 1);
      const returns = [];
      for (let j = 1; j < window.length; j++) {
        if (window[j - 1] > 0) {
          returns.push(Math.log(window[j] / window[j - 1]));
        }
      }
      if (returns.length >= 3) {
        const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
        const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length;
        const annualizedVol = Math.sqrt(variance) * Math.sqrt(52) * 100;
        weeklyVols.push(annualizedVol);
      }
    }

    if (weeklyVols.length < 5) {
      return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }, body: JSON.stringify({ currentIV: atmIV, ivRank: null, ivPercentile: null }) };
    }

    const ivLow = Math.min(...weeklyVols);
    const ivHigh = Math.max(...weeklyVols);
    const ivRange = ivHigh - ivLow;

    // IV Rank: percentage of time IV was below current
    const belowCount = weeklyVols.filter(v => v < atmIV).length;
    const ivPercentile = (belowCount / weeklyVols.length) * 100;

    // IV Rank: (current - low) / (high - low) * 100
    const ivRank = ivRange > 0 ? ((atmIV - ivLow) / ivRange) * 100 : 50;

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentIV: Math.round(atmIV * 100) / 100,
        ivRank: Math.round(Math.max(0, Math.min(100, ivRank)) * 10) / 10,
        ivPercentile: Math.round(ivPercentile * 10) / 10,
      })
    };
  } catch(e) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: e.message })
    };
  }
};
