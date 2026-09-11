import { expect, test } from '@playwright/test';
import { installDeterministicCloudAccount } from './fixtures/cloudAccount';
import { installDeterministicMarketApi } from './fixtures/marketApi';

const EXPIRATION = 1_798_761_600;
const EXPIRY = '2027-01-01';

test('final correctness remediation keeps the four corrected workflows truthful', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440x900', 'one bounded desktop correctness path');
  test.setTimeout(120_000);

  const consoleErrors: string[] = [];
  page.on('console', message => {
    if (message.type() === 'error' && !message.text().includes('ERR_BLOCKED_BY_CLIENT')) consoleErrors.push(message.text());
  });
  page.on('pageerror', error => consoleErrors.push(error.message));

  const market = await installDeterministicMarketApi(page);
  await installDeterministicCloudAccount(page, {
    portfolio: [],
    watchlist: [{
      id: `TQQQ|put|${EXPIRY}|90`,
      ticker: 'TQQQ',
      expiry: EXPIRY,
      expiryTimestamp: EXPIRATION,
      expiryFormatted: "Jan 1 '27",
      strike: 90,
      optionType: 'put',
      addedAt: 1_788_000_000_000,
      savedAt: 1_788_000_000_000,
      note: '',
    }],
    preferences: {},
  });

  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Market context' })).toBeVisible();
  await expect(page.locator('[data-evidence-freshness="current"]').first()).toBeVisible();
  const beforeRefresh = market.counts.get('price') ?? 0;
  await page.getByRole('button', { name: 'Refresh market charts' }).first().click();
  await expect.poll(() => market.counts.get('price') ?? 0).toBe(beforeRefresh + 4);
  await expect(page.locator('[data-evidence-freshness="current"]').first()).toBeVisible();

  await page.goto('/watchlist');
  await expect(page.getByRole('heading', { name: 'Watchlist', exact: true })).toBeVisible();
  const watchRow = page.locator('table tbody tr:not(.watchlist-group-header)').filter({ hasText: 'TQQQ' }).first();
  await expect(watchRow).toContainText('90.00');
  await expect(watchRow.getByText('2.00', { exact: true })).toBeVisible();

  await page.goto(`/options/TQQQ?expiry=${EXPIRY}`);
  await expect(page).toHaveURL(new RegExp(`/options/TQQQ\\?expiry=${EXPIRY}$`));
  await expect(page.getByRole('button', { pressed: true }).filter({ hasText: /Jan 1/ }).first()).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: '90.00' }).last()).toBeVisible();

  await page.goto('/pulse');
  await expect(page.getByText('ETF Pulse Visuals')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Details', exact: true }).first().click();
  const marketRead = page.getByRole('dialog', { name: 'Market Read' });
  await expect(marketRead).toContainText('Key drivers');
  await expect(marketRead).toContainText(/SPY:/);
  await expect(marketRead).toContainText(/QQQ:/);

  expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
});
