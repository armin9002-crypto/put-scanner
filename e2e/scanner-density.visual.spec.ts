import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { installDeterministicMarketApi } from './fixtures/marketApi';

const phase = process.env.UI_SCANNER_DENSITY_CAPTURE;
const outputRoot = path.join(process.cwd(), 'e2e-artifacts', 'scanner-density', phase || 'disabled');

type DensityMetrics = {
  viewport: { width: number; height: number };
  pageHeaderHeight: number | null;
  marketContextHeight: number | null;
  marketCardHeight: number | null;
  opportunitySetHeight: number | null;
  resultsHeaderHeight: number | null;
  firstOpportunityTop: number | null;
  cardHeight: number | null;
  visibleCards: number;
  pageRootTop: number | null;
  pageOverflow: boolean;
};

async function capture(page: Page, testInfo: TestInfo, name: string) {
  const directory = path.join(outputRoot, testInfo.project.name);
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, `${name}.png`), animations: 'disabled', fullPage: false });
}

async function measure(page: Page): Promise<DensityMetrics> {
  return page.evaluate(() => {
    const rect = (selector: string) => document.querySelector<HTMLElement>(selector)?.getBoundingClientRect() ?? null;
    const pageRoot = rect('.scanner-page') ?? rect('.mobile-route-page');
    const cards = Array.from(document.querySelectorAll<HTMLElement>('.instrument-card, .mobile-etf-row'));
    const visibleCards = cards.filter(card => {
      const item = card.getBoundingClientRect();
      return item.height > 0 && item.top >= -1 && item.bottom <= window.innerHeight + 1;
    }).length;
    const firstCard = cards.find(card => card.getBoundingClientRect().height > 0)?.getBoundingClientRect() ?? null;
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      pageHeaderHeight: rect('.scanner-page .page-header')?.height ?? null,
      marketContextHeight: rect('.scanner-market-rail')?.height ?? rect('.mobile-market-strip')?.height ?? null,
      marketCardHeight: rect('.scanner-market-card')?.height ?? null,
      opportunitySetHeight: rect('.scanner-control-plane')?.height ?? rect('.mobile-scanner-controls')?.height ?? null,
      resultsHeaderHeight: rect('.scanner-page section[aria-label="ETF opportunities"] > .section-header')?.height ?? rect('.mobile-scanner-results-header')?.height ?? null,
      firstOpportunityTop: firstCard?.top ?? null,
      cardHeight: firstCard?.height ?? null,
      visibleCards,
      pageRootTop: pageRoot?.top ?? null,
      pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    };
  });
}

async function waitForPopulatedScanner(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByPlaceholder(/Filter \/ Search by Ticker/i).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.instrument-card, .mobile-etf-row').first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(250);
}

test.describe('Scanner density visual review', () => {
  test('capture populated, selected, filtered, loading, partial, and empty Scanner states', async ({ page }, testInfo) => {
    test.skip(!(phase === 'baseline' || phase === 'final'), 'Run with UI_SCANNER_DENSITY_CAPTURE=baseline|final.');
    test.setTimeout(120_000);
    const harness = await installDeterministicMarketApi(page);
    await waitForPopulatedScanner(page);
    const metrics = await measure(page);
    if (phase === 'final') {
      if (metrics.viewport.width < 768) {
        expect(metrics.cardHeight, `${testInfo.project.name} Scanner card should stay compact in portrait`).toBeLessThanOrEqual(90);
      }
      if (metrics.viewport.width <= 950 && metrics.viewport.height <= 520) {
        expect(metrics.cardHeight, `${testInfo.project.name} Scanner card should stay compact in phone landscape`).toBeLessThanOrEqual(100);
      }
      expect(metrics.pageOverflow, `${testInfo.project.name} Scanner should not overflow horizontally`).toBe(false);
    }
    await capture(page, testInfo, 'scanner-default');

    await page.goto('/?expiry=2027-01-01', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.instrument-card, .mobile-etf-row').first()).toBeVisible({ timeout: 30_000 });
    await capture(page, testInfo, 'scanner-selected-expiration');

    await page.goto('/?leverage=3x&type=Sector&liquidity=mediumPlus&sort=fiveDay', { waitUntil: 'domcontentloaded' });
    await expect(page.getByPlaceholder(/Filter \/ Search by Ticker/i).first()).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(250);
    await capture(page, testInfo, 'scanner-filters-active');

    await page.goto('/?q=TQQQ', { waitUntil: 'domcontentloaded' });
    await expect(page.getByPlaceholder(/Filter \/ Search by Ticker/i).first()).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(250);
    await capture(page, testInfo, 'scanner-search-active');

    harness.delays.set('prices', 900);
    await page.evaluate(() => {
      for (const key of ['price_cache_batch_v5', 'price_cache_batch_v4', 'prices_cache']) localStorage.removeItem(key);
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(150);
    await capture(page, testInfo, 'scanner-loading');
    harness.delays.delete('prices');

    harness.failNext.add('prices');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    await capture(page, testInfo, 'scanner-partial');

    await page.goto('/?q=NO_SUCH_ETF', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(/No ETFs match|No matching ETFs/)).toBeVisible({ timeout: 20_000 });
    await capture(page, testInfo, 'scanner-empty');

    const metricsFile = path.join(outputRoot, testInfo.project.name, 'metrics.json');
    await writeFile(metricsFile, `${JSON.stringify(metrics, null, 2)}\n`, 'utf8');
  });
});
