import { buildScreenerBatch, responseBytes, SCREENER_BATCH_MAX_BYTES, SCREENER_BATCH_VERSION } from './_lib/screenerBatch.js';
import { observeMarketRequest } from './_lib/requestObservability.js';

function integerQuery(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw == null || raw === '') return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

export default async function handler(req, res) {
  const observation = observeMarketRequest(req, res, { endpoint: 'screener-batch' });
  res.setHeader('Access-Control-Allow-Origin', '*');
  const chunkId = integerQuery(req.query.chunk);
  const rawDate = Array.isArray(req.query.date) ? req.query.date[0] : req.query.date;
  const targetDate = rawDate == null || rawDate === '' ? null : integerQuery(rawDate);
  if (chunkId == null) return res.status(400).json({ error: 'Invalid Screener chunk' });
  if (rawDate != null && rawDate !== '' && (targetDate == null || targetDate <= 0)) return res.status(400).json({ error: 'Invalid expiration date' });

  try {
    const dataset = await buildScreenerBatch({ chunkId, targetDate, signal: observation.signal });
    observation.setCounts({ tickerCount: dataset.diagnostics.plannedEtfs, expiryCount: targetDate == null ? 0 : 1 });
    const bytes = responseBytes(dataset);
    if (bytes > SCREENER_BATCH_MAX_BYTES) return res.status(502).json({ error: 'Screener batch exceeded the response-size guardrail' });
    const cacheControl = dataset.complete
      ? 'public, s-maxage=300, stale-while-revalidate=900'
      : 'private, no-store';
    res.setHeader('Cache-Control', cacheControl);
    res.setHeader('X-PutScanner-Upstream-Requests', String(dataset.diagnostics.upstreamRequests));
    res.setHeader('X-PutScanner-Cache-Strategy', cacheControl);
    res.setHeader('X-PutScanner-Dataset-Version', String(SCREENER_BATCH_VERSION));
    res.setHeader('X-PutScanner-Max-Observed-Concurrency', String(dataset.diagnostics.maxObservedConcurrency));
    res.setHeader('X-PutScanner-Circuit-Rejections', String(dataset.diagnostics.circuitBreakerRejections));
    res.setHeader('X-PutScanner-Planned-Chains', String(dataset.diagnostics.plannedOptionChains));
    res.setHeader('X-PutScanner-Response-Bytes', String(bytes));
    return res.status(200).json(dataset);
  } catch (error) {
    const status = error instanceof RangeError ? 400 : 502;
    return res.status(status).json({ error: error?.message || 'Failed to build Screener batch' });
  }
}
