import { expect, test } from '@playwright/test';
import { installDeterministicMarketApi } from './fixtures/marketApi';

const EXACT_EXPIRATION = 1_798_761_600;
const NEAR_EXPIRATION = 1_789_689_600;
let consoleErrors: string[] = [];
let marketHarness: Awaited<ReturnType<typeof installDeterministicMarketApi>>;

test.beforeEach(async ({ page }) => {
  consoleErrors = [];
  page.on('console', message => {
    if (message.type() === 'error' && !message.text().includes('ERR_BLOCKED_BY_CLIENT.Inspector')) consoleErrors.push(message.text());
  });
  page.on('pageerror', error => consoleErrors.push(error.message));
  await page.addInitScript(({ nearExpiration, exactExpiration }) => {
    // Deliberately obsolete account data: Stage 7A must never render it.
    localStorage.setItem('put_scanner_portfolio_trades', JSON.stringify([{ id: 'legacy-b', ticker: 'LEGACYB', notes: 'LEGACY B' }]));
    localStorage.setItem('put_scanner_watchlist', JSON.stringify([{ id: 'legacy-watch', ticker: 'LEGACYB', note: 'LEGACY WATCH B' }]));
    localStorage.setItem('scanner_option_expirations_v1', JSON.stringify({
      TQQQ: { dates: [nearExpiration, exactExpiration], updatedAt: new Date().toISOString() },
    }));
  }, { nearExpiration: NEAR_EXPIRATION, exactExpiration: EXACT_EXPIRATION });
  marketHarness = await installDeterministicMarketApi(page);
});

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    await testInfo.attach('page-url.txt', { body: page.url(), contentType: 'text/plain' });
    await testInfo.attach('console-errors.txt', { body: consoleErrors.join('\n') || '(none)', contentType: 'text/plain' });
  }
});

test('viewport workflow is deterministic, cloud-authoritative, and usable', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/');
  await expect(page.getByPlaceholder(/Filter \/ Search by Ticker/i).first()).toBeVisible();

  await page.goto('/options/TQQQ');
  await expect(page.getByText('TQQQ', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Put chain').or(page.getByText(/^Puts \d+$/)).first()).toBeVisible();

  await page.goto('/screener');
  await expect(page.getByRole('button', { name: /Load|Run Screener/i }).first()).toBeVisible();

  await page.goto('/watchlist');
  await expect(page.getByRole('heading', { name: 'Watchlist', exact: true })).toBeVisible();
  await expect(page.getByText(/LEGACY WATCH B/)).toHaveCount(0);

  await page.goto('/portfolio');
  await expect(page.getByRole('heading', { name: 'Portfolio', exact: true })).toBeVisible();
  await expect(page.getByText(/LEGACY B/)).toHaveCount(0);
  const mobileActions = page.getByRole('button', { name: 'Portfolio actions' });
  const desktopMaintenance = page.getByRole('button', { name: 'Maintenance', exact: true });
  const emptyPortfolio = page.getByText('No open positions', { exact: true });
  await expect(mobileActions.or(desktopMaintenance).or(emptyPortfolio).first()).toBeVisible();
  let maintenanceOpened = false;
  if (await mobileActions.isVisible()) {
    await mobileActions.click();
    await page.getByRole('button', { name: 'Portfolio Maintenance' }).click();
    maintenanceOpened = true;
  } else if (await desktopMaintenance.isVisible()) {
    await desktopMaintenance.click();
    maintenanceOpened = true;
  }
  if (maintenanceOpened) {
    const maintenance = page.getByRole('dialog', { name: 'Portfolio Maintenance' });
    await expect(maintenance).toBeVisible();
    const box = await maintenance.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);
    await maintenance.getByRole('button', { name: 'Close', exact: true }).click();
  } else {
    await expect(emptyPortfolio).toBeVisible();
  }

  await page.goto('/pulse');
  await expect(page.getByText('ETF Pulse').first()).toBeVisible();

  await page.goto('/?account-ui-fixture=synced');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel('Cloud account status')).toBeVisible();
  expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
});

test('Screener retries failed batches only and preserves successful rows', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440x900', 'one deterministic desktop request-count scenario');
  test.setTimeout(120_000);
  await page.unroute('**/api/**');
  const harness = await installDeterministicMarketApi(page, { failScreenerChunkOnce: 1 });
  await page.goto('/screener');
  await page.getByRole('button', { name: /Load|Run Screener/i }).first().click();
  await page.getByRole('button', { name: /Run scan|Confirm/i }).click();
  await expect(page.getByText('Some results could not be loaded.')).toBeVisible();
  const rowsBefore = await page.locator('tbody tr').count();
  await page.getByRole('button', { name: 'Retry failed results' }).click();
  await expect(page.getByText('Some results could not be loaded.')).toHaveCount(0);
  expect(await page.locator('tbody tr').count()).toBeGreaterThan(rowsBefore);
  expect(harness.counts.get('screener-batch')).toBe(15);
  expect(harness.counts.get('screener-1')).toBe(2);
  expect(consoleErrors.every(error => error.includes('503'))).toBe(true);
});

test('Scanner filtering and exact-expiry navigation remain request-bounded', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440x900', 'one deterministic desktop request-graph scenario');
  test.setTimeout(120_000);
  await page.goto('/');
  const filter = page.getByPlaceholder(/Filter \/ Search by Ticker/i);
  await expect(filter).toBeVisible();
  const beforeFilter = [...marketHarness.counts.values()].reduce((sum, count) => sum + count, 0);
  await filter.fill('TQQQ');
  await expect(page.getByText('1 results')).toBeVisible();
  expect([...marketHarness.counts.values()].reduce((sum, count) => sum + count, 0)).toBe(beforeFilter);
  const expiration = page.locator('label').filter({ hasText: /^Expiration/ }).locator('..').locator('select').first();
  await expiration.selectOption(`date_${EXACT_EXPIRATION}`);
  const card = page.locator('a[href="/options/TQQQ?expiry=2027-01-01"]').first();
  await expect(card).toBeVisible();
  await card.click();
  await expect(page).toHaveURL(/\/options\/TQQQ\?expiry=2027-01-01$/);
  await expect(page.getByRole('row').filter({ hasText: '90.00' }).last()).toBeVisible();
  expect(marketHarness.counts.get('ticker-detail') ?? 0).toBeLessThanOrEqual(2);
});

test('Scanner reset clears local criteria and option rows use drawer-only detail inspection', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440x900', 'one deterministic desktop interaction scenario');
  test.setTimeout(120_000);
  await page.goto('/?q=TQQQ&leverage=3x&type=Sector&expiry=2027-01-01&sort=fiveDay&liquidity=mediumPlus');
  const filter = page.getByPlaceholder(/Filter \/ Search by Ticker/i).first();
  await expect(filter).toHaveValue('TQQQ');
  await expect(page.getByText('6 active controls', { exact: true })).toBeVisible();
  await page.locator('.scanner-reset-filters').click();
  await expect(filter).toHaveValue('');
  await expect(page.getByText('0 active controls', { exact: true })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/');
  expect(new URL(page.url()).search).toBe('');

  await page.goto('/options/TQQQ?expiry=2027-01-01');
  const row = page.getByRole('row').filter({ hasText: '90.00' }).last();
  await expect(row).toBeVisible();
  await row.hover();
  await expect(page.getByText(/Last Trade Date:/)).toHaveCount(0);
  await row.focus();
  await row.press('Enter');
  await expect(page.getByRole('complementary')).toBeVisible();
  await page.getByRole('complementary').getByRole('button', { name: /Close option detail/i }).click();
  await row.getByRole('button', { name: /watchlist/i }).click();
  await expect(page.getByRole('complementary')).toHaveCount(0);
});

test('mobile Scanner keeps Reset Filters in the existing filter sheet', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'portrait-390x844', 'one deterministic phone interaction scenario');
  await page.goto('/?q=TQQQ&leverage=3x&type=Sector&expiry=2027-01-01&sort=fiveDay&liquidity=mediumPlus');
  const filter = page.getByPlaceholder(/Filter \/ Search by Ticker/i).first();
  await expect(filter).toHaveValue('TQQQ');
  await page.locator('.mobile-control-button').click();
  await expect(page.getByText('Scanner filters', { exact: true })).toBeVisible();
  await page.getByRole('dialog', { name: 'Scanner filters' }).getByRole('button', { name: 'Reset Filters', exact: true }).click();
  await expect(filter).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Filters', exact: true })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/');
  expect(new URL(page.url()).search).toBe('');
});

test('detail drawer, transient Pulse cancellation, and Account conflict UI remain bounded', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440x900', 'one consolidated deterministic desktop scenario');
  test.setTimeout(180_000);
  await page.goto('/options/SPY?expiry=2027-01-01');
  await expect(page.getByRole('row').filter({ hasText: '90.00' }).last()).toBeVisible();
  const beforeDrawer = [...marketHarness.counts.values()].reduce((sum, count) => sum + count, 0);
  await page.getByRole('row').filter({ hasText: '90.00' }).last().click();
  const drawer = page.getByRole('complementary');
  await expect(drawer.getByRole('heading', { name: 'Position Calculator' })).toBeVisible();
  await drawer.getByRole('textbox', { name: 'Contracts' }).fill('2');
  await expect(drawer.getByText('$400.00', { exact: true }).first()).toBeVisible();
  expect([...marketHarness.counts.values()].reduce((sum, count) => sum + count, 0)).toBe(beforeDrawer);
  await drawer.getByRole('button', { name: /Close option detail/i }).click();

  marketHarness.delays.set('etf-pulse', 350);
  await page.goto('/pulse');
  await expect(page.getByRole('status', { name: 'ETF Pulse loading' })).toBeVisible();
  await page.goto('/watchlist');
  await expect(page.getByRole('heading', { name: 'Watchlist' })).toBeVisible();
  await page.waitForTimeout(450);
  expect(marketHarness.aborted.get('etf-pulse') ?? 0).toBeGreaterThanOrEqual(1);

  await page.goto('/?account-ui-fixture=conflict');
  await expect(page.getByText(/changed on another device/i).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reload Latest Cloud Data' })).toBeVisible();
});
