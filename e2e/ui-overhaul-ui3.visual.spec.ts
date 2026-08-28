import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { installDeterministicMarketApi } from './fixtures/marketApi';

const phase = process.env.UI_OVERHAUL_CAPTURE;
const suite = process.env.UI_OVERHAUL_SUITE;
const outputRoot = path.join(process.cwd(), 'e2e-artifacts', 'ui-overhaul', 'ui3', phase || 'disabled');
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
  { id: 'ui3-open-tqqq', ticker: 'TQQQ', optionType: 'put', strike: 90, expiration: '2027-01-01', contracts: 2, soldPrice: 3, soldDate: '2026-08-20', status: 'open', notes: 'Close candidate: target reached; compare against Feb expiry.', createdAt: '2026-08-20T12:00:00.000Z', updatedAt: '2026-08-20T12:00:00.000Z', entryVixClose: 17.8, latestMarketData: { underlyingPrice: 100, optionBid: 1, optionAsk: 1.2, optionLast: 1.1, delta: -0.2, iv: 48, openInterest: 900, volume: 120, refreshedAt: '2026-08-27T12:00:00.000Z', availabilityStatus: 'live' } },
  { id: 'ui3-open-spy', ticker: 'SPY', optionType: 'put', strike: 95, expiration: '2027-01-01', contracts: 1, soldPrice: 2.4, soldDate: '2026-08-18', status: 'open', notes: 'Core index premium; monitor stale quote.', createdAt: '2026-08-18T12:00:00.000Z', updatedAt: '2026-08-18T12:00:00.000Z', entryVixClose: 18.2, latestMarketData: { underlyingPrice: 104, optionBid: 1.7, optionAsk: 1.9, optionLast: 1.8, delta: -0.26, iv: 42, openInterest: 1200, volume: 240, refreshedAt: '2026-08-20T12:00:00.000Z', availabilityStatus: 'stale' } },
  { id: 'ui3-open-qqq', ticker: 'QQQ', optionType: 'put', strike: 88, expiration: '2027-02-19', contracts: 3, soldPrice: 2.25, soldDate: '2026-08-15', status: 'open', notes: 'Second expiry concentration; lower delta.', createdAt: '2026-08-15T12:00:00.000Z', updatedAt: '2026-08-15T12:00:00.000Z', entryVixClose: 19.1, latestMarketData: { underlyingPrice: 101, optionBid: 0.9, optionAsk: 1.1, optionLast: 1, delta: -0.18, iv: 39, openInterest: 1800, volume: 300, refreshedAt: '2026-08-27T12:00:00.000Z', availabilityStatus: 'live' } },
  { id: 'ui3-open-soxl', ticker: 'SOXL', optionType: 'put', strike: 70, expiration: '2026-12-18', contracts: 1, soldPrice: 4.5, soldDate: '2026-08-12', status: 'open', notes: 'Stale quote / review liquidity before adjusting.', createdAt: '2026-08-12T12:00:00.000Z', updatedAt: '2026-08-12T12:00:00.000Z', entryVixClose: 22.4, latestMarketData: { underlyingPrice: 72, optionBid: null, optionAsk: null, optionLast: null, delta: -0.42, iv: 68, openInterest: null, volume: null, refreshedAt: '2026-08-10T12:00:00.000Z', availabilityStatus: 'unavailable' } },
  { id: 'ui3-closed-qqq', ticker: 'QQQ', optionType: 'put', strike: 82, expiration: '2026-08-21', contracts: 1, soldPrice: 2.25, soldDate: '2026-07-15', status: 'closed', closePrice: 0.55, closeDate: '2026-08-12', realizedPnl: 170, percentCaptured: 0.756, notes: 'Closed at target; realized gain.', createdAt: '2026-07-15T12:00:00.000Z', updatedAt: '2026-08-12T12:00:00.000Z', entryVixClose: 19.1 },
  { id: 'ui3-expired-spy', ticker: 'SPY', optionType: 'put', strike: 90, expiration: '2026-07-17', contracts: 1, soldPrice: 1.8, soldDate: '2026-06-20', status: 'expired', expirationClosePrice: 0, expirationCloseDate: '2026-07-17', finalOptionValue: 0, realizedPnl: 180, percentCaptured: 1, resolutionType: 'expired_worthless', resolvedDate: '2026-07-17', notes: 'Expired worthless.', createdAt: '2026-06-20T12:00:00.000Z', updatedAt: '2026-07-17T12:00:00.000Z' },
];

type OverflowSnapshot = { project: string; name: string; url: string; pageOverflow: boolean; rootScrollWidth: number; rootClientWidth: number };
const overflows: OverflowSnapshot[] = [];

async function settle(page: Page) { await page.waitForLoadState('domcontentloaded'); await page.waitForTimeout(350); }
async function capture(page: Page, testInfo: TestInfo, name: string) {
  const directory = path.join(outputRoot, testInfo.project.name);
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, `${name}.png`), animations: 'disabled', fullPage: false });
  const overflow = await page.evaluate(() => ({ pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1, rootScrollWidth: document.documentElement.scrollWidth, rootClientWidth: document.documentElement.clientWidth }));
  overflows.push({ project: testInfo.project.name, name, url: page.url(), ...overflow });
}

async function seed(page: Page) {
  await page.addInitScript(({ watchlistValue, portfolioValue }) => {
    if (sessionStorage.getItem('put_scanner_ui3_seeded') === 'true') return;
    sessionStorage.setItem('put_scanner_ui3_seeded', 'true');
    localStorage.setItem('put_scanner_watchlist', JSON.stringify(watchlistValue));
    localStorage.setItem('put_scanner_portfolio_trades', JSON.stringify(portfolioValue));
    localStorage.setItem('put_scanner_theme', 'dark');
    localStorage.removeItem('put_scanner_debug_layout');
    localStorage.removeItem('put_scanner_debug_network');
  }, { watchlistValue: watchlist, portfolioValue: portfolio });
}

async function openWatchlist(page: Page) { await page.goto('/watchlist'); await expect(page.locator('h1:visible').filter({ hasText: 'Watchlist' }).or(page.getByText(/saved contracts/i).first()).first()).toBeVisible({ timeout: 20_000 }); await settle(page); }
async function openPortfolio(page: Page) { await page.goto('/portfolio'); await expect(page.getByText(/^(Open Positions|Schedule of Positions)$/).first()).toBeVisible({ timeout: 20_000 }); await settle(page); }

test.describe('UI-3 portfolio and watchlist visual matrix', () => {
  test.skip(!(phase === 'before' || phase === 'after') || suite !== 'ui3', 'Run through npm run visual:ui3 -- before|after.');
  test.beforeEach(async ({ page }) => { await seed(page); });

  test('capture Watchlist → Portfolio → analytics → history workflow', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const marketHarness = await installDeterministicMarketApi(page);
    const project = testInfo.project.name;
    if (project === 'desktop-1440x900') {
      marketHarness.failuresRemaining.set('options', 1);
      await openWatchlist(page);
      await capture(page, testInfo, 'watchlist-populated-mixed-status');
      await page.locator('table').first().screenshot({ path: path.join(outputRoot, project, 'watchlist-table.png'), animations: 'disabled' });
      marketHarness.delays.set('options', 1_200);
      marketHarness.delays.set('prices', 1_200);
      await page.getByRole('button', { name: 'Refresh All' }).click();
      await page.waitForTimeout(180);
      await capture(page, testInfo, 'watchlist-refresh-loading');
      marketHarness.delays.clear();
      await page.waitForTimeout(1_300);
      await page.evaluate(value => localStorage.setItem('put_scanner_watchlist', JSON.stringify(value)), []);
      await page.reload(); await expect(page.getByText(/No saved puts/i).first()).toBeVisible(); await settle(page); await capture(page, testInfo, 'watchlist-empty');
      await page.evaluate(value => localStorage.setItem('put_scanner_watchlist', JSON.stringify(value)), watchlist);
      await page.goto('/portfolio');
      await expect(page.getByRole('heading', { name: 'Portfolio', exact: true })).toBeVisible();
      await settle(page);
      await capture(page, testInfo, 'portfolio-analytics-collapsed');
      const lastMark = page.getByRole('button', { name: 'Last', exact: true }).first();
      if (await lastMark.count()) { await lastMark.click(); await capture(page, testInfo, 'portfolio-mark-last'); await page.getByRole('button', { name: 'Ask', exact: true }).first().click(); }
      const noneGroup = page.getByRole('button', { name: 'None', exact: true }).last();
      if (await noneGroup.count()) { await noneGroup.click(); await capture(page, testInfo, 'portfolio-ungrouped'); const underlyingGroup = page.getByRole('button', { name: 'Underlying', exact: true }).last(); if (await underlyingGroup.count()) { await underlyingGroup.click(); await capture(page, testInfo, 'portfolio-grouped-underlying'); } await page.getByRole('button', { name: 'Expiry', exact: true }).last().click(); }
      await page.getByRole('button', { name: 'Expand Portfolio Analytics' }).click();
      await expect(page.getByText('Needs Attention').first()).toBeVisible();
      await capture(page, testInfo, 'portfolio-analytics-expanded');
      for (const label of ['Exposure by Ticker', 'Close Candidates', 'Schedule of Positions']) {
        const locator = page.getByText(label, { exact: false }).first();
        if (await locator.count()) { await locator.scrollIntoViewIfNeeded(); await capture(page, testInfo, `portfolio-${label.toLowerCase().replaceAll(' ', '-')}`); }
      }
      const history = page.getByText('Expired / Closed History', { exact: true });
      if (await history.count()) { await history.scrollIntoViewIfNeeded(); await capture(page, testInfo, 'portfolio-history'); }
      const firstPosition = page.locator('[data-trade-id]:visible').first();
      const strikeButton = firstPosition.locator('button').first();
      if (await strikeButton.count()) { await strikeButton.click(); await expect(page.getByRole('complementary')).toBeVisible({ timeout: 10_000 }); await capture(page, testInfo, 'portfolio-trade-drawer'); await page.getByRole('button', { name: 'Close option detail drawer' }).last().click(); }
      await openWatchlist(page);
      for (const theme of ['light', 'dark', 'sepia', 'dark-blue']) {
        await page.evaluate(value => localStorage.setItem('put_scanner_theme', value), theme);
        await page.reload(); await expect(page.locator('html')).toHaveAttribute('data-theme', theme); await settle(page); await capture(page, testInfo, `theme-${theme}-watchlist`);
        await openPortfolio(page); await capture(page, testInfo, `theme-${theme}-portfolio-collapsed`);
        await page.getByRole('button', { name: 'Expand Portfolio Analytics' }).click(); await capture(page, testInfo, `theme-${theme}-portfolio-expanded`);
        const themePosition = page.locator('[data-trade-id]:visible').first();
        const themeStrike = themePosition.locator('button').first();
        if (await themeStrike.count()) { await themeStrike.click(); if (await page.getByRole('complementary').count()) { await capture(page, testInfo, `theme-${theme}-portfolio-drawer`); await page.getByRole('button', { name: 'Close option detail drawer' }).last().click(); } }
      }
    } else if (project === 'tablet-1024x768') {
      await openWatchlist(page); await capture(page, testInfo, 'watchlist-tablet');
      await openPortfolio(page); await capture(page, testInfo, 'portfolio-tablet-collapsed');
      await page.getByRole('button', { name: 'Expand Portfolio Analytics' }).click(); await capture(page, testInfo, 'portfolio-tablet-expanded');
    } else if (project === 'portrait-430x932' || project === 'portrait-390x844' || project === 'portrait-375x667') {
      await openWatchlist(page); await capture(page, testInfo, 'watchlist-mobile');
      await openPortfolio(page); await capture(page, testInfo, 'portfolio-mobile-headline');
      const analytics = page.getByRole('button', { name: /Portfolio Analytics/ }).first();
      if (await analytics.count()) { await analytics.click(); await analytics.scrollIntoViewIfNeeded(); await capture(page, testInfo, 'portfolio-mobile-analytics'); }
      const history = page.getByRole('button', { name: /History/ }).first();
      if (await history.count()) { await history.click(); await page.getByText('History', { exact: true }).last().scrollIntoViewIfNeeded(); await capture(page, testInfo, 'portfolio-mobile-history'); }
    } else if (project === 'landscape-844x390' || project === 'landscape-667x375') {
      await openWatchlist(page); await capture(page, testInfo, 'watchlist-landscape');
      await openPortfolio(page); await capture(page, testInfo, 'portfolio-landscape');
      const analytics = page.getByRole('button', { name: /Portfolio Analytics/ }).first();
      if (await analytics.count()) { await analytics.click(); await analytics.scrollIntoViewIfNeeded(); await capture(page, testInfo, 'portfolio-landscape-analytics'); }
    } else {
      await openWatchlist(page); await capture(page, testInfo, 'watchlist-responsive');
      await openPortfolio(page); await capture(page, testInfo, 'portfolio-responsive');
    }
    await mkdir(outputRoot, { recursive: true });
    await writeFile(path.join(outputRoot, `overflow-report-${project}.json`), `${JSON.stringify(overflows.filter(entry => entry.project === project), null, 2)}\n`, 'utf8');
  });
});
