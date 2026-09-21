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
  chartPathWidths: Array<{
    plotWidth: number;
    plotHeight: number;
    pathWidth: number;
    pathHeight: number;
    referenceWidth: number;
    leftInset: number;
    rightInset: number;
    viewBoxAspectRatio: number;
    renderedAspectRatio: number;
  }>;
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
    const chartPathWidths = [...document.querySelectorAll<SVGSVGElement>('.scanner-market-card__plot > svg')].map(svg => {
      const plot = svg.parentElement?.getBoundingClientRect();
      const path = svg.querySelector('path')?.getBoundingClientRect();
      const reference = svg.querySelector('line')?.getBoundingClientRect();
      return {
        plotWidth: plot?.width ?? 0,
        plotHeight: plot?.height ?? 0,
        pathWidth: path?.width ?? 0,
        pathHeight: path?.height ?? 0,
        referenceWidth: reference?.width ?? 0,
        leftInset: path && plot ? path.left - plot.left : 0,
        rightInset: path && plot ? plot.right - path.right : 0,
        viewBoxAspectRatio: svg.viewBox.baseVal.height > 0 ? svg.viewBox.baseVal.width / svg.viewBox.baseVal.height : 0,
        renderedAspectRatio: svg.getBoundingClientRect().height > 0 ? svg.getBoundingClientRect().width / svg.getBoundingClientRect().height : 0,
      };
    });
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
      chartPathWidths,
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
    await page.waitForFunction(() => [...document.querySelectorAll<SVGSVGElement>('.scanner-market-card__plot > svg')].every(svg => {
      const rendered = svg.getBoundingClientRect();
      return rendered.height > 0 && Math.abs((svg.viewBox.baseVal.width / svg.viewBox.baseVal.height) - (rendered.width / rendered.height)) < 0.05;
    }));
    const widthMetrics = await measure(page);
    measurements.push(widthMetrics);
    await page.screenshot({ path: testInfo.outputPath(`scanner-${width}.png`), animations: 'disabled', fullPage: false });
  }

  for (const size of ['small', 'medium', 'large']) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(value => document.documentElement.setAttribute('data-text-size', value), size);
    await page.waitForFunction(() => [...document.querySelectorAll<SVGSVGElement>('.scanner-market-card__plot > svg')].every(svg => {
      const rendered = svg.getBoundingClientRect();
      return rendered.height > 0 && Math.abs((svg.viewBox.baseVal.width / svg.viewBox.baseVal.height) - (rendered.width / rendered.height)) < 0.05;
    }));
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
    expect(metrics.chartPathWidths, `${metrics.width} Scanner should render four market paths`).toHaveLength(4);
    for (const chart of metrics.chartPathWidths) {
      expect(chart.pathWidth, `${metrics.width} chart path should use the available plot width`).toBeGreaterThan(chart.plotWidth * 0.8);
      expect(chart.referenceWidth, `${metrics.width} reference line should use the available plot width`).toBeGreaterThan(chart.plotWidth * 0.8);
      expect(chart.leftInset, `${metrics.width} chart path should not be centered by intrinsic aspect ratio`).toBeLessThan(chart.plotWidth * 0.1);
      expect(chart.rightInset, `${metrics.width} chart path should reach the right plot edge`).toBeLessThan(chart.plotWidth * 0.1);
      expect(Math.abs(chart.viewBoxAspectRatio - chart.renderedAspectRatio), `${metrics.width} responsive viewBox should match its rendered plot ratio`).toBeLessThan(0.05);
      expect(chart.pathHeight, `${metrics.width} chart path should use the available vertical plot range`).toBeGreaterThan(chart.plotHeight * 0.5);
    }
  }
});
