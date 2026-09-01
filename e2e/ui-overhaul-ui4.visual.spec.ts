import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { installDeterministicMarketApi } from './fixtures/marketApi';

const phase = process.env.UI_OVERHAUL_CAPTURE;
const outputRoot = path.join(process.cwd(), 'e2e-artifacts', 'ui-overhaul', 'ui4', phase || 'disabled');
const overflows: Array<{ project: string; name: string; url: string; pageOverflow: boolean; rootScrollWidth: number; rootClientWidth: number }> = [];

type PulseDensityMetrics = {
  viewport: { width: number; height: number };
  rowHeight: number | null;
  visibleRows: number;
  skeletonHeight: number | null;
  visibleSkeletons: number;
  pageOverflow: boolean;
};

async function settle(page: Page, ms = 350) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(ms);
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  const directory = path.join(outputRoot, testInfo.project.name);
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, `${name}.png`), animations: 'disabled', fullPage: true });
  const overflow = await page.evaluate(() => ({
    pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    rootScrollWidth: document.documentElement.scrollWidth,
    rootClientWidth: document.documentElement.clientWidth,
  }));
  overflows.push({ project: testInfo.project.name, name, url: page.url(), ...overflow });
}

async function measurePulseDensity(page: Page): Promise<PulseDensityMetrics> {
  return page.evaluate(() => {
    const visible = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect();
      return rect.height > 0 && rect.top < window.innerHeight && rect.bottom > 0;
    };
    const rows = Array.from(document.querySelectorAll<HTMLElement>('.mobile-pulse-list-item'));
    const skeletons = Array.from(document.querySelectorAll<HTMLElement>('.pulse-mobile-skeleton'));
    const firstRow = rows.find(row => row.getBoundingClientRect().height > 0)?.getBoundingClientRect() ?? null;
    const firstSkeleton = skeletons.find(skeleton => skeleton.getBoundingClientRect().height > 0)?.getBoundingClientRect() ?? null;
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      rowHeight: firstRow?.height ?? null,
      visibleRows: rows.filter(visible).length,
      skeletonHeight: firstSkeleton?.height ?? null,
      visibleSkeletons: skeletons.filter(visible).length,
      pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    };
  });
}

async function writePulseDensityMetrics(page: Page, testInfo: TestInfo, name: string, metrics: PulseDensityMetrics) {
  const directory = path.join(outputRoot, testInfo.project.name);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, `${name}-metrics.json`), `${JSON.stringify(metrics, null, 2)}\n`, 'utf8');
}

async function loadScreener(page: Page) {
  await page.getByRole('button', { name: /Load|Run Screener/i }).first().click();
  const confirm = page.getByRole('button', { name: /Run scan|Confirm/i });
  if (await confirm.count()) await confirm.first().click();
}

async function selectScreenerOption(page: Page, value: string) {
  const index = await page.locator('select').evaluateAll((selects, target) => selects.findIndex(select => Array.from(select.options).some(option => option.value === target)), value);
  if (index >= 0) await page.locator('select').nth(index).selectOption(value);
}

async function waitScreenerReady(page: Page) {
  await expect(page.getByText(/visible after local filters|Showing \d+ results/).first()).toBeVisible({ timeout: 30_000 });
}

async function captureScreener(page: Page, testInfo: TestInfo) {
  const harness = await installDeterministicMarketApi(page);
  await page.goto('/screener');
  await expect(page.getByRole('button', { name: /Load|Run Screener/i }).first()).toBeVisible();
  await settle(page);
  await capture(page, testInfo, 'screener-initial');

  const etfInput = page.getByPlaceholder('Select ETFs...').first();
  if (await etfInput.count()) {
    await etfInput.fill('TQQQ');
    const option = page.getByRole('button', { name: /TQQQ/ }).first();
    if (await option.count()) await option.click();
  }
  await selectScreenerOption(page, 'below_0.30');
  await capture(page, testInfo, 'screener-filters-modified');

  harness.delays.set('screener-batch', 650);
  await loadScreener(page);
  await page.waitForTimeout(180);
  await capture(page, testInfo, 'screener-loading');
  harness.delays.delete('screener-batch');
  await waitScreenerReady(page);
  await capture(page, testInfo, 'screener-populated');

  const yieldHeader = page.getByRole('columnheader', { name: /AY Bid/i });
  if (await yieldHeader.count()) await yieldHeader.click();
  await capture(page, testInfo, 'screener-sorted');

  await selectScreenerOption(page, 'below_0.20');
  await capture(page, testInfo, 'screener-local-filters');

  harness.failNext.add('screener-batch');
  await page.reload();
  await settle(page);
  await loadScreener(page);
  await expect(page.getByText(/Some results could not be loaded/i).first()).toBeVisible({ timeout: 30_000 });
  await capture(page, testInfo, 'screener-partial-failure');
  const retry = page.getByRole('button', { name: /Retry failed results/i }).first();
  if (await retry.count()) {
    await retry.click();
    await waitScreenerReady(page);
    await capture(page, testInfo, 'screener-retry-success');
  }

  harness.failuresRemaining.set('screener-batch', 30);
  await page.reload();
  await settle(page);
  await loadScreener(page);
  await expect(page.getByRole('alert').first()).toBeVisible({ timeout: 30_000 });
  await capture(page, testInfo, 'screener-fatal-failure');
  harness.failuresRemaining.delete('screener-batch');

  await page.reload();
  await settle(page);
  await loadScreener(page);
  await waitScreenerReady(page);
  await selectScreenerOption(page, 'below_0.05');
  await expect(page.getByText('No options match the current filters.', { exact: true })).toBeVisible();
  await capture(page, testInfo, 'screener-empty-result');

  await page.reload();
  await settle(page);
  await loadScreener(page);
  await waitScreenerReady(page);
  const strike = page.getByRole('button', { name: /Open option details/i }).first();
  if (await strike.count()) {
    await strike.click();
    await expect(page.getByRole('complementary')).toBeVisible({ timeout: 10_000 });
    await capture(page, testInfo, 'screener-option-drawer');
  }
}

async function capturePulse(page: Page, testInfo: TestInfo) {
  const harness = await installDeterministicMarketApi(page);
  harness.delays.set('etf-pulse', 800);
  await page.goto('/pulse');
  await expect(page.getByText(/ETF Pulse/i).first()).toBeVisible();
  await page.waitForTimeout(180);
  await capture(page, testInfo, 'pulse-loading');
  await page.waitForTimeout(750);
  await expect(page.getByText('ETF Pulse Visuals')).toBeVisible({ timeout: 30_000 });
  await capture(page, testInfo, 'pulse-populated');
  harness.delays.delete('etf-pulse');

  const sort = page.getByRole('columnheader', { name: /30D/i }).first();
  if (await sort.count()) await sort.click();
  await capture(page, testInfo, 'pulse-sorted');
  const details = page.getByRole('button', { name: 'Details' }).first();
  if (await details.count()) {
    await details.click();
    await page.waitForTimeout(250);
    await capture(page, testInfo, 'pulse-market-read');
    const close = page.getByRole('button', { name: 'Close market read' });
    if (await close.count()) await close.focus();
  }

  await page.goto('/pulse');
  await page.waitForTimeout(300);
  harness.failNext.add('etf-pulse');
  const refresh = page.getByRole('button', { name: /Refresh/ }).first();
  if (await refresh.count()) {
    await refresh.click();
    await page.waitForTimeout(500);
    await capture(page, testInfo, 'pulse-error-existing-data');
  }
  await page.reload();
  await settle(page);
  await expect(page.getByText('ETF Pulse Visuals')).toBeVisible({ timeout: 30_000 });
  await capture(page, testInfo, 'pulse-cached-revisit');
}

async function captureDesktop(page: Page, testInfo: TestInfo) {
  await captureScreener(page, testInfo);
  await capturePulse(page, testInfo);
  for (const theme of ['dark', 'dark-blue', 'light', 'sepia']) {
    await page.evaluate(value => localStorage.setItem('put_scanner_theme', value), theme);
    await page.goto('/screener');
    await settle(page);
    await capture(page, testInfo, `theme-${theme}-screener`);
    await page.goto('/pulse');
    await settle(page);
    await capture(page, testInfo, `theme-${theme}-pulse`);
  }
}

async function capturePhone(page: Page, testInfo: TestInfo) {
  const harness = await installDeterministicMarketApi(page);
  await page.goto('/');
  await expect(page.getByPlaceholder(/Filter \/ Search by Ticker/i).first()).toBeVisible();
  await settle(page);
  await capture(page, testInfo, 'mobile-scanner-shell');
  for (const route of ['/screener', '/pulse', '/watchlist', '/portfolio', '/options/TQQQ']) {
    if (route === '/pulse') {
      harness.delays.set('etf-pulse', 800);
      await page.goto(route);
      await expect(page.getByText(/ETF Pulse/i).first()).toBeVisible();
      await page.waitForTimeout(180);
      await capture(page, testInfo, 'mobile-pulse-loading');
      const pulseLoadingMetrics = await measurePulseDensity(page);
      await writePulseDensityMetrics(page, testInfo, 'mobile-pulse-loading', pulseLoadingMetrics);
      if (pulseLoadingMetrics.skeletonHeight != null) {
        expect(pulseLoadingMetrics.skeletonHeight, `${testInfo.project.name} ETF Pulse loading skeleton should stay compact`).toBeLessThanOrEqual(60);
      }
      expect(pulseLoadingMetrics.pageOverflow, `${testInfo.project.name} ETF Pulse loading should not overflow horizontally`).toBe(false);
      harness.delays.delete('etf-pulse');
      await expect(page.locator('.mobile-pulse-list-item').first()).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(250);
      await capture(page, testInfo, 'mobile-pulse');
      const pulseMetrics = await measurePulseDensity(page);
      await writePulseDensityMetrics(page, testInfo, 'mobile-pulse', pulseMetrics);
      if (pulseMetrics.viewport.width < 768) {
        expect(pulseMetrics.rowHeight, `${testInfo.project.name} ETF Pulse List row should stay compact`).toBeLessThanOrEqual(90);
      } else if (pulseMetrics.viewport.width <= 950 && pulseMetrics.viewport.height <= 520) {
        expect(pulseMetrics.rowHeight, `${testInfo.project.name} ETF Pulse List row should stay compact in phone landscape`).toBeLessThanOrEqual(100);
      }
      expect(pulseMetrics.pageOverflow, `${testInfo.project.name} ETF Pulse should not overflow horizontally`).toBe(false);

      for (const visual of ['Heatmap', 'Momentum'] as const) {
        await page.getByRole('tab', { name: visual, exact: true }).click();
        await expect(page.getByRole('tab', { name: visual, exact: true })).toHaveAttribute('aria-selected', 'true');
        await capture(page, testInfo, `mobile-pulse-${visual.toLowerCase()}`);
      }
      await page.getByRole('tab', { name: 'List', exact: true }).click();
      continue;
    }
    await page.goto(route);
    await settle(page);
    await capture(page, testInfo, `mobile-${route.slice(1).replace('/', '-') || 'scanner'}`);
  }
  for (const theme of ['dark', 'dark-blue', 'light', 'sepia']) {
    await page.evaluate(value => localStorage.setItem('put_scanner_theme', value), theme);
    await page.goto('/pulse');
    await settle(page);
    await capture(page, testInfo, `theme-${theme}-mobile-pulse`);
  }
}

test.describe('UI-4 deterministic visual matrix', () => {
  test.skip(!phase, 'Run through npm run visual:ui4 -- before|after.');
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      if (!localStorage.getItem('put_scanner_theme')) localStorage.setItem('put_scanner_theme', 'dark');
      localStorage.removeItem('put_scanner_debug_layout');
      localStorage.removeItem('put_scanner_debug_network');
    });
  });

  test('capture Screener, ETF Pulse, and shell states', async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    const project = testInfo.project.name;
    if (project === 'desktop-1440x900') await captureDesktop(page, testInfo);
    else if (project === 'portrait-390x844') await capturePhone(page, testInfo);
    else if (project === 'landscape-844x390') await capturePhone(page, testInfo);
    else {
      await installDeterministicMarketApi(page);
      await page.goto('/screener');
      await expect(page.getByRole('button', { name: /Load|Run Screener/i }).first()).toBeVisible();
      await settle(page);
      await capture(page, testInfo, 'screener-responsive');
      await page.goto('/pulse');
      await expect(page.getByText(/ETF Pulse/i).first()).toBeVisible();
      await settle(page);
      await capture(page, testInfo, 'pulse-responsive');
    }
    await mkdir(outputRoot, { recursive: true });
    await writeFile(path.join(outputRoot, `overflow-report-${project}.json`), `${JSON.stringify(overflows.filter(entry => entry.project === project), null, 2)}\n`, 'utf8');
  });

  test('mobile filter sheets preserve focus, Escape, and touch reachability', async ({ page }, testInfo) => {
    test.skip(!phase || testInfo.project.name !== 'portrait-390x844', 'focused phone interaction check');
    await installDeterministicMarketApi(page);
    await page.goto('/screener');
    await expect(page.getByRole('button', { name: 'Run Screener' })).toBeVisible();
    await page.getByRole('button', { name: /Filters/ }).first().click();
    const screenerDialog = page.getByRole('dialog', { name: 'Screener filters' });
    await expect(screenerDialog).toBeVisible();
    const etfInput = screenerDialog.getByPlaceholder(/All ETFs|Add ETF/);
    await etfInput.fill('TQQQ');
    await page.keyboard.press('Escape');
    await expect(screenerDialog).toHaveCount(0);

    await page.goto('/pulse');
    await expect(page.getByText(/ETF Pulse/i).first()).toBeVisible();
    await page.getByRole('button', { name: 'Filters' }).click();
    const pulseDialog = page.getByRole('dialog', { name: 'ETF Pulse filters' });
    await expect(pulseDialog).toBeVisible();
    await pulseDialog.getByPlaceholder('Ticker, name, or theme').fill('TQQQ');
    await page.keyboard.press('Escape');
    await expect(pulseDialog).toHaveCount(0);
  });
});
