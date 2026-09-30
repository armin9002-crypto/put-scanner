import { expect, test, type Page } from '@playwright/test';
import { installDeterministicCloudAccount } from './fixtures/cloudAccount';
import { installDeterministicMarketApi } from './fixtures/marketApi';

const portfolio = [
  ['2020-01-01', '2020-03-20', 1, 0, 35], ['2026-04-01', '2026-06-19', 2, 1, null],
  ['2026-06-20', '2026-07-24', 1.5, 0.5, 45], ['2026-07-15', '2026-08-21', 1, 2.4, null],
  ['2026-08-01', '2026-09-18', 1, 1, 52],
].map(([soldDate, expiration, soldPrice, closePrice, entryIv], index) => ({
  id: `analytics-${index}`, ticker: 'SPY', optionType: 'put', strike: 80 + index * 5, contracts: 1,
  soldDate, expiration, soldPrice, closePrice, ...(entryIv == null ? {} : { entryIv }), ...(index === 1 ? {} : { entryDelta: -0.2 - index * 0.05 }),
  status: 'closed', closeDate: expiration, createdAt: `${soldDate}T12:00:00.000Z`, updatedAt: `${expiration}T12:00:00.000Z`,
}));

const viewports = [[1440, 900], [320, 844], [375, 812], [390, 844], [430, 932], [844, 390]] as const;
const footprintCeilings: Record<string, number[]> = {
  '1440': [401.890625, 412.78125, 423.6875], '320': [415, 435, 472], '375': [415, 435, 454], '390': [402, 421, 440], '430': [402, 421, 440],
};

async function openAnalytics(page: Page) {
  await page.goto('/portfolio');
  await expect(page.getByText(/^(Open Positions|Schedule of Positions)$/).first()).toBeVisible({ timeout: 20_000 });
  return revealAnalytics(page);
}

async function revealAnalytics(page: Page) {
  const disclosure = page.getByRole('button', { name: /History/ }).first();
  if (await disclosure.isVisible().catch(() => false) && await disclosure.getAttribute('aria-expanded') === 'false') await disclosure.click();
  const chart = page.getByTestId('rolling-historical-analytics');
  await chart.scrollIntoViewIfNeeded();
  await expect(chart).toBeVisible();
  return chart;
}

function expectNoOverlap(boxes: Array<{ x: number; y: number; width: number; height: number }>, horizontalOnly = false) {
  for (let first = 0; first < boxes.length; first += 1) for (let second = first + 1; second < boxes.length; second += 1) {
    const a = boxes[first];
    const b = boxes[second];
    const overlapX = a.x < b.x + b.width && b.x < a.x + a.width;
    const overlapY = a.y < b.y + b.height && b.y < a.y + a.height;
    expect(overlapX && (horizontalOnly || overlapY)).toBe(false);
  }
}

test('Historical Analytics 2.0 stays within the established responsive footprint', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await page.clock.setFixedTime(new Date('2026-09-29T17:00:00Z'));
  await installDeterministicMarketApi(page);
  await installDeterministicCloudAccount(page, { portfolio, watchlist: [] });
  const chart = await openAnalytics(page);
  const measurements: unknown[] = [];
  const footprintViolations: Array<{ viewport: string; textSize: string; actual: number; ceiling: number }> = [];
  for (const [width, height] of viewports) {
    await page.setViewportSize({ width, height });
    await revealAnalytics(page);
    for (const [index, textSize] of ['small', 'medium', 'large'].entries()) {
      await page.evaluate(size => document.documentElement.setAttribute('data-text-size', size), textSize);
      await chart.scrollIntoViewIfNeeded();
      const controls = chart.getByRole('group', { name: /Historical analytics controls/ });
      await expect(controls).toBeVisible();
      await controls.evaluate(element => { element.scrollLeft = element.scrollWidth; });
      await expect(chart.getByRole('button', { name: 'View data' })).toBeVisible();
      await expect(page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).resolves.toBe(true);
      const box = await chart.boundingBox();
      const plot = await chart.locator('svg').boundingBox();
      const svg = chart.locator('svg');
      const readBoxes = (selector: string) => svg.locator(selector).evaluateAll(elements => elements.map(element => {
        const box = element.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height };
      }));
      expectNoOverlap(await readBoxes('.rolling-historical-analytics__value-label'));
      expectNoOverlap(await readBoxes('.rolling-historical-analytics__x-label'), true);
      expect(plot?.height).toBe(height === 390 ? 156 : width < 768 ? 212 : 292);
      const ceiling = footprintCeilings[String(width)]?.[index];
      if (ceiling != null && (box?.height ?? Infinity) > ceiling) footprintViolations.push({ viewport: `${width}x${height}`, textSize, actual: box?.height ?? Infinity, ceiling });
      measurements.push({ width, height, textSize, chart: box, plot, controls: await controls.evaluate(element => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth })) });
      if ((width === 1440 && textSize === 'small') || (width === 320 && textSize === 'large') || (width === 390 && textSize === 'large') || (width === 844 && textSize === 'large')) {
        await chart.screenshot({ path: testInfo.outputPath(`historical-${width}-${textSize}.png`) });
      }
    }
  }
  await testInfo.attach('historical-analytics-footprint.json', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' });
  expect(footprintViolations).toEqual([]);
});

test('Historical Analytics 2.0 interaction, data, state, and request matrix', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.setFixedTime(new Date('2026-09-29T17:00:00Z'));
  const market = await installDeterministicMarketApi(page);
  const cloud = await installDeterministicCloudAccount(page, { portfolio, watchlist: [] });
  const chart = await openAnalytics(page);
  await page.waitForTimeout(250);
  const settledCloud = [...cloud.requests];
  const settledMarket = [...market.counts.entries()];
  const metric = chart.getByRole('combobox', { name: 'Metric' });
  const range = chart.getByRole('combobox', { name: 'Range' });
  const plot = chart.getByTestId('rolling-historical-analytics-plot');
  const svg = plot.locator('svg');

  for (const value of ['YTD', 'L3Y', 'Since Inception']) {
    await range.selectOption(value);
    await expect(range).toHaveValue(value);
  }
  for (const window of ['3', '6', '12']) {
    await chart.getByRole('button', { name: `${window}M`, exact: true }).click();
    await expect(chart.getByRole('button', { name: `${window}M`, exact: true })).toHaveAttribute('aria-pressed', 'true');
  }
  await chart.getByRole('button', { name: 'Compare' }).click();
  await expect(chart).toHaveAttribute('data-comparison', 'true');
  await expect(plot.locator('.historical-series')).toHaveCount(3);
  await expect(plot.getByText(/12M primary/)).toBeVisible();

  const headline = await chart.getAttribute('data-rolling-current-value');
  await svg.hover({ position: { x: 80, y: 90 } });
  await expect(chart.locator('.rolling-historical-analytics__tooltip')).toBeVisible();
  await expect(chart).toHaveAttribute('data-rolling-current-value', headline ?? '');
  await svg.click({ position: { x: 100, y: 80 } });
  await expect(chart).not.toHaveAttribute('data-pinned-date', '');
  await page.mouse.move(0, 0);
  await expect(chart.locator('.rolling-historical-analytics__tooltip')).toHaveClass(/is-pinned/);
  await svg.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(chart).toHaveAttribute('data-rolling-hover-value', /.+/);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(chart).toHaveAttribute('data-pinned-date', '');
  await expect(chart.locator('.rolling-historical-analytics__tooltip')).toHaveCount(0);

  await chart.getByRole('button', { name: 'View data' }).click();
  const comparisonDialog = page.getByRole('dialog', { name: /Observation data/ });
  await expect(comparisonDialog.locator('tbody tr')).toHaveCount(Number(await chart.getAttribute('data-rolling-observation-count')) * 3);
  await comparisonDialog.screenshot({ path: testInfo.outputPath('historical-data-desktop.png') });
  await page.keyboard.press('Escape');
  await expect(comparisonDialog).toHaveCount(0);

  await metric.selectOption('entryIv');
  await expect(chart.locator('.rolling-historical-analytics__metadata')).toContainText(/incomplete coverage/);
  await metric.selectOption('realizedIrr');
  await range.selectOption('L3M');
  await svg.focus();
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowLeft');
  await expect(chart.locator('.rolling-historical-analytics__tooltip')).toContainText(/-|âˆ’/);
  await range.selectOption('Since Inception');
  await chart.getByRole('combobox', { name: 'Series' }).selectOption('PORTFOLIO_STATE');
  await metric.selectOption('averageRemainingDte');
  const stateLines = plot.locator('.rolling-historical-analytics__line');
  expect(await stateLines.count()).toBeGreaterThan(1);
  for (const path of await stateLines.evaluateAll(elements => elements.map(element => element.getAttribute('d') ?? ''))) {
    expect(path).toMatch(/H .* V/);
  }
  await expect(chart.getByRole('button', { name: 'Compare' })).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await revealAnalytics(page);
  await range.selectOption('L3M');
  await chart.screenshot({ path: testInfo.outputPath('historical-analytics-mobile.png') });
  const opener = chart.getByRole('button', { name: 'View data' });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: /Observation data/ });
  await expect(dialog).toBeVisible();
  await dialog.screenshot({ path: testInfo.outputPath('historical-data-sheet.png') });
  const rowCount = await chart.getAttribute('data-rolling-observation-count');
  await expect(dialog.getByRole('row')).toHaveCount(Number(rowCount) + 1);
  await expect(dialog.getByText(`${rowCount} visible dates`, { exact: false })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(dialog.locator(':focus')).toHaveCount(1);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();

  expect(cloud.requests).toEqual(settledCloud);
  expect([...market.counts.entries()]).toEqual(settledMarket);
  expect(errors).toEqual([]);
});

test('unavailable IV stays unavailable in the headline, plot, and data rows', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-29T17:00:00Z'));
  await installDeterministicMarketApi(page);
  await installDeterministicCloudAccount(page, { portfolio: portfolio.map(trade => ({ ...trade, entryIv: undefined })), watchlist: [] });
  const chart = await openAnalytics(page);
  await chart.getByRole('combobox', { name: 'Metric' }).selectOption('entryIv');
  await chart.getByRole('combobox', { name: 'Range' }).selectOption('L3M');
  await expect(chart).toHaveAttribute('data-rolling-current-value', '—');
  await expect(chart.locator('.rolling-historical-analytics__empty')).toBeVisible();
  await expect(chart.locator('.rolling-historical-analytics__line')).toHaveCount(0);
  await chart.getByRole('button', { name: 'View data' }).click();
  const rows = page.getByRole('dialog').locator('tbody tr');
  await expect(rows).toHaveCount(Number(await chart.getAttribute('data-rolling-observation-count')));
  for (const value of await rows.locator('td:first-of-type').allTextContents()) expect(value).toBe('—');
});

test('Historical Analytics 2.0 supports touch pinning', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:4317', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date('2026-09-29T17:00:00Z'));
  await installDeterministicMarketApi(page);
  await installDeterministicCloudAccount(page, { portfolio, watchlist: [] });
  const chart = await openAnalytics(page);
  await chart.getByTestId('rolling-historical-analytics-plot').locator('svg').tap({ position: { x: 100, y: 80 } });
  await expect(chart).not.toHaveAttribute('data-pinned-date', '');
  await context.close();
});
