import { randomUUID } from 'node:crypto';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,96}$/;

function firstHeader(value) {
  return Array.isArray(value) ? value[0] : value;
}

function safeCount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function classifyFailure(status) {
  if (status < 400) return 'none';
  if (status === 400 || status === 422) return 'validation';
  if (status === 404) return 'not_found';
  if (status === 408 || status === 499) return 'aborted';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'provider';
  return 'http';
}

function responseHeader(res, name) {
  return typeof res.getHeader === 'function' ? res.getHeader(name) : undefined;
}

export function observeMarketRequest(req, res, options) {
  const startedAt = Date.now();
  const incoming = String(firstHeader(req?.headers?.['x-putscanner-request-id']) || '');
  const requestId = REQUEST_ID_PATTERN.test(incoming) ? incoming : `ps-srv-${randomUUID()}`;
  const context = {
    tickerCount: safeCount(options?.tickerCount),
    expiryCount: safeCount(options?.expiryCount),
    retryCount: 0,
  };
  const abortController = new AbortController();
  let logged = false;

  const abort = () => {
    if (!res.writableEnded && !abortController.signal.aborted) {
      abortController.abort(new DOMException('Client disconnected', 'AbortError'));
    }
  };
  req?.once?.('aborted', abort);
  res?.once?.('close', abort);

  res.setHeader('X-PutScanner-Request-Id', requestId);
  const originalJson = res.json.bind(res);
  res.json = body => {
    const durationMs = Math.max(0, Date.now() - startedAt);
    const status = Number(res.statusCode) || 200;
    const failureCategory = classifyFailure(status);
    const upstreamRequests = safeCount(responseHeader(res, 'X-PutScanner-Upstream-Requests'));
    const retryCount = Math.max(context.retryCount, safeCount(responseHeader(res, 'X-PutScanner-Retry-Count')));
    const cacheStatus = String(
      responseHeader(res, 'X-PutScanner-Cache-Status')
      || responseHeader(res, 'X-Vercel-Cache')
      || responseHeader(res, 'X-PutScanner-Cache-Strategy')
      || 'none',
    );
    res.setHeader('X-PutScanner-Server-Duration-Ms', String(durationMs));
    res.setHeader('X-PutScanner-Retry-Count', String(retryCount));
    res.setHeader('X-PutScanner-Cache-Status', cacheStatus);
    res.setHeader('X-PutScanner-Failure-Category', failureCategory);
    if (!logged) {
      logged = true;
      console.info(JSON.stringify({
        event: 'market_request',
        requestId,
        endpoint: options.endpoint,
        method: req?.method || 'GET',
        tickerCount: context.tickerCount,
        expiryCount: context.expiryCount,
        cacheStatus,
        providerAttemptCount: upstreamRequests,
        retryCount,
        durationMs,
        outcome: failureCategory === 'none' ? 'success' : failureCategory === 'aborted' ? 'aborted' : 'failure',
        failureCategory,
      }));
    }
    return originalJson(body);
  };

  return {
    requestId,
    signal: abortController.signal,
    setCounts(value = {}) {
      if (value.tickerCount != null) context.tickerCount = safeCount(value.tickerCount);
      if (value.expiryCount != null) context.expiryCount = safeCount(value.expiryCount);
    },
    noteRetry(count = 1) {
      context.retryCount += safeCount(count);
    },
  };
}
