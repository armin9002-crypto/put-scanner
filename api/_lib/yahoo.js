export const YAHOO_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const SESSION_TTL_MS = 10 * 60 * 1000;
const CIRCUIT_COOLDOWN_MS = 45 * 1000;
const FAILURE_THRESHOLD = 3;
let sessionCache = null;
let sessionInFlight = null;
const healthByEndpoint = new Map();

export function normalizeFiniteNumber(value) {
  if (value == null || value === '') return null;
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function normalizeNonNegativeNumber(value) {
  const numeric = normalizeFiniteNumber(value);
  return numeric != null && numeric >= 0 ? numeric : null;
}

export function normalizePositiveNumber(value) {
  const numeric = normalizeFiniteNumber(value);
  return numeric != null && numeric > 0 ? numeric : null;
}

export function normalizeTimestampSeconds(value) {
  const numeric = normalizeFiniteNumber(value);
  if (numeric == null || numeric <= 0) return null;
  return Math.round(numeric > 10_000_000_000 ? numeric / 1000 : numeric);
}

// Provider event timestamps are advisory: reject malformed, pre-2000, or implausibly future values.
export function normalizeProviderTimestampSeconds(value, nowMs = Date.now()) {
  const numeric = normalizeFiniteNumber(value);
  if (numeric == null || numeric <= 0) return null;
  const seconds = numeric > 10_000_000_000 ? numeric / 1000 : numeric;
  const timestampMs = Math.round(seconds * 1000);
  if (!Number.isFinite(timestampMs) || timestampMs < Date.UTC(2000, 0, 1) || timestampMs > nowMs + 5 * 60 * 1000) return null;
  return Math.round(timestampMs / 1000);
}

function healthFor(endpoint) {
  const health = healthByEndpoint.get(endpoint) ?? { consecutiveFailures: 0, lastFailureAt: null, circuitOpenUntil: null };
  healthByEndpoint.set(endpoint, health);
  return health;
}

function noteSuccess(endpoint) {
  healthByEndpoint.set(endpoint, { consecutiveFailures: 0, lastFailureAt: null, circuitOpenUntil: null });
}

export function noteYahooFailure(endpoint) {
  const now = Date.now();
  const health = healthFor(endpoint);
  health.consecutiveFailures += 1;
  health.lastFailureAt = now;
  if (health.consecutiveFailures >= FAILURE_THRESHOLD) health.circuitOpenUntil = now + CIRCUIT_COOLDOWN_MS;
}

export function getYahooProviderHealth() {
  return Object.fromEntries([...healthByEndpoint.entries()].map(([key, value]) => [key, { ...value }]));
}

export async function readYahooJson(response, endpoint) {
  try {
    const data = await response.json();
    if (!data || typeof data !== 'object') throw new Error('Yahoo returned a non-object payload');
    return data;
  } catch (error) {
    noteYahooFailure(endpoint);
    throw error;
  }
}

export async function yahooFetch(url, options = {}) {
  const endpoint = options.endpoint ?? 'yahoo';
  const health = healthFor(endpoint);
  if (!options.overrideCircuit && health.circuitOpenUntil != null && health.circuitOpenUntil > Date.now()) {
    const error = new Error(`Yahoo ${endpoint} circuit is cooling down`);
    error.code = 'YAHOO_CIRCUIT_OPEN';
    throw error;
  }

  options.onAttempt?.({ endpoint, url });

  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) abortFromCaller();
  else options.signal?.addEventListener('abort', abortFromCaller, { once: true });
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
  try {
    const response = await fetch(url, {
      ...options.fetchOptions,
      signal: controller.signal,
      headers: {
        'User-Agent': YAHOO_USER_AGENT,
        Accept: 'application/json',
        ...options.fetchOptions?.headers,
      },
    });
    if (response.status === 429 || response.status >= 500) noteYahooFailure(endpoint);
    else if (response.ok) noteSuccess(endpoint);
    return response;
  } catch (error) {
    noteYahooFailure(endpoint);
    throw error;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abortFromCaller);
  }
}

export function invalidateYahooSession() {
  sessionCache = null;
  sessionInFlight = null;
}

function extractCookies(response) {
  const raw = response.headers.get('set-cookie') || '';
  return raw.split(',').map(cookie => cookie.split(';')[0]).filter(Boolean).join('; ');
}

async function acquireYahooSession(ticker, force = false, options = {}) {
  if (!force && sessionCache && Date.now() - sessionCache.obtainedAt < SESSION_TTL_MS) return sessionCache;
  const pageResponse = await yahooFetch(`https://finance.yahoo.com/quote/${encodeURIComponent(ticker)}/options/`, {
    endpoint: 'session',
    overrideCircuit: force,
    onAttempt: options.onAttempt,
    timeoutMs: options.timeoutMs,
    signal: options.signal,
    fetchOptions: {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      redirect: 'follow',
    },
  });
  if (!pageResponse.ok) throw new Error(`Yahoo quote page failed (${pageResponse.status})`);
  const cookie = extractCookies(pageResponse);
  const html = await pageResponse.text();
  const crumbMatch = html.match(/"crumb":"([^"\\]+)"/);
  let crumb = crumbMatch ? crumbMatch[1].replace(/\\u002F/g, '/') : '';
  if (!crumb) {
    const crumbResponse = await yahooFetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
      endpoint: 'session',
      overrideCircuit: force,
      onAttempt: options.onAttempt,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      fetchOptions: { headers: { Cookie: cookie } },
    });
    if (crumbResponse.ok) crumb = (await crumbResponse.text()).trim();
  }
  if (!crumb) {
    noteYahooFailure('session');
    throw new Error('Yahoo session crumb was unavailable');
  }
  sessionCache = { cookie, crumb, obtainedAt: Date.now() };
  return sessionCache;
}

export async function getYahooSession(ticker, force = false, options = {}) {
  if (!force && sessionCache && Date.now() - sessionCache.obtainedAt < SESSION_TTL_MS) return sessionCache;
  if (!force && sessionInFlight) return sessionInFlight;
  const request = acquireYahooSession(ticker, force, options);
  if (!force) sessionInFlight = request;
  try {
    return await request;
  } finally {
    if (!force && sessionInFlight === request) sessionInFlight = null;
  }
}

export async function fetchYahooOptions(ticker, date = null, options = {}) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const session = await getYahooSession(ticker, attempt > 0, { onAttempt: options.onAttempt, timeoutMs: options.timeoutMs, signal: options.signal });
    let url = `https://query2.finance.yahoo.com/v7/finance/options/${encodeURIComponent(ticker)}?crumb=${encodeURIComponent(session.crumb)}`;
    if (date) url += `&date=${date}`;
    if (options.fresh) url += `&_=${Date.now()}`;
    const response = await yahooFetch(url, {
      endpoint: 'options',
      overrideCircuit: options.fresh === true && attempt === 0,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      onAttempt: options.onAttempt,
      fetchOptions: { headers: { Cookie: session.cookie } },
    });
    if ((response.status === 401 || response.status === 403) && attempt === 0) {
      invalidateYahooSession();
      options.onRetry?.();
      continue;
    }
    if (!response.ok) {
      const error = new Error(`Yahoo options request failed (${response.status})`);
      error.status = response.status;
      throw error;
    }
    const data = await readYahooJson(response, 'options');
    if (!data || typeof data !== 'object' || !data.optionChain) {
      noteYahooFailure('options');
      throw new Error('Malformed Yahoo options response');
    }
    return data;
  }
  throw new Error('Yahoo options session retry failed');
}
