import { expect, test } from '@playwright/test';
import { installDeterministicCloudAccount } from './fixtures/cloudAccount';
import { installDeterministicMarketApi } from './fixtures/marketApi';

test.beforeEach(async ({ page }) => {
  await installDeterministicMarketApi(page, { optionCount: 72, firstOptionBid: 0 });
  await installDeterministicCloudAccount(page, { portfolio: [], watchlist: [], preferences: {} });
});

test('portrait table density, alignment and sticky layers across widths and text sizes', async ({ page }, info) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const width of [320, 375, 390, 430]) {
    for (const size of ['small', 'medium', 'large']) {
      await page.setViewportSize({ width, height: 844 });
      await page.addInitScript(({ size, width }) => {
        localStorage.setItem('put_scanner_text_size', size);
        localStorage.setItem('put_scanner_theme', width === 430 ? 'light' : 'dark');
      }, { size, width });
      await page.goto('/options/TQQQ?expiry=2027-01-01');
      const rows = page.locator('.mobile-financial-table-row');
      await expect(rows).toHaveCount(72);
      await expect(page.locator('.mobile-option-card')).toHaveCount(0);
      await expect(rows.first().locator('td').nth(1)).toHaveText('No Bid');
      const owner = page.locator('.mobile-financial-table-scroll');
      const initial = await owner.evaluate(element => {
        const table = element.querySelector('table')!;
        const row = table.querySelector('tbody tr.mobile-financial-table-row')!;
        return { overflow: element.scrollWidth > element.clientWidth, height: row.getBoundingClientRect().height,
          widths: [...row.children].map(cell => cell.getBoundingClientRect().width),
          headers: [...table.querySelectorAll('thead th')].map(cell => cell.getBoundingClientRect().width),
          bottomPadding: getComputedStyle(document.querySelector('.app-content-shell')!).paddingBottom,
          pageOverflow: document.documentElement.scrollWidth > innerWidth };
      });
      expect(initial.overflow).toBe(true);
      expect(initial.pageOverflow).toBe(false);
      expect(initial.bottomPadding).toBe('0px');
      expect(initial.height).toBeGreaterThanOrEqual(32);
      expect(initial.height).toBeLessThanOrEqual(40);
      expect(initial.widths).toEqual(initial.headers);
      await page.screenshot({ path: info.outputPath(`${width}-${size}-top.png`) });
      await owner.evaluate(element => { element.scrollLeft = 300; element.scrollTop = 650; });
      const sticky = await owner.evaluate(element => {
        const header = element.querySelector('thead th')!;
        const row = element.querySelectorAll('.mobile-financial-table-row')[25];
        const rect = element.getBoundingClientRect();
        const identity = row.children[0];
        return { top: header.getBoundingClientRect().top, ownerTop: rect.top, left: identity.getBoundingClientRect().left,
          ownerLeft: rect.left, frozen: [...row.children].filter(cell => getComputedStyle(cell).position === 'sticky').length,
          headerBottom: document.querySelector('.mobile-option-header')!.getBoundingClientRect().bottom,
          background: getComputedStyle(identity).backgroundColor };
      });
      expect(sticky.top).toBeCloseTo(sticky.ownerTop, 0);
      expect(sticky.left).toBeCloseTo(sticky.ownerLeft, 0);
      expect(sticky.top).toBeGreaterThanOrEqual(sticky.headerBottom);
      expect(sticky.frozen).toBe(1);
      expect(sticky.background).not.toBe('rgba(0, 0, 0, 0)');
      await page.screenshot({ path: info.outputPath(`${width}-${size}-scrolled.png`) });
    }
  }
  expect(errors).toEqual([]);
});

test('exact detail, independent mouse/keyboard star, divider, local sort and scroll restoration', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let marketRequests = 0;
  page.on('request', request => { if (request.url().includes('/api/')) marketRequests++; });
  await page.goto('/options/TQQQ?expiry=2027-01-01');
  const rows = page.locator('.mobile-financial-table-row');
  await expect(rows).toHaveCount(72);
  const star = rows.first().getByRole('button');
  await star.click();
  await expect(star).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await star.press('Enter');
  await expect(star).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const owner = page.locator('.mobile-financial-table-scroll');
  await owner.evaluate(element => { element.scrollLeft = 350; });
  const divider = page.locator('.mobile-financial-table-divider');
  await expect(divider).toHaveText('Current price: $100.00');
  expect(await divider.locator('span').evaluate(element => element.getBoundingClientRect().left)).toBeCloseTo(0, 0);
  const row = page.locator('[data-option-strike="100"]');
  await row.locator('th').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'TQQQ $100 Put', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText("Jan 1 '27");
  await page.waitForTimeout(350);
  await page.screenshot({ path: info.outputPath('detail.png') });
  await page.getByRole('button', { name: 'Close option details' }).click();
  expect(await owner.evaluate(element => element.scrollLeft)).toBe(350);
  const requestsBeforeSort = marketRequests;
  await page.getByLabel('Sort option chain', { exact: true }).selectOption('annYieldBid');
  await expect(divider).toHaveCount(0);
  await page.getByLabel('Sort option chain', { exact: true }).selectOption('strike');
  await page.getByRole('button', { name: 'Sort descending' }).click();
  await expect(divider).toHaveCount(1);
  expect(marketRequests).toBe(requestsBeforeSort);
  const expiry = page.locator('.mobile-option-header').getByRole('button', { name: /Jan 29/ });
  await expiry.click();
  await expect(expiry).toHaveAttribute('aria-pressed', 'true');
  await expect(rows).toHaveCount(72);
  const exactLabel = await rows.first().getAttribute('aria-label');
  expect(exactLabel).toContain('TQQQ 2027-01-29');
  await rows.first().locator('th').click();
  await expect(page.getByRole('dialog')).toContainText('Jan 29');
  await page.getByRole('button', { name: 'Close option details' }).click();
  await page.getByLabel('Option table columns').click();
  await page.getByLabel('Volume / OI', { exact: true }).check();
  await page.getByLabel('Nominal Yield', { exact: true }).check();
  await expect(page.getByRole('columnheader', { name: 'Volume', exact: true })).toHaveCount(1);
  await expect(page.getByRole('columnheader', { name: 'NY Bid', exact: true })).toHaveCount(1);
});

test('native horizontal touch and keyboard scrolling stay inside the table', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('/options/TQQQ?expiry=2027-01-01');
  const owner = page.locator('.mobile-financial-table-scroll');
  await expect(page.locator('.mobile-financial-table-row')).toHaveCount(72);
  const box = (await owner.boundingBox())!;
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 330, y: box.y + 110 }] });
  for (const x of [290, 240, 190, 130]) {
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: box.y + 110 }] });
    await page.waitForTimeout(30);
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => owner.evaluate(element => element.scrollLeft)).toBeGreaterThan(100);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await owner.evaluate(element => { element.scrollLeft = 0; });
  await owner.focus();
  await owner.press('ArrowRight');
  await expect.poll(() => owner.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollX)).toBe(0);
});

test('standalone inset simulation and landscape/desktop remain coherent', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/options/TQQQ?expiry=2027-01-01');
  await expect(page.locator('.mobile-financial-table-row')).toHaveCount(72);
  // Browser emulation cannot supply physical iOS env() insets. Exercise the
  // same computed padding to verify the flex table reacts without double offsets.
  await page.addStyleTag({ content: '.mobile-option-header { padding-top: 59px; } .mobile-trade-sheet { padding-bottom: 34px; }' });
  const owner = page.locator('.mobile-financial-table-scroll');
  await owner.evaluate(element => { element.scrollTop = 600; element.scrollLeft = 200; });
  const metrics = await page.evaluate(() => ({
    header: document.querySelector('.mobile-option-header')!.getBoundingClientRect().bottom,
    table: document.querySelector('.mobile-financial-table thead th')!.getBoundingClientRect().top,
    padding: getComputedStyle(document.querySelector('.app-content-shell')!).paddingBottom,
  }));
  expect(metrics.table).toBeGreaterThanOrEqual(metrics.header);
  expect(metrics.padding).toBe('0px');
  await page.screenshot({ path: info.outputPath('standalone-insets.png') });
  await page.locator('.mobile-financial-table-row').nth(25).locator('th').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('.mobile-trade-sheet')).toHaveCSS('padding-bottom', '34px');
  await page.waitForTimeout(350);
  await page.screenshot({ path: info.outputPath('standalone-sheet.png') });
  await page.getByRole('button', { name: 'Close option details' }).click();
  for (const viewport of [{ width: 844, height: 390 }, { width: 1024, height: 768 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    await expect(page.locator('.option-desktop-chain')).toBeVisible();
    await expect(page.locator('.mobile-financial-table')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`wide-${viewport.width}.png`) });
  }
});
