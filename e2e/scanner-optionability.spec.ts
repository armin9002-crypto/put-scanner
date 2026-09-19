import { expect, test, type Page } from '@playwright/test';
import { installDeterministicMarketApi } from './fixtures/marketApi';
import { installDeterministicCloudAccount } from './fixtures/cloudAccount';

const NOW = new Date('2026-09-14T17:00:00Z');
const FUTURE = Date.parse('2026-11-20T00:00:00Z') / 1000;
const OTHER = Date.parse('2026-10-23T00:00:00Z') / 1000;
const opportunityLinks = (page: Page) => page.locator('a[href^="/options/"]');

async function setup(page: Page, delayDiscovery = false) {
  await page.clock.install({ time: NOW });
  const market = await installDeterministicMarketApi(page);
  await installDeterministicCloudAccount(page, { portfolio: [], watchlist: [], preferences: {} });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let qqUpPositive = false;
  await page.route('**/api/screener-expirations**', async route => {
    if (delayDiscovery) await gate;
    await route.fulfill({ json: {
      datasetVersion: 4, fetchedAt: NOW.getTime(), complete: false,
      expirationsByTicker: { TQQQ: [FUTURE], UPRO: [OTHER], ...(qqUpPositive ? { QQUP: [FUTURE] } : { QQUP: [] }) },
      errors: [{ ticker: 'SOXL', message: 'fixture incomplete response' }],
      diagnostics: { upstreamRequests: 84, maxObservedConcurrency: 3, circuitBreakerRejections: 0 },
    } });
  });
  return { market, release, makePositive: () => { qqUpPositive = true; } };
}

test('cold load hides unconfirmed cards; all and exact scopes show confirmed membership; positive refresh reappears', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const fixture = await setup(page, true);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByPlaceholder('Filter / Search by Ticker')).toBeVisible();
  await expect(opportunityLinks(page)).toHaveCount(0);
  fixture.release();
  await expect(page.locator('a[href^="/options/TQQQ"]')).toBeVisible();
  await expect(page.locator('a[href^="/options/UPRO"]')).toBeVisible();
  await expect(page.locator('a[href^="/options/QQUP"]')).toHaveCount(0);
  await expect(page.locator('a[href^="/options/SOXL"]')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('confirmed-all.png'), animations: 'disabled' });
  const select = page.locator('select[aria-label="Scanner expiration"], .scanner-control-plane__expiration select').filter({ visible: true });
  await select.selectOption(`date_${OTHER}`);
  await expect(page.locator('a[href^="/options/UPRO"]')).toBeVisible();
  await expect(page.locator('a[href^="/options/TQQQ"]')).toHaveCount(0);
  await expect(page.locator('a[href^="/options/QQUP"]')).toHaveCount(0);
  expect(fixture.market.counts.get('options') ?? 0).toBe(0);
  await select.selectOption('all');
  fixture.makePositive();
  await page.evaluate(() => sessionStorage.removeItem('screener_expirations_v4'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('a[href^="/options/QQUP"]')).toBeVisible();
  const requestsBeforeExpiry = fixture.market.counts.get('options') ?? 0;
  await page.clock.fastForward(8 * 60 * 60 * 1000 + 1000);
  await expect(opportunityLinks(page)).toHaveCount(0);
  expect(fixture.market.counts.get('options') ?? 0).toBe(requestsBeforeExpiry);
  expect(errors).toEqual([]);
});

test('explicit manual ticker investigation still navigates when ticker has no confirmed options', async ({ page }) => {
  await setup(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('a[href^="/options/TQQQ"]')).toBeVisible();
  await page.getByPlaceholder('Filter / Search by Ticker').fill('QQUP');
  await expect(page.locator('a[href^="/options/QQUP"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Go to Option Chain', exact: true }).click();
  await expect(page).toHaveURL(/\/options\/QQUP/);
});

test('continuously open Scanner reacquires once at the next regular session and stays quiet after focus rerenders', async ({ page }) => {
  const friday = new Date('2026-09-18T20:00:00Z');
  const saturday = new Date('2026-09-19T18:00:00Z');
  const sunday = new Date('2026-09-20T18:00:00Z');
  const mondayPreOpen = new Date('2026-09-21T13:00:00Z');
  const mondayOpen = new Date('2026-09-21T13:30:00Z');
  const future = Date.parse('2026-11-20T00:00:00Z') / 1000;
  let expirationRequests = 0;

  await page.clock.install({ time: friday });
  await installDeterministicMarketApi(page);
  await installDeterministicCloudAccount(page, { portfolio: [], watchlist: [], preferences: {} });
  await page.route('**/api/screener-expirations**', async route => {
    expirationRequests += 1;
    const mondayRefresh = expirationRequests > 1;
    await route.fulfill({ json: {
      datasetVersion: 4,
      fetchedAt: (mondayRefresh ? mondayOpen : friday).getTime(),
      complete: false,
      expirationsByTicker: mondayRefresh ? { TQQQ: [], UPRO: [future] } : { TQQQ: [future] },
      errors: [],
      diagnostics: { upstreamRequests: 2, maxObservedConcurrency: 1, circuitBreakerRejections: 0 },
    } });
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('a[href^="/options/TQQQ"]')).toBeVisible();
  expect(expirationRequests).toBe(1);

  await page.clock.fastForward(saturday.getTime() - friday.getTime());
  await page.clock.fastForward(sunday.getTime() - saturday.getTime());
  await page.clock.fastForward(mondayPreOpen.getTime() - sunday.getTime());
  expect(expirationRequests).toBe(1);

  await page.clock.fastForward(mondayOpen.getTime() - mondayPreOpen.getTime());
  await expect.poll(() => expirationRequests).toBe(2);
  await expect(page.locator('a[href^="/options/TQQQ"]')).toHaveCount(0);
  await expect(page.locator('a[href^="/options/UPRO"]')).toBeVisible();

  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByPlaceholder('Filter / Search by Ticker').fill('UPRO');
  await page.getByPlaceholder('Filter / Search by Ticker').fill('');
  await page.clock.fastForward(1000);
  expect(expirationRequests).toBe(2);
});

test('continuously open Scanner retains Friday positive evidence when Monday revalidation fails', async ({ page }) => {
  const friday = new Date('2026-09-18T20:00:00Z');
  const mondayPreOpen = new Date('2026-09-21T13:00:00Z');
  const mondayOpen = new Date('2026-09-21T13:30:00Z');
  const future = Date.parse('2026-11-20T00:00:00Z') / 1000;
  let expirationRequests = 0;

  await page.clock.install({ time: friday });
  await installDeterministicMarketApi(page);
  await installDeterministicCloudAccount(page, { portfolio: [], watchlist: [], preferences: {} });
  await page.route('**/api/screener-expirations**', async route => {
    expirationRequests += 1;
    if (expirationRequests > 1) {
      await route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'temporary outage' }) });
      return;
    }
    await route.fulfill({ json: {
      datasetVersion: 4,
      fetchedAt: friday.getTime(),
      complete: false,
      expirationsByTicker: { TQQQ: [future], QQUP: [] },
      errors: [],
      diagnostics: { upstreamRequests: 2, maxObservedConcurrency: 1, circuitBreakerRejections: 0 },
    } });
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('a[href^="/options/TQQQ"]')).toBeVisible();
  expect(expirationRequests).toBe(1);
  await page.clock.fastForward(mondayPreOpen.getTime() - friday.getTime());
  expect(expirationRequests).toBe(1);
  await page.clock.fastForward(mondayOpen.getTime() - mondayPreOpen.getTime());
  await expect.poll(() => expirationRequests).toBe(2);
  await expect(page.locator('a[href^="/options/TQQQ"]')).toBeVisible();
  await expect(page.getByText(/1 confirmed .*incomplete/).first()).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.clock.fastForward(1000);
  expect(expirationRequests).toBe(2);
});
