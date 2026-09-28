import { expect, test } from '@playwright/test';
import { installDeterministicCloudAccount } from './fixtures/cloudAccount';
import { installDeterministicMarketApi } from './fixtures/marketApi';

const expiry = '2027-01-01';
const watchlist = [{ id: `TQQQ|put|${expiry}|90`, ticker: 'TQQQ', expiry, expiryTimestamp: 1_798_761_600, expiryFormatted: "Jan 1 '27", strike: 90, optionType: 'put', addedAt: 1, savedAt: 1, note: '' }];
const portfolio = [{ id: 'polish-open', ticker: 'TQQQ', optionType: 'put', strike: 90, expiration: expiry, contracts: 1, soldPrice: 4, soldDate: '2026-08-01', status: 'open', createdAt: '2026-08-01T12:00:00Z', updatedAt: '2026-08-01T12:00:00Z' }];

test('shared polish preserves source context, native scrolling and route geometry', async ({ page }, info) => {
  test.setTimeout(300_000);
  const api = await installDeterministicMarketApi(page, { optionCount: 72 });
  await installDeterministicCloudAccount(page, { portfolio, watchlist, preferences: { portfolioGroupMode: 'none' } });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  for (const size of ['small', 'large']) {
    await page.evaluate(size => localStorage.setItem('put_scanner_text_size', size), size);
    for (const [name, route] of [['scanner', '/'], ['screener', '/screener'], ['recommendations', '/recommendations?recommendations-fixture=conditional'], ['watchlist', '/watchlist'], ['portfolio', '/portfolio'], ['pulse', '/pulse'], ['options', `/options/TQQQ?expiry=${expiry}`]]) {
      await page.goto(route);
      await expect(page.locator('main')).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-text-size', size);
      await page.waitForLoadState('networkidle');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name} ${size}`).toBe(true);
      await page.screenshot({ path: info.outputPath(`${name}-${size}.png`) });
      if (name === 'watchlist') {
        const source = page.locator('.mobile-financial-table-row:visible, .financial-table tbody tr:has(button[title="Open option details"]):visible').first();
        const before = [...api.counts];
        if (info.project.name.startsWith('portrait')) await source.locator('td').first().click();
        else await source.getByRole('button', { name: /Open option details/ }).click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await expect(source).toHaveAttribute('data-overlay-active', 'true');
        if (info.project.name.startsWith('desktop')) {
          await expect(source.locator('.watchlist-ticker-cell')).toHaveCSS('box-shadow', /inset/);
        }
        await page.getByRole('dialog').evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished)));
        await page.screenshot({ path: info.outputPath(`watchlist-detail-${size}.png`) });
        await expect.poll(() => page.getByRole('dialog').evaluate(el => el.contains(document.activeElement))).toBe(true);
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expect(source).not.toHaveAttribute('data-overlay-active');
        expect([...api.counts]).toEqual(before);
      }
      if (name === 'portfolio' && info.project.name.startsWith('portrait')) {
        const source = page.locator('.mobile-position-row').first();
        await source.getByRole('button', { name: /^Expand/ }).click();
        await source.getByRole('button', { name: 'Open details', exact: true }).click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await expect(source).toHaveAttribute('data-overlay-active', 'true');
        await expect.poll(() => page.getByRole('dialog').evaluate(el => el.contains(document.activeElement))).toBe(true);
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expect(source).not.toHaveAttribute('data-overlay-active');
      }
      if (name === 'portfolio' && info.project.name.startsWith('desktop')) {
        const source = page.locator('.portfolio-schedule-surface tr[data-trade-id]').first();
        await source.getByRole('button', { name: '$90.00', exact: true }).click();
        await expect(source).toHaveAttribute('data-overlay-active', 'true');
        await expect(page.getByRole('dialog')).toBeVisible();
        await expect.poll(() => page.getByRole('dialog').evaluate(el => el.contains(document.activeElement))).toBe(true);
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expect(source).not.toHaveAttribute('data-overlay-active');
        const owner = source.locator('xpath=ancestor::div[contains(@class,"financial-table-scroll")]');
        await owner.evaluate(el => { el.scrollLeft = 200; });
        await expect(owner).toHaveAttribute('data-scrolled-inline', 'true');
        expect(await source.locator('td').first().evaluate(el => getComputedStyle(el, '::after').content)).toBe('""');
        await page.screenshot({ path: info.outputPath(`portfolio-scrolled-${size}.png`) });
      }
      if (name === 'recommendations') {
        const source = page.locator('.recommendation-card').first();
        await source.getByRole('button', { name: 'Evidence', exact: true }).click();
        await expect(source).toHaveAttribute('data-overlay-active', 'true');
        await expect(page.getByRole('dialog')).toBeVisible();
        await expect.poll(() => page.getByRole('dialog').evaluate(el => el.contains(document.activeElement))).toBe(true);
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expect(source).not.toHaveAttribute('data-overlay-active');
      }
      if (name === 'options' && info.project.name.startsWith('portrait')) {
        const owner = page.locator('.mobile-financial-table-scroll');
        const identity = owner.locator('thead th').first();
        expect(await identity.evaluate(el => getComputedStyle(el, '::after').content)).toBe('none');
        const before = [...api.counts];
        await owner.evaluate(el => { el.scrollLeft = 240; el.scrollTop = 200; });
        await expect(owner).toHaveAttribute('data-scrolled-inline', 'true');
        expect(await identity.evaluate(el => getComputedStyle(el, '::after').content)).toBe('""');
        const bounds = await owner.evaluate(el => ({ owner: el.getBoundingClientRect().left, cell: el.querySelector('tbody th')!.getBoundingClientRect().left, top: el.getBoundingClientRect().top, header: el.querySelector('thead th')!.getBoundingClientRect().top }));
        expect(bounds.cell).toBeCloseTo(bounds.owner, 0);
        expect(bounds.header).toBeCloseTo(bounds.top, 0);
        await page.screenshot({ path: info.outputPath(`options-scrolled-${size}.png`) });
        await owner.evaluate(el => { el.scrollLeft = 0; });
        await expect(owner).toHaveAttribute('data-scrolled-inline', 'false');
        expect(await identity.evaluate(el => getComputedStyle(el, '::after').content)).toBe('none');
        expect([...api.counts]).toEqual(before);
      }
    }
  }
  expect(errors).toEqual([]);
});

test('summary acknowledgement skips mount and unchanged renders and honors reduced motion', async ({ page }) => {
  await installDeterministicMarketApi(page);
  await installDeterministicCloudAccount(page, { portfolio: [], watchlist: [] });
  await page.goto('/');
  // Exercise the actual shared component in the same Vite module graph.
  await page.evaluate(async () => {
    const reactPath = '/node_modules/.vite/deps/react.js';
    const domPath = '/node_modules/.vite/deps/react-dom_client.js';
    const componentPath = '/src/components/ui/ChangedValue.tsx';
    const [{ default: { createElement } }, { default: { createRoot } }, { ChangedValue }] = await Promise.all([import(reactPath), import(domPath), import(componentPath)]);
    const host = document.createElement('div');
    host.id = 'changed-value-test';
    document.body.append(host);
    const root = createRoot(host);
    (window as unknown as { renderValue: (value: string) => void }).renderValue = value => root.render(createElement(ChangedValue, { value }));
    (window as unknown as { renderValue: (value: string) => void }).renderValue('$100');
  });
  const value = page.locator('#changed-value-test > div');
  await expect(value).toHaveText('$100');
  await expect(value).not.toHaveClass(/motion-value/);
  await page.evaluate(() => (window as unknown as { renderValue: (value: string) => void }).renderValue('$101'));
  await expect(value).toHaveText('$101');
  await expect(value).toHaveClass(/motion-value/);
  await value.evaluate(el => el.setAttribute('data-same-node', 'true'));
  await page.evaluate(() => (window as unknown as { renderValue: (value: string) => void }).renderValue('$101'));
  await expect(value).toHaveAttribute('data-same-node', 'true');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => (window as unknown as { renderValue: (value: string) => void }).renderValue('$100'));
  await expect(value).toHaveText('$100');
  await expect(value).toHaveCSS('animation-name', 'none');
});
