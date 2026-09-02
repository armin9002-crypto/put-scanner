import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { installDeterministicMarketApi } from './fixtures/marketApi';
import { installDeterministicCloudAccount } from './fixtures/cloudAccount';

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
  { id: 'ui3-closed-loss', ticker: 'SOXL', optionType: 'put', strike: 68, expiration: '2026-09-18', contracts: 1, soldPrice: 1, soldDate: '2026-08-01', status: 'closed', closePrice: 2.5, closeDate: '2026-08-28', realizedPnl: -150, percentCaptured: -1.5, notes: 'Closed for a controlled loss.', createdAt: '2026-08-01T12:00:00.000Z', updatedAt: '2026-08-28T12:00:00.000Z', entryVixClose: 24.2 },
  { id: 'ui3-closed-flat', ticker: 'TQQQ', optionType: 'put', strike: 86, expiration: '2026-10-16', contracts: 1, soldPrice: 1, soldDate: '2026-08-04', status: 'closed', closePrice: 1, closeDate: '2026-08-29', realizedPnl: 0, percentCaptured: 0, notes: 'Closed at breakeven.', createdAt: '2026-08-04T12:00:00.000Z', updatedAt: '2026-08-29T12:00:00.000Z', entryVixClose: 20.4 },
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

async function measurePortfolio(page: Page, testInfo: TestInfo, name: string) {
  const metrics = await page.evaluate(() => {
    const rect = (element: Element | null) => {
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return { top: box.top + window.scrollY, bottom: box.bottom + window.scrollY, height: box.height, width: box.width };
    };
    const visible = (selector: string) => [...document.querySelectorAll(selector)].filter(element => {
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    });
    const firstVisible = (selector: string) => visible(selector)[0] ?? null;
    const title = [...document.querySelectorAll('h1')].find(element => element.textContent?.trim() === 'Portfolio') ?? null;
    const schedule = [...document.querySelectorAll('h2')].find(element => element.textContent?.trim() === 'Schedule of Positions') ?? null;
    const history = [...document.querySelectorAll('h2')].find(element => element.textContent?.trim() === 'Expired / Closed History') ?? null;
    const summaryCards = visible('.portfolio-summary-grid > *, .portfolio-summary-mobile .portfolio-summary-card');
    const priorityCards = visible('.portfolio-priority-card');
    const historyCards = visible('.portfolio-history-summary-grid > *');
    const chart = firstVisible('.portfolio-realized-pnl-chart');
    const historyTable = firstVisible('.portfolio-history-table');
    const heights = (selector: string) => visible(selector).map(element => rect(element)?.height ?? null);
    return {
      titleToSchedule: title && schedule ? schedule.getBoundingClientRect().top + window.scrollY - (title.getBoundingClientRect().top + window.scrollY) : null,
      historyTitleToTable: history && historyTable ? historyTable.getBoundingClientRect().top + window.scrollY - (history.getBoundingClientRect().top + window.scrollY) : null,
      topKpiHeights: summaryCards.map(element => rect(element)?.height ?? null),
      priorityHeights: priorityCards.map(element => rect(element)?.height ?? null),
      historyKpiHeights: historyCards.map(element => rect(element)?.height ?? null),
      chart: rect(chart),
      activeChildRowHeights: heights('.portfolio-schedule-surface tbody tr[data-trade-id]'),
      activeGroupRowHeights: heights('.portfolio-schedule-surface tbody tr[data-group-key]'),
      historyChildRowHeights: heights('.portfolio-history-table tbody tr:not(.portfolio-history-group-subtotal)'),
      historyGroupRowHeights: heights('.portfolio-history-table tbody tr.portfolio-history-group-subtotal'),
      mobileActiveRowHeights: heights('.mobile-position-row'),
      mobileHistoryRowHeights: heights('.portfolio-history-mobile-row'),
      chartMonthLabels: visible('[data-chart-month-label]').map(element => element.textContent?.trim() ?? ''),
      chartValueLabels: visible('[data-chart-pnl-label]').map(element => element.textContent?.trim() ?? ''),
    };
  });
  const directory = path.join(outputRoot, testInfo.project.name);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, `${name}-metrics.json`), `${JSON.stringify(metrics, null, 2)}\n`, 'utf8');
}

async function assertRenderedPortfolioDensity(page: Page, desktop: boolean) {
  const summaryCards = page.locator('.portfolio-summary-grid > *:visible');
  if (desktop) {
    await expect(summaryCards).toHaveCount(10);
    await expect(summaryCards.locator('.portfolio-summary-card__label')).toHaveText(['Open Trades', 'Premium', 'Gross Risk', 'Net Risk', 'Gain/Loss', '% Captured', 'Entry Wtd. Avg. AY', 'Current Wtd. Avg. AY', 'Weighted Avg Delta', 'Weighted Avg DTE']);
    const heights = await summaryCards.evaluateAll(elements => elements.map(element => element.getBoundingClientRect().height));
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(1);
    expect(Math.max(...heights)).toBeLessThan(60);
  } else {
    const mobileCards = page.locator('.portfolio-summary-mobile .portfolio-summary-card:visible');
    if (await mobileCards.count()) {
      const heights = await mobileCards.evaluateAll(elements => elements.map(element => element.getBoundingClientRect().height));
      expect(Math.max(...heights)).toBeLessThan(60);
    }
  }
  const priorityCards = page.locator('.portfolio-priority-card:visible');
  const priorityRailVisible = await page.locator('.portfolio-priority-rail:visible').count();
  if (priorityRailVisible) await expect(priorityCards).toHaveCount(2);
  if (desktop) {
    const heights = await priorityCards.evaluateAll(elements => elements.map(element => element.getBoundingClientRect().height));
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(1);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
}

async function assertRenderedHistoryDensity(page: Page) {
  const cards = page.locator('.portfolio-history-summary-grid > *:visible');
  await expect(cards).toHaveCount(8);
  await expect(cards.locator('.portfolio-summary-card__label')).toHaveText(['Realized P&L', 'Total Realized IRR', 'Blended Capture', 'Total Historical Notional', 'Resolved Trades', 'Avg. Days Held', 'Wtd. Avg. Entry Delta', 'Wtd. Avg. Entry IV']);
  const heights = await cards.evaluateAll(elements => elements.map(element => element.getBoundingClientRect().height));
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(1);
  await expect(page.getByText('Realized P&L by Expiration Month', { exact: true })).toBeVisible();
  const monthLabels = page.locator('[data-chart-month-label]:visible');
  await expect(monthLabels).toHaveCount(4);
  for (const label of await monthLabels.allTextContents()) expect(label.trim()).toMatch(/^[A-Z][a-z]{2} '\d{2}$/);
  const valueLabels = page.locator('[data-chart-pnl-label]:visible');
  await expect(valueLabels).toHaveCount(3);
  const values = (await valueLabels.allTextContents()).map(value => value.trim());
  expect(values).toContain('$170');
  expect(values).toContain('($150)');
  expect(values).not.toContain('$0');
  expect(values.every(value => !/\.\d/.test(value))).toBe(true);
  await expect(page.locator('.portfolio-realized-pnl-chart__value--positive:visible')).toHaveCount(1);
  await expect(page.locator('.portfolio-realized-pnl-chart__value--negative:visible')).toHaveCount(2);
  await expect(monthLabels.first()).toHaveCSS('font-size', '10px');
  await expect(valueLabels.first()).toHaveCSS('font-size', '10px');
  const activeRows = page.locator('.portfolio-schedule-surface tbody tr[data-trade-id]:visible');
  const historyRows = page.locator('.portfolio-history-table tbody tr:not(.portfolio-history-group-subtotal):visible');
  if (await activeRows.count() && await historyRows.count()) {
    const activeHeight = Math.max(...await activeRows.evaluateAll(elements => elements.map(element => element.getBoundingClientRect().height)));
    const historyHeight = Math.max(...await historyRows.evaluateAll(elements => elements.map(element => element.getBoundingClientRect().height)));
    expect(historyHeight).toBeLessThanOrEqual(activeHeight);
  }
  const activeGroups = page.locator('.portfolio-schedule-surface tbody tr[data-group-key]:visible');
  const historyGroups = page.locator('.portfolio-history-table tbody tr.portfolio-history-group-subtotal:visible');
  if (await activeGroups.count() && await historyGroups.count()) {
    const activeHeight = Math.max(...await activeGroups.evaluateAll(elements => elements.map(element => element.getBoundingClientRect().height)));
    const historyHeight = Math.max(...await historyGroups.evaluateAll(elements => elements.map(element => element.getBoundingClientRect().height)));
    expect(historyHeight).toBeLessThanOrEqual(activeHeight + 2);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
}

async function captureRollingAnalyticsStates(page: Page, testInfo: TestInfo) {
  const chart = page.getByTestId('rolling-historical-analytics');
  if (!await chart.count()) return;
  await chart.scrollIntoViewIfNeeded();
  await expect(chart).toBeVisible();
  const analytics = chart.getByRole('combobox', { name: 'Analytics' });
  await expect(analytics.locator('option')).toHaveCount(7);
  const states = [
    ['entryAy', '3', 'entry-ay-3m'],
    ['entryAy', '6', 'entry-ay-6m'],
    ['entryIv', '6', 'entry-iv-6m'],
    ['entryDelta', '12', 'entry-delta-12m'],
    ['realizedIrr', '6', 'realized-irr-6m'],
    ['premiumRunRate', '3', 'premium-3m'],
    ['grossRiskDeployed', '12', 'gross-risk-12m'],
    ['originalDte', '6', 'original-dte-6m'],
  ] as const;
  const domain = await chart.evaluate(element => ({ start: element.getAttribute('data-rolling-domain-start'), end: element.getAttribute('data-rolling-domain-end') }));
  for (const [metric, period, name] of states) {
    await analytics.selectOption(metric);
    await chart.getByRole('button', { name: `${period}M`, exact: true }).click();
    await expect(chart).toHaveAttribute('data-rolling-domain-start', domain.start ?? '');
    await expect(chart).toHaveAttribute('data-rolling-domain-end', domain.end ?? '');
    await capture(page, testInfo, `portfolio-rolling-${name}`);
  }
  await analytics.selectOption('entryIv');
  await chart.getByRole('button', { name: '6M', exact: true }).click();
  const plot = chart.getByTestId('rolling-historical-analytics-plot');
  if (await chart.locator('.rolling-historical-analytics__line').count()) {
    await plot.locator('svg').hover({ position: { x: 72, y: 82 } });
    await expect(chart.locator('.rolling-historical-analytics__tooltip')).toBeVisible();
    await capture(page, testInfo, 'portfolio-rolling-entry-iv-6m-tooltip');
  } else {
    await capture(page, testInfo, 'portfolio-rolling-entry-iv-6m-no-full-window');
  }
}

async function seed(page: Page) {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('put_scanner_ui3_seeded') === 'true') return;
    sessionStorage.setItem('put_scanner_ui3_seeded', 'true');
    localStorage.setItem('put_scanner_theme', 'dark');
    localStorage.removeItem('put_scanner_debug_layout');
    localStorage.removeItem('put_scanner_debug_network');
  });
}

async function openWatchlist(page: Page) { await page.goto('/watchlist'); await expect(page.locator('h1:visible').filter({ hasText: 'Watchlist' }).or(page.getByText(/saved contracts/i).first()).first()).toBeVisible({ timeout: 20_000 }); await settle(page); }
async function openPortfolio(page: Page) {
  await page.goto('/portfolio');
  await expect(page.getByText(/^(Open Positions|Schedule of Positions)$/).first()).toBeVisible({ timeout: 20_000 });
  await settle(page);
  const refresh = page.getByRole('button', { name: 'Refresh Open Trades' });
  if (await refresh.count() && await refresh.isEnabled()) {
    await refresh.click();
  } else {
    const actions = page.getByRole('button', { name: 'Portfolio actions' });
    if (await actions.count()) {
      await actions.click();
      const mobileRefresh = page.getByRole('button', { name: 'Refresh Open Trades' });
      if (await mobileRefresh.count() && await mobileRefresh.isEnabled()) await mobileRefresh.click();
    }
  }
  await page.waitForTimeout(400);
}

test.describe('UI-3 portfolio and watchlist visual matrix', () => {
  test.skip(!(phase === 'before' || phase === 'after') || suite !== 'ui3', 'Run through npm run visual:ui3 -- before|after.');
  test.beforeEach(async ({ page }) => { await seed(page); });

  test('capture Watchlist → Portfolio → analytics → history workflow', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const marketHarness = await installDeterministicMarketApi(page);
    const cloudHarness = await installDeterministicCloudAccount(page, {
      portfolio,
      watchlist,
      preferences: { portfolioMarkBasis: 'ask', portfolioGroupMode: 'expiration', showNominalYield: false },
    });
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
      cloudHarness.setNamespaceData('watchlist', []);
      await page.reload(); await expect(page.getByText(/No saved puts/i).first()).toBeVisible(); await settle(page); await capture(page, testInfo, 'watchlist-empty');
      cloudHarness.setNamespaceData('watchlist', watchlist);
      await page.reload();
      await openPortfolio(page);
      await capture(page, testInfo, 'portfolio-analytics-collapsed');
      await measurePortfolio(page, testInfo, 'portfolio-dashboard');
      await assertRenderedPortfolioDensity(page, true);
      const entryDeltaToggle = page.getByRole('checkbox', { name: 'Show Entry Deltas / IV' });
      if (await entryDeltaToggle.count()) {
        await entryDeltaToggle.check();
        await capture(page, testInfo, 'portfolio-entry-deltas-on');
        await entryDeltaToggle.uncheck();
      }
      const nominalYieldToggle = page.getByRole('checkbox', { name: 'Show Nominal Yield' });
      if (await nominalYieldToggle.count()) {
        await nominalYieldToggle.check();
        await capture(page, testInfo, 'portfolio-nominal-yield-on');
        await nominalYieldToggle.uncheck();
      }
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
      if (await history.count()) {
        await history.scrollIntoViewIfNeeded();
        await capture(page, testInfo, 'portfolio-history');
        await measurePortfolio(page, testInfo, 'portfolio-history');
        await assertRenderedHistoryDensity(page);
        const historyExpand = page.getByRole('button', { name: 'Expand All' }).last();
        if (await historyExpand.count()) {
          await historyExpand.click();
          await capture(page, testInfo, 'portfolio-history-expanded');
          const historyCollapse = page.getByRole('button', { name: 'Collapse All' }).last();
          if (await historyCollapse.count()) {
            await historyCollapse.click();
            await capture(page, testInfo, 'portfolio-history-collapsed');
            await page.getByRole('button', { name: 'Expand All' }).last().click();
          }
        }
        await captureRollingAnalyticsStates(page, testInfo);
      }
      const firstPosition = page.locator('[data-trade-id]:visible').first();
      const strikeButton = firstPosition.locator('button').first();
      if (await strikeButton.count()) { await strikeButton.click(); await expect(page.getByRole('complementary')).toBeVisible({ timeout: 10_000 }); await capture(page, testInfo, 'portfolio-trade-drawer'); await page.getByRole('button', { name: 'Close option detail drawer' }).last().click(); }
      await openWatchlist(page);
      for (const theme of ['light', 'dark', 'sepia', 'dark-blue']) {
        await page.evaluate(value => localStorage.setItem('put_scanner_theme', value), theme);
        await page.reload(); await expect(page.locator('html')).toHaveAttribute('data-theme', theme); await settle(page); await capture(page, testInfo, `theme-${theme}-watchlist`);
        await openPortfolio(page); await capture(page, testInfo, `theme-${theme}-portfolio-collapsed`);
        await page.getByRole('button', { name: 'Expand Portfolio Analytics' }).click(); await capture(page, testInfo, `theme-${theme}-portfolio-expanded`);
        const themeHistory = page.getByText('Expired / Closed History', { exact: true });
        if (await themeHistory.count()) { await themeHistory.scrollIntoViewIfNeeded(); await capture(page, testInfo, `theme-${theme}-portfolio-history`); await assertRenderedHistoryDensity(page); }
        const themePosition = page.locator('[data-trade-id]:visible').first();
        const themeStrike = themePosition.locator('button').first();
        if (await themeStrike.count()) { await themeStrike.click(); if (await page.getByRole('complementary').count()) { await capture(page, testInfo, `theme-${theme}-portfolio-drawer`); await page.getByRole('button', { name: 'Close option detail drawer' }).last().click(); } }
      }
    } else if (project === 'tablet-1024x768') {
      await openWatchlist(page); await capture(page, testInfo, 'watchlist-tablet');
      await openPortfolio(page); await capture(page, testInfo, 'portfolio-tablet-collapsed');
      await measurePortfolio(page, testInfo, 'portfolio-dashboard');
      await assertRenderedPortfolioDensity(page, false);
      await page.getByRole('button', { name: 'Expand Portfolio Analytics' }).click(); await capture(page, testInfo, 'portfolio-tablet-expanded');
      await captureRollingAnalyticsStates(page, testInfo);
    } else if (project === 'portrait-430x932' || project === 'portrait-390x844' || project === 'portrait-375x667') {
      await openWatchlist(page); await capture(page, testInfo, 'watchlist-mobile');
      await openPortfolio(page); await capture(page, testInfo, 'portfolio-mobile-headline');
      await measurePortfolio(page, testInfo, 'portfolio-dashboard');
      await assertRenderedPortfolioDensity(page, false);
      await expect(page.locator('.portfolio-priority-rail:visible')).toHaveCount(0);
      await expect(page.locator('.mobile-position-row:visible')).toHaveCount(4);
      await expect(page.locator('.mobile-position-row__summary').first()).toContainText('Gain/Loss');
      await expect(page.locator('.mobile-position-row__summary').first()).toContainText('% Captured');
      await page.locator('.mobile-position-row__summary').first().click();
      await expect(page.locator('.mobile-position-row__details:visible').first()).toBeVisible();
      const analytics = page.getByRole('button', { name: /Portfolio Analytics/ }).first();
      if (await analytics.count()) { await analytics.click(); await analytics.scrollIntoViewIfNeeded(); await capture(page, testInfo, 'portfolio-mobile-analytics'); }
      const entryDeltaToggle = page.getByRole('checkbox', { name: 'Show Entry Deltas / IV' });
      if (await entryDeltaToggle.count()) {
        await entryDeltaToggle.check();
        await capture(page, testInfo, 'portfolio-mobile-entry-deltas-on');
        await entryDeltaToggle.uncheck();
      }
      const history = page.getByRole('button', { name: /History/ }).first();
      if (await history.count()) { await history.click(); await page.getByText('History', { exact: true }).last().scrollIntoViewIfNeeded(); await capture(page, testInfo, 'portfolio-mobile-history-collapsed'); const expandAll = page.getByRole('button', { name: 'Expand All' }).last(); if (await expandAll.count()) await expandAll.click(); await expect(page.locator('.portfolio-history-mobile-row:visible')).toHaveCount(4); await expect(page.locator('.portfolio-history-mobile-row__summary').first()).toContainText('Realized P&L'); await expect(page.locator('.portfolio-history-mobile-row__summary').first()).toContainText('Realized IRR'); await page.locator('.portfolio-history-mobile-row__summary').first().click(); await expect(page.locator('.portfolio-history-mobile-row__details:visible').first()).toBeVisible(); }
      if (await history.count()) { await measurePortfolio(page, testInfo, 'portfolio-history'); await assertRenderedHistoryDensity(page); await captureRollingAnalyticsStates(page, testInfo); }
    } else if (project === 'landscape-844x390' || project === 'landscape-667x375') {
      await openWatchlist(page); await capture(page, testInfo, 'watchlist-landscape');
      await openPortfolio(page); await capture(page, testInfo, 'portfolio-landscape');
      await measurePortfolio(page, testInfo, 'portfolio-dashboard');
      await assertRenderedPortfolioDensity(page, false);
      await expect(page.locator('.portfolio-schedule-surface .financial-table')).toBeVisible();
      await expect(page.locator('.portfolio-schedule-surface .financial-table thead th.portfolio-sticky-column')).toHaveCSS('position', 'sticky');
      await page.locator('.portfolio-history-section').scrollIntoViewIfNeeded();
      await expect(page.locator('.portfolio-history-table')).toBeVisible();
      await expect(page.locator('.portfolio-history-table thead th.portfolio-sticky-column')).toHaveCSS('position', 'sticky');
      const analytics = page.getByRole('button', { name: /Portfolio Analytics/ }).first();
      if (await analytics.count()) { await analytics.click(); await analytics.scrollIntoViewIfNeeded(); await capture(page, testInfo, 'portfolio-landscape-analytics'); }
      await captureRollingAnalyticsStates(page, testInfo);
    } else {
      await openWatchlist(page); await capture(page, testInfo, 'watchlist-responsive');
      await openPortfolio(page); await capture(page, testInfo, 'portfolio-responsive');
      await measurePortfolio(page, testInfo, 'portfolio-dashboard');
      const history = page.getByText('Expired / Closed History', { exact: true });
      if (await history.count()) { await history.scrollIntoViewIfNeeded(); await captureRollingAnalyticsStates(page, testInfo); }
    }
    expect(cloudHarness.requests.some(request => request.startsWith('GET /rest/v1/user_state'))).toBe(true);
    expect(await page.evaluate(() => ({ portfolio: localStorage.getItem('put_scanner_portfolio_trades'), watchlist: localStorage.getItem('put_scanner_watchlist') }))).toEqual({ portfolio: null, watchlist: null });
    await mkdir(outputRoot, { recursive: true });
    await writeFile(path.join(outputRoot, `overflow-report-${project}.json`), `${JSON.stringify(overflows.filter(entry => entry.project === project), null, 2)}\n`, 'utf8');
  });
});
