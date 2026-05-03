exports.handler = async function(event, context) {
  const ticker = event.queryStringParameters.ticker;
  const date = event.queryStringParameters.date;

  const urls = [
    `https://query2.finance.yahoo.com/v9/finance/options/${ticker}${date ? '?date=' + date : ''}`,
    `https://query1.finance.yahoo.com/v9/finance/options/${ticker}${date ? '?date=' + date : ''}`,
    `https://query2.finance.yahoo.com/v7/finance/options/${ticker}${date ? '?date=' + date : ''}`,
  ];

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Origin': 'https://finance.yahoo.com',
    'Referer': 'https://finance.yahoo.com/quote/' + ticker + '/options/',
    'Cookie': 'B=abc; expires=Thu, 01-Jan-2026 00:00:00 GMT'
  };

  for (const url of urls) {
    try {
      console.log('Trying URL:', url);
      const res = await fetch(url, { headers });
      console.log('Response status:', res.status);
      const text = await res.text();
      console.log('Response preview:', text.substring(0, 200));
      if (res.ok) {
        const data = JSON.parse(text);
        if (data.optionChain?.result?.length > 0) {
          return {
            statusCode: 200,
            headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
          };
        }
      }
    } catch(e) {
      console.log('Error with URL', url, ':', e.message);
    }
  }

  return {
    statusCode: 500,
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ error: 'All Yahoo Finance endpoints failed' })
  };
};
