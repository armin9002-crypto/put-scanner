export default async (request, context) => {
  const url = new URL(request.url);
  const ticker = url.searchParams.get('ticker');
  const date = url.searchParams.get('date');

  let yahooUrl = `https://query2.finance.yahoo.com/v9/finance/options/${ticker}`;
  if (date) yahooUrl += `?date=${date}`;

  try {
    const res = await fetch(yahooUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Referer': 'https://finance.yahoo.com'
      }
    });
    const data = await res.json();
    return new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
};

export const config = { path: '/api/options' };
