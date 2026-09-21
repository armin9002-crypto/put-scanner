import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { installDeterministicMarketApi } from './fixtures/marketApi';
import { installDeterministicCloudAccount } from './fixtures/cloudAccount';
import { portfolio, watchlist } from './fixtures/textSizeAccount';
import { checkMobileTable, checkNavigation, checkOverlay } from './fixtures/textSizeChecks';

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-05T16:00:00Z'));
  await installDeterministicMarketApi(page, { expirationFetchedAt: Date.parse('2026-09-04T20:00:00Z'), optionCount: 12 });
  await installDeterministicCloudAccount(page, { portfolio, watchlist, preferences: {} });
  await page.addInitScript(() => {
    localStorage.setItem('put_scanner_text_size', 'large');
    localStorage.setItem('put_scanner_theme', 'dark');
    localStorage.setItem('theme_migration_version', '2');
  });
});

async function dismiss(page: Page) {
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test('Large overlays keep controls reachable', async ({ page }, info) => {
  test.setTimeout(120_000);
  const directory = path.join('e2e-artifacts/text-size/fit', info.project.name);
  await mkdir(directory, { recursive: true });
  const inspect = async (name: string) => {
    await expect(page.getByRole('dialog').last()).toBeVisible();
    await page.screenshot({ path: path.join(directory, `${name}.png`), animations: 'disabled' });
    await checkOverlay(page);
    await dismiss(page);
  };
  await page.goto('/portfolio');
  await page.waitForLoadState('networkidle');
  for (const name of ['Add Trade', 'Maintenance', 'Data Backup', 'Import / Export Historical Excel']) {
    const actions = page.getByRole('button', { name: 'Portfolio actions', exact: true });
    if (await actions.isVisible()) await actions.click();
    if (name === 'Data Backup' || name.startsWith('Import')) await page.locator('summary').filter({ hasText: 'Data Tools' }).click();
    await page.getByRole('button', { name: name === 'Maintenance' ? /^(Portfolio )?Maintenance$/ : name, exact: true }).click();
    await inspect(name.replaceAll(/[^a-z]/gi, '-'));
  }
  await page.goto('/watchlist');
  await page.waitForLoadState('networkidle');
  const note = page.getByRole('button', { name: /Edit note for TQQQ/ });
  if (await page.locator('.mobile-financial-table:visible').count()) {
    await expect(note).toBeVisible();
    await note.click(); await inspect('watchlist-note');
  }
  for (const route of ['/', '/screener', '/pulse']) {
    await page.goto(route);
    await page.waitForLoadState('networkidle');
    const filters = page.getByRole('button', { name: /^Filters/ });
    if (await filters.isVisible()) { await filters.click(); await inspect(`filters-${route.replaceAll('/', '') || 'scanner'}`); }
  }
  await page.goto('/recommendations?recommendations-fixture=actionable');
  await page.getByRole('heading', { name: 'Full Opportunity Board / Audit' }).scrollIntoViewIfNeeded();
  const mobileBoard = page.locator('.recommendations-board-mobile-row__summary:visible').first();
  if (await mobileBoard.count()) {
    await mobileBoard.click();
    await page.locator('.recommendations-board-mobile .recommendations-frontier-list button').first().click();
  } else {
    await page.locator('.recommendations-expand-button').first().click();
    await page.getByRole('button', { name: 'Evidence', exact: true }).first().click();
  }
  await inspect('recommendation-evidence');
  await page.goto('/pulse');
  await page.getByRole('button', { name: 'Details', exact: true }).first().click();
  await inspect('market-read');
});

test('Large 320px financial tables and mobile shell', async ({ page }, info) => {
  test.skip(info.project.name !== 'portrait-390x844', 'single narrow-phone matrix');
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 320, height: 844 });
  const directory = 'e2e-artifacts/text-size/fit/portrait-320';
  await mkdir(directory, { recursive: true });
  for (const [name, route] of [['scanner', '/'], ['screener', '/screener'], ['watchlist', '/watchlist'], ['options', '/options/TQQQ'], ['pulse', '/pulse']]) {
    await page.goto(route);
    await page.waitForLoadState('networkidle');
    if (name === 'screener') {
      await page.getByRole('button', { name: /^Filters/ }).click();
      await page.getByText('Recent Trades Only', { exact: true }).locator('..').getByRole('combobox').selectOption('no');
      await page.getByText('Expiration', { exact: true }).locator('..').getByRole('combobox').selectOption('all');
      await page.getByRole('button', { name: 'Done', exact: true }).click();
      await page.getByRole('button', { name: 'Run Screener', exact: true }).click();
      await page.getByRole('button', { name: /^(Run scan|Confirm)$/ }).click();
      await expect(page.locator('.mobile-financial-table-row').first()).toBeVisible({ timeout: 30000 });
    }
    await page.screenshot({ path: path.join(directory, `${name}.png`), animations: 'disabled' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await checkNavigation(page);
    await checkMobileTable(page);
    const owner = page.locator('.mobile-financial-table-scroll');
    if (await owner.count()) {
      await owner.evaluate(el => { el.scrollLeft = el.scrollWidth; el.scrollTop = 150; });
      await page.screenshot({ path: path.join(directory, `${name}-scrolled.png`), animations: 'disabled' });
    }
  }
});
