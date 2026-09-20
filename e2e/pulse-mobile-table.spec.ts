import { expect, test } from '@playwright/test';
import { installDeterministicMarketApi } from './fixtures/marketApi';

test('portrait ETF Pulse List is a contained compact financial table', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('portrait-'), 'portrait ETF Pulse table check');
  await installDeterministicMarketApi(page);
  await page.goto('/pulse');
  await expect(page.getByText('ETF Pulse').first()).toBeVisible({ timeout: 30_000 });
  const table = page.locator('.mobile-financial-table');
  await expect(table).toBeVisible({ timeout: 30_000 });
  await expect(table.locator('tbody tr.mobile-financial-table-row:not(.mobile-pulse-loading-row)').first()).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: testInfo.outputPath('pulse-mobile-table.png'), fullPage: true });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  await page.screenshot({ path: testInfo.outputPath('pulse-mobile-table-light.png'), fullPage: true });

  await expect(table.locator('thead th')).toHaveText([
    'Ticker', 'Price', '1D', '5D', '30D', '3M', '6M', 'YTD', '1Y', 'Recent DD', 'RSI', '20D RV',
    'vs 20D', 'vs 50D', 'vs 200D', '52W High', '% 52W High', '52W Pos', '52W DD', 'Trend',
  ]);
  await expect(table.locator('thead th.mobile-financial-table-identity')).toHaveText('Ticker');
  const firstTicker = table.locator('tbody tr.mobile-financial-table-row:not(.mobile-pulse-loading-row) th a').first();
  await expect(firstTicker).toHaveAttribute('href', /\/options\//);

  const layout = await page.locator('.mobile-financial-table-scroll').evaluate(element => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
    pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  }));
  expect(layout.scrollWidth).toBeGreaterThan(layout.clientWidth);
  expect(layout.pageOverflow).toBe(false);

  await page.getByRole('button', { name: '6M', exact: true }).first().click();
  await expect(table.locator('thead th.is-selected')).toHaveText('6M');
  await page.getByRole('tab', { name: 'Heatmap', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Heatmap', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'Momentum', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Momentum', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'List', exact: true }).click();
  await expect(table).toBeVisible();
});

test('portrait Pulse table stays dense and contained across requested widths and text themes', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('portrait-'), 'portrait ETF Pulse table matrix');
  await installDeterministicMarketApi(page);

  const projectWidth = Number(testInfo.project.name.match(/portrait-(\d+)/)?.[1] ?? 390);
  const width = Number(process.env.PULSE_VIEWPORT_WIDTH ?? projectWidth);
  const height = width === 320 ? 700 : width === 375 ? 667 : width === 430 ? 932 : 844;
  await page.setViewportSize({ width, height });
  await page.goto('/pulse');
  await expect(page.locator('.mobile-financial-table tbody tr.mobile-financial-table-row:not(.mobile-pulse-loading-row)').first()).toBeVisible({ timeout: 30_000 });
  const metrics = await page.locator('.mobile-financial-table-scroll').evaluate(element => {
    const row = element.querySelector<HTMLElement>('tbody tr.mobile-financial-table-row:not(.mobile-pulse-loading-row)');
    return {
      rowHeight: row?.getBoundingClientRect().height ?? 0,
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    };
  });
  expect(metrics.rowHeight, `${width}px Pulse row should remain compact`).toBeLessThanOrEqual(45);
  expect(metrics.scrollWidth, `${width}px Pulse table should scroll horizontally`).toBeGreaterThan(metrics.clientWidth);
  expect(metrics.pageOverflow, `${width}px Pulse page should not overflow horizontally`).toBe(false);

  for (const textSize of ['small', 'medium', 'large']) {
    for (const theme of ['dark', 'light']) {
      await page.evaluate(({ theme: nextTheme, textSize: nextTextSize }) => {
        document.documentElement.dataset.theme = nextTheme;
        document.documentElement.dataset.textSize = nextTextSize;
      }, { theme, textSize });
      await expect(page.locator('.mobile-financial-table-scroll')).toBeVisible();
      const themedOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      expect(themedOverflow, `${width}px ${theme}/${textSize} Pulse page should not overflow horizontally`).toBe(false);
    }
  }
});
