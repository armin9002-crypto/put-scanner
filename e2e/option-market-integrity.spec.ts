import { expect, test } from '@playwright/test';
import { installDeterministicCloudAccount } from './fixtures/cloudAccount';
import { installDeterministicMarketApi } from './fixtures/marketApi';

const integrityProjects = new Set(['desktop-1440x900', 'portrait-390x844', 'landscape-844x390']);
const EXPIRATION = 1_798_761_600;
const expiry = '2027-01-01';
const watchId = `UPRO|put|${expiry}|107`;
const durableWatch = { id: watchId, ticker: 'UPRO', expiry, expiryTimestamp: EXPIRATION, expiryFormatted: "Jan 1 '27", strike: 107, optionType: 'put', addedAt: 1_788_000_000_000, savedAt: 1_788_000_000_000, note: '' };
const durableTrade = { id: 'integrity-lot', ticker: 'UPRO', optionType: 'put', strike: 107, expiration: expiry, contracts: 1, soldPrice: 2, soldDate: '2026-09-04', status: 'open', createdAt: '2026-09-04T14:00:00.000Z', updatedAt: '2026-09-04T14:00:00.000Z' };

test('invalid option quotes remain auditable while executable yields fail closed', async ({ page }, testInfo) => {
  test.skip(!integrityProjects.has(testInfo.project.name), 'focused integrity viewport matrix');
  const display = testInfo.project.name === 'portrait-390x844'
    ? { theme: 'light', textSize: 'large' }
    : { theme: 'dark', textSize: 'small' };
  await page.addInitScript(({ theme, textSize }) => {
    localStorage.setItem('put_scanner_theme', theme);
    localStorage.setItem('put_scanner_text_size', textSize);
    localStorage.setItem('theme_migration_version', '2');
  }, display);
  await installDeterministicMarketApi(page, { optionCount: 28, dirtySurface: true });
  await installDeterministicCloudAccount(page, { portfolio: [], watchlist: [], preferences: {} });
  await page.goto('/options/UPRO');
  await expect(page.getByText('UPRO', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('html')).toHaveAttribute('data-theme', display.theme);
  await expect(page.locator('html')).toHaveAttribute('data-text-size', display.textSize);

  const compactRows = page.locator('.mobile-option-chain-row:not(.mobile-option-chain-row--skeleton)');
  const compactLayout = testInfo.project.name === 'portrait-390x844';
  if (compactLayout) {
    await expect(compactRows.first()).toBeVisible();
    const row = compactRows.filter({ hasText: '107.00' }).first();
    await expect(row).toContainText('Quote inconsistent');
    await expect(row.locator('[data-field="ay-bid"]')).toContainText('—');
    await row.click();
  } else {
    const row = page.locator('.option-desktop-chain tbody tr').filter({ hasText: '107.00' }).first();
    await expect(row.getByLabel('Quote inconsistent')).toBeVisible();
    await expect(row).toContainText('8.00');
    await row.click();
  }

  const mobileDetail = testInfo.project.name !== 'desktop-1440x900';
  const detail = mobileDetail ? page.getByRole('dialog') : page.locator('.option-detail-drawer');
  await expect(detail).toContainText('Quote inconsistent');
  await expect(detail).toContainText('$8.00');
  await expect(detail).toContainText('$10.20');
  if (mobileDetail) await expect(detail).toContainText('No executable quote');
  else await expect(detail.getByRole('spinbutton', { name: 'Sold Price' })).toHaveValue('');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
});

test('Screener, Watchlist, and Portfolio expose fail-closed integrity states', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  test.skip(!integrityProjects.has(testInfo.project.name), 'focused cross-consumer viewport matrix');
  const market = await installDeterministicMarketApi(page, { optionCount: 28, dirtySurface: true });
  await installDeterministicCloudAccount(page, { portfolio: [durableTrade], watchlist: [durableWatch], preferences: {} });

  if (testInfo.project.name !== 'desktop-1440x900') {
    await page.goto('/watchlist');
    await expect(page.getByRole('heading', { name: 'Watchlist', exact: true })).toBeVisible();
    await expect(page.getByText(/Quote inconsistent/).last()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('$8.00', { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);

    await page.goto('/portfolio');
    await expect(page.getByRole('heading', { name: 'Portfolio', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Refresh Open Trades' }).click();
    await expect(page.getByText(/Refresh failed/).first()).toBeVisible();
    await expect(page.getByText('$8.00', { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    return;
  }

  await page.goto('/screener');
  await page.getByPlaceholder('Select ETFs...').fill('UPRO');
  await page.getByRole('button', { name: /UPRO.*ProShares UltraPro S&P 500/i }).click();
  await page.getByRole('button', { name: 'Load', exact: true }).click();
  await expect(page.getByText(/contracts loaded/i).first()).toBeVisible({ timeout: 20_000 });
  const badScreenerRow = page.locator('table tbody tr').filter({ hasText: '107.00' }).first();
  await expect(badScreenerRow).toContainText('Quote inconsistent');
  await expect(badScreenerRow).toContainText('—');
  const optionRequestsBeforeFilter = market.counts.get('screener-batch') ?? 0;
  await page.getByText('Annualized Yield Bid', { exact: true }).locator('..').getByRole('combobox').selectOption('>75');
  await expect(badScreenerRow).toHaveCount(0);
  expect(market.counts.get('screener-batch') ?? 0).toBe(optionRequestsBeforeFilter);

  await page.goto('/watchlist');
  await expect(page.getByRole('heading', { name: 'Watchlist', exact: true })).toBeVisible();
  await expect(page.getByText('Quote inconsistent', { exact: true }).last()).toBeVisible();
  const watchRow = page.locator('table tbody tr').filter({ hasText: '107.00' }).first();
  await expect(watchRow).not.toContainText('$8.00');

  await page.goto('/portfolio');
  await expect(page.getByRole('heading', { name: 'Portfolio', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Refresh Open Trades' }).click();
  await expect(page.getByText(/Saved trade data was preserved/i)).toBeVisible();
  const portfolioRow = page.locator('table tbody tr').filter({ hasText: 'UPRO' }).first();
  await expect(portfolioRow).not.toContainText('$8.00');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
});
