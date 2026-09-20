import { buildScreenerExpirationDataset, SCREENER_BATCH_VERSION } from './_lib/screenerBatch.js';
import { observeMarketRequest } from './_lib/requestObservability.js';
import { getCache } from '@vercel/functions';
import { resolveScreenerExpirationDataset } from './_lib/screenerExpirationEvidence.js';

export default async function handler(req, res) {
  const observation = observeMarketRequest(req, res, { endpoint: 'screener-expirations' });
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const freshRequested = String(req?.query?.fresh ?? '') === '1';
    const resolved = await resolveScreenerExpirationDataset({
      cache: getCache({ namespace: 'put-scanner' }),
      freshRequested,
      acquire: () => buildScreenerExpirationDataset({ signal: observation.signal }),
    });
    const dataset = resolved.dataset;
    const requestDiagnostics = resolved.upstreamRequests === 0
      ? { upstreamRequests: 0, maxObservedConcurrency: 0, circuitBreakerRejections: 0 }
      : dataset.refreshDiagnostics ?? dataset.diagnostics;
    observation.setCounts({ tickerCount: Object.keys(dataset.expirationsByTicker).length });
    res.setHeader('X-PutScanner-Evidence-Source', resolved.source);
    res.setHeader('X-PutScanner-Evidence-Observed-At', String(dataset.fetchedAt));
    res.setHeader('X-PutScanner-Upstream-Requests', String(resolved.upstreamRequests ?? dataset.diagnostics?.upstreamRequests ?? 0));
    const cacheControl = dataset.complete
      ? freshRequested ? 'private, no-store' : 'public, s-maxage=259200, stale-while-revalidate=86400'
      : 'private, no-store';
    res.setHeader('Cache-Control', cacheControl);
    res.setHeader('X-PutScanner-Cache-Strategy', cacheControl);
    res.setHeader('X-PutScanner-Dataset-Version', String(SCREENER_BATCH_VERSION));
    res.setHeader('X-PutScanner-Max-Observed-Concurrency', String(requestDiagnostics?.maxObservedConcurrency ?? 0));
    res.setHeader('X-PutScanner-Circuit-Rejections', String(requestDiagnostics?.circuitBreakerRejections ?? 0));
    return res.status(200).json(dataset);
  } catch (error) {
    return res.status(502).json({ error: error?.message || 'Failed to load Screener expirations' });
  }
}
