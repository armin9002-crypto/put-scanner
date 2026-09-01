import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { installDeterministicCloudAccount } from './fixtures/cloudAccount';

const phase = process.env.UI_OVERHAUL_CAPTURE;
const suite = process.env.UI_OVERHAUL_SUITE;
const outputRoot = path.join(process.cwd(), 'e2e-artifacts', 'ui-overhaul', 'history-actions', phase || 'disabled');

const historyPortfolio = [
  { id: 'history-expired-worthless', ticker: 'SPY', optionType: 'put', strike: 90, expiration: '2025-06-20', contracts: 1, soldPrice: 1.8, soldDate: '2025-05-20', status: 'expired', expirationClosePrice: 95, expirationCloseDate: '2025-06-20', finalOptionValue: 0, realizedPnl: 180, percentCaptured: 1, resolutionType: 'expired_worthless', resolvedDate: '2025-06-20', createdAt: '2025-05-20T12:00:00.000Z', updatedAt: '2025-06-20T12:00:00.000Z' },
  { id: 'history-expired-itm', ticker: 'QQQ', optionType: 'put', strike: 100, expiration: '2025-07-18', contracts: 1, soldPrice: 2.5, soldDate: '2025-06-18', status: 'expired', expirationClosePrice: 95, expirationCloseDate: '2025-07-18', finalOptionValue: 500, realizedPnl: -250, percentCaptured: -1, resolutionType: 'expired_itm', resolvedDate: '2025-07-18', createdAt: '2025-06-18T12:00:00.000Z', updatedAt: '2025-07-18T12:00:00.000Z' },
  { id: 'history-closed', ticker: 'TQQQ', optionType: 'put', strike: 80, expiration: '2025-08-15', contracts: 1, soldPrice: 2.2, soldDate: '2025-07-15', status: 'closed', closePrice: 0.5, closeDate: '2025-08-01', realizedPnl: 170, percentCaptured: 0.77, createdAt: '2025-07-15T12:00:00.000Z', updatedAt: '2025-08-01T12:00:00.000Z' },
  { id: 'history-assigned', ticker: 'SOXL', optionType: 'put', strike: 70, expiration: '2025-09-19', contracts: 1, soldPrice: 3, soldDate: '2025-08-19', status: 'assigned', realizedPnl: -6_700, percentCaptured: -22.33, resolvedDate: '2025-09-19', createdAt: '2025-08-19T12:00:00.000Z', updatedAt: '2025-09-19T12:00:00.000Z' },
  { id: 'history-pending', ticker: 'LABU', optionType: 'put', strike: 50, expiration: '2025-10-17', contracts: 2, soldPrice: 1.2345, soldDate: '2025-09-17', status: 'expired_price_pending', resolutionType: 'expired_price_pending', resolutionWarning: 'Expiration close unavailable', createdAt: '2025-09-17T12:00:00.000Z', updatedAt: '2025-10-18T12:00:00.000Z' },
];

async function openHistory(page: Page, mobile: boolean) {
  await page.goto('/portfolio');
  await expect(page.getByRole('heading', { name: 'Portfolio', exact: true })).toBeVisible({ timeout: 20_000 });
  if (mobile) {
    const historyToggle = page.getByRole('button', { name: /^History \d+ resolved/ });
    await expect(historyToggle).toBeVisible({ timeout: 20_000 });
    await historyToggle.click();
  }
  await expect(page.getByText('Expired / Closed History', { exact: true })).toBeVisible();
}

async function capture(page: Page, testInfo: TestInfo) {
  const directory = path.join(outputRoot, testInfo.project.name);
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, 'portfolio-history-actions.png'), animations: 'disabled', fullPage: false });
  return page.evaluate(() => ({
    pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    rootScrollWidth: document.documentElement.scrollWidth,
    rootClientWidth: document.documentElement.clientWidth,
  }));
}

function surfaceFor(page: Page, ticker: string, mobile: boolean) {
  return mobile
    ? page.locator('article').filter({ hasText: ticker }).last()
    : page.getByRole('row').filter({ hasText: ticker }).last();
}

async function historyTickers(page: Page, mobile: boolean) {
  if (mobile) {
    return page.locator('.portfolio-history-section article').evaluateAll(elements => elements.map(element => (element.textContent ?? '').trim().split(/\s+/)[0]));
  }
  return page.locator('.portfolio-history-section tbody tr[title]').evaluateAll(rows => rows.map(row => row.querySelector('td')?.textContent?.trim() ?? ''));
}

test.describe('History expiration actions visual matrix', () => {
  test.skip(!(phase === 'before' || phase === 'after') || suite !== 'history', 'Run with UI_OVERHAUL_CAPTURE=before|after and UI_OVERHAUL_SUITE=history.');

  test('captures resolved and pending History action hierarchy at every supported viewport', async ({ page }, testInfo) => {
    await installDeterministicCloudAccount(page, { portfolio: historyPortfolio, watchlist: [] });
    const mobile = testInfo.project.name.startsWith('portrait-') || testInfo.project.name.startsWith('landscape-');
    await openHistory(page, mobile);
    await page.locator('.portfolio-history-section').last().scrollIntoViewIfNeeded();
    const overflow = await capture(page, testInfo);
    expect(overflow.pageOverflow).toBe(false);

    if (phase !== 'after') return;

    await page.getByRole('button', { name: 'Expand All' }).click();

    const resolved = surfaceFor(page, 'SPY', mobile);
    await expect(resolved).toContainText('Expired Worthless');
    await expect(resolved.getByRole('button', { name: /Edit SPY trade/ })).toBeVisible();
    await expect(resolved.getByRole('button', { name: /Delete SPY trade/ })).toBeVisible();
    await expect(resolved.getByRole('button', { name: /Set Expiration Close/ })).toHaveCount(0);
    await expect(resolved.getByRole('button', { name: /Correct Price @ Exp\./ })).toBeVisible();

    const itm = surfaceFor(page, 'QQQ', mobile);
    await expect(itm).toContainText('Expired ITM');
    await expect(itm.getByRole('button', { name: /Set Expiration Close/ })).toHaveCount(0);

    const closed = surfaceFor(page, 'TQQQ', mobile);
    await expect(closed.getByRole('button', { name: /Set Expiration Close|Correct Price @ Exp\./ })).toHaveCount(0);

    const assigned = surfaceFor(page, 'SOXL', mobile);
    await expect(assigned.getByRole('button', { name: /Set Expiration Close|Correct Price @ Exp\./ })).toHaveCount(0);

    const pending = surfaceFor(page, 'LABU', mobile);
    await expect(pending).toContainText('Expiration Price Pending');
    await expect(pending.getByRole('button', { name: 'Retry Resolve' })).toBeVisible();
    await expect(pending.getByRole('button', { name: 'Confirm Worthless' })).toBeVisible();
    await expect(pending.getByRole('button', { name: 'Enter Exp. Price' })).toBeVisible();
    await expect(pending.getByRole('button', { name: /Delete LABU trade/ })).toBeVisible();
    await expect(pending).toContainText('1.23');
    await expect(pending).not.toContainText('1.2345');

    let requestCount = 0;
    page.on('request', () => { requestCount += 1; });
    const requestsBeforeSort = requestCount;
    if (mobile) {
      await page.locator('#mobile-history-sort').selectOption('soldPrice');
      await expect.poll(() => historyTickers(page, true)).toEqual(['LABU', 'SPY', 'TQQQ', 'QQQ', 'SOXL']);
      await page.locator('.portfolio-history-section').getByRole('button', { name: /Sort ascending; activate for descending/ }).click();
      await expect.poll(() => historyTickers(page, true)).toEqual(['SOXL', 'QQQ', 'TQQQ', 'SPY', 'LABU']);
    } else {
      await page.locator('.portfolio-history-section').getByRole('button', { name: /^Sold Price, not sorted/ }).click();
      await expect.poll(() => historyTickers(page, false)).toEqual(['LABU', 'SPY', 'TQQQ', 'QQQ', 'SOXL']);
      await page.locator('.portfolio-history-section').getByRole('button', { name: /^Sold Price, sorted ascending/ }).click();
      await expect.poll(() => historyTickers(page, false)).toEqual(['SOXL', 'QQQ', 'TQQQ', 'SPY', 'LABU']);
    }
    expect(requestCount).toBe(requestsBeforeSort);

    const historyGrouping = page.getByRole('group', { name: 'Group history by' });
    for (const grouping of ['Year', 'Expiry', 'Underlying', 'None']) {
      await historyGrouping.getByRole('button', { name: grouping, exact: true }).click();
      if (grouping !== 'None') {
        const expandInitiallyCollapsed = page.getByRole('button', { name: 'Expand All' });
        if (await expandInitiallyCollapsed.count()) await expandInitiallyCollapsed.click();
        const collapseAll = page.getByRole('button', { name: 'Collapse All' });
        await expect(collapseAll).toBeVisible();
        await collapseAll.click();
        await expect(page.getByRole('button', { name: 'Expand All' })).toBeVisible();
        await page.getByRole('button', { name: 'Expand All' }).click();
      }
      await expect(surfaceFor(page, 'LABU', mobile).getByRole('button', { name: 'Enter Exp. Price' })).toBeVisible();
    }
  });

  test('keeps pending and resolved action semantics readable across all themes', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1440x900', 'one deterministic theme readability check');
    await installDeterministicCloudAccount(page, { portfolio: historyPortfolio, watchlist: [] });
    for (const theme of ['dark', 'dark-blue', 'light', 'sepia']) {
      await page.addInitScript(value => {
        localStorage.setItem('put_scanner_theme', value);
        localStorage.setItem('theme', value);
      }, theme);
      await openHistory(page, false);
      await page.getByRole('button', { name: 'Expand All' }).click();
      await surfaceFor(page, 'LABU', false).scrollIntoViewIfNeeded();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(surfaceFor(page, 'LABU', false).getByRole('button', { name: 'Confirm Worthless' })).toBeVisible();
      await expect(surfaceFor(page, 'SPY', false).getByRole('button', { name: /Correct Price @ Exp\./ })).toBeVisible();
      const directory = path.join(outputRoot, testInfo.project.name);
      await mkdir(directory, { recursive: true });
      await page.screenshot({ path: path.join(directory, `theme-${theme}.png`), animations: 'disabled', fullPage: false });
    }
  });
});
