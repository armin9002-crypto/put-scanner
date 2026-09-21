import { expect, test } from '@playwright/test';
import { installDeterministicCloudAccount } from './fixtures/cloudAccount';
import { installDeterministicMarketApi } from './fixtures/marketApi';

const projects = new Set(['desktop-1440x900', 'portrait-390x844']);
const expiry = '2027-01-01';
const watchlist = [{
  id: `UPRO|put|${expiry}|90`,
  ticker: 'UPRO',
  optionType: 'put' as const,
  strike: 90,
  expiration: expiry,
  expiry,
  expiryTimestamp: 1_798_761_600,
  expiryFormatted: "Jan 1 '27",
  addedAt: 1_788_000_000_000,
  savedAt: 1_788_000_000_000,
  note: 'export QA',
}];

test('Watchlist Excel export downloads without refreshes or durable mutations', async ({ page }, info) => {
  test.skip(!projects.has(info.project.name), 'representative desktop and portrait-phone coverage only');
  const market = await installDeterministicMarketApi(page);
  const cloud = await installDeterministicCloudAccount(page, { portfolio: [], watchlist, preferences: {} });

  await page.goto('/watchlist');
  const desktopHeading = page.getByRole('heading', { name: 'Watchlist', exact: true });
  const phoneCount = page.getByText(/saved contracts/i).first();
  await expect.poll(async () => (await desktopHeading.isVisible()) || (await phoneCount.isVisible()), { timeout: 20_000 }).toBe(true);
  await expect(page.getByRole('button', { name: /Refresh watchlist|Refresh All/i }).first()).not.toBeDisabled({ timeout: 20_000 });

  const marketBefore = Object.fromEntries(market.counts);
  const cloudBefore = JSON.stringify(cloud.rows);
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('watchlist-export-excel').click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/^put-scanner-watchlist-\d{4}-\d{2}-\d{2}\.xlsx$/);
  expect(Object.fromEntries(market.counts)).toEqual(marketBefore);
  expect(JSON.stringify(cloud.rows)).toBe(cloudBefore);
  await expect(page.getByTestId('watchlist-export-excel')).not.toHaveAttribute('aria-busy', 'true');
  expect(await page.evaluate(() => ({
    portfolio: localStorage.getItem('put_scanner_portfolio_trades'),
    watchlist: localStorage.getItem('put_scanner_watchlist'),
  }))).toEqual({ portfolio: null, watchlist: null });
});
