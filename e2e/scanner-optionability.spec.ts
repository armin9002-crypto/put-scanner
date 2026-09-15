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
