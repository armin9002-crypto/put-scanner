import { expect, test } from '@playwright/test';
import { installDeterministicCloudAccount } from './fixtures/cloudAccount';
import { installDeterministicMarketApi } from './fixtures/marketApi';

const projects = new Set(['desktop-1440x900', 'portrait-390x844']);
const expiry = '2027-01-01';
const watchlist = [{
  id: `UPRO|put|${expiry}|107`, ticker: 'UPRO', optionType: 'put', strike: 107,
  expiration: expiry, expiry, expiryTimestamp: 1_798_761_600, expiryFormatted: "Jan 1 '27",
  addedAt: 1_788_000_000_000, savedAt: 1_788_000_000_000, note: '',
}];

test.describe('UI density cleanup', () => {
  test.beforeEach(async ({ page }, info) => {
    test.skip(!projects.has(info.project.name), 'requested representative viewports only');
    await installDeterministicMarketApi(page, { optionCount: 28 });
    await installDeterministicCloudAccount(page, { portfolio: [], watchlist, preferences: {} });
  });

  test('option chain uses compact neutral rows and keeps dates and badges', async ({ page }, info) => {
    await page.goto('/options/UPRO');
    await expect(page.getByText('UPRO', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
    if (info.project.name === 'desktop-1440x900') {
      const row = page.locator('.option-desktop-chain tbody tr').filter({ hasText: '107.00' }).first();
      await expect(row).toBeVisible();
      await expect(row).toContainText('08/29/26');
      await expect(row.getByText('ITM', { exact: true })).toBeVisible();
      await expect(row).not.toContainText('Calculated');
      const box = await row.boundingBox();
      expect(box?.height ?? 99).toBeLessThanOrEqual(34);
      expect(await row.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
      await page.screenshot({ path: 'e2e-artifacts/ui-density-option-chain-desktop.png', fullPage: false });
    } else {
      const row = page.locator('.mobile-financial-table-row').filter({ hasText: '107.00' }).first();
      await expect(row).toBeVisible();
      await expect(row).toContainText('08/29/26');
      await expect(row).not.toContainText('Calculated');
      await page.screenshot({ path: 'e2e-artifacts/ui-density-option-chain-phone.png', fullPage: false });
    }
  });

  test('watchlist shows one line for date, delta, and state', async ({ page }, info) => {
    await page.goto('/watchlist');
    await expect(page.getByRole('heading', { name: 'Watchlist', exact: true })).toBeVisible();
    if (info.project.name === 'desktop-1440x900') {
      const row = page.locator('table tbody tr').filter({ hasText: '107.00' }).first();
      await expect(row).toBeVisible({ timeout: 20_000 });
      await expect(row).not.toContainText('Calculated');
      await expect(row).not.toContainText('sessions ago');
      await page.screenshot({ path: 'e2e-artifacts/ui-density-watchlist-desktop.png', fullPage: false });
    } else {
      await expect(page.locator('.mobile-financial-table')).toBeVisible({ timeout: 20_000 });
    }
  });
});
