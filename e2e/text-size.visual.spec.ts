import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { installDeterministicMarketApi } from './fixtures/marketApi';
import { installDeterministicCloudAccount } from './fixtures/cloudAccount';
import { checkChartScale, checkMobileTable, checkNavigation, checkOverlay, typographySample } from './fixtures/textSizeChecks';

import { portfolio, watchlist } from './fixtures/textSizeAccount';

const baseline = process.env.TEXT_SIZE_CAPTURE === 'baseline';
const artifacts = path.join(process.cwd(), 'e2e-artifacts', 'text-size');
const routes = [
  ['scanner', '/'], ['screener', '/screener'],
  ['recommendations', '/recommendations?recommendations-fixture=actionable'],
  ['watchlist', '/watchlist'], ['portfolio', '/portfolio'],
  ['options', '/options/TQQQ'], ['pulse', '/pulse'],
] as const;

async function loadScreener(page: Page) {
  const filters = page.getByRole('button', { name: /^Filters/ });
  if (await filters.isVisible()) {
    await filters.click();
    await page.getByText('Recent Trades Only', { exact: true }).locator('..').getByRole('combobox').selectOption('no');
    await page.getByText('Expiration', { exact: true }).locator('..').getByRole('combobox').selectOption('all');
    await page.getByRole('button', { name: 'Done', exact: true }).click();
  } else {
    await page.getByRole('checkbox', { name: /Recent Trades Only/ }).uncheck();
  }
  await page.getByRole('button', { name: /^(Load|Run Screener)$/i }).click();
  const confirm = page.getByRole('button', { name: /^(Run scan|Confirm)$/i });
  if (await confirm.count()) await confirm.click();
  await expect(page.getByText(/visible after local filters|Showing \d+(?: results| after local filters)/).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('tbody tr').first()).toBeVisible();
}

type TextSample = { tag: string; text: string | null; font: string; line: string; x: number; y: number; w: number; h: number };
const stableSamples = (samples: TextSample[]) => samples.filter(x => !/ago|Updated|Refreshed|Saved|AM|PM/.test(x.text || ''));

async function capture(page: Page, directory: string, name: string) {
  await page.screenshot({ path: path.join(directory, `${name}.png`), animations: 'disabled' });
  const metrics = await page.evaluate(() => {
    const elements = [...document.querySelectorAll<HTMLElement>('body *')].filter(el =>
      !el.closest('nav, .mobile-page-header, .app-desktop-nav, .app-nav-utilities') &&
      el.children.length === 0 && el.textContent?.trim() && el.getBoundingClientRect().width > 0);
    return elements.map(el => {
      const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
      return { tag: el.tagName, text: el.textContent, font: s.fontSize, line: s.lineHeight,
        x: r.x, y: r.y, w: r.width, h: r.height };
    });
  });
  await writeFile(path.join(directory, `${name}.json`), JSON.stringify(metrics, null, 2));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const clippedUtilities = await page.locator('.app-nav-utilities button, .mobile-page-header button').evaluateAll(elements => elements.filter(el => {
    const r = el.getBoundingClientRect();
    return el.checkVisibility() && !el.getAttribute('aria-label')?.startsWith('Fixture ') && r.width > 0 && (r.left < -1 || r.right > innerWidth + 1);
  }).map(el => el.getAttribute('aria-label') || el.textContent));
  expect(clippedUtilities, `${name}: utility controls stay inside viewport`).toEqual([]);
  if (!baseline) await checkNavigation(page);
  if (!baseline && await page.locator('[role="dialog"]:visible').count()) await checkOverlay(page);
  return metrics;
}

test('text size route and overlay matrix', async ({ page }, info) => {
  test.setTimeout(240_000);
  await page.clock.setFixedTime(new Date('2026-09-05T16:00:00Z'));
  await installDeterministicMarketApi(page, { expirationFetchedAt: Date.parse('2026-09-04T20:00:00Z') });
  await installDeterministicCloudAccount(page, { portfolio, watchlist, preferences: {} });
  await page.addInitScript(() => {
    if (!localStorage.getItem('put_scanner_theme')) localStorage.setItem('put_scanner_theme', 'dark');
    localStorage.setItem('theme_migration_version', '2');
  });
  const sizes = ['small', 'medium', 'large'];
  for (const size of sizes) {
    const directory = path.join(artifacts, baseline ? 'baseline' : 'final', info.project.name, size);
    await mkdir(directory, { recursive: true });
    for (const [name, route] of routes) {
      await page.goto(route);
      await page.evaluate(value => localStorage.setItem('put_scanner_text_size', value), size);
      await page.reload();
      await page.waitForTimeout(1100);
      if (name === 'scanner') await expect(page.locator('a[href="/options/TQQQ"]').first()).toBeVisible();
      if (name === 'screener') await loadScreener(page);
      if (!baseline) await expect(page.locator('html')).toHaveAttribute('data-text-size', size);
      const metrics = await capture(page, directory, name);
      if (!baseline) await checkMobileTable(page);
      if (!baseline && process.env.TEXT_SIZE_COMPARE === 'true' && size !== 'large') {
        // Fresh pre-edit current-main captures, never the historical September 5 hashes.
        const previousSize = size === 'small' ? 'small' : 'large';
        const reference = JSON.parse(readFileSync(path.join(artifacts, 'baseline', info.project.name, previousSize, `${name}.json`), 'utf8'));
        expect(stableSamples(metrics), `${info.project.name}/${name}: ${size} matches PRE ${previousSize}`).toEqual(stableSamples(reference));
      }
      if (name === 'options') {
        const row = page.getByRole('row').filter({ hasText: '90.00' }).last();
        if (await row.count()) await row.click();
        else await page.locator('.mobile-financial-table-row').first().click();
        await expect(page.locator('aside, .option-drawer-mobile').last()).toBeVisible();
        await capture(page, directory, 'option-drawer');
      }
      if (name === 'recommendations') {
        await page.getByRole('button', { name: 'Methodology', exact: true }).click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await capture(page, directory, 'methodology');
      }
    }
    await page.goto('/?account-ui-fixture=synced');
    await expect(page.getByRole('dialog')).toBeVisible();
    await capture(page, directory, 'account-sheet');
  }
});



test('text control persistence, request isolation, dense themes and charts', async ({ page }, info) => {
  test.skip(baseline, 'Behavior applies to the new control.');
  test.setTimeout(300_000);
  page.setDefaultTimeout(8000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.setFixedTime(new Date('2026-09-05T16:00:00Z'));
  await installDeterministicMarketApi(page, { expirationFetchedAt: Date.parse('2026-09-04T20:00:00Z') });
  // The historical screenshot fixture predates the current chart response schema.
  await page.route('**/api/chart-history?**', async route => {
    const params = new URL(route.request().url()).searchParams;
    const points = Array.from({ length: 60 }, (_, i) => ({
      timestamp: 1_787_000_000 + i * 3600,
      date: new Date((1_787_000_000 + i * 3600) * 1000).toISOString(), price: 95 + i / 10 + Math.sin(i / 5),
    }));
    await route.fulfill({ json: { ticker: params.get('ticker'), displayTicker: params.get('ticker'),
      timeframe: params.get('timeframe') || '1D', points, corporateActions: [], previousClose: 95,
      latestPrice: points.at(-1)?.price, fetchedAt: Date.now(), metadata: { interval: '1h' } } });
  });
  const cloud = await installDeterministicCloudAccount(page, { portfolio, watchlist, preferences: {} });
  const requests: string[] = [];
  page.on('request', request => { if (/\/api\/|supabase/.test(request.url())) requests.push(request.url()); });
  const checkCharts = async (labels: Parameters<typeof checkChartScale>[1]) => {
    await page.waitForLoadState('networkidle');
    const count = requests.length; const rows = JSON.stringify(cloud.rows);
    await checkChartScale(page, labels);
    await page.waitForTimeout(100);
    expect(requests.length, 'chart text changes make no requests').toBe(count);
    expect(JSON.stringify(cloud.rows)).toBe(rows);
  };
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Text size: Small', exact: true })).toBeVisible();
  await page.waitForLoadState('networkidle');
  const rootFont = await page.locator('html').evaluate(el => getComputedStyle(el).fontSize);
  for (const [name, route] of routes.filter(([name]) => name !== 'options')) {
    await page.goto(route);
    await page.waitForLoadState('networkidle');
    if (name === 'screener') await loadScreener(page);
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => window.scrollTo(0, 0));
    const count = requests.length;
    const beforeRows = JSON.stringify(cloud.rows);
    const original = await page.locator('body').innerText();
    const sizeBefore = await page.locator('body').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    const textBefore = await typographySample(page);
    const chartPaths = await page.locator('svg path[d]').evaluateAll(elements => elements.map(el => el.getAttribute('d')));
    for (const size of ['Medium', 'Large', 'Small']) {
      await page.getByRole('button', { name: /^Text size:/ }).click();
      await expect(page.locator('html')).toHaveAttribute('data-text-size', size.toLowerCase());
      await expect(page.getByRole('button', { name: `Text size: ${size}`, exact: true })).toHaveAttribute('title', `Text size: ${size}`);
      const scale = size === 'Medium' ? 1.16 : size === 'Large' ? 1.32 : 1;
      expect(await page.locator('body').evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeCloseTo(sizeBefore * scale, 2);
      expect(await page.evaluate(() => localStorage.getItem('put_scanner_text_size'))).toBe(size.toLowerCase());
      const sample = await typographySample(page);
      expect(sample.map(x => [x.tag, x.text])).toEqual(textBefore.map(x => [x.tag, x.text]));
      const outliers = sample.flatMap((item, i) => Math.abs(item.font - textBefore[i].font * scale) > 0.015
        ? [{ text: item.text, actual: item.font, expected: textBefore[i].font * scale }] : []);
      expect(outliers, `${name}/${size}: every rendered text role scales`).toEqual([]);
      if (size === 'Small') expect(sample, `${name}: cycle restores Small geometry`).toEqual(textBefore);
      expect(await page.locator('svg path[d]').evaluateAll(elements => elements.map(el => el.getAttribute('d')))).toEqual(chartPaths);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await checkNavigation(page);
    }
    await page.waitForTimeout(300);
    expect(JSON.stringify(cloud.rows)).toBe(beforeRows);
    expect(requests.length, `text switching requests on ${name}`).toBe(count);
    expect(await page.locator('body').innerText()).toBe(original);
    expect(await page.locator('html').evaluate(el => getComputedStyle(el).fontSize)).toBe(rootFont);
  }
  await page.getByRole('button', { name: 'Text size: Small', exact: true }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-text-size', 'medium');
  await page.evaluate(() => localStorage.setItem('put_scanner_text_size', 'invalid'));
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-text-size', 'small');
  const control = page.getByRole('button', { name: 'Text size: Small', exact: true });
  expect(await control.evaluate(el => el.nextElementSibling?.getAttribute('title'))).toMatch(/Switch theme/);
  await control.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-text-size', 'medium');

  for (const [theme, size] of [['light', 'large'], ['sepia', 'large'], ['dark-blue', 'large']]) {
    await page.evaluate(({ theme, size }) => {
      localStorage.setItem('put_scanner_theme', theme);
      localStorage.setItem('put_scanner_text_size', size);
    }, { theme, size });
    const directory = path.join(artifacts, 'final', info.project.name, `${theme}-${size}`);
    await mkdir(directory, { recursive: true });
    for (const [name, route] of routes.filter(([name]) => ['screener', 'portfolio', 'watchlist', 'options', 'pulse'].includes(name))) {
      await page.goto(route);
      await page.waitForLoadState('networkidle');
      if (name === 'screener') await loadScreener(page);
      await capture(page, directory, name);
      await checkMobileTable(page);
      if (name === 'portfolio') {
        const analytics = page.getByRole('button', { name: 'Expand Portfolio Analytics' });
        if (await analytics.count()) await analytics.click();
        else await page.locator('button[aria-controls="portfolio-analytics-content"]').click();
        await page.waitForTimeout(250);
        await capture(page, directory, 'portfolio-analytics');
        const history = page.getByText('Expired / Closed History', { exact: true });
        if (await history.count()) await history.scrollIntoViewIfNeeded();
        else await page.getByRole('button', { name: /^History / }).click();
        await page.locator('.portfolio-realized-pnl-chart').first().scrollIntoViewIfNeeded();
        await capture(page, directory, 'portfolio-history');
        await checkCharts(page.locator('[data-chart-period-label]:visible, .rolling-historical-analytics__svg text:visible'));
      }
      if (name === 'pulse') {
        const quadrant = page.locator('svg[aria-label^="Momentum quadrant"]:visible');
        if (!await quadrant.count()) await page.getByRole('tab', { name: 'Momentum', exact: true }).click();
        await quadrant.scrollIntoViewIfNeeded();
        await capture(page, directory, 'momentum-chart');
        expect(await quadrant.locator('text').first().evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeCloseTo(13.2, 1);
        await checkCharts(quadrant.locator('text'));
        await quadrant.locator('a').first().focus();
        await capture(page, directory, 'momentum-tooltip');
        expect(await quadrant.locator('foreignObject').evaluate(el => {
          const content = el.firstElementChild!.getBoundingClientRect();
          const viewport = el.getBoundingClientRect();
          const chart = el.closest('svg')!.getBoundingClientRect();
          return content.bottom <= viewport.bottom + 1 && viewport.bottom <= chart.bottom + 1;
        })).toBe(true);
      }
      if (name === 'options') {
        await page.getByRole('button', { name: /Open TQQQ (interactive )?price chart/i }).first().click();
        await page.waitForTimeout(400);
        await capture(page, directory, 'price-chart');
        expect(await page.locator('svg text').first().evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeCloseTo(13.2, 1);
        await checkCharts(page.locator('svg text:visible'));
        await page.keyboard.press('Escape');
      }
    }
    await page.goto('/?account-ui-fixture=signed-out');
    await expect(page.getByRole('dialog')).toBeVisible();
    const input = page.locator('input').first();
    await input.focus();
    if (info.project.name.includes('portrait')) expect(await input.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeCloseTo(21.12, 2);
    await capture(page, directory, 'account-input-focused');
  }
});

test('motion controls, overlays and reduced motion', async ({ page, browser }, info) => {
  test.setTimeout(120_000);
  await installDeterministicMarketApi(page);
  await installDeterministicCloudAccount(page, { portfolio, watchlist, preferences: {} });
  await page.addInitScript(() => localStorage.setItem('theme_migration_version', '2'));
  const directory = path.join(artifacts, 'motion', info.project.name);
  await mkdir(directory, { recursive: true });
  for (const theme of ['dark', 'dark-blue', 'light', 'sepia']) {
    await page.goto('/');
    await page.evaluate(theme => {
      localStorage.setItem('put_scanner_theme', theme);
      localStorage.setItem('put_scanner_text_size', theme === 'dark' ? 'small' : 'large');
    }, theme);
    await page.reload();
    const control = page.getByRole('button', { name: /^Text size:/ });
    await expect(control).toBeVisible();
    await control.focus();
    await expect(control).toBeFocused();
    await control.hover();
    await expect.poll(() => control.evaluate(el => getComputedStyle(el).translate)).toBe('0px -2px');
    await page.mouse.down();
    await expect.poll(() => control.evaluate(el => getComputedStyle(el).scale)).toBe('0.985');
    await page.mouse.move(0, 0);
    await page.mouse.up();
    const row = page.locator('.mobile-etf-row').first();
    if (await row.isVisible()) {
      await row.hover();
      await page.mouse.down();
      expect(await row.evaluate(el => ({ translate: getComputedStyle(el).translate, scale: getComputedStyle(el).scale }))).toEqual({ translate: 'none', scale: 'none' });
      await page.mouse.move(0, 0); await page.mouse.up();
    }
    await page.screenshot({ path: path.join(directory, `${theme}.png`), animations: 'disabled' });
    await page.goto('/?account-ui-fixture=synced');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const animation = await dialog.evaluate(el => getComputedStyle(el).animationName);
    expect(['ui-modal', 'ui-sheet']).toContain(animation);
    // Inspect the actual entrance halfway through, preserving layout transforms.
    const entrance = await dialog.evaluate(el => {
      // Restart the same CSS entrance if navigation has already finished it.
      (el as HTMLElement).style.animationName = 'none';
      void (el as HTMLElement).offsetWidth;
      (el as HTMLElement).style.animationName = '';
      const animation = el.getAnimations()[0];
      if (!animation) throw new Error('Expected the CSS overlay entrance');
      animation.pause();
      animation.currentTime = 105;
      const style = getComputedStyle(el);
      const sample = { duration: animation.effect?.getTiming().duration, opacity: Number(style.opacity), translate: style.translate };
      animation.finish();
      return sample;
    });
    expect(entrance.duration).toBe(320);
    expect(entrance.opacity).toBeGreaterThan(0);
    expect(entrance.opacity).toBeLessThan(1);
    expect(entrance.translate).not.toBe('none');

    await page.screenshot({ path: path.join(directory, `${theme}-account.png`), animations: 'disabled' });
  }
  const touchContext = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 }, baseURL: new URL(page.url()).origin });
  const touchPage = await touchContext.newPage();
  await installDeterministicMarketApi(touchPage);
  await touchPage.goto('/');
  const touchControl = touchPage.getByRole('button', { name: /^Text size:/ });
  await expect(touchControl).toBeVisible();
  await touchPage.waitForLoadState('networkidle');
  const bounds = await touchControl.boundingBox();
  expect(bounds).not.toBeNull();
  // Chromium synthesizes mouse contact during tap completion. Capture that
  // event synchronously instead of polling :active after the finger has lifted.
  await touchControl.evaluate(el => el.addEventListener('mousedown', () => {
    (el as HTMLElement).dataset.touchContactScale = getComputedStyle(el).scale;
  }, { once: true }));
  await touchControl.tap();
  await expect(touchControl).toHaveAttribute('data-touch-contact-scale', '0.985');
  await expect(touchControl).toHaveAttribute('title', 'Text size: Medium');
  expect(await touchControl.evaluate(el => (el as HTMLElement).offsetHeight)).toBeGreaterThanOrEqual(44);
  await touchContext.close();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const control = page.getByRole('button', { name: /^Text size:/ });
  await control.hover();
  await page.mouse.down();
  expect(await control.evaluate(el => ({ translate: getComputedStyle(el).translate, scale: getComputedStyle(el).scale }))).toEqual({ translate: 'none', scale: 'none' });
  await page.mouse.move(0, 0); await page.mouse.up();
  await page.goto('/?account-ui-fixture=synced');
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await page.getByRole('dialog').evaluate(el => getComputedStyle(el).animationName)).toBe('none');
});
