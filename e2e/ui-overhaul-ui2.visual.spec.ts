import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { installDeterministicMarketApi } from './fixtures/marketApi';

const phase = process.env.UI_OVERHAUL_CAPTURE;
const suite = process.env.UI_OVERHAUL_SUITE;
const outputRoot = path.join(process.cwd(), 'e2e-artifacts', 'ui-overhaul', 'ui2', phase || 'disabled');
const EXACT_EXPIRATION = 1_798_761_600;
const NEAR_EXPIRATION = 1_789_689_600;

const watchlist = [{
  id: 'TQQQ|put|2027-01-01|90', ticker: 'TQQQ', expiry: '2027-01-01', expiryTimestamp: EXACT_EXPIRATION,
  expiryFormatted: "Jan 1 '27", strike: 90, optionType: 'put', addedAt: 1_787_200_000_000,
  savedAt: 1_787_200_000_000, updatedAt: 1_787_200_000_000, note: 'UI-2 discovery workflow fixture',
  status: 'live', snapshot: { underlyingPrice: 100, bid: 2, ask: 2.2, last: 2.1, delta: -0.2, iv: 48, dte: 127, openInterest: 900, volume: 120 },
}];

const portfolio = [{
  id: 'ui2-open-tqqq', ticker: 'TQQQ', optionType: 'put', strike: 90, expiration: '2027-01-01', contracts: 1,
  soldPrice: 2, soldDate: '2026-08-20', status: 'open', notes: 'UI-2 fixture',
  createdAt: '2026-08-20T12:00:00.000Z', updatedAt: '2026-08-20T12:00:00.000Z', entryVixClose: 17.8,
  latestMarketData: { underlyingPrice: 100, optionBid: 1, optionAsk: 1.2, optionLast: 1.1, delta: -0.2, iv: 48, openInterest: 900, volume: 120, refreshedAt: '2026-08-27T12:00:00.000Z' },
}];

const overflows: Array<{ project: string; name: string; url: string; pageOverflow: boolean; rootScrollWidth: number; rootClientWidth: number }> = [];

async function settle(page: Page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(250);
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  const directory = path.join(outputRoot, testInfo.project.name);
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, `${name}.png`), animations: 'disabled' });
  const overflow = await page.evaluate(() => ({
    pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    rootScrollWidth: document.documentElement.scrollWidth,
    rootClientWidth: document.documentElement.clientWidth,
  }));
  overflows.push({ project: testInfo.project.name, name, url: page.url(), ...overflow });
}

async function seed(page: Page) {
  await page.addInitScript(({ nearExpiration, expiration, watchlistValue, portfolioValue }) => {
    if (sessionStorage.getItem('put_scanner_ui2_seeded') === 'true') return;
    sessionStorage.setItem('put_scanner_ui2_seeded', 'true');
    localStorage.setItem('scanner_option_expirations_v1', JSON.stringify({ TQQQ: { dates: [nearExpiration, expiration], updatedAt: '2026-08-27T12:00:00.000Z' } }));
    localStorage.setItem('put_scanner_watchlist', JSON.stringify(watchlistValue));
    localStorage.setItem('put_scanner_portfolio_trades', JSON.stringify(portfolioValue));
    localStorage.removeItem('put_scanner_debug_layout');
    localStorage.removeItem('put_scanner_debug_network');
  }, { nearExpiration: NEAR_EXPIRATION, expiration: EXACT_EXPIRATION, watchlistValue: watchlist, portfolioValue: portfolio });
}

async function openScanner(page: Page) {
  await page.goto('/');
  await expect(page.getByText('Analyze Ticker').first()).toBeVisible();
  await settle(page);
}

async function openDetail(page: Page, ticker = 'TQQQ') {
  await page.goto(`/options/${ticker}`);
  await expect(page.getByText(ticker, { exact: true }).first()).toBeVisible();
  await settle(page);
}

async function clearScannerPriceCache(page: Page) {
  await page.evaluate(() => {
    for (const key of ['price_cache_batch_v5', 'price_cache_batch_v4', 'prices_cache']) localStorage.removeItem(key);
  });
}

test.describe('UI-2 discovery workflow visual matrix', () => {
  test.skip(!(phase === 'before' || phase === 'after') || suite !== 'ui2', 'Run through npm run visual:ui2 -- before|after.');

  test.beforeEach(async ({ page }) => {
    await seed(page);
  });

  test('capture Scanner, ticker detail, and Option Drawer workflow', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const marketHarness = await installDeterministicMarketApi(page);
    const project = testInfo.project.name;

    if (project === 'desktop-1440x900') {
      await openScanner(page);
      await capture(page, testInfo, 'scanner-default-populated');
      await page.getByPlaceholder(/Filter by ticker/i).fill('TQQQ');
      await page.getByRole('button', { name: '3x', exact: true }).click();
      await capture(page, testInfo, 'scanner-filters-active');
      await page.getByPlaceholder(/Filter by ticker/i).fill('');
      await page.locator('.scanner-desktop-controls select').first().selectOption('lte_30dte');
      await capture(page, testInfo, 'scanner-different-expiry');

      await openDetail(page);
      await capture(page, testInfo, 'detail-leveraged-etf');
      const expiryButton = page.getByRole('button', { name: /Jan 29 '27/ });
      if (await expiryButton.count()) {
        await expiryButton.click();
        await capture(page, testInfo, 'detail-after-expiry-switch');
      }
      await openDetail(page);
      await expect(page.getByRole('row').filter({ hasText: '90.00' }).last()).toBeVisible();
      await capture(page, testInfo, 'option-table');
      await page.getByRole('row').filter({ hasText: '90.00' }).last().click();
      await expect(page.getByRole('complementary')).toBeVisible();
      await capture(page, testInfo, 'option-drawer-calculator');

      await openDetail(page, 'SPY');
      await capture(page, testInfo, 'detail-normal-etf');
      await openDetail(page);

      for (const theme of ['light', 'dark', 'sepia', 'dark-blue']) {
        await page.goto('/');
        await page.evaluate(value => localStorage.setItem('put_scanner_theme', value), theme);
        await page.reload();
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await settle(page);
        await capture(page, testInfo, `theme-${theme}-scanner`);
        await openDetail(page);
        await capture(page, testInfo, `theme-${theme}-detail`);
        await page.getByRole('row').filter({ hasText: '90.00' }).last().click();
        await expect(page.getByRole('complementary')).toBeVisible();
        await capture(page, testInfo, `theme-${theme}-drawer`);
      }
    } else if (project === 'portrait-390x844') {
      await openScanner(page);
      await capture(page, testInfo, 'scanner-mobile');
      await page.getByRole('button', { name: /Filters/ }).click();
      await expect(page.getByText('Scanner filters', { exact: true })).toBeVisible();
      await capture(page, testInfo, 'scanner-mobile-filters-open');
      await openDetail(page);
      await capture(page, testInfo, 'detail-mobile');
      await page.locator('article.mobile-option-row').first().getByRole('button', { name: /Open details/ }).click({ force: true });
      await expect(page.getByRole('dialog')).toBeVisible();
      await capture(page, testInfo, 'option-drawer-mobile');
    } else if (project === 'landscape-844x390') {
      await openScanner(page);
      await capture(page, testInfo, 'scanner-landscape');
      await openDetail(page);
      await capture(page, testInfo, 'detail-landscape');
      await page.locator('article.mobile-option-row').first().getByRole('button', { name: /Open details/ }).click({ force: true });
      await expect(page.getByRole('dialog')).toBeVisible();
      await capture(page, testInfo, 'option-drawer-landscape');
    } else {
      await openScanner(page);
      await capture(page, testInfo, 'scanner-responsive');
      await openDetail(page);
      await capture(page, testInfo, 'detail-responsive');
    }

    if (project === 'desktop-1280x800') {
      marketHarness.delays.set('prices', 1_200);
      await clearScannerPriceCache(page);
      await page.goto('/');
      await expect(page.getByText('Analyze Ticker').first()).toBeVisible();
      await capture(page, testInfo, 'scanner-loading');
    }
    if (project === 'tablet-1024x768') {
      marketHarness.failNext.add('prices');
      await clearScannerPriceCache(page);
      await page.goto('/');
      await expect(page.getByText('Analyze Ticker').first()).toBeVisible();
      await page.waitForTimeout(600);
      await capture(page, testInfo, 'scanner-error-or-partial');
    }

    await mkdir(outputRoot, { recursive: true });
    await writeFile(path.join(outputRoot, `overflow-report-${project}.json`), `${JSON.stringify(overflows.filter(entry => entry.project === project), null, 2)}\n`, 'utf8');
  });
});
