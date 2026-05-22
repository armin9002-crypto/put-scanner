export default async function handler(req, res) {
  const ticker = req.query.ticker;
  const date = req.query.date;

  const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  try {
    // Step 1: Hit Yahoo Finance quote page to get cookies + crumb
    const pageRes = await fetch(`https://finance.yahoo.com/quote/${ticker}/options/`, {
      headers: {
        'User-Agent': userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      },
      redirect: 'follow'
    });

    // Extract cookies
    const rawCookies = pageRes.headers.get('set-cookie') || '';
    const cookieStr = rawCookies.split(',').map(c => c.split(';')[0]).join('; ');

    // Extract crumb from HTML
    const html = await pageRes.text();
    const crumbMatch = html.match(/"crumb":"([^"\\]+)"/);
    const crumb = crumbMatch ? crumbMatch[1].replace(/\\u002F/g, '/') : null;
    console.log('Extracted crumb:', crumb);
    console.log('Cookie length:', cookieStr.length);

    if (!crumb) {
      // Fallback: try getcrumb endpoint with page cookies
      const crumbRes = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
        headers: { 'User-Agent': userAgent, 'Cookie': cookieStr }
      });
      const fallbackCrumb = await crumbRes.text();
      console.log('Fallback crumb:', fallbackCrumb);
    }

    const finalCrumb = crumb || '';
    let url = `https://query2.finance.yahoo.com/v7/finance/options/${ticker}?crumb=${encodeURIComponent(finalCrumb)}`;
    if (date) url += `&date=${date}`;

    const optRes = await fetch(url, {
      headers: {
        'User-Agent': userAgent,
        'Accept': 'application/json',
        'Cookie': cookieStr
      }
    });
    const data = await optRes.json();
    console.log('Options status:', optRes.status, 'Has result:', !!data?.optionChain?.result?.length);

    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json(data);
  } catch(e) {
    console.log('Error:', e.message);
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(500).json({ error: e.message });
  }
}
