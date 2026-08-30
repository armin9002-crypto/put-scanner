import { expect, test } from '@playwright/test';
import { installDeterministicMarketApi } from './fixtures/marketApi';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('put_scanner_portfolio_trades', JSON.stringify([{
      id: 'legacy-browser-b',
      ticker: 'LEGACYB',
      optionType: 'put',
      strike: 5,
      expiration: '2027-01-01',
      contracts: 1,
      soldPrice: 1,
      soldDate: '2026-08-20',
      status: 'open',
      notes: 'LEGACY PORTFOLIO B MUST NEVER DISPLAY',
      createdAt: '2026-08-20T12:00:00.000Z',
      updatedAt: '2026-08-20T12:00:00.000Z',
    }]));
    localStorage.setItem('put_scanner_watchlist', JSON.stringify([{
      id: 'LEGACYB|put|2027-01-01|5', ticker: 'LEGACYB', expiry: '2027-01-01',
      expiryTimestamp: 1_798_761_600, expiryFormatted: "Jan 1 '27", strike: 5,
      optionType: 'put', addedAt: 1_787_200_000_000, savedAt: 1_787_200_000_000,
      note: 'LEGACY WATCHLIST B MUST NEVER DISPLAY',
    }]));
  });
  await installDeterministicMarketApi(page);
});

test('signed-out routes ignore legacy durable keys and reject a Watchlist save', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/portfolio');
  await expect(page.getByRole('heading', { name: 'Portfolio', exact: true })).toBeVisible();
  await expect(page.getByText(/No (?:open positions|sold puts added yet)/)).toBeVisible();
  await expect(page.getByText(/LEGACY PORTFOLIO B/)).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('put_scanner_portfolio_trades'))).not.toBeNull();

  await page.goto('/watchlist');
  await expect(page.getByRole('heading', { name: 'Watchlist', exact: true })).toBeVisible();
  await expect(page.getByText(/LEGACY WATCHLIST B/)).toHaveCount(0);

  await page.goto('/options/TQQQ');
  const add = page.getByRole('button', { name: 'Add to watchlist' }).first();
  await expect(add).toBeVisible();
  await add.click();
  await expect(page.getByRole('alert')).toContainText('Sign in to save account data.');
});

test('new Account fixture exposes only cloud status and stale-CAS recovery language', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/?account-ui-fixture=conflict');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText(/changed on another device/i).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reload Latest Cloud Data' })).toBeVisible();
  await expect(page.getByText(/Keep This Device|Use Account Copy|device enrolled|both changed/i)).toHaveCount(0);
});
