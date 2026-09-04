import { expect, test, type Page } from '@playwright/test';
import * as XLSX from 'xlsx';
import { installDeterministicCloudAccount } from './fixtures/cloudAccount';

const headers = [
  'Ticker', 'Expiration', 'Strike', 'Contracts', 'Sold Price (Net)', 'Sold Date', 'Delta at Entry', 'IV at Entry',
  'Status', 'Outcome', 'Close Date', 'Close price', 'Underlying Price at Expiration / Contract Close',
];

const dayMs = 86_400_000;
const serial = (value: string) => (Date.parse(`${value}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / dayMs;

function sanitizedWorkbook(): Buffer {
  const rows = [
    [],
    [null, ...headers],
    [null, 'XYZ', serial('2025-06-20'), 40, 1, 1.5, serial('2025-05-01'), -0.0712, 0.7954, 'Held to Expiration', 'Expired Worthless', null, 0, 50],
    [null, 'ABC', serial('2025-07-18'), 70, 2, 1.5, serial('2025-05-02'), -0.2, 0.42, 'Closed / Bought Back', 'Closed Manually', serial('2025-06-10'), 0.5, 72],
  ];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  for (const address of ['C3', 'G3', 'C4', 'G4', 'L4']) sheet[address].z = 'yyyy-mm-dd';
  for (const address of ['I3', 'I4']) sheet[address].z = '0.00%';
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Invented V5 Data');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

const existingPortfolio = [{
  id: 'existing-lot', ticker: 'TQQQ', optionType: 'put', strike: 50, expiration: '2027-01-15', contracts: 1,
  soldPrice: 1.25, soldDate: '2026-08-13', status: 'open', createdAt: '2026-08-13T15:00:00.000Z', updatedAt: '2026-08-13T15:00:00.000Z',
}];

async function openHistoricalImport(page: Page) {
  await page.goto('/portfolio');
  await expect(page.getByRole('heading', { name: 'Portfolio', exact: true })).toBeVisible();
  const mobileActions = page.getByRole('button', { name: 'Portfolio actions' });
  const desktopImport = page.getByRole('button', { name: 'Import Historical Excel' }).first();
  await expect.poll(async () => await mobileActions.isVisible() || await desktopImport.isVisible()).toBe(true);
  if (await mobileActions.isVisible()) {
    await mobileActions.click();
    await page.getByRole('dialog', { name: 'Portfolio actions' }).getByRole('button', { name: 'Import Historical Excel' }).click();
  } else {
    await desktopImport.click();
  }
  return page.getByRole('dialog', { name: 'Import Historical Excel' });
}

test('historical Excel audit is responsive, starts unchecked, and separates option close from underlying context', async ({ page }, testInfo) => {
  test.skip(!['desktop-1440x900', 'tablet-1024x768', 'portrait-390x844', 'landscape-844x390'].includes(testInfo.project.name), 'Representative responsive matrix only.');
  const theme = ({
    'desktop-1440x900': 'dark',
    'tablet-1024x768': 'dark-blue',
    'portrait-390x844': 'light',
    'landscape-844x390': 'sepia',
  } as const)[testInfo.project.name as 'desktop-1440x900' | 'tablet-1024x768' | 'portrait-390x844' | 'landscape-844x390'];
  await page.addInitScript(selectedTheme => {
    localStorage.setItem('put_scanner_theme', selectedTheme);
    localStorage.setItem('theme_migration_version', '2');
  }, theme);
  const cloud = await installDeterministicCloudAccount(page, { portfolio: existingPortfolio, watchlist: [], preferences: { portfolioGroupMode: 'none' } });
  let vixRequests = 0;
  await page.route('**/api/chart-history?*', async route => {
    vixRequests += 1;
    const points = ['2025-05-01', '2025-05-02'].map((date, index) => ({ timestamp: Date.parse(`${date}T20:00:00Z`) / 1000, date, price: 20 + index }));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ticker: '^VIX', timeframe: 'custom', points, fetchedAt: Date.now(), metadata: { interval: '1d' } }) });
  });
  const modal = await openHistoricalImport(page);
  await expect(modal).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await modal.locator('input[type="file"]').setInputFiles({
    name: 'sanitized-v5.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: sanitizedWorkbook(),
  });
  await expect(modal.getByText('NO DATA HAS BEEN CHANGED YET.')).toBeVisible();
  await expect(modal.getByText('Invented V5 Data', { exact: false })).toBeVisible();
  const rowCheckboxes = modal.getByRole('checkbox', { name: /Select source row/ });
  await expect(rowCheckboxes).toHaveCount(2);
  await expect(rowCheckboxes.nth(0)).not.toBeChecked();
  await expect(rowCheckboxes.nth(1)).not.toBeChecked();
  await modal.getByRole('button', { name: 'Select All Ready' }).click();
  await expect(rowCheckboxes.nth(0)).toBeChecked();
  await expect(rowCheckboxes.nth(1)).toBeChecked();
  const commit = modal.getByRole('button', { name: /Download Safety Backup & Import 2 Selected Lots/ });
  await expect(commit).toBeVisible();
  expect(vixRequests).toBe(1);

  if (testInfo.project.name.startsWith('portrait-')) {
    await expect(modal.locator('table')).not.toBeVisible();
    const manualRow = modal.locator('article').filter({ hasText: 'ABC' });
    await manualRow.getByRole('button').click();
    await expect(manualRow).toContainText('OPTION Close Price');
    await expect(manualRow).toContainText('$0.50');
    await expect(manualRow).toContainText('$72.00 · context only, not persisted');
  } else {
    await expect(modal.locator('table')).toBeVisible();
    await expect(modal.getByRole('columnheader', { name: 'OPTION Close Price' })).toBeVisible();
    await expect(modal.getByRole('columnheader', { name: 'Contract Key' })).toBeVisible();
    const scrollContainer = modal.locator('table').locator('..');
    expect(await scrollContainer.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  expect(vixRequests).toBe(1);
  expect(cloud.requests.filter(request => request.startsWith('PATCH /rest/v1/user_state') && request.includes('namespace=eq.portfolio'))).toHaveLength(0);

  if (testInfo.project.name === 'desktop-1440x900') {
    const mutationsBeforeCommit = cloud.requests.filter(request => request.startsWith('PATCH /rest/v1/user_state')).length;
    const watchlistRevisionBeforeCommit = cloud.rows.find(row => row.namespace === 'watchlist')?.revision;
    const preferencesRevisionBeforeCommit = cloud.rows.find(row => row.namespace === 'preferences')?.revision;
    const backupDownload = page.waitForEvent('download');
    await commit.click();
    const download = await backupDownload;
    expect(download.suggestedFilename()).toMatch(/^pre-historical-import-backup-.*\.json$/);
    await expect(modal.getByText('Authoritative cloud import confirmed')).toBeVisible();
    await expect(modal.getByText('Imported lots')).toBeVisible();
    const mutations = cloud.requests.filter(request => request.startsWith('PATCH /rest/v1/user_state')).slice(mutationsBeforeCommit);
    expect(mutations).toHaveLength(1);
    expect(mutations[0]).toContain('namespace=eq.portfolio');
    const portfolio = cloud.rows.find(row => row.namespace === 'portfolio');
    expect((portfolio?.payload.data as unknown[])).toHaveLength(3);
    expect(cloud.rows.find(row => row.namespace === 'watchlist')?.revision).toBe(watchlistRevisionBeforeCommit);
    expect(cloud.rows.find(row => row.namespace === 'preferences')?.revision).toBe(preferencesRevisionBeforeCommit);
  }
});
