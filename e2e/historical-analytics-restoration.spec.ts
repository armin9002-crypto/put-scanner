import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { installDeterministicCloudAccount } from './fixtures/cloudAccount';
import { installDeterministicMarketApi } from './fixtures/marketApi';

const baseline = process.env.HISTORICAL_RESTORATION_CAPTURE === 'baseline';
const artifacts = 'e2e-artifacts/historical-restoration';
const viewports = [[1440, 900], [320, 844], [375, 812], [390, 844], [430, 932], [844, 390]] as const;
const metrics = ['entryAy', 'realizedIrr', 'entryDelta', 'entryIv', 'premiumRunRate', 'originalDte', 'grossRiskExposure', 'averageRemainingDte'];
const ranges = ['L3M', 'L6M', 'L1Y', 'L2Y', 'Since Inception'];
const portfolio = [
  ['2024-01-01', '2024-03-20', 1, 0, 35], ['2026-04-01', '2026-06-19', 2, 1, null],
  ['2026-06-20', '2026-07-24', 1.5, 0.5, 45], ['2026-07-15', '2026-08-21', 1, 2.4, null],
  ['2026-08-01', '2026-09-18', 1, 1, 52],
].map(([soldDate, expiration, soldPrice, closePrice, entryIv], index) => ({
  id: `restored-${index}`, ticker: 'SPY', optionType: 'put', strike: 80 + index * 5, contracts: 1,
  soldDate, expiration, soldPrice, closePrice, ...(entryIv == null ? {} : { entryIv }), entryDelta: -0.2 - index * 0.05,
  status: 'closed', closeDate: expiration, createdAt: `${soldDate}T12:00:00.000Z`, updatedAt: `${expiration}T12:00:00.000Z`,
}));

test.beforeEach(() => {
  test.skip(test.info().project.name !== 'desktop-1440x900', 'This suite supplies its own viewport and touch matrices.');
});

async function reveal(page: Page) {
  const disclosure = page.getByRole('button', { name: /History/ }).first();
  if (await disclosure.isVisible().catch(() => false) && await disclosure.getAttribute('aria-expanded') === 'false') await disclosure.click();
  const chart = page.getByTestId('rolling-historical-analytics');
  await chart.scrollIntoViewIfNeeded();
  await expect(chart).toBeVisible();
  return chart;
}

async function setup(page: Page, trades: unknown[] = portfolio) {
  await page.clock.setFixedTime(new Date('2026-09-29T17:00:00Z'));
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  // Deny unmocked external traffic before installing the deterministic routes.
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.hostname === '127.0.0.1' ? route.continue() : route.abort();
  });
  const market = await installDeterministicMarketApi(page);
  const cloud = await installDeterministicCloudAccount(page, { portfolio: trades, watchlist: [] });
  await page.goto('/portfolio');
  await expect(page.getByText(/^(Open Positions|Schedule of Positions)$/).first()).toBeVisible({ timeout: 20_000 });
  const chart = await reveal(page);
  await page.waitForTimeout(400);
  return { chart, market, cloud, errors };
}

async function geometry(chart: Locator) {
  return chart.evaluate(element => {
    const box = element.getBoundingClientRect();
    const rect = (item: Element) => {
      const r = item.getBoundingClientRect();
      return [r.x - box.x, r.y - box.y, r.width, r.height].map(value => Math.round(value * 100) / 100);
    };
    return {
      size: [box.width, box.height],
      controls: [...element.querySelectorAll('select, button')].map(item => ({ text: item.textContent, rect: rect(item) })),
      plot: rect(element.querySelector('svg')!),
      paths: [...element.querySelectorAll('path.rolling-historical-analytics__line:not(.rolling-historical-analytics__line--depth)')].map(item => item.getAttribute('d')),
      labels: [...element.querySelectorAll('svg text')].map(item => ({ text: item.textContent, x: item.getAttribute('x'), y: item.getAttribute('y') })),
      heading: element.querySelector('.rolling-historical-analytics__heading')?.textContent,
    };
  });
}

test('restored layout matches the approved baseline across viewport, text size, themes and metrics', async ({ page }) => {
  test.setTimeout(180_000);
  mkdirSync(artifacts, { recursive: true });
  const { chart, errors } = await setup(page);
  const captures: Record<string, Awaited<ReturnType<typeof geometry>>> = {};
  for (const [width, height] of viewports) {
    await page.setViewportSize({ width, height });
    await reveal(page);
    for (const size of ['small', 'medium', 'large']) {
      await page.evaluate(value => document.documentElement.setAttribute('data-text-size', value), size);
      await page.mouse.move(0, 0);
      await chart.scrollIntoViewIfNeeded();
      await page.waitForTimeout(100);
      const key = `${width}x${height}-${size}`;
      captures[key] = await geometry(chart);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
      expect(await chart.locator('.rolling-historical-analytics__controls').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      expect(await chart.locator('svg').evaluate(element => getComputedStyle(element).touchAction)).toBe('pan-y');
      await chart.screenshot({ path: `${artifacts}/${baseline ? 'baseline' : 'final'}-${key}.png` });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => document.documentElement.setAttribute('data-text-size', 'small'));
  for (const theme of ['dark', 'light', 'sepia', 'dark-blue']) {
    await page.evaluate(value => document.documentElement.setAttribute('data-theme', value), theme);
    for (const metric of metrics) {
      await chart.getByRole('combobox', { name: 'Analytics', exact: true }).selectOption(metric);
      await page.mouse.move(0, 0);
      await chart.scrollIntoViewIfNeeded();
      await page.waitForTimeout(350);
      const key = `${theme}-${metric}`;
      captures[key] = await geometry(chart);
      await chart.screenshot({ path: `${artifacts}/${baseline ? 'baseline' : 'final'}-${key}.png` });
    }
  }
  const reference = `${artifacts}/baseline-geometry.json`;
  if (baseline) writeFileSync(reference, JSON.stringify(captures, null, 2));
  else {
    writeFileSync(`${artifacts}/final-geometry.json`, JSON.stringify(captures, null, 2));
    // Required, versioned fingerprints include all baseline geometry and text;
    // the approved same-path under-stroke is the only intentional visual addition.
    const expected = JSON.parse(readFileSync(new URL('./fixtures/historicalAnalyticsBaseline.json', import.meta.url), 'utf8'));
    const fingerprints = Object.fromEntries(Object.entries(captures).map(([key, value]) => [key, {
      size: value.size, plot: value.plot, sha256: createHash('sha256').update(JSON.stringify(value)).digest('hex'),
    }]));
    expect(fingerprints).toEqual(expected.captures);
  }
  expect(errors).toEqual([]);
});

test('baseline controls, exact observations and motion remain local and immediate', async ({ page }) => {
  test.skip(baseline, 'Capture baseline geometry before adding motion.');
  const { chart, market, cloud, errors } = await setup(page);
  const counts = [...market.counts.entries()];
  const requests = cloud.requests.length;
  const analytics = chart.getByRole('combobox', { name: 'Analytics', exact: true });
  await expect(analytics.locator('option')).toHaveCount(8);
  expect(await chart.getByRole('combobox', { name: 'Visible range' }).locator('option').allTextContents()).toEqual(ranges);
  await expect(chart.getByRole('combobox', { name: /^(Series|Metric)$/ })).toHaveCount(0);
  await expect(chart.getByRole('button', { name: /Compare|View data|methodology|pin/i })).toHaveCount(0);
  for (const metric of metrics) {
    await analytics.selectOption(metric);
    if (['grossRiskExposure', 'averageRemainingDte'].includes(metric)) {
      await expect(chart.getByText('Point in time', { exact: true })).toBeVisible();
      await expect(chart.getByRole('button', { name: '6M', exact: true })).toHaveCount(0);
    } else for (const period of [3, 6, 12]) {
      await chart.getByRole('button', { name: `${period}M`, exact: true }).click();
      await expect(chart.locator('h3')).toContainText(`${period}M`);
    }
    for (const range of ranges) await chart.getByRole('combobox', { name: 'Visible range' }).selectOption(range);
  }
  await analytics.selectOption('entryIv');
  const plot = chart.locator('svg');
  const latest = await chart.getAttribute('data-rolling-current-value');
  await plot.hover({ position: { x: 85, y: 70 } });
  const tooltip = chart.locator('.rolling-historical-analytics__tooltip');
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText('Partial window');
  await expect(tooltip).toContainText('Gross Risk represented');
  await expect(chart.locator('.rolling-historical-analytics__context')).toContainText('2024');
  const marker = chart.locator('.rolling-historical-analytics__marker');
  const before = await marker.getAttribute('cx');
  await plot.hover({ position: { x: 800, y: 70 } });
  expect(await marker.getAttribute('cx')).not.toBe(before);
  expect(await marker.evaluate(element => getComputedStyle(element).transitionDuration)).toBe('0s');
  await page.mouse.move(0, 0);
  await expect(tooltip).toHaveCount(0);
  await expect(chart).toHaveAttribute('data-rolling-current-value', latest!);

  // Inspect real CSS animation timelines without timing-sensitive screenshots.
  await chart.getByRole('button', { name: '3M', exact: true }).click();
  const animations = await chart.locator('.rolling-historical-analytics__data').evaluate(element => element.getAnimations().map(animation => ({
    duration: animation.effect?.getTiming().duration, frames: (animation.effect as KeyframeEffect).getKeyframes(),
  })));
  expect(animations.length).toBeGreaterThan(0);
  expect(animations.every(animation => Number(animation.duration) >= 200 && Number(animation.duration) <= 320)).toBe(true);
  expect(animations.some(animation => animation.frames.some(frame => frame.clipPath === 'inset(0px 100% 0px 0px)' || frame.clipPath === 'inset(0 100% 0 0)'))).toBe(true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await analytics.selectOption('entryDelta');
  expect(await chart.locator('.rolling-historical-analytics__data').evaluate(element => getComputedStyle(element).animationName)).toBe('none');
  await plot.hover({ position: { x: 100, y: 70 } });
  for (const selector of ['.rolling-historical-analytics__tooltip', '.rolling-historical-analytics__marker', '.rolling-historical-analytics__crosshair']) {
    expect(await chart.locator(selector).evaluate(element => getComputedStyle(element).animationName)).toBe('none');
  }
  expect([...market.counts.entries()]).toEqual(counts);
  expect(cloud.requests.length).toBe(requests);
  expect(errors).toEqual([]);
});

test('partial history, missing observations and no observations keep baseline presentation', async ({ page }) => {
  test.skip(baseline);
  const { chart } = await setup(page, portfolio.slice(1));
  await expect(chart.locator('.rolling-historical-analytics__metadata')).toContainText('Partial window');
  await expect(chart.locator('.rolling-historical-analytics__line--partial').first()).toBeVisible();
  await chart.getByRole('combobox', { name: 'Analytics', exact: true }).selectOption('entryIv');
  await expect(chart.locator('.rolling-historical-analytics__line--partial').first()).toBeVisible();
  await chart.screenshot({ path: `${artifacts}/final-partial-missing.png` });
});

test('a metric with no observations displays no fabricated value', async ({ page }) => {
  test.skip(baseline);
  const { chart } = await setup(page, portfolio.map(trade => ({ ...trade, entryIv: undefined })));
  await chart.getByRole('combobox', { name: 'Analytics', exact: true }).selectOption('entryIv');
  await expect(chart).toHaveAttribute('data-rolling-current-value', '—');
  await expect(chart.getByText('No observations available for this metric yet.')).toBeVisible();
  await expect(chart.locator('path')).toHaveCount(0);
});

test('touch inspection preserves native vertical pan and contained tooltip', async ({ browser }) => {
  test.skip(baseline);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const { chart } = await setup(page);
  const plot = chart.locator('svg');
  expect(await plot.evaluate(element => getComputedStyle(element).touchAction)).toBe('pan-y');
  const cdp = await context.newCDPSession(page);
  const bounds = await plot.boundingBox();
  // Baseline inspection is held contact, not the rejected persistent tap-to-pin model.
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: bounds!.x + 110, y: bounds!.y + 70 }] });
  await expect(chart.locator('.rolling-historical-analytics__tooltip')).toBeVisible();
  const box = await chart.boundingBox();
  const tooltip = await chart.locator('.rolling-historical-analytics__tooltip').boundingBox();
  expect(tooltip!.x).toBeGreaterThanOrEqual(box!.x);
  expect(tooltip!.x + tooltip!.width).toBeLessThanOrEqual(box!.x + box!.width);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(chart.locator('.rolling-historical-analytics__tooltip')).toHaveCount(0);
  const startScroll = await page.evaluate(() => scrollY);
  const x = bounds!.x + bounds!.width / 2;
  const y = Math.max(100, Math.min(500, bounds!.y + 80));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (const distance of [30, 70, 110]) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + distance }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => page.evaluate(() => scrollY)).not.toBe(startScroll);
  await context.close();
});
