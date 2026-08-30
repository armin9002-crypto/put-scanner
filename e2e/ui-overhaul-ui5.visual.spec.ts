import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { installDeterministicMarketApi } from './fixtures/marketApi';

const phase = process.env.UI_OVERHAUL_CAPTURE;
const suite = process.env.UI_OVERHAUL_SUITE;
const outputRoot = path.join(process.cwd(), 'e2e-artifacts', 'ui-overhaul', 'ui5', phase || 'disabled');
const EXPIRY_JAN = 1_798_761_600;
const EXPIRY_FEB = 1_802_995_200;
const EXPIRY_DEC = 1_797_552_000;

const watchlist = [
  { id: 'TQQQ|put|2027-01-01|90', ticker: 'TQQQ', expiry: '2027-01-01', expiryTimestamp: EXPIRY_JAN, expiryFormatted: "Jan 1 '27", strike: 90, optionType: 'put', addedAt: 1_787_200_000_000, savedAt: 1_787_200_000_000, updatedAt: 1_787_200_000_000, note: 'Core income sleeve — review at 50% captured; keep downside buffer intact.', status: 'live', snapshot: { underlyingPrice: 100, bid: 2, ask: 2.2, last: 2.1, delta: -0.2, iv: 48, dte: 127, openInterest: 900, volume: 120 } },
  { id: 'SPY|put|2027-01-01|95', ticker: 'SPY', expiry: '2027-01-01', expiryTimestamp: EXPIRY_JAN, expiryFormatted: "Jan 1 '27", strike: 95, optionType: 'put', addedAt: 1_787_200_100_000, savedAt: 1_787_200_100_000, updatedAt: 1_787_000_000_000, note: 'Index hedge; stale mark is expected until the next quote window.', status: 'stale', snapshot: { underlyingPrice: 104, bid: 1.7, ask: 1.9, last: 1.8, delta: -0.26, iv: 42, dte: 127, openInterest: 1200, volume: 240 } },
  { id: 'QQQ|put|2027-02-19|80', ticker: 'QQQ', expiry: '2027-02-19', expiryTimestamp: EXPIRY_FEB, expiryFormatted: "Feb 19 '27", strike: 80, optionType: 'put', addedAt: 1_787_200_200_000, savedAt: 1_787_200_200_000, updatedAt: 1_787_200_200_000, note: 'Strike unavailable in the latest chain; retain for review.', status: 'unavailable', snapshot: { underlyingPrice: 100, bid: null, ask: null, last: null, delta: null, iv: null, dte: 176 } },
  { id: 'SOXL|put|2026-12-18|95', ticker: 'SOXL', expiry: '2026-12-18', expiryTimestamp: EXPIRY_DEC, expiryFormatted: "Dec 18 '26", strike: 95, optionType: 'put', addedAt: 1_787_200_300_000, savedAt: 1_787_200_300_000, updatedAt: 1_787_200_300_000, note: '', status: 'refresh_failed', snapshot: { underlyingPrice: 72, bid: 4, ask: 4.4, last: 4.2, delta: -0.35, iv: 68, dte: 112, openInterest: 400, volume: 80 } },
];

const portfolio = [
  { id: 'ui5-open-tqqq', ticker: 'TQQQ', optionType: 'put', strike: 90, expiration: '2027-01-01', contracts: 2, soldPrice: 3, soldDate: '2026-08-20', status: 'open', notes: 'Close candidate: target reached; compare against Feb expiry.', createdAt: '2026-08-20T12:00:00.000Z', updatedAt: '2026-08-20T12:00:00.000Z', entryVixClose: 17.8, latestMarketData: { underlyingPrice: 100, optionBid: 1, optionAsk: 1.2, optionLast: 1.1, delta: -0.2, iv: 48, openInterest: 900, volume: 120, refreshedAt: '2026-08-27T12:00:00.000Z', availabilityStatus: 'live' } },
  { id: 'ui5-open-spy', ticker: 'SPY', optionType: 'put', strike: 95, expiration: '2027-01-01', contracts: 1, soldPrice: 2.4, soldDate: '2026-08-18', status: 'open', notes: 'Core index premium; monitor stale quote.', createdAt: '2026-08-18T12:00:00.000Z', updatedAt: '2026-08-18T12:00:00.000Z', entryVixClose: 18.2, latestMarketData: { underlyingPrice: 104, optionBid: 1.7, optionAsk: 1.9, optionLast: 1.8, delta: -0.26, iv: 42, openInterest: 1200, volume: 240, refreshedAt: '2026-08-20T12:00:00.000Z', availabilityStatus: 'stale' } },
  { id: 'ui5-open-qqq', ticker: 'QQQ', optionType: 'put', strike: 88, expiration: '2027-02-19', contracts: 3, soldPrice: 2.25, soldDate: '2026-08-15', status: 'open', notes: 'Second expiry concentration; lower delta.', createdAt: '2026-08-15T12:00:00.000Z', updatedAt: '2026-08-15T12:00:00.000Z', entryVixClose: 19.1, latestMarketData: { underlyingPrice: 101, optionBid: 0.9, optionAsk: 1.1, optionLast: 1, delta: -0.18, iv: 39, openInterest: 1800, volume: 300, refreshedAt: '2026-08-27T12:00:00.000Z', availabilityStatus: 'live' } },
  { id: 'ui5-open-soxl', ticker: 'SOXL', optionType: 'put', strike: 70, expiration: '2026-12-18', contracts: 1, soldPrice: 4.5, soldDate: '2026-08-12', status: 'open', notes: 'Stale quote / review liquidity before adjusting.', createdAt: '2026-08-12T12:00:00.000Z', updatedAt: '2026-08-12T12:00:00.000Z', entryVixClose: 22.4, latestMarketData: { underlyingPrice: 72, optionBid: null, optionAsk: null, optionLast: null, delta: -0.42, iv: 68, openInterest: null, volume: null, refreshedAt: '2026-08-10T12:00:00.000Z', availabilityStatus: 'unavailable' } },
  { id: 'ui5-closed-qqq', ticker: 'QQQ', optionType: 'put', strike: 82, expiration: '2026-08-21', contracts: 1, soldPrice: 2.25, soldDate: '2026-07-15', status: 'closed', closePrice: 0.55, closeDate: '2026-08-12', realizedPnl: 170, percentCaptured: 0.756, notes: 'Closed at target; realized gain.', createdAt: '2026-07-15T12:00:00.000Z', updatedAt: '2026-08-12T12:00:00.000Z', entryVixClose: 19.1 },
  { id: 'ui5-expired-spy', ticker: 'SPY', optionType: 'put', strike: 90, expiration: '2026-07-17', contracts: 1, soldPrice: 1.8, soldDate: '2026-06-20', status: 'expired', expirationClosePrice: 0, expirationCloseDate: '2026-07-17', finalOptionValue: 0, realizedPnl: 180, percentCaptured: 1, resolutionType: 'expired_worthless', resolvedDate: '2026-07-17', notes: 'Expired worthless.', createdAt: '2026-06-20T12:00:00.000Z', updatedAt: '2026-07-17T12:00:00.000Z' },
];

type LayoutSnapshot = {
  project: string;
  name: string;
  url: string;
  pageOverflow: boolean;
  rootScrollWidth: number;
  rootClientWidth: number;
  scrollX: number;
  pageHeaderLeft: number | null;
  unboundedHorizontalOverflow: string[];
};
const layouts: LayoutSnapshot[] = [];

async function settle(page: Page, ms = 350) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(ms);
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  const directory = path.join(outputRoot, testInfo.project.name);
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, `${name}.png`), animations: 'disabled', fullPage: false });
  const layout = await page.evaluate(() => {
    const overflowing = Array.from(document.querySelectorAll<HTMLElement>('body *')).filter(element => {
      if (element.classList.contains('sr-only')) return false;
      if (element.closest('[role="tooltip"]')) return false;
      if (element.closest('.overflow-x-auto, .overflow-auto, .touch-scroll')) return false;
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      return rect.left < -2 || rect.right > document.documentElement.clientWidth + 2;
    }).slice(0, 12).map(element => `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${element.classList.length ? `.${Array.from(element.classList).slice(0, 2).join('.')}` : ''}`);
    const pageHeader = document.querySelector<HTMLElement>('.page-header');
    return {
      pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      rootScrollWidth: document.documentElement.scrollWidth,
      rootClientWidth: document.documentElement.clientWidth,
      scrollX: window.scrollX,
      pageHeaderLeft: pageHeader ? Math.round(pageHeader.getBoundingClientRect().left * 10) / 10 : null,
      unboundedHorizontalOverflow: overflowing,
    };
  });
  layouts.push({ project: testInfo.project.name, name, url: page.url(), ...layout });
}

async function loadScreener(page: Page) {
  await page.getByRole('button', { name: /Load|Run Screener/i }).first().click();
  const confirm = page.getByRole('button', { name: /Run scan|Confirm/i });
  if (await confirm.count()) await confirm.first().click();
  await expect(page.getByText(/visible after local filters|Showing \d+ results/).first()).toBeVisible({ timeout: 30_000 });
}

async function openDetail(page: Page, ticker: string) {
  await page.goto(`/options/${ticker}`);
  await expect(page.getByText(ticker, { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  await settle(page);
}

async function openPortfolio(page: Page) {
  await page.goto('/portfolio');
  await expect(page.getByText(/^(Open Positions|Schedule of Positions)$/).first()).toBeVisible({ timeout: 20_000 });
  await settle(page);
}

async function captureCoreRoutes(page: Page, testInfo: TestInfo) {
  await page.goto('/'); await expect(page.getByPlaceholder(/Filter \/ Search by Ticker/i).first()).toBeVisible(); await settle(page); await capture(page, testInfo, 'scanner');
  await page.goto('/screener'); await expect(page.getByRole('button', { name: /Load|Run Screener/i }).first()).toBeVisible(); await settle(page); await capture(page, testInfo, 'screener');
  await page.goto('/watchlist'); await expect(page.getByText(/saved contracts/i).first()).toBeVisible(); await settle(page); await capture(page, testInfo, 'watchlist');
  await openPortfolio(page); await capture(page, testInfo, 'portfolio');
  await openDetail(page, 'TQQQ'); await capture(page, testInfo, 'detail');
  await page.goto('/pulse');
  await expect(page.getByRole('link').filter({ hasText: /^AGQ/ }).first()).toBeVisible({ timeout: 30_000 });
  await capture(page, testInfo, 'pulse');
}

async function captureDesktop(page: Page, testInfo: TestInfo) {
  const harness = await installDeterministicMarketApi(page);
  await page.goto('/'); await expect(page.getByPlaceholder(/Filter \/ Search by Ticker/i).first()).toBeVisible(); await settle(page); await capture(page, testInfo, 'scanner-default');
  await page.getByPlaceholder(/Filter \/ Search by Ticker/i).fill('TQQQ'); await page.getByRole('button', { name: '3x', exact: true }).click(); await capture(page, testInfo, 'scanner-filters-active');
  harness.delays.set('prices', 900); await page.evaluate(() => { for (const key of ['price_cache_batch_v5', 'price_cache_batch_v4', 'prices_cache']) localStorage.removeItem(key); }); await page.reload(); await page.waitForTimeout(160); await capture(page, testInfo, 'scanner-loading'); harness.delays.delete('prices');

  await page.goto('/screener'); await expect(page.getByRole('button', { name: /Load|Run Screener/i }).first()).toBeVisible(); await settle(page); await capture(page, testInfo, 'screener-initial');
  await loadScreener(page); await capture(page, testInfo, 'screener-populated');
  harness.failNext.add('screener-batch'); await page.reload(); await loadScreener(page); await expect(page.getByText(/Some results could not be loaded/i).first()).toBeVisible({ timeout: 30_000 }); await capture(page, testInfo, 'screener-partial');

  harness.failuresRemaining.set('options', 1); await page.goto('/watchlist'); await expect(page.getByText(/saved contracts/i).first()).toBeVisible(); await settle(page); await capture(page, testInfo, 'watchlist-populated-stale-partial');
  await openPortfolio(page); await capture(page, testInfo, 'portfolio-analytics-collapsed');
  await page.getByRole('button', { name: 'Expand Portfolio Analytics' }).click(); await expect(page.getByText('Needs Attention').first()).toBeVisible(); await capture(page, testInfo, 'portfolio-analytics-expanded');
  const underlying = page.getByRole('button', { name: 'Underlying', exact: true }).last(); if (await underlying.count()) { await underlying.click(); await capture(page, testInfo, 'portfolio-grouped-positions'); }
  const history = page.getByText('Expired / Closed History', { exact: true }); if (await history.count()) { await history.scrollIntoViewIfNeeded(); await capture(page, testInfo, 'portfolio-history'); }

  await openDetail(page, 'TQQQ'); await capture(page, testInfo, 'detail-leveraged-etf');
  const table = page.getByRole('table').last(); if (await table.count()) await table.screenshot({ path: path.join(outputRoot, testInfo.project.name, 'detail-option-table.png'), animations: 'disabled' });
  const row = page.getByRole('row').filter({ hasText: '90.00' }).last(); await row.click(); await expect(page.getByRole('complementary')).toBeVisible(); await capture(page, testInfo, 'option-drawer-normal');
  await page.getByRole('textbox', { name: 'Contracts' }).fill('3'); await page.getByRole('spinbutton', { name: 'Sold Price', exact: true }).fill('2.05'); await capture(page, testInfo, 'option-drawer-calculator-populated');
  await openDetail(page, 'SPY'); await capture(page, testInfo, 'detail-normal-etf');
  await openDetail(page, 'AAPL'); await expect(page.getByRole('heading', { name: /No listed puts found/i })).toBeVisible(); await capture(page, testInfo, 'detail-stock');

  harness.delays.set('etf-pulse', 900); await page.goto('/pulse'); await expect(page.getByRole('status', { name: 'ETF Pulse loading' })).toBeVisible(); await capture(page, testInfo, 'pulse-loading-progress'); await expect(page.getByRole('link', { name: 'AGQ', exact: true })).toBeVisible({ timeout: 30_000 }); await capture(page, testInfo, 'pulse-populated'); harness.delays.delete('etf-pulse');
  await page.goto('/?account-ui-fixture=synced'); await expect(page.getByRole('dialog')).toBeVisible(); await capture(page, testInfo, 'account-signed-in-synced');

  const browser = page.context().browser();
  if (!browser) throw new Error('UI-5 theme capture requires a browser-backed context.');
  const themeContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await themeContext.addInitScript(({ watchlistValue, portfolioValue, expiration }) => {
    localStorage.setItem('put_scanner_watchlist', JSON.stringify(watchlistValue));
    localStorage.setItem('put_scanner_portfolio_trades', JSON.stringify(portfolioValue));
    localStorage.setItem('scanner_option_expirations_v1', JSON.stringify({ TQQQ: { dates: [expiration], updatedAt: '2026-08-27T12:00:00.000Z' } }));
    if (!localStorage.getItem('put_scanner_theme')) localStorage.setItem('put_scanner_theme', 'dark');
  }, { watchlistValue: watchlist, portfolioValue: portfolio, expiration: EXPIRY_JAN });
  const themePage = await themeContext.newPage();
  await installDeterministicMarketApi(themePage);
  for (const theme of ['dark', 'dark-blue', 'light', 'sepia']) {
    await themePage.goto('/');
    await themePage.evaluate(value => localStorage.setItem('put_scanner_theme', value), theme);
    await themePage.reload();
    await expect(themePage.locator('.instrument-card').first()).toContainText('$100.00', { timeout: 30_000 });
    await capture(themePage, testInfo, `theme-${theme}-scanner`);
    await openPortfolio(themePage); await capture(themePage, testInfo, `theme-${theme}-portfolio`);
    await openDetail(themePage, 'TQQQ'); await capture(themePage, testInfo, `theme-${theme}-detail`);
    await themePage.goto('/screener'); await settle(themePage); await capture(themePage, testInfo, `theme-${theme}-screener`);
  }
  await themeContext.close();
}

test.describe('UI-5 complete deterministic visual review', () => {
  test.skip(!(phase === 'baseline' || phase === 'final') || suite !== 'ui5', 'Run through npm run visual:ui5 -- baseline|final.');
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(({ watchlistValue, portfolioValue, expiration }) => {
      localStorage.setItem('put_scanner_watchlist', JSON.stringify(watchlistValue));
      localStorage.setItem('put_scanner_portfolio_trades', JSON.stringify(portfolioValue));
      localStorage.setItem('scanner_option_expirations_v1', JSON.stringify({ TQQQ: { dates: [expiration], updatedAt: '2026-08-27T12:00:00.000Z' } }));
      if (!localStorage.getItem('put_scanner_theme')) localStorage.setItem('put_scanner_theme', 'dark');
      localStorage.removeItem('put_scanner_debug_layout');
      localStorage.removeItem('put_scanner_debug_network');
    }, { watchlistValue: watchlist, portfolioValue: portfolio, expiration: EXPIRY_JAN });
  });

  test('capture every primary route, state, viewport, and representative theme', async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    const project = testInfo.project.name;
    if (project === 'desktop-1440x900') await captureDesktop(page, testInfo);
    else {
      await installDeterministicMarketApi(page);
      await captureCoreRoutes(page, testInfo);
      if (project === 'portrait-390x844' || project === 'landscape-844x390') {
        await openDetail(page, 'TQQQ');
        const option = page.locator('article.mobile-option-row').first().getByRole('button', { name: /Open details/ });
        if (await option.count()) { await option.click({ force: true }); await expect(page.getByRole('dialog')).toBeVisible(); await capture(page, testInfo, 'option-drawer'); }
        await page.goto('/?account-ui-fixture=synced'); await expect(page.getByRole('dialog')).toBeVisible(); await capture(page, testInfo, 'account');
      }
    }
    await mkdir(outputRoot, { recursive: true });
    await writeFile(path.join(outputRoot, `layout-report-${project}.json`), `${JSON.stringify(layouts.filter(entry => entry.project === project), null, 2)}\n`, 'utf8');
  });
});
