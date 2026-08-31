import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { installDeterministicMarketApi } from './fixtures/marketApi';
import { installDeterministicCloudAccount } from './fixtures/cloudAccount';

const phase = process.env.UI_OVERHAUL_CAPTURE;
const outputRoot = path.join(process.cwd(), 'e2e-artifacts', 'ui-overhaul', phase || 'disabled');
const EXACT_EXPIRATION = 1_798_761_600;
const NEAR_EXPIRATION = 1_789_689_600;

const watchlist = [{
  id: 'TQQQ|put|2027-01-01|90', ticker: 'TQQQ', expiry: '2027-01-01', expiryTimestamp: EXACT_EXPIRATION,
  expiryFormatted: "Jan 1 '27", strike: 90, optionType: 'put', addedAt: 1_787_200_000_000,
  savedAt: 1_787_200_000_000, updatedAt: 1_787_200_000_000, note: 'Income position · review at 50% captured',
  status: 'live', snapshot: { underlyingPrice: 100, bid: 2, ask: 2.2, last: 2.1, delta: -0.2, iv: 48, dte: 127, openInterest: 900, volume: 120 },
}];

const portfolio = [
  {
    id: 'ui1-open-tqqq', ticker: 'TQQQ', optionType: 'put', strike: 90, expiration: '2027-01-01', contracts: 2,
    soldPrice: 3, soldDate: '2026-08-20', status: 'open', notes: 'Close Candidate: target reached',
    createdAt: '2026-08-20T12:00:00.000Z', updatedAt: '2026-08-20T12:00:00.000Z', entryVixClose: 17.8,
    latestMarketData: { underlyingPrice: 100, optionBid: 1, optionAsk: 1.2, optionLast: 1.1, delta: -0.2, iv: 48, openInterest: 900, volume: 120, refreshedAt: '2026-08-27T12:00:00.000Z' },
  },
  {
    id: 'ui1-open-spy', ticker: 'SPY', optionType: 'put', strike: 95, expiration: '2027-01-29', contracts: 1,
    soldPrice: 2.4, soldDate: '2026-08-18', status: 'open', notes: 'Core index premium',
    createdAt: '2026-08-18T12:00:00.000Z', updatedAt: '2026-08-18T12:00:00.000Z', entryVixClose: 18.2,
    latestMarketData: { underlyingPrice: 104, optionBid: 1.7, optionAsk: 1.9, optionLast: 1.8, delta: -0.26, iv: 42, openInterest: 1200, volume: 240, refreshedAt: '2026-08-27T12:00:00.000Z' },
  },
  {
    id: 'ui1-closed-qqq', ticker: 'QQQ', optionType: 'put', strike: 88, expiration: '2026-08-21', contracts: 1,
    soldPrice: 2.25, soldDate: '2026-07-15', status: 'closed', closePrice: 0.55, closeDate: '2026-08-12', notes: 'Closed at target',
    createdAt: '2026-07-15T12:00:00.000Z', updatedAt: '2026-08-12T12:00:00.000Z', entryVixClose: 19.1,
  },
];

type OverflowSnapshot = {
  project: string;
  name: string;
  url: string;
  pageOverflow: boolean;
  rootScrollWidth: number;
  rootClientWidth: number;
};

const overflows: OverflowSnapshot[] = [];

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

async function captureDesktop(page: Page, testInfo: TestInfo, marketHarness: Awaited<ReturnType<typeof installDeterministicMarketApi>>) {
  await page.goto('/');
  await expect(page.getByPlaceholder(/Filter \/ Search by Ticker/i).first()).toBeVisible();
  await settle(page);
  await capture(page, testInfo, 'scanner');
  await page.getByPlaceholder(/Filter \/ Search by Ticker/i).fill('TQQQ');
  await page.getByRole('button', { name: '3x', exact: true }).click();
  await capture(page, testInfo, 'scanner-filters-active');

  await page.goto('/screener');
  await expect(page.getByRole('button', { name: /Load|Run Screener/i }).first()).toBeVisible();
  await capture(page, testInfo, 'screener-before-load');
  await page.getByRole('button', { name: /Load|Run Screener/i }).first().click();
  if (await page.getByRole('button', { name: /Run scan|Confirm/i }).count()) await page.getByRole('button', { name: /Run scan|Confirm/i }).click();
  await expect(page.getByText(/(?:Showing \d+ results|\d+ contracts loaded)/).first()).toBeVisible();
  await capture(page, testInfo, 'screener-populated');

  await page.goto('/watchlist');
  await expect(page.getByRole('heading', { name: 'Watchlist' })).toBeVisible();
  await capture(page, testInfo, 'watchlist-populated');

  await page.goto('/portfolio');
  await expect(page.getByRole('heading', { name: 'Portfolio', exact: true })).toBeVisible();
  await capture(page, testInfo, 'portfolio-analytics-collapsed');
  await page.getByRole('button', { name: 'Expand Portfolio Analytics' }).click();
  await expect(page.getByText('Needs Attention').first()).toBeVisible();
  await capture(page, testInfo, 'portfolio-analytics-expanded');
  const history = page.getByText('Portfolio History', { exact: true }).first();
  if (await history.count()) {
    await history.scrollIntoViewIfNeeded();
    await capture(page, testInfo, 'portfolio-history');
  }

  await page.goto('/options/SPY?expiry=2027-01-01');
  await expect(page.getByRole('row').filter({ hasText: '90.00' }).last()).toBeVisible();
  await capture(page, testInfo, 'ticker-detail');
  const optionTable = page.getByRole('table').last();
  await optionTable.screenshot({ path: path.join(outputRoot, testInfo.project.name, 'ticker-detail-option-table.png'), animations: 'disabled' });
  await page.getByRole('row').filter({ hasText: '90.00' }).last().click();
  await expect(page.getByRole('complementary')).toBeVisible();
  await capture(page, testInfo, 'option-drawer');

  await page.goto('/pulse');
  await expect(page.getByText('ETF Pulse Visuals')).toBeVisible();
  await capture(page, testInfo, 'etf-pulse');

  await page.goto('/?account-ui-fixture=synced');
  await expect(page.getByRole('dialog')).toBeVisible();
  await capture(page, testInfo, 'account-signed-in');

  await page.goto('/');
  await page.getByPlaceholder(/Filter \/ Search by Ticker/i).fill('NO_MATCH');
  await expect(page.getByText(/No ETFs match your filters/i)).toBeVisible();
  await capture(page, testInfo, 'state-empty');

  marketHarness.failuresRemaining.set('ticker-detail', 2);
  await page.goto('/options/IWM');
  await expect(page.getByRole('heading', { name: /couldn't load options/i })).toBeVisible();
  await capture(page, testInfo, 'state-error');
  marketHarness.failuresRemaining.set('ticker-detail', 0);

  for (const theme of ['light', 'dark', 'sepia', 'dark-blue']) {
    await page.goto('/');
    await page.evaluate(value => localStorage.setItem('put_scanner_theme', value), theme);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await settle(page);
    await capture(page, testInfo, `theme-${theme}`);
  }
}

async function capturePhone(page: Page, testInfo: TestInfo) {
  await page.goto('/');
  await expect(page.getByPlaceholder(/Filter \/ Search by Ticker/i).first()).toBeVisible();
  await settle(page);
  await capture(page, testInfo, 'scanner');
  await page.goto('/screener');
  await expect(page.getByRole('button', { name: 'Run Screener' })).toBeVisible();
  await capture(page, testInfo, 'screener');
  await page.goto('/watchlist');
  await expect(page.getByText('Watchlist').first()).toBeVisible();
  await capture(page, testInfo, 'watchlist');
  await page.goto('/portfolio');
  await expect(page.getByText('Portfolio Analytics', { exact: true }).first()).toBeVisible();
  await capture(page, testInfo, 'portfolio');
  await page.goto('/options/TQQQ');
  await expect(page.getByText('TQQQ', { exact: true }).first()).toBeVisible();
  await capture(page, testInfo, 'ticker-detail');
  await page.getByRole('button', { name: 'Open details for $90.00 Put' }).click();
  await expect(page.getByText('Nominal Yield').first()).toBeVisible();
  await capture(page, testInfo, 'option-drawer');
  await page.goto('/?account-ui-fixture=synced');
  await expect(page.getByRole('dialog')).toBeVisible();
  await capture(page, testInfo, 'account');
}

async function captureLandscape(page: Page, testInfo: TestInfo) {
  await page.goto('/');
  await expect(page.getByPlaceholder(/Filter \/ Search by Ticker/i).first()).toBeVisible();
  await settle(page);
  await capture(page, testInfo, 'navigation-scanner');
  await page.goto('/portfolio');
  await expect(page.getByText('Portfolio Analytics', { exact: true }).first()).toBeVisible();
  await capture(page, testInfo, 'portfolio');
  await page.goto('/options/TQQQ');
  await expect(page.getByText('TQQQ', { exact: true }).first()).toBeVisible();
  await capture(page, testInfo, 'ticker-detail');
  await page.getByRole('button', { name: 'Open details for $90.00 Put' }).click();
  await capture(page, testInfo, 'option-drawer');
}

test.describe('UI overhaul deterministic visual matrix', () => {
  test.skip(!phase, 'Run through npm run visual:ui1 -- before|after.');
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(({ expiration, nearExpiration }) => {
      localStorage.setItem('scanner_option_expirations_v1', JSON.stringify({ TQQQ: { dates: [nearExpiration, expiration], updatedAt: '2026-08-27T12:00:00.000Z' } }));
      if (!localStorage.getItem('put_scanner_theme')) localStorage.setItem('put_scanner_theme', 'dark');
      localStorage.removeItem('put_scanner_debug_layout');
      localStorage.removeItem('put_scanner_debug_network');
    }, { expiration: EXACT_EXPIRATION, nearExpiration: NEAR_EXPIRATION });
  });

  test('capture requested surfaces', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const marketHarness = await installDeterministicMarketApi(page);
    await installDeterministicCloudAccount(page, { portfolio, watchlist, preferences: {} });
    const project = testInfo.project.name;
    if (project === 'desktop-1440x900') await captureDesktop(page, testInfo, marketHarness);
    else if (project === 'portrait-390x844') await capturePhone(page, testInfo);
    else if (project === 'landscape-844x390') await captureLandscape(page, testInfo);
    else {
      await page.goto('/');
      await expect(page.getByPlaceholder(/Filter \/ Search by Ticker/i).first()).toBeVisible();
      await settle(page);
      await capture(page, testInfo, 'scanner-responsive-check');
      await page.goto('/portfolio');
      await expect(page.getByText('Portfolio Analytics', { exact: true }).first()).toBeVisible();
      await capture(page, testInfo, 'portfolio-responsive-check');
    }
    await mkdir(outputRoot, { recursive: true });
    await writeFile(
      path.join(outputRoot, `overflow-report-${project}.json`),
      `${JSON.stringify(overflows.filter(entry => entry.project === project), null, 2)}\n`,
      'utf8',
    );
  });
});
