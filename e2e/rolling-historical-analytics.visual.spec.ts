import { expect, test } from '@playwright/test';
import { installDeterministicCloudAccount } from './fixtures/cloudAccount';
import { installDeterministicMarketApi } from './fixtures/marketApi';

const phase = process.env.UI_OVERHAUL_CAPTURE;
const suite = process.env.UI_OVERHAUL_SUITE;

const portfolio = [
  { id: 'rolling-anchor', ticker: 'SPY', optionType: 'put', strike: 90, expiration: '2024-03-15', contracts: 1, soldPrice: 1, soldDate: '2024-01-01', status: 'open', createdAt: '2024-01-01T12:00:00.000Z', updatedAt: '2024-01-01T12:00:00.000Z', entryDelta: -0.2, entryIv: 35 },
  { id: 'rolling-entry', ticker: 'QQQ', optionType: 'put', strike: 100, expiration: '2026-09-18', contracts: 1, soldPrice: 2, soldDate: '2026-04-01', status: 'open', createdAt: '2026-04-01T12:00:00.000Z', updatedAt: '2026-04-01T12:00:00.000Z', entryDelta: -0.25 },
  { id: 'rolling-iv', ticker: 'TQQQ', optionType: 'put', strike: 80, expiration: '2026-09-18', contracts: 1, soldPrice: 1.5, soldDate: '2026-06-20', status: 'closed', closePrice: 0.5, closeDate: '2026-07-20', realizedPnl: 100, createdAt: '2026-06-20T12:00:00.000Z', updatedAt: '2026-07-20T12:00:00.000Z', entryDelta: -0.32, entryIv: 45 },
  { id: 'rolling-loss', ticker: 'SOXL', optionType: 'put', strike: 70, expiration: '2026-10-16', contracts: 1, soldPrice: 1, soldDate: '2026-07-15', status: 'closed', closePrice: 2.4, closeDate: '2026-08-01', realizedPnl: -140, createdAt: '2026-07-15T12:00:00.000Z', updatedAt: '2026-08-01T12:00:00.000Z', entryDelta: -0.45 },
  { id: 'rolling-flat', ticker: 'SPY', optionType: 'put', strike: 85, expiration: '2026-10-16', contracts: 1, soldPrice: 1, soldDate: '2026-08-01', status: 'closed', closePrice: 1, closeDate: '2026-08-29', realizedPnl: 0, createdAt: '2026-08-01T12:00:00.000Z', updatedAt: '2026-08-29T12:00:00.000Z', entryDelta: -0.18, entryIv: 52 },
];

test.describe('rolling historical analytics UI', () => {
  test.skip(!(phase === 'after' && suite === 'ui3'), 'Run through UI_OVERHAUL_CAPTURE=after UI_OVERHAUL_SUITE=ui3.');

  test('covers all configured metrics, periods, domain stability, tooltip metadata, and local-only controls', async ({ page }) => {
    test.setTimeout(90_000);
    const marketHarness = await installDeterministicMarketApi(page);
    const cloudHarness = await installDeterministicCloudAccount(page, { portfolio, watchlist: [], preferences: { portfolioMarkBasis: 'ask' } });
    await page.goto('/portfolio');
    await expect(page.getByText(/^(Open Positions|Schedule of Positions)$/).first()).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(450);

    const historyDisclosure = page.getByRole('button', { name: /History/ }).first();
    if (await historyDisclosure.isVisible().catch(() => false)) await historyDisclosure.click();
    const chart = page.getByTestId('rolling-historical-analytics');
    await chart.scrollIntoViewIfNeeded();
    await expect(chart).toBeVisible();
    const domain = await chart.evaluate(element => ({ start: element.getAttribute('data-rolling-domain-start'), end: element.getAttribute('data-rolling-domain-end') }));
    expect(domain.start).toBe('2024-01-01');
    expect(domain.end).toMatch(/^2026-0[89]-\d{2}$/);

    const analytics = chart.getByRole('combobox', { name: 'Analytics' });
    await expect(analytics.locator('option')).toHaveCount(8);
    const initialCloudRequests = cloudHarness.requests.length;
    const initialMarketCounts = [...marketHarness.counts.entries()];
    const metrics = ['entryAy', 'entryIv', 'entryDelta', 'realizedIrr', 'premiumRunRate', 'originalDte'] as const;
    const periods = ['3', '6', '12'] as const;
    for (const metric of metrics) {
      await analytics.selectOption(metric);
      await expect(chart.locator('h3')).toContainText(/Rolling|Annualized/);
      for (const period of periods) {
        await chart.getByRole('button', { name: `${period}M`, exact: true }).click();
        await expect(chart.getByRole('button', { name: `${period}M`, exact: true })).toHaveAttribute('aria-pressed', 'true');
        await expect(chart).toHaveAttribute('data-rolling-domain-start', domain.start ?? '');
        await expect(chart).toHaveAttribute('data-rolling-domain-end', domain.end ?? '');
      }
    }

    for (const metric of ['grossRiskExposure', 'averageRemainingDte'] as const) {
      await analytics.selectOption(metric);
      await expect(chart.getByText('Point in time', { exact: true })).toBeVisible();
      await expect(chart.getByRole('button', { name: '6M', exact: true })).toHaveCount(0);
    }

    await analytics.selectOption('entryIv');
    await chart.getByRole('button', { name: '6M', exact: true }).click();
    const plot = chart.getByTestId('rolling-historical-analytics-plot');
    await plot.hover({ position: { x: 60, y: 90 } });
    const tooltip = chart.locator('.rolling-historical-analytics__tooltip');
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText(/Partial window|Full trailing 6M window/);
    await expect(tooltip).toContainText(/trades represented|Gross Risk represented/);
    if (await page.evaluate(() => matchMedia('(pointer: coarse)').matches)) await plot.tap({ position: { x: 120, y: 70 } });

    expect(cloudHarness.requests.length).toBe(initialCloudRequests);
    expect(cloudHarness.requests.slice(initialCloudRequests).some(request => /POST|PATCH|DELETE/.test(request))).toBe(false);
    expect([...marketHarness.counts.entries()]).toEqual(initialMarketCounts);
    await expect(page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).resolves.toBe(true);
  });
});
