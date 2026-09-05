import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const smallReference = JSON.parse(readFileSync(new URL('./fixtures/textSizeSmall.json', import.meta.url), 'utf8'));
import { expect, test, type Page } from '@playwright/test';
import { installDeterministicMarketApi } from './fixtures/marketApi';
import { installDeterministicCloudAccount } from './fixtures/cloudAccount';

const EXPIRY_JAN = 1_798_761_600;
const EXPIRY_FEB = 1_802_995_200;
const EXPIRY_DEC = 1_797_552_000;

const watchlist = [
  { id: 'TQQQ|put|2027-01-01|90', ticker: 'TQQQ', expiry: '2027-01-01', expiryTimestamp: EXPIRY_JAN, expiryFormatted: "Jan 1 '27", strike: 90, optionType: 'put', addedAt: 1_787_200_000_000, savedAt: 1_787_200_000_000, updatedAt: 1_787_200_000_000, note: 'Core income sleeve — review at 50% captured; keep downside buffer intact.', status: 'live', snapshot: { underlyingPrice: 100, bid: 2, ask: 2.2, last: 2.1, delta: -0.2, iv: 48, dte: 127, openInterest: 900, volume: 120 } },
  { id: 'SPY|put|2027-01-01|95', ticker: 'SPY', expiry: '2027-01-01', expiryTimestamp: EXPIRY_JAN, expiryFormatted: "Jan 1 '27", strike: 95, optionType: 'put', addedAt: 1_787_200_100_000, savedAt: 1_787_200_100_000, updatedAt: 1_787_000_000_000, note: 'Index hedge; stale mark is expected until the next quote window.', status: 'stale', snapshot: { underlyingPrice: 104, bid: 1.7, ask: 1.9, last: 1.8, delta: -0.26, iv: 42, dte: 127, openInterest: 1200, volume: 240 } },
  { id: 'QQQ|put|2027-02-19|80', ticker: 'QQQ', expiry: '2027-02-19', expiryTimestamp: EXPIRY_FEB, expiryFormatted: "Feb 19 '27", strike: 80, optionType: 'put', addedAt: 1_787_200_200_000, savedAt: 1_787_200_200_000, updatedAt: 1_787_200_200_000, note: 'Strike unavailable in the latest chain; retain for review.', status: 'unavailable', snapshot: { underlyingPrice: 100, bid: null, ask: null, last: null, delta: null, iv: null, dte: 176 } },
  { id: 'SOXL|put|2026-12-18|95', ticker: 'SOXL', expiry: '2026-12-18', expiryTimestamp: EXPIRY_DEC, expiryFormatted: "Dec 18 '26", strike: 95, optionType: 'put', addedAt: 1_787_200_300_000, savedAt: 1_787_200_300_000, updatedAt: 1_787_200_300_000, note: '', status: 'refresh_failed', snapshot: { underlyingPrice: 72, bid: 4, ask: 4.4, last: 4.2, delta: -0.35, iv: 68, dte: 112, openInterest: 400, volume: 80 } },
];

const portfolio = [
  { id: 'ui5-open-tqqq', ticker: 'TQQQ', optionType: 'put', strike: 90, expiration: '2027-01-01', contracts: 2, soldPrice: 3, soldDate: '2026-08-20', status: 'open', notes: 'Close candidate: target reached; compare against Feb expiry.', createdAt: '2026-08-20T12:00:00.000Z', updatedAt: '2026-08-20T12:00:00.000Z', entryVixClose: 17.8, latestMarketData: { underlyingPrice: 100, optionBid: 1, optionAsk: 1.2, optionLast: 1.1, delta: -0.2, iv: 48, openInterest: 900, volume: 120, refreshedAt: '2026-08-27T12:00:00.000Z', availabilityStatus: 'live' } },
  { id: 'ui5-open-spy', ticker: 'SPY', optionType: 'put', strike: 95, expiration: '2027-01-01', contracts: 1, soldPrice: 2.4, soldDate: '2026-08-18', status: 'open', notes: 'Core index premium; monitor stale quote.', createdAt: '2026-08-18T12:00:00.000Z', updatedAt: '2026-08-18T12:00:00.000Z', entryVixClose: 18.2, latestMarketData: { underlyingPrice: 104, optionBid: 1.7, optionAsk: 1.9, optionLast: 1.8, delta: -0.26, iv: 42, openInterest: 1200, volume: 240, refreshedAt: '2026-08-20T12:00:00.000Z', availabilityStatus: 'stale' } },
  { id: 'ui5-open-qqq', ticker: 'QQQ', optionType: 'put', strike: 88, expiration: '2027-02-19', contracts: 3, soldPrice: 2.25, soldDate: '2026-08-15', status: 'open', notes: 'Second expiry concentration; lower delta.', createdAt: '2026-08-15T12:00:00.000Z', updatedAt: '2026-08-15T12:00:00.000Z', entryVixClose: 19.1, latestMarketData: { underlyingPrice: 101, optionBid: 0.9, optionAsk: 1.1, optionLast: 1, delta: -0.18, iv: 39, openInterest: 1800, volume: 300, refreshedAt: '2026-08-27T12:00:00.000Z', availabilityStatus: 'live' } },
  { id: 'ui5-open-soxl', ticker: 'SOXL', optionType: 'put', strike: 70, expiration: '2026-12-18', contracts: 1, soldPrice: 4.5, soldDate: '2026-08-12', status: 'open', notes: 'Stale quote / review liquidity before adjusting.', createdAt: '2026-08-12T12:00:00.000Z', updatedAt: '2026-08-12T12:00:00.000Z', entryVixClose: 22.4, latestMarketData: { underlyingPrice: 72, optionBid: null, optionAsk: null, optionLast: null, delta: -0.42, iv: 68, openInterest: null, volume: null, refreshedAt: '2026-08-10T12:00:00.000Z', availabilityStatus: 'unavailable' } },
  { id: 'ui5-closed-qqq', ticker: 'QQQ', optionType: 'put', strike: 82, expiration: '2026-08-21', contracts: 1, soldPrice: 2.25, soldDate: '2026-07-15', status: 'closed', closePrice: 0.55, closeDate: '2026-08-12', realizedPnl: 170, percentCaptured: 0.756, notes: 'Closed at target; realized gain.', createdAt: '2026-07-15T12:00:00.000Z', updatedAt: '2026-08-12T12:00:00.000Z', entryVixClose: 19.1 },
  { id: 'ui5-expired-spy', ticker: 'SPY', optionType: 'put', strike: 90, expiration: '2026-07-17', contracts: 1, soldPrice: 1.8, soldDate: '2026-06-20', status: 'expired', expirationClosePrice: 0, expirationCloseDate: '2026-07-17', finalOptionValue: 0, realizedPnl: 180, percentCaptured: 1, resolutionType: 'expired_worthless', resolvedDate: '2026-07-17', notes: 'Expired worthless.', createdAt: '2026-06-20T12:00:00.000Z', updatedAt: '2026-07-17T12:00:00.000Z' },
];

const baseline = process.env.TEXT_SIZE_CAPTURE === 'baseline';
const artifacts = path.join(process.cwd(), 'e2e-artifacts', 'text-size');
const routes = [
  ['scanner', '/'], ['screener', '/screener'],
  ['recommendations', '/recommendations?recommendations-fixture=actionable'],
  ['watchlist', '/watchlist'], ['portfolio', '/portfolio'],
  ['options', '/options/TQQQ'], ['pulse', '/pulse'],
] as const;

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
  return metrics;
}

test('text size route and overlay matrix', async ({ page }, info) => {
  test.setTimeout(240_000);
  await page.clock.setFixedTime(new Date('2026-09-05T16:00:00Z'));
  await installDeterministicMarketApi(page);
  await installDeterministicCloudAccount(page, { portfolio, watchlist, preferences: {} });
  await page.addInitScript(() => {
    if (!localStorage.getItem('put_scanner_theme')) localStorage.setItem('put_scanner_theme', 'dark');
    localStorage.setItem('theme_migration_version', '2');
  });
  const sizes = baseline ? ['small'] : ['small', 'medium', 'large'];
  for (const size of sizes) {
    const directory = path.join(artifacts, baseline ? 'baseline' : 'final', info.project.name, size);
    await mkdir(directory, { recursive: true });
    for (const [name, route] of routes) {
      await page.goto(route);
      await page.evaluate(value => localStorage.setItem('put_scanner_text_size', value), size);
      await page.reload();
      await page.waitForTimeout(1100);
      if (name === 'screener') {
        await page.getByRole('button', { name: /Load|Run Screener/i }).first().click();
        const confirm = page.getByRole('button', { name: /Run scan|Confirm/i });
        if (await confirm.count()) await confirm.first().click();
        await expect(page.getByText(/visible after local filters|Showing \d+(?: results| after local filters)/).first()).toBeVisible({ timeout: 30_000 });
      }
      if (!baseline) await expect(page.locator('html')).toHaveAttribute('data-text-size', size);
      const metrics = await capture(page, directory, name);
      if (!baseline && size === 'small') {
        // Recorded from a83c861 at the same fixture date. Exclude wall-clock status text.
        const stable = metrics.filter(x => !/ago|Updated|Refreshed|Saved|AM|PM/.test(x.text || ''));
        const digest = createHash('sha256').update(JSON.stringify(stable)).digest('hex');
        const references = smallReference as Record<string, Record<string, string>>;
        expect(digest, `${info.project.name}/${name}: Small typography and geometry`).toBe(references[info.project.name][name]);
      }
      if (name === 'options') {
        const row = page.getByRole('row').filter({ hasText: '90.00' }).last();
        if (await row.count()) await row.click();
        else await page.locator('.mobile-option-chain-row').first().click();
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
  test.setTimeout(180_000);
  page.setDefaultTimeout(8000);
  await installDeterministicMarketApi(page);
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
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Text size: Small', exact: true })).toBeVisible();
  await page.waitForLoadState('networkidle');
  const rootFont = await page.locator('html').evaluate(el => getComputedStyle(el).fontSize);
  for (const [name, route] of routes.filter(([name]) => name !== 'options')) {
    await page.goto(route);
    await page.waitForLoadState('networkidle');
    const count = requests.length;
    const beforeRows = JSON.stringify(cloud.rows);
    const original = await page.locator('body').innerText();
    const sizeBefore = await page.locator('body').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    for (const size of ['Medium', 'Large', 'Small']) {
      await page.getByRole('button', { name: /^Text size:/ }).click();
      await expect(page.locator('html')).toHaveAttribute('data-text-size', size.toLowerCase());
      await expect(page.getByRole('button', { name: `Text size: ${size}`, exact: true })).toHaveAttribute('title', `Text size: ${size}`);
      const scale = size === 'Medium' ? 1.08 : size === 'Large' ? 1.16 : 1;
      expect(await page.locator('body').evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeCloseTo(sizeBefore * scale, 2);
      expect(await page.evaluate(() => localStorage.getItem('put_scanner_text_size'))).toBe(size.toLowerCase());
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

  for (const [theme, size] of [['light', 'medium'], ['sepia', 'large']]) {
    await page.evaluate(({ theme, size }) => {
      localStorage.setItem('put_scanner_theme', theme);
      localStorage.setItem('put_scanner_text_size', size);
    }, { theme, size });
    const directory = path.join(artifacts, 'final', info.project.name, `${theme}-${size}`);
    await mkdir(directory, { recursive: true });
    for (const [name, route] of routes.filter(([name]) => ['screener', 'portfolio', 'watchlist', 'options', 'pulse'].includes(name))) {
      await page.goto(route);
      await page.waitForLoadState('networkidle');
      await capture(page, directory, name);
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
      }
      if (name === 'pulse') {
        const quadrant = page.locator('svg[aria-label^="Momentum quadrant"]:visible');
        if (!await quadrant.count()) await page.getByRole('tab', { name: 'Momentum', exact: true }).click();
        await quadrant.scrollIntoViewIfNeeded();
        await capture(page, directory, 'momentum-chart');
        expect(await quadrant.locator('text').first().evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeCloseTo(size === 'large' ? 11.6 : 10.8, 1);
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
        expect(await page.locator('svg text').first().evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeCloseTo(size === 'large' ? 11.6 : 10.8, 1);
        await page.keyboard.press('Escape');
      }
    }
    await page.goto('/?account-ui-fixture=signed-out');
    await expect(page.getByRole('dialog')).toBeVisible();
    const input = page.locator('input').first();
    await input.focus();
    if (info.project.name.includes('portrait')) expect(await input.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
    await capture(page, directory, 'account-input-focused');
  }
});
