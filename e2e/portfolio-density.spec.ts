import { expect, test } from '@playwright/test';
import { installDeterministicCloudAccount } from './fixtures/cloudAccount';
import { installDeterministicMarketApi } from './fixtures/marketApi';

test('Portfolio data tools and display range preserve workflows and requests', async ({ page }, testInfo) => {
  const market = await installDeterministicMarketApi(page);
  const cloud = await installDeterministicCloudAccount(page, { portfolio: [
    { id: 'density-history', ticker: 'SPY', optionType: 'put', strike: 90, expiration: '2025-03-21', contracts: 1, soldPrice: 2, soldDate: '2024-01-01', status: 'closed', closePrice: 1, closeDate: '2025-03-01', createdAt: '2024-01-01T12:00:00.000Z', updatedAt: '2025-03-01T12:00:00.000Z' },
    { id: 'density-open', ticker: 'QQQ', optionType: 'put', strike: 90, expiration: '2026-12-18', contracts: 1, soldPrice: 2, soldDate: '2026-08-01', status: 'open', createdAt: '2026-08-01T12:00:00.000Z', updatedAt: '2026-08-01T12:00:00.000Z' },
  ], watchlist: [] });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/portfolio');
  await expect(page.getByText(/^(Open Positions|Schedule of Positions)$/).first()).toBeVisible({ timeout: 20000 });
  const mobile = (page.viewportSize()?.width ?? 1440) < 600;
  {
    if (mobile) await page.getByRole('button', { name: 'Portfolio actions', exact: true }).click();
    await expect(page.getByText('Import Screenshot', { exact: true })).toHaveCount(0);
    await page.locator('summary').filter({ hasText: 'Data Tools' }).click();
    await page.getByRole('button', { name: 'Data Backup', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    if (mobile) await page.getByRole('button', { name: 'Portfolio actions', exact: true }).click();
    await page.locator('summary').filter({ hasText: 'Data Tools' }).click();
    await page.getByRole('button', { name: 'Import / Export Historical Excel', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog')).toContainText(/Historical/);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  const history = page.getByRole('button', { name: /History/ }).first();
  if (await history.isVisible().catch(() => false)) await history.click();
  const chart = page.getByTestId('rolling-historical-analytics');
  await chart.scrollIntoViewIfNeeded();
  await expect(chart).toBeVisible();
  const before = [...market.counts.entries()];
  const cloudBefore = cloud.requests.length;
  const allCount = Number(await chart.getAttribute('data-rolling-observation-count'));
  const value = await chart.getAttribute('data-rolling-current-value');
  for (const range of ['L3M', 'L6M', 'L1Y', 'L2Y', 'Since Inception']) {
    await chart.getByLabel('Visible range').selectOption(range);
    expect(Number(await chart.getAttribute('data-rolling-observation-count'))).toBeLessThanOrEqual(allCount);
    await expect(chart).toHaveAttribute('data-rolling-current-value', value!);
  }
  await chart.getByLabel('Analytics', { exact: true }).selectOption('grossRiskExposure');
  await chart.getByLabel('Visible range').selectOption('L3M');
  await expect(chart).toHaveAttribute('data-analytics-family', 'PORTFOLIO_STATE');
  expect([...market.counts.entries()]).toEqual(before);
  expect(cloud.requests.length).toBe(cloudBefore);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await chart.getByLabel('Visible range').selectOption('L6M');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({ path: `e2e-artifacts/density-portfolio-${testInfo.project.name}.png`, fullPage: true });
});
