import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { installDeterministicCloudAccount } from './fixtures/cloudAccount';

const openLotA = {
  id: 'lot-open-a', ticker: 'TQQQ', optionType: 'put', strike: 40, expiration: '2027-01-15',
  contracts: 10, soldPrice: 1.2, soldDate: '2026-05-01', status: 'open',
  entryDelta: -0.2, entryDeltaSource: 'manual', entryIv: 40, entryIvSource: 'manual', entryVixClose: 20,
  notes: 'Original entry', createdAt: '2026-05-01T15:00:00.000Z', updatedAt: '2026-05-01T15:00:00.000Z',
};

const openLotB = {
  ...openLotA,
  id: 'lot-open-b', contracts: 5, soldPrice: 1.65, soldDate: '2026-05-20',
  entryDelta: -0.4, entryIv: 80, entryVixClose: 30,
  notes: 'Later entry', createdAt: '2026-05-20T15:00:00.000Z', updatedAt: '2026-05-20T15:00:00.000Z',
};

const historyLotA = {
  id: 'lot-history-a', ticker: 'TQQQ', optionType: 'put', strike: 35, expiration: '2026-06-19',
  contracts: 2, soldPrice: 1.1, soldDate: '2026-04-20', status: 'expired',
  expirationClosePrice: 50, expirationCloseDate: '2026-06-19', finalOptionValue: 0,
  realizedPnl: 220, percentCaptured: 1, resolutionType: 'expired_worthless', resolvedDate: '2026-06-19',
  entryDelta: -0.18, entryIv: 42, entryVixClose: 21,
  notes: 'Expired entry', createdAt: '2026-04-20T15:00:00.000Z', updatedAt: '2026-06-19T20:00:00.000Z',
};

const historyLotB = {
  ...historyLotA,
  id: 'lot-history-b', contracts: 1, soldPrice: 1.4, soldDate: '2026-05-05', status: 'closed',
  closePrice: 0.5, closeDate: '2026-06-10', realizedPnl: 90, percentCaptured: 90 / 140,
  expirationClosePrice: undefined, expirationCloseDate: undefined, finalOptionValue: 50,
  resolutionType: undefined, resolvedDate: undefined, entryDelta: -0.3, entryIv: 55, entryVixClose: 24,
  notes: 'Bought-back entry', createdAt: '2026-05-05T15:00:00.000Z', updatedAt: '2026-06-10T20:00:00.000Z',
};

const singleOpenPosition = {
  id: 'lot-open-soxl', ticker: 'SOXL', optionType: 'put', strike: 25, expiration: '2026-12-18',
  contracts: 1, soldPrice: 1.05, soldDate: '2026-08-12', status: 'open',
  entryDelta: -0.25, entryIv: 62, entryVixClose: 23,
  notes: 'Independent contract', createdAt: '2026-08-12T15:00:00.000Z', updatedAt: '2026-08-12T15:00:00.000Z',
};

const portfolio = [openLotA, openLotB, singleOpenPosition, historyLotA, historyLotB];
const renderedQaProjects = new Set(['desktop-1440x900', 'tablet-1024x768', 'portrait-390x844', 'landscape-844x390']);

async function capture(page: Page, testInfo: TestInfo, name: string) {
  const screenshot = await page.screenshot({ path: testInfo.outputPath(`${name}.png`), animations: 'disabled', fullPage: false });
  await testInfo.attach(name, { body: screenshot, contentType: 'image/png' });
}

async function assertNoPageOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
}

async function openMultiLotEditor(page: Page, portrait: boolean) {
  if (portrait) {
    const row = page.locator('.mobile-position-row:visible').filter({ hasText: 'TQQQ' }).first();
    await expect(row).toBeVisible();
    const expander = row.locator('.mobile-position-row__summary-button');
    if (await expander.getAttribute('aria-expanded') !== 'true') await expander.click();
    await expect(row).toContainText('15 contracts');
    await expect(row.getByRole('button', { name: /Delete/i })).toHaveCount(0);
    await row.getByRole('button', { name: 'Edit', exact: true }).click();
  } else {
    const row = page.locator('[data-trade-ticker="TQQQ"]:visible').first();
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('15');
    await expect(row).toContainText('1.35');
    await expect(row.getByRole('button', { name: /Delete/i })).toHaveCount(0);
    await row.locator('button[title="Edit entries"]').click();
  }
  const editor = page.getByRole('dialog', { name: /TQQQ \$40\.00 Put/ });
  await expect(editor).toBeVisible();
  await expect(editor.getByText(/15 contracts.*2 entries/)).toBeVisible();
  await expect(editor.locator('article')).toHaveCount(2);
  return editor;
}

test('contract positions render once and expose only lot-scoped mutations', async ({ page }, testInfo) => {
  test.skip(!renderedQaProjects.has(testInfo.project.name), 'Covered by the representative responsive QA matrix.');
  await installDeterministicCloudAccount(page, {
    portfolio,
    watchlist: [],
    preferences: { portfolioMarkBasis: 'ask', portfolioGroupMode: 'none' },
  });
  await page.goto('/portfolio');
  await expect(page.locator('h2:visible').filter({ hasText: /^(Open Positions|Schedule of Positions)$/ }).first()).toBeVisible({ timeout: 20_000 });
  const portrait = testInfo.project.name.startsWith('portrait-');

  if (portrait) {
    await expect(page.getByText('2 positions', { exact: true }).first()).toBeVisible();
    await expect(page.locator('.mobile-position-row:visible').filter({ hasText: 'TQQQ' })).toHaveCount(1);
  } else {
    const openPositionsCard = page.locator('.portfolio-summary-card:visible').filter({ hasText: 'Open Positions' });
    await expect(openPositionsCard).toContainText('2');
    await expect(page.locator('[data-trade-ticker="TQQQ"]:visible')).toHaveCount(1);
    const singleLotPosition = page.locator('[data-trade-ticker="SOXL"]:visible').first();
    await expect(singleLotPosition.locator('button[title="Delete"]')).toHaveCount(1);
  }
  await assertNoPageOverflow(page);
  await capture(page, testInfo, 'contract-position-list');

  let editor = await openMultiLotEditor(page, portrait);
  await assertNoPageOverflow(page);
  await capture(page, testInfo, 'contract-position-editor');

  await editor.getByRole('button', { name: 'Edit Entry' }).first().click();
  let tradeDialog = page.getByRole('dialog', { name: 'Edit Sold Put' });
  await expect(tradeDialog.getByLabel('Sold Date')).toHaveValue('2026-05-01');
  await expect(tradeDialog.getByLabel('Contracts')).toHaveValue('10');
  await expect(tradeDialog.getByRole('button', { name: /Delete/i })).toHaveCount(1);
  await tradeDialog.getByRole('button', { name: 'Close add trade modal' }).click();

  editor = await openMultiLotEditor(page, portrait);
  await editor.getByRole('button', { name: 'Add to Position' }).click();
  tradeDialog = page.getByRole('dialog', { name: 'Add to Position' });
  await expect(tradeDialog.getByLabel('Ticker')).toHaveValue('TQQQ');
  await expect(tradeDialog.getByLabel('Expiration')).toHaveValue('2027-01-15');
  await expect(tradeDialog.getByLabel('Strike')).toHaveValue('40');
  await expect(tradeDialog.getByLabel('Contracts')).toHaveValue('');
  await expect(tradeDialog.getByLabel('Sold Price')).toHaveValue('');
  await expect(tradeDialog.getByLabel('Sold Date')).toHaveValue('');
  await expect(tradeDialog.getByRole('button', { name: /Delete/i })).toHaveCount(0);
  await assertNoPageOverflow(page);
  await capture(page, testInfo, 'add-to-position');
  await tradeDialog.getByRole('button', { name: 'Close add trade modal' }).click();

  if (portrait) await page.getByRole('button', { name: /^History/ }).click();
  const history = page.locator('.portfolio-history-section:visible');
  await expect(history).toBeVisible();
  await history.scrollIntoViewIfNeeded();
  const expandAll = history.getByRole('button', { name: 'Expand All' });
  if (await expandAll.count()) await expandAll.click();
  if (portrait) {
    const historyPosition = history.locator('.portfolio-history-mobile-row:visible');
    await expect(historyPosition).toHaveCount(1);
    await historyPosition.locator('.portfolio-history-mobile-row__summary').click();
    await expect(historyPosition).toContainText('Mixed');
    await expect(historyPosition.getByRole('button', { name: /Delete/i })).toHaveCount(0);
  } else {
    const historyPosition = history.locator('tbody tr[title]:visible');
    await expect(historyPosition).toHaveCount(1);
    await expect(historyPosition).toContainText('Mixed');
    await expect(historyPosition.locator('button[title="Delete"]')).toHaveCount(0);
  }
  await assertNoPageOverflow(page);
  await capture(page, testInfo, 'mixed-lot-history');
});
