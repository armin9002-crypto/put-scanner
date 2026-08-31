import { expect, test } from '@playwright/test';
import { installDeterministicCloudAccount } from './fixtures/cloudAccount';

const enabled = process.env.UI_OVERHAUL_CAPTURE === 'after';

const ownerExampleTrade = {
  id: 'canonical-yield-owner-example',
  ticker: 'YIELD',
  optionType: 'put',
  strike: 30,
  expiration: '2026-08-30',
  contracts: 1,
  soldPrice: 0.73326,
  soldDate: '2026-07-31',
  status: 'expired',
  expirationClosePrice: 35,
  expirationCloseDate: '2026-08-30',
  finalOptionValue: 0,
  realizedPnl: 73.326,
  percentCaptured: 1,
  resolutionType: 'expired_worthless',
  resolvedDate: '2026-08-30',
  createdAt: '2026-07-31T12:00:00.000Z',
  updatedAt: '2026-08-30T12:00:00.000Z',
};

test('renders canonical History NY and Realized IRR for the owner example', async ({ page }, testInfo) => {
  test.skip(!enabled || testInfo.project.name !== 'desktop-1440x900', 'one deterministic canonical-yield display check');
  await installDeterministicCloudAccount(page, { portfolio: [ownerExampleTrade], watchlist: [] });

  await page.goto('/portfolio');
  await expect(page.getByRole('heading', { name: 'Portfolio', exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Expired / Closed History', { exact: true })).toBeVisible();

  const row = page.getByRole('row').filter({ hasText: 'YIELD' }).last();
  await expect(row).toContainText('2.44%');
  await expect(row).toContainText('29.74%');

  const totalRealizedIrr = page.getByText('Total Realized IRR', { exact: true }).locator('..');
  await expect(totalRealizedIrr).toContainText('29.74%');
});
