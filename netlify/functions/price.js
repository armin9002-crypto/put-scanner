export default async (request, context) => {
  const url = new URL(request.url);
  const ticker = url.searchParams.get('ticker');

  try {
    const res = await fetch(
      `https://query2.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`,
      { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } }
    );
    const data = await res.json();
    const meta = data.chart.result[0].meta;
    const price = meta.regularMarketPrice;
    const change = price - meta.chartPreviousClose;
    const changePct = (change / meta.chartPreviousClose) * 100;
    return new Response(JSON.stringify({ price, change, changePct }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
};

export const config = { path: '/api/price' };
