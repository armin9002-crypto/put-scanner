import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { installDeterministicCloudAccount } from './fixtures/cloudAccount';
import { installDeterministicMarketApi } from './fixtures/marketApi';
import { portfolio, watchlist } from './fixtures/textSizeAccount';

type PerformanceWindow = Window & { __longTasks: Array<{ start: number; duration: number }> };

// Opt-in production-build measurements, never a CI millisecond threshold.
const label = process.env.PERF_LABEL || 'baseline';
const routes = [
  ['portfolio', '/portfolio', 'Schedule of Positions'],
  ['options', '/options/TQQQ', 'Put Options'],
  ['watchlist', '/watchlist', 'Watchlist'],
  ['screener', '/screener', 'Screener'],
  ['pulse', '/pulse', 'ETF Pulse'],
  ['recommendations', '/recommendations', 'Recommendations'],
] as const;

for (const [name, path, heading] of routes) test(`${name} first navigation`, async ({ page, context }, testInfo) => {
  test.skip(!process.env.PERF_LABEL, 'Opt-in production benchmark; use playwright.performance.config.ts');
  const run = `${label}-${testInfo.repeatEachIndex}`;
  const now = new Date();
  const market = await installDeterministicMarketApi(page, { optionCount: name === 'screener' ? 8 : 80, expirationFetchedAt: now.getTime() });
  const history = Array.from({ length: 200 }, (_, i) => ({
    id: `perf-closed-${i}`, ticker: ['SPY', 'QQQ', 'TQQQ'][i % 3], optionType: 'put',
    strike: 90 + i / 10, expiration: '2026-08-21', contracts: 1, soldPrice: 2,
    soldDate: '2026-01-02', status: 'closed', closePrice: 1, closeDate: '2026-08-20',
    createdAt: '2026-01-02T12:00:00.000Z', updatedAt: '2026-08-20T12:00:00.000Z',
  }));
  const open = Array.from({ length: 40 }, (_, i) => ({ ...portfolio[i % 4], id: `perf-open-${i}`, strike: 90 + i, expiration: '2027-01-01' }));
  const saved = Array.from({ length: 80 }, (_, i) => ({ ...watchlist[0], id: `TQQQ|put|2027-01-01|${90 + i}`, strike: 90 + i }));
  await installDeterministicCloudAccount(page, { portfolio: [...open, ...portfolio.slice(4), ...history], watchlist: saved });
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    (window as unknown as PerformanceWindow).__longTasks = [];
    new PerformanceObserver(list => (window as unknown as PerformanceWindow).__longTasks.push(...list.getEntries().map(e => ({ start: e.startTime, duration: e.duration })))).observe({ type: 'longtask', buffered: true });
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 60, downloadThroughput: 1_500_000, uploadThroughput: 750_000 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Scanner', exact: true })).toBeVisible();
  await page.waitForTimeout(800);
  if (name === 'options') await page.getByRole('textbox', { name: 'Ticker symbol' }).fill('TQQQ');
  const initialAssets = await page.evaluate(() => performance.getEntriesByType('resource').map(e => e.name).filter(n => /\/assets\//.test(n)));
  expect(initialAssets.some(url => /\/(xlsx|PortfolioPage|OptionsPage|WatchlistPage|ScreenerPage|EtfPulsePage|RecommendationsPage)-/.test(url))).toBe(false);
  const before = Object.fromEntries(market.counts);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.start');
  const start = await page.evaluate(() => performance.now());
  const trigger = name === 'options' ? page.getByRole('button', { name: 'Go to Option Chain' }) : page.locator(`a[href="${path}"]`).first();
  await trigger.evaluate((el: HTMLElement) => el.click());
  if (name === 'portfolio') await expect(page.getByText(heading, { exact: true }).first()).toBeVisible();
  else if (name === 'options') await expect(page.locator('table').first()).toBeVisible();
  else await expect(page.getByRole('heading', { name: heading, exact: true }).first()).toBeVisible();
  const mount = await page.evaluate(() => new Promise<number>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now())))));
  await page.waitForTimeout(1500);
  if (name === 'screener') {
    await page.getByRole('combobox', { name: 'Expiration', exact: true }).selectOption('all');
    await page.getByRole('checkbox', { name: /Recent Trades Only/ }).uncheck();
    await page.getByRole('button', { name: /Load|Run Screener/i }).first().click();
    await page.getByRole('button', { name: /^(Confirm|Run scan)$/ }).click();
    await expect(page.getByText(/(?:contracts loaded|\d+ loaded)/i).first()).toBeVisible({ timeout: 120_000 });
    await expect(page.locator('tbody tr').nth(10)).toBeVisible();
  }
  if (name === 'portfolio') {
    await page.getByRole('button', { name: 'Expand Portfolio Analytics', exact: true }).click();
    await page.getByRole('button', { name: 'Collapse Portfolio Analytics', exact: true }).click();
    const expandHistory = page.getByRole('button', { name: 'Expand All', exact: true });
    if (await expandHistory.count()) await expandHistory.click();
  }
  const profile = await cdp.send('Profiler.stop');
  const measurements = await page.evaluate(() => ({
    assets: performance.getEntriesByType('resource').filter(e => /\/assets\//.test(e.name)).map(e => ({ name: e.name.split('/').pop(), start: e.startTime, duration: e.duration })),
    longTasks: (window as unknown as PerformanceWindow).__longTasks,
    rows: document.querySelectorAll('tbody tr').length,
  }));
  await mkdir('e2e-artifacts/performance', { recursive: true });
  await writeFile(`e2e-artifacts/performance/${run}-${name}.json`, JSON.stringify({ mountMs: mount - start, navigationStart: start, initialAssets, before, after: Object.fromEntries(market.counts), ...measurements }, null, 2));
  await writeFile(`e2e-artifacts/performance/${run}-${name}.cpuprofile`, JSON.stringify(profile.profile));
  await page.screenshot({ path: `e2e-artifacts/performance/${run}-${name}.png` });
  console.log(JSON.stringify({ name, mountMs: mount - start, rows: measurements.rows, requests: Object.fromEntries(market.counts) }));
  expect(errors).toEqual([]);
});

test('mobile route visual sanity', async ({ page }) => {
  test.skip(!process.env.PERF_LABEL, 'Opt-in production browser verification');
  await page.setViewportSize({ width: 390, height: 844 });
  await installDeterministicMarketApi(page, { optionCount: 80, expirationFetchedAt: Date.now() });
  await installDeterministicCloudAccount(page, { portfolio, watchlist });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const path of ['/', ...routes.map(([, path]) => path)]) {
    await page.goto(path);
    await expect(page.locator('main')).toBeVisible();
    if (path === '/options/TQQQ') await expect(page.locator('.mobile-financial-table tbody tr').first()).toBeVisible();
    else await expect(page.getByRole('heading').first()).toBeVisible();
    await expect(page.getByText('Loading...', { exact: true })).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: `e2e-artifacts/performance/${label}-mobile-${path.replaceAll('/', '-') || 'scanner'}.png` });
    if (path === '/portfolio') {
      await page.getByRole('button', { name: /History/ }).first().click();
      await page.getByTestId('rolling-historical-analytics').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `e2e-artifacts/performance/${label}-mobile-history.png` });
    }
  }
  expect(errors).toEqual([]);
});
