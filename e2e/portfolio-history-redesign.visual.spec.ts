import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { installDeterministicCloudAccount } from './fixtures/cloudAccount';
import { installDeterministicMarketApi } from './fixtures/marketApi';

const phase = process.env.UI_OVERHAUL_CAPTURE;
const suite = process.env.UI_OVERHAUL_SUITE;
const outputRoot = path.join(process.cwd(), 'e2e-artifacts', 'portfolio-history-redesign', phase || 'disabled');

function trade(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id, ticker: 'SPY', optionType: 'put', strike: 90, expiration: '2025-03-21', contracts: 1, soldPrice: 2,
    soldDate: '2024-01-15', status: 'closed', closePrice: 0.5, closeDate: '2024-03-01', realizedPnl: 150,
    createdAt: `${overrides.soldDate ?? '2024-01-15'}T12:00:00.000Z`, updatedAt: '2026-08-29T12:00:00.000Z',
    entryDelta: -0.25, entryIv: 55, ...overrides,
  };
}

const anchor = trade('redesign-anchor', { status: 'open', expiration: '2024-03-21', soldDate: '2024-01-01', closePrice: undefined, closeDate: undefined, realizedPnl: undefined });
const baseHistory = [
  trade('redesign-2024-positive', { soldDate: '2024-02-15', expiration: '2024-04-19', closeDate: '2024-04-01', realizedPnl: 200, ticker: 'SPY' }),
  trade('redesign-2024-negative', { soldDate: '2024-06-10', expiration: '2024-08-16', closeDate: '2024-07-15', realizedPnl: -90, ticker: 'QQQ', strike: 100, soldPrice: 2.5 }),
  trade('redesign-2024-flat', { soldDate: '2024-11-10', expiration: '2025-01-17', closeDate: '2025-01-10', realizedPnl: 0, ticker: 'TQQQ' }),
  trade('redesign-2025-positive', { soldDate: '2025-03-03', expiration: '2025-05-16', closeDate: '2025-05-01', realizedPnl: 240, ticker: 'SPY', entryIv: 62 }),
  trade('redesign-2025-negative', { soldDate: '2025-08-12', expiration: '2025-10-17', closeDate: '2025-09-02', realizedPnl: -120, ticker: 'SOXL', strike: 70, entryIv: undefined }),
  trade('redesign-2026-positive', { soldDate: '2026-01-20', expiration: '2026-03-20', closeDate: '2026-03-02', realizedPnl: 175, ticker: 'QQQ', entryDelta: -0.35 }),
  trade('redesign-2026-negative', { soldDate: '2026-05-15', expiration: '2026-07-17', closeDate: '2026-06-01', realizedPnl: -80, ticker: 'TQQQ', entryDelta: undefined }),
  trade('redesign-2026-positive-late', { soldDate: '2026-07-10', expiration: '2026-09-18', closeDate: '2026-08-01', realizedPnl: 210, ticker: 'SPY', entryIv: 70 }),
];
const basePortfolio = [anchor, ...baseHistory];
const iso = (timestamp: number) => new Date(timestamp).toISOString().slice(0, 10);
const monthlyHistory = (count: number) => Array.from({ length: count }, (_, index) => {
  const expiration = Date.UTC(2024, index, 21);
  return trade(`redesign-period-${count}-${index}`, {
    soldDate: iso(expiration - 55 * 86_400_000),
    expiration: iso(expiration),
    closeDate: iso(expiration - 12 * 86_400_000),
    realizedPnl: index % 4 === 0 ? -100 : 120 + index * 3,
    ticker: ['SPY', 'QQQ', 'TQQQ', 'SOXL'][index % 4],
  });
});
const fewPortfolio = [anchor, ...monthlyHistory(8)];
const balancedPortfolio = [anchor, ...monthlyHistory(15).map((item, index) => ({ ...item, realizedPnl: index % 2 === 0 ? 180 : -180 }))];
const mediumPortfolio = [anchor, ...monthlyHistory(28)];
const longHistory = [anchor, ...monthlyHistory(35)];

async function settle(page: Page) { await page.waitForLoadState('domcontentloaded'); await page.waitForTimeout(350); }
async function openPortfolio(page: Page, cloud?: { requests: string[] }) {
  await page.goto('/portfolio');
  try {
    await expect(page.getByText(/^(Open Positions|Schedule of Positions)$/).first()).toBeVisible({ timeout: 20_000 });
  } catch (error) {
    console.log(`history-redesign cloud requests: ${JSON.stringify(cloud?.requests ?? [])}`);
    throw error;
  }
  await settle(page);
}
async function ensureHistoryOpen(page: Page) {
  const disclosure = page.getByRole('button', { name: /History/ }).first();
  if (await disclosure.isVisible().catch(() => false)) await disclosure.click();
  await expect(page.getByText('Expired / Closed History', { exact: true })).toBeVisible();
}
async function capture(page: Page, testInfo: TestInfo, name: string) {
  const directory = path.join(outputRoot, testInfo.project.name);
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, `${name}.png`), animations: 'disabled', fullPage: false });
}
async function captureRollingStates(page: Page, testInfo: TestInfo) {
  const chart = page.getByTestId('rolling-historical-analytics');
  await chart.scrollIntoViewIfNeeded();
  const analytics = chart.getByRole('combobox', { name: 'Analytics' });
  for (const [metric, period, name] of [
    ['entryAy', '6', 'entry-ay-6m'], ['originalDte', '12', 'original-dte-12m'], ['entryIv', '6', 'entry-iv-6m'],
    ['entryDelta', '12', 'entry-delta-12m'], ['realizedIrr', '6', 'realized-irr-6m'], ['premiumRunRate', '3', 'premium-3m'],
  ] as const) {
    await analytics.selectOption(metric);
    await chart.getByRole('button', { name: `${period}M`, exact: true }).click();
    await capture(page, testInfo, `rolling-${name}`);
  }
  for (const [metric, name] of [['grossRiskExposure', 'gross-risk-exposure'], ['averageRemainingDte', 'average-remaining-dte']] as const) {
    await analytics.selectOption(metric);
    await expect(chart.getByText('Point in time', { exact: true })).toBeVisible();
    await capture(page, testInfo, `state-${name}`);
  }
  await analytics.selectOption('entryAy');
  await chart.getByRole('button', { name: '6M', exact: true }).click();
  const initialValue = await chart.getAttribute('data-rolling-current-value');
  const plot = chart.getByTestId('rolling-historical-analytics-plot');
  const box = await plot.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.5);
    await expect(chart).toHaveAttribute('data-rolling-hover-value', /.+/);
    await page.mouse.move(2, 2);
    await expect(chart).toHaveAttribute('data-rolling-hover-value', '');
    await expect(chart).toHaveAttribute('data-rolling-current-value', initialValue ?? '—');
  }
}

test.describe('Portfolio history redesign visual matrix', () => {
  test.skip(!(phase === 'before' || phase === 'after') || suite !== 'history-redesign', 'Run with UI_OVERHAUL_CAPTURE=before|after UI_OVERHAUL_SUITE=history-redesign.');
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('put_scanner_theme', 'dark');
      localStorage.removeItem('put_scanner_portfolio_trades');
      localStorage.removeItem('put_scanner_watchlist');
    });
  });
  test('captures rolling analytics, realized P&L density, and History states', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await installDeterministicMarketApi(page);
    const cloud = await installDeterministicCloudAccount(page, { portfolio: basePortfolio, watchlist: [], preferences: { portfolioMarkBasis: 'ask', portfolioGroupMode: 'expiration' } });
    const project = testInfo.project.name;
    if (project === 'desktop-1440x900') {
      await page.setViewportSize({ width: 1920, height: 1080 });
      await openPortfolio(page, cloud); await ensureHistoryOpen(page); await captureRollingStates(page, testInfo);
      await capture(page, testInfo, 'viewport-1920x1080-history');
      await page.setViewportSize({ width: 1440, height: 900 });
    }
    await openPortfolio(page, cloud); await ensureHistoryOpen(page); await captureRollingStates(page, testInfo);
    await capture(page, testInfo, `viewport-${project}-history`);

    for (const [name, dataset] of [['few-months', fewPortfolio], ['balanced-15-months', balancedPortfolio], ['medium-months', mediumPortfolio], ['long-multi-year', longHistory]] as const) {
      cloud.setNamespaceData('portfolio', dataset);
      await page.reload(); await openPortfolio(page, cloud); await ensureHistoryOpen(page);
      const realized = page.getByText('Realized P&L by Expiration Month', { exact: true });
      await realized.scrollIntoViewIfNeeded();
      await capture(page, testInfo, `realized-${name}`);
      const realizedPlot = page.locator('.portfolio-realized-pnl-chart__plot');
      await expect(realizedPlot).toHaveCSS('overflow-y', 'hidden');
      const chartMetrics = await realizedPlot.evaluate(element => ({
        mode: element.getAttribute('data-scroll-mode'),
        widths: [...element.querySelectorAll('[data-chart-period-label]')].map(label => label.parentElement?.getBoundingClientRect().width ?? 0),
        horizontalOverflow: element.scrollWidth - element.clientWidth,
        verticalOverflow: element.scrollHeight - element.clientHeight,
      }));
      expect(chartMetrics.widths.every(width => width > 0)).toBe(true);
      if (name === 'long-multi-year') {
        expect(chartMetrics.mode).toBe('contained');
        expect(chartMetrics.horizontalOverflow).toBeGreaterThan(0);
      } else {
        expect(chartMetrics.mode).toBe('fit');
        expect(chartMetrics.horizontalOverflow).toBeLessThanOrEqual(2);
      }
      expect(chartMetrics.verticalOverflow).toBeLessThanOrEqual(3);
      if (name === 'few-months') {
        const period = page.getByRole('combobox', { name: 'Realized P&L period' });
        await period.selectOption('quarter');
        await expect(page.getByText('Realized P&L by Expiration Quarter', { exact: true })).toBeVisible();
        await capture(page, testInfo, 'realized-quarter');
        await period.selectOption('year');
        await expect(page.getByText('Realized P&L by Expiration Year', { exact: true })).toBeVisible();
        await capture(page, testInfo, 'realized-year');
        await period.selectOption('month');
      }
    }

    cloud.setNamespaceData('portfolio', basePortfolio);
    await page.reload(); await openPortfolio(page, cloud); await ensureHistoryOpen(page);
    for (const [label, name] of [['Year', 'group-year'], ['Expiry', 'group-expiry'], ['Underlying', 'group-underlying'], ['None', 'group-none']] as const) {
      await page.getByRole('button', { name: label, exact: true }).last().click();
      await capture(page, testInfo, `history-${name}`);
    }
    await page.getByRole('button', { name: 'Closed', exact: true }).last().click(); await capture(page, testInfo, 'history-filter-closed');
    const totals = page.locator('.portfolio-history-grand-total:visible, .portfolio-history-mobile-grand-total:visible').first();
    const allTotals = await totals.innerText();
    await page.getByRole('button', { name: 'Expired Worthless', exact: true }).last().click();
    await expect(totals).not.toHaveText(allTotals);
    await page.getByRole('button', { name: 'All', exact: true }).last().click();
    const beforeGrouping = await totals.innerText();
    await page.getByRole('button', { name: 'Expiry', exact: true }).last().click();
    await expect(totals).toContainText('$71,000');
    const afterGrouping = await totals.innerText();
    expect(afterGrouping.replace(/\s+/g, '')).toBe(beforeGrouping.replace(/\s+/g, ''));
    const tickerSort = page.getByRole('button', { name: /Ticker, not sorted/ }).last();
    if (await tickerSort.count()) { await tickerSort.click(); await capture(page, testInfo, 'history-sorted-ticker'); }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  });

  test('captures rolling, realized, and totals surfaces in every theme', async ({ page }, testInfo) => {
    test.skip(!(phase === 'after' && suite === 'history-redesign') || testInfo.project.name !== 'desktop-1440x900', 'Theme captures run once at the desktop visual project.');
    test.setTimeout(120_000);
    await installDeterministicMarketApi(page);
    const cloud = await installDeterministicCloudAccount(page, { portfolio: basePortfolio, watchlist: [], preferences: { portfolioMarkBasis: 'ask', portfolioGroupMode: 'expiration' } });
    for (const theme of ['dark', 'dark-blue', 'light', 'sepia'] as const) {
      await page.goto('/portfolio');
      await openPortfolio(page, cloud);
      const themeLabel = theme === 'dark-blue' ? 'Dark Blue' : theme.charAt(0).toUpperCase() + theme.slice(1);
      const themeButton = page.getByTitle(/Switch theme/);
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const title = await themeButton.getAttribute('title');
        if (title?.includes(`current: ${themeLabel}`)) break;
        await themeButton.click();
      }
      await expect(themeButton).toHaveAttribute('title', new RegExp(`current: ${themeLabel}`));
      await ensureHistoryOpen(page);
      const chart = page.getByTestId('rolling-historical-analytics');
      await chart.scrollIntoViewIfNeeded();
      await capture(page, testInfo, `theme-${theme}-rolling`);
      const realized = page.getByText('Realized P&L by Expiration Month', { exact: true });
      await realized.scrollIntoViewIfNeeded();
      await capture(page, testInfo, `theme-${theme}-realized-totals`);
    }
  });
});
