import { expect, test, type Page } from '@playwright/test';
import { installDeterministicMarketApi } from './fixtures/marketApi';

type ScannerLayoutMetrics = {
  width: number;
  workspaceHeight: number;
  controlsHeight: number;
  controlsBottom: number;
  gridBottom: number;
  railHeight: number;
  gridHeight: number;
  plotHeight: number;
  svgHeight: number;
  cardHeight: number;
  typeBottom: number;
  resultsTop: number;
  hasMarketCopy: boolean;
  overflow: boolean;
};

async function measure(page: Page): Promise<ScannerLayoutMetrics> {
  return page.evaluate(() => {
    const rect = (selector: string) => document.querySelector<HTMLElement>(selector)?.getBoundingClientRect() ?? null;
    const workspace = rect('.scanner-workspace');
    const controls = rect('.scanner-control-plane');
    const grid = rect('.scanner-market-rail__grid');
    const card = rect('.scanner-market-card');
    const plot = rect('.scanner-market-card__plot');
    const svg = rect('.scanner-market-card__plot > svg');
    const types = rect('.scanner-control-plane__types');
    const results = rect('section[aria-label="ETF opportunities"]');
    return {
      width: innerWidth,
      workspaceHeight: workspace?.height ?? 0,
      controlsHeight: controls?.height ?? 0,
      controlsBottom: controls?.bottom ?? 0,
      gridBottom: grid?.bottom ?? 0,
      railHeight: rect('.scanner-market-rail')?.height ?? 0,
      gridHeight: grid?.height ?? 0,
      plotHeight: plot?.height ?? 0,
      svgHeight: svg?.height ?? 0,
      cardHeight: card?.height ?? 0,
      typeBottom: types?.bottom ?? 0,
      resultsTop: results?.top ?? 0,
      hasMarketCopy: /market context|index pulse/i.test(document.body.innerText),
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
    };
  });
}

test('desktop Scanner market rail fits the compact control plane', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.clock.install({ time: '2027-01-02T12:00:00Z' });
  await installDeterministicMarketApi(page, { expirationFetchedAt: Date.parse('2027-01-02T12:00:00Z') });

  const measurements: ScannerLayoutMetrics[] = [];
  for (const width of [1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.scanner-market-card').first()).toBeVisible({ timeout: 30_000 });
    const widthMetrics = await measure(page);
    measurements.push(widthMetrics);
    await page.screenshot({ path: testInfo.outputPath(`scanner-${width}.png`), animations: 'disabled', fullPage: false });
  }

  for (const size of ['small', 'medium', 'large']) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(value => document.documentElement.setAttribute('data-text-size', value), size);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
    const metrics = await measure(page);
    measurements.push(metrics);
    await page.screenshot({ path: testInfo.outputPath(`scanner-${size}.png`), animations: 'disabled', fullPage: false });
    expect(Math.abs(metrics.controlsBottom - metrics.gridBottom), `${size} controls and market grid should share a baseline`).toBeLessThanOrEqual(4);
    expect(metrics.overflow, `${size} Scanner should not overflow horizontally`).toBe(false);
  }

  for (const metrics of measurements) {
    expect(metrics.hasMarketCopy, `${metrics.width} Scanner should not render the removed market copy`).toBe(false);
    expect(metrics.overflow, `${metrics.width} Scanner should not overflow horizontally`).toBe(false);
    expect(Math.abs(metrics.controlsBottom - metrics.gridBottom), `${metrics.width} controls and market grid should share a baseline`).toBeLessThanOrEqual(4);
    expect(metrics.resultsTop - metrics.typeBottom, `${metrics.width} ETF Opportunities should follow the compact top section`).toBeLessThan(36);
    expect(metrics.cardHeight, `${metrics.width} market cards should remain shallow`).toBeLessThan(140);
  }
});
