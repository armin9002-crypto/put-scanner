import { buildScreenerExpirationDataset, SCREENER_BATCH_VERSION } from './_lib/screenerBatch.js';
import { observeMarketRequest } from './_lib/requestObservability.js';

export default async function handler(req, res) {
  const observation = observeMarketRequest(req, res, { endpoint: 'screener-expirations' });
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const dataset = await buildScreenerExpirationDataset({ signal: observation.signal });
    observation.setCounts({ tickerCount: Object.keys(dataset.expirationsByTicker).length });
    const freshRequested = String(req?.query?.fresh ?? '') === '1';
    const cacheControl = dataset.complete
      ? freshRequested ? 'private, no-store' : 'public, s-maxage=259200, stale-while-revalidate=86400'
      : 'private, no-store';
    res.setHeader('Cache-Control', cacheControl);
    res.setHeader('X-PutScanner-Upstream-Requests', String(dataset.diagnostics.upstreamRequests));
    res.setHeader('X-PutScanner-Cache-Strategy', cacheControl);
    res.setHeader('X-PutScanner-Dataset-Version', String(SCREENER_BATCH_VERSION));
    res.setHeader('X-PutScanner-Max-Observed-Concurrency', String(dataset.diagnostics.maxObservedConcurrency));
    res.setHeader('X-PutScanner-Circuit-Rejections', String(dataset.diagnostics.circuitBreakerRejections));
    return res.status(200).json(dataset);
  } catch (error) {
    return res.status(502).json({ error: error?.message || 'Failed to load Screener expirations' });
  }
}
