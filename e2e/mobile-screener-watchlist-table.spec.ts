import { expect, test } from '@playwright/test';
import { installDeterministicCloudAccount } from './fixtures/cloudAccount';
import { installDeterministicMarketApi } from './fixtures/marketApi';

const EXPIRATION = 1_798_761_600;
const expiry = '2027-01-01';

const durableWatchlist = [
  { id: `TQQQ|put|${expiry}|90`, ticker: 'TQQQ', expiry, expiryTimestamp: EXPIRATION, expiryFormatted: "Jan 1 '27", strike: 90, optionType: 'put', addedAt: 1_788_000_000_000, savedAt: 1_788_000_000_000, note: 'Review after earnings' },
  { id: `UPRO|put|${expiry}|95`, ticker: 'UPRO', expiry, expiryTimestamp: EXPIRATION, expiryFormatted: "Jan 1 '27", strike: 95, optionType: 'put', addedAt: 1_788_000_100_000, savedAt: 1_788_000_100_000, note: '' },
];

test.beforeEach(async ({ page }) => {
  await installDeterministicMarketApi(page, { optionCount: 8 });
  await installDeterministicCloudAccount(page, { portfolio: [], watchlist: durableWatchlist, preferences: {} });
});

test('portrait Screener table keeps aligned sticky and frozen layers across phone widths', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'portrait-390x844', 'manual portrait-width matrix');
  test.setTimeout(120_000);
  await page.goto('/screener');
  await page.getByRole('button', { name: /Filters/i }).click();
  await page.getByText('Recent Trades Only', { exact: true }).locator('..').getByRole('combobox').selectOption('no');
  await page.getByText('Expiration', { exact: true }).locator('..').getByRole('combobox').selectOption('all');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: /Run Screener/i }).click();
  await page.getByRole('button', { name: /^(Run scan|Confirm)$/i }).click();
  await expect(page.getByText(/contracts loaded/i).first()).toBeVisible({ timeout: 120_000 });

  const owner = page.locator('.mobile-financial-table-scroll');
  const rows = page.locator('.mobile-financial-table-row');
  await expect(owner).toBeVisible();
  await expect(page.locator('.mobile-financial-table thead th').first()).toHaveText('Ticker');
  await expect(rows.first()).toBeVisible();

  for (const width of [320, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    const metrics = await owner.evaluate(element => {
      const row = element.querySelector('.mobile-financial-table-row')!;
      const header = element.querySelector('thead th')!;
      const identity = row.children[0] as HTMLElement;
      return {
        overflow: element.scrollWidth > element.clientWidth,
        pageOverflow: document.documentElement.scrollWidth > innerWidth,
        aligned: row.children.length === element.querySelectorAll('thead th').length,
        frozen: getComputedStyle(identity).position,
        stickyHeader: getComputedStyle(header).position,
      };
    });
    expect(metrics.overflow, `${width}px should scroll horizontally`).toBe(true);
    expect(metrics.pageOverflow, `${width}px should not overflow the page`).toBe(false);
    expect(metrics.aligned).toBe(true);
    expect(metrics.frozen).toBe('sticky');
    expect(metrics.stickyHeader).toBe('sticky');
  }

  await owner.evaluate(element => { element.scrollLeft = 300; element.scrollTop = 240; });
  await expect.poll(() => owner.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  await expect.poll(() => owner.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  const firstRow = rows.first();
  await firstRow.locator('td').first().click();
  await expect(page.locator('.option-drawer-mobile [role="dialog"]')).toBeVisible();
  await page.getByRole('button', { name: 'Close option details' }).click();
  await firstRow.getByRole('link').click();
  await expect(page).toHaveURL(/\/options\//);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('portrait Watchlist table isolates grouping, note, remove, ticker and detail actions', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'portrait-390x844', 'focused portrait interaction check');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/watchlist');

  const table = page.locator('.mobile-financial-table');
  const rows = page.locator('.mobile-financial-table-row');
  await expect(table).toBeVisible({ timeout: 20_000 });
  await expect(rows).toHaveCount(2);
  await expect(table.locator('thead')).toContainText('Ticker');
  await expect(table.locator('thead')).toContainText('State');
  await expect(page.locator('.mobile-financial-table-divider')).toHaveCount(2);

  const first = rows.first();
  const note = first.getByRole('button', { name: 'Edit note for TQQQ' });
  await note.click();
  await expect(page.getByRole('dialog', { name: /Edit note for TQQQ/i })).toBeVisible();
  await page.getByRole('textbox', { name: 'Note for TQQQ' }).fill('Updated mobile note');
  await page.getByRole('button', { name: 'Save note' }).click();
  await expect(first.getByRole('button', { name: 'Edit note for TQQQ' })).toHaveAttribute('title', 'Updated mobile note');

  await first.locator('td').first().click();
  await expect(page.locator('.option-drawer-mobile [role="dialog"]')).toBeVisible();
  await page.getByRole('button', { name: 'Close option details' }).click();

  await first.getByRole('button', { name: /Remove TQQQ/ }).click();
  await expect(rows).toHaveCount(1);

  await page.getByLabel('Group watchlist by').selectOption('none');
  await expect(page.locator('.mobile-financial-table-divider')).toHaveCount(0);
  await expect(page.locator('.mobile-financial-table-scroll')).toHaveCSS('overflow', /auto/);
});
