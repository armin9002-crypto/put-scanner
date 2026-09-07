import { test, expect } from '@playwright/test';
import { installDeterministicMarketApi } from './fixtures/marketApi';
import { installDeterministicCloudAccount } from './fixtures/cloudAccount';

const expiry = '2028-01-21';
const watched = (ticker: string, strike: number, date = expiry) => ({ id: `${ticker}|put|${date}|${strike}`, ticker, expiry: date, expiryTimestamp: Date.parse(`${date}T00:00:00Z`) / 1000, expiryFormatted: date, strike, optionType: 'put', addedAt: 1, savedAt: 1, note: '' });

test('refresh diagnostics, flat Watchlist, and Portfolio Last fallback responsive QA', async ({ page }, info) => {
  const api = await installDeterministicMarketApi(page, { firstOptionBid: 8, firstOptionAsk: 3, firstOptionLast: 5 });
  const cloud = await installDeterministicCloudAccount(page, {
    portfolio: [{ id: 'leap', ticker: 'LABU', optionType: 'put', strike: 90, expiration: expiry, contracts: 2, soldPrice: 8, soldDate: '2026-01-02', status: 'open', createdAt: '2026-01-02T15:00:00Z', updatedAt: '2026-01-02T15:00:00Z' }],
    watchlist: [watched('LABU', 90), watched('SPY', 95), watched('LABU', 95), watched('SPY', 95, '2024-01-19')],
    preferences: { portfolioMarkBasis: 'bid', portfolioGroupMode: 'none' },
  });
  await page.goto('/portfolio');
  await page.getByRole('button', { name: /Refresh open trades/i }).click();
  const details = page.locator('details').filter({ hasText: /current quotes/ });
  await expect(details.locator('summary')).toContainText('1 stale Last fallback');
  await details.locator('summary').click();
  await expect(details).toContainText('Stale Last fallback $5.00');
  await expect(details).toContainText('integrity-rejected quote');
  await expect(page.getByText('Refresh failed', { exact: true })).toHaveCount(0);
  await expect(page.locator('body')).toContainText('$600');
  await page.screenshot({ path: info.outputPath('portfolio-last-fallback.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);

  await page.goto('/watchlist');
  await expect(page.getByText(/^3 saved(?: contracts)?$/)).toBeVisible();
  await page.getByLabel('Group by', { exact: false }).selectOption('none');
  await expect(page.locator('.watchlist-group-header')).toHaveCount(0);
  const before = api.counts.get('options') ?? 0;
  const mobileSort = page.getByLabel('Sort watchlist', { exact: true });
  if (await mobileSort.isVisible()) {
    await mobileSort.selectOption('strike');
    await page.getByRole('button', { name: 'Sort descending', exact: true }).click();
  } else {
    await page.getByRole('columnheader', { name: 'Strike', exact: true }).click();
    await page.getByRole('columnheader', { name: 'Strike', exact: true }).click();
  }
  expect(api.counts.get('options') ?? 0).toBe(before);
  await expect.poll(() => (cloud.rows.find(row => row.namespace === 'watchlist')!.payload.data as unknown[]).length).toBe(3);
  await page.screenshot({ path: info.outputPath('watchlist-none.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);

  await page.goto('/');
  await page.getByPlaceholder(/Filter \/ Search by Ticker/i).fill('LABU');
  api.delays.set('options', 700);
  api.failuresRemaining.set('options', 5);
  const filters = page.getByRole('button', { name: /^Filters/ });
  if (await filters.isVisible()) await filters.click();
  await page.getByRole('button', { name: 'Update liquidity', exact: true }).click();
  await expect(page.getByRole('button', { name: /Updating .*needing refresh/ })).toBeVisible();
  await page.getByRole('button', { name: /1 issue/ }).click();
  await expect(page.getByRole('dialog', { name: 'Liquidity refresh details' })).toContainText('LABU');
  await expect(page.getByRole('dialog', { name: 'Liquidity refresh details' })).toContainText('failed');
  await page.screenshot({ path: info.outputPath('scanner-touch-details.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.getByRole('button', { name: 'Close Liquidity refresh details', exact: true }).last().click();
  if (page.viewportSize()?.width === 390) {
    await page.evaluate(() => localStorage.setItem('put_scanner_text_size', 'large'));
    await page.goto('/portfolio');
    api.failuresRemaining.set('options', 0);
    api.delays.set('options', 0);
    await page.getByRole('button', { name: /Refresh open trades/i }).click();
    await expect(details.locator('summary')).toContainText('1 stale Last fallback');
    await details.locator('summary').click();
    await page.screenshot({ path: info.outputPath('portfolio-last-fallback-large.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
});
