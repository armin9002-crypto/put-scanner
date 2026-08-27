import { buildEtfPulseDataset, ETF_PULSE_DATASET_VERSION } from './_lib/etfPulseDataset.js';
import { observeMarketRequest } from './_lib/requestObservability.js';

export default async function handler(req, res) {
  const observation = observeMarketRequest(req, res, { endpoint: 'etf-pulse' });
  res.setHeader('Access-Control-Allow-Origin', '*');
  const fresh = req.query.fresh === '1';
  try {
    const dataset = await buildEtfPulseDataset({ signal: observation.signal });
    observation.setCounts({ tickerCount: dataset.tickers.length });
    const complete = dataset.errors.length === 0;
    const cacheControl = fresh
      ? 'private, no-store'
      : complete
        ? 'public, s-maxage=3600, stale-while-revalidate=21600'
        : 'public, s-maxage=60, stale-while-revalidate=3600';
    res.setHeader('Cache-Control', cacheControl);
    res.setHeader('X-PutScanner-Upstream-Requests', String(dataset.diagnostics.upstreamRequests));
    res.setHeader('X-PutScanner-Cache-Strategy', cacheControl);
    res.setHeader('X-PutScanner-Dataset-Version', String(ETF_PULSE_DATASET_VERSION));
    res.setHeader('X-PutScanner-Max-Observed-Concurrency', String(dataset.diagnostics.maxObservedConcurrency));
    res.setHeader('X-PutScanner-Circuit-Rejections', String(dataset.diagnostics.circuitBreakerRejections));
    return res.status(200).json(dataset);
  } catch (error) {
    return res.status(502).json({ error: error?.message || 'Failed to build ETF Pulse dataset' });
  }
}
