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

function setResponseHeader(res, name, value) {
  try {
    res.setHeader(name, value);
  } catch {
    // A disconnected client cannot receive headers, but the request summary is still useful.
  }
}

export function observeMarketRequest(req, res, options) {
  const startedAt = Date.now();
  const incoming = String(firstHeader(req?.headers?.['x-putscanner-request-id']) || '');
  const requestId = REQUEST_ID_PATTERN.test(incoming) ? incoming : `ps-srv-${randomUUID()}`;
  const context = {
    symbolCount: safeCount(options?.symbolCount ?? options?.tickerCount),
    expiryCount: safeCount(options?.expiryCount),
    retryCount: 0,
  };
  const abortController = new AbortController();
  let logged = false;

  const finish = statusOverride => {
    if (logged) return;
    logged = true;
    const durationMs = Math.max(0, Date.now() - startedAt);
    const status = Number(statusOverride ?? res.statusCode) || 200;
    const failureCategory = classifyFailure(status);
    const providerAttemptCount = safeCount(responseHeader(res, 'X-PutScanner-Upstream-Requests'));
    const retryCount = Math.max(context.retryCount, safeCount(responseHeader(res, 'X-PutScanner-Retry-Count')));
    const cacheStatus = String(
      responseHeader(res, 'X-PutScanner-Cache-Status')
      || responseHeader(res, 'X-Vercel-Cache')
      || responseHeader(res, 'X-PutScanner-Cache-Strategy')
      || 'none',
    );
    setResponseHeader(res, 'X-PutScanner-Server-Duration-Ms', String(durationMs));
    setResponseHeader(res, 'X-PutScanner-Provider-Attempts', String(providerAttemptCount));
    setResponseHeader(res, 'X-PutScanner-Retry-Count', String(retryCount));
    setResponseHeader(res, 'X-PutScanner-Cache-Status', cacheStatus);
    setResponseHeader(res, 'X-PutScanner-Failure-Category', failureCategory);
    console.info(JSON.stringify({
      event: 'market_request',
      requestId,
      endpoint: options.endpoint,
      operation: options.operation ?? options.endpoint,
      method: req?.method || 'GET',
      symbolCount: context.symbolCount,
      expiryCount: context.expiryCount,
      cacheStatus,
      providerAttemptCount,
      retryCount,
      durationMs,
      status,
      outcome: failureCategory === 'none' ? 'success' : failureCategory === 'aborted' ? 'aborted' : 'failure',
      failureCategory,
    }));
  };

  const abort = () => {
    if (!res.writableEnded && !abortController.signal.aborted) {
      abortController.abort(new DOMException('Client disconnected', 'AbortError'));
      finish(499);
    }
  };
  req?.once?.('aborted', abort);
  res?.once?.('close', abort);

  setResponseHeader(res, 'X-PutScanner-Request-Id', requestId);
  const originalJson = res.json.bind(res);
  res.json = body => {
    finish();
    return originalJson(body);
  };

  return {
    requestId,
    signal: abortController.signal,
    setCounts(value = {}) {
      if (value.symbolCount != null || value.tickerCount != null) {
        context.symbolCount = safeCount(value.symbolCount ?? value.tickerCount);
      }
      if (value.expiryCount != null) context.expiryCount = safeCount(value.expiryCount);
    },
    noteRetry(count = 1) {
      context.retryCount += safeCount(count);
    },
  };
}
