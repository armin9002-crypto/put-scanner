exports.handler = async function(event, context) {
  const ticker = event.queryStringParameters.ticker;
  const date = event.queryStringParameters.date;

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  try {
    // Step 1: Get a cookie by visiting Yahoo Finance
    const cookieRes = await fetch('https://fc.yahoo.com', { headers });
    const cookies = cookieRes.headers.get('set-cookie') || '';

    // Step 2: Fetch the crumb using that cookie
    const crumbRes = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
      headers: { ...headers, 'Cookie': cookies }
    });
    const crumb = await crumbRes.text();
    console.log('Got crumb:', crumb);

    // Step 3: Fetch options using the crumb
    let url = `https://query2.finance.yahoo.com/v7/finance/options/${ticker}?crumb=${encodeURIComponent(crumb)}`;
    if (date) url += `&date=${date}`;

    const optRes = await fetch(url, {
      headers: { ...headers, 'Cookie': cookies }
    });
    const data = await optRes.json();
    console.log('Options status:', optRes.status);

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
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
