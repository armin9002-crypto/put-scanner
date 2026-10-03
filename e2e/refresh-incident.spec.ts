import { test, expect } from '@playwright/test';
import { installDeterministicMarketApi } from './fixtures/marketApi';
import { installDeterministicCloudAccount } from './fixtures/cloudAccount';
import { SCREENER_CHUNKS } from '../shared/screenerUniverse.js';

test('Scanner accepts availability observed after request start, including bounded server clock skew', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-02T15:00:00Z') });
  await installDeterministicMarketApi(page);
  await installDeterministicCloudAccount(page, { portfolio: [], watchlist: [] });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let started = false;
  await page.route('**/api/screener-expirations**', async route => {
    started = true;
    await gate;
    const fetchedAt = await page.evaluate(() => Date.now() + 500);
    await route.fulfill({ json: {
      datasetVersion: 4, fetchedAt, complete: false,
      expirationsByTicker: { TQQQ: [Date.parse('2026-11-20T00:00:00Z') / 1000], QQUP: [] },
      errors: [{ ticker: 'SOXL', message: 'Incomplete provider metadata' }],
      diagnostics: { upstreamRequests: 3, maxObservedConcurrency: 3, circuitBreakerRejections: 0 },
    } });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => started).toBe(true);
  await page.clock.fastForward(4000);
  release();
  await expect(page.locator('a[href^="/options/TQQQ"]')).toBeVisible();
  await expect(page.locator('a[href^="/options/QQUP"]')).toHaveCount(0);
  await expect(page.locator('a[href^="/options/SOXL"]')).toHaveCount(0);
});

test('explicit chart and Portfolio refresh bypass HTTP caches without fresh circuit override', async ({ page }) => {
  await page.clock.install({ time: new Date() });
  const market = await installDeterministicMarketApi(page);
  await installDeterministicCloudAccount(page, {
    portfolio: [{ id: 'refresh-probe', ticker: 'LABU', optionType: 'put', strike: 90, expiration: '2028-01-21', contracts: 1, soldPrice: 8, soldDate: '2026-01-02', status: 'open', createdAt: '2026-01-02T15:00:00Z', updatedAt: '2026-01-02T15:00:00Z' }],
    watchlist: [], preferences: { portfolioMarkBasis: 'bid', portfolioGroupMode: 'none' },
  });
  const requests: URL[] = [];
  page.on('request', request => { if (request.url().includes('/api/')) requests.push(new URL(request.url())); });
  await page.goto('/');
  const charts = page.getByLabel('Refresh market charts').first();
  await expect(charts).toBeEnabled();
  requests.length = 0;
  await charts.click();
  await expect(charts).toBeEnabled();
  const chartRequests = requests.filter(url => url.pathname === '/api/price');
  expect(chartRequests).toHaveLength(4);
  for (const url of chartRequests) {
    expect(url.searchParams.get('revalidate')).toBe('1');
    expect(url.searchParams.has('_')).toBe(true);
    expect(url.searchParams.has('fresh')).toBe(false);
  }
  await page.goto('/portfolio');
  const refresh = page.getByRole('button', { name: /Refresh open trades/i });
  await expect.poll(() => market.counts.get('options') ?? 0).toBe(1);
  await expect(refresh).toBeEnabled();
  requests.length = 0;
  await refresh.click();
  await expect(refresh).toBeEnabled();
  const acquisitions = requests.filter(url => ['/api/prices', '/api/options'].includes(url.pathname));
  expect(acquisitions).toHaveLength(2);
  for (const url of acquisitions) {
    expect(url.searchParams.get('revalidate')).toBe('1');
    expect(url.searchParams.has('_')).toBe(true);
    expect(url.searchParams.has('fresh')).toBe(false);
  }
  const freshness = page.locator('#freshness-portfolio-market-marks');
  const observed = (await freshness.innerText()).match(/Observed: (.*)/)?.[1];
  expect(observed).toBeTruthy();
  await page.clock.fastForward(61000);
  market.failuresRemaining.set('options', 1);
  await refresh.click();
  await expect(refresh).toBeEnabled();
  await expect(page.locator('body')).toContainText(/prior marks retained|stale Last fallback/);
  await expect(page.locator('body')).toContainText('refresh issues; saved data preserved');
  await expect(freshness).toContainText(`Observed: ${observed}`);
  await refresh.click();
  await expect(refresh).toBeEnabled();
  await expect(page.locator('body')).not.toContainText('refresh issues; saved data preserved');
});

test('ETF Pulse forced refresh retains failed evidence and recovers on a later success', async ({ page }) => {
  const market = await installDeterministicMarketApi(page);
  await installDeterministicCloudAccount(page, { portfolio: [], watchlist: [] });
  const initialResponse = page.waitForResponse('**/api/etf-pulse?**');
  await page.goto('/pulse');
  const initialDataset = await (await initialResponse).json();
  const mobile = (page.viewportSize()?.width ?? 1440) < 768;
  if (mobile) await page.getByRole('button', { name: 'Filters', exact: true }).click();
  const refresh = page.getByRole('button', { name: mobile ? 'Refresh data' : 'Refresh', exact: true });
  await expect(refresh).toBeEnabled({ timeout: 15000 });
  const cacheKey = await page.evaluate(() => Object.keys(localStorage).find(key => key.includes('etf_pulse_rows')));
  expect(cacheKey).toBeTruthy();
  const previous = await page.evaluate(key => JSON.parse(localStorage.getItem(key!)!), cacheKey);
  market.failuresRemaining.set('etf-pulse', 1);
  const failedRequest = page.waitForRequest('**/api/etf-pulse?**');
  await refresh.click();
  const request = await failedRequest;
  expect(new URL(request.url()).searchParams.get('fresh')).toBe('1');
  expect(new URL(request.url()).searchParams.has('_')).toBe(true);
  await expect(refresh).toBeEnabled();
  await expect(page.locator('body')).toContainText(mobile ? '84 retained' : 'Refresh failed');
  const retained = await page.evaluate(key => JSON.parse(localStorage.getItem(key!)!), cacheKey);
  expect(retained.lastSuccessfulAt).toBe(previous.lastSuccessfulAt);
  await page.route('**/api/etf-pulse?**', route => route.fulfill({ json: {
    ...initialDataset, fetchedAt: initialDataset.fetchedAt + 1000,
  } }));
  await refresh.click();
  await expect(refresh).toBeEnabled();
  await expect(page.getByText(/Refresh failed/)).toHaveCount(0);
  const recovered = await page.evaluate(key => JSON.parse(localStorage.getItem(key!)!), cacheKey);
  expect(recovered.lastSuccessfulAt).toBeGreaterThan(previous.lastSuccessfulAt);
});

test('Watchlist refresh and Recommendations acquisition remain bounded', async ({ page }) => {
  const market = await installDeterministicMarketApi(page);
  const expiry = '2028-01-21';
  await installDeterministicCloudAccount(page, { portfolio: [], watchlist: [{
    id: `LABU|put|${expiry}|90`, ticker: 'LABU', expiry,
    expiryTimestamp: Date.parse(`${expiry}T00:00:00Z`) / 1000,
    expiryFormatted: expiry, strike: 90, optionType: 'put', addedAt: 1, savedAt: 1, note: '',
  }] });
  await page.goto('/watchlist');
  const refresh = page.getByRole('button', { name: /Refresh All|Refresh watchlist/ });
  await expect.poll(() => market.counts.get('options') ?? 0).toBe(1);
  await expect(refresh).toBeEnabled();
  const before = { options: market.counts.get('options') ?? 0, prices: market.counts.get('prices') ?? 0 };
  await refresh.click();
  await expect(refresh).toBeEnabled();
  expect(market.counts.get('options')).toBe(before.options + 1);
  expect(market.counts.get('prices')).toBe(before.prices + 1);
  await page.goto('/recommendations');
  const recommend = page.getByRole('button', { name: 'Refresh Recommendations', exact: true });
  await recommend.click();
  await expect(recommend).toBeEnabled({ timeout: 30000 });
  expect(market.counts.get('etf-pulse')).toBe(1);
  expect(market.counts.get('screener-batch') ?? 0).toBeGreaterThan(0);
  expect(market.counts.get('screener-batch') ?? 0).toBeLessThanOrEqual(SCREENER_CHUNKS.length);
  await expect(page.locator('.recommendations-attempt-notice--error')).toHaveCount(0);
});
