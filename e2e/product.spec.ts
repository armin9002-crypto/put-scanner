import { expect, test } from '@playwright/test';
import { installDeterministicMarketApi } from './fixtures/marketApi';

let consoleErrors: string[] = [];
const EXACT_EXPIRATION = 1_798_761_600;
const NEAR_EXPIRATION = 1_789_689_600;
let marketHarness: Awaited<ReturnType<typeof installDeterministicMarketApi>>;

function seededWatchlist() {
  return [{ id: 'TQQQ|put|2027-01-01|90', ticker: 'TQQQ', expiry: '2027-01-01', expiryTimestamp: EXACT_EXPIRATION, expiryFormatted: "Jan 1 '27", strike: 90, optionType: 'put', addedAt: 1_787_200_000_000, savedAt: 1_787_200_000_000, updatedAt: 1_787_200_000_000, note: 'keep current note', status: 'live', snapshot: { underlyingPrice: 100, bid: 2, ask: 2.2, last: 2.1, delta: -0.2, iv: 48, dte: 127, openInterest: 900, volume: 120 } }];
}

function seededPortfolio() {
  return [{ id: 'e2e-trade-1', ticker: 'TQQQ', optionType: 'put', strike: 90, expiration: '2027-01-01', contracts: 1, soldPrice: 3, soldDate: '2026-08-20', status: 'open', notes: 'Close Candidate: target reached', createdAt: '2026-08-20T12:00:00.000Z', updatedAt: '2026-08-20T12:00:00.000Z', latestMarketData: { underlyingPrice: 100, optionBid: 1, optionAsk: 1.2, optionLast: 1.1, delta: -0.2, refreshedAt: '2026-08-27T12:00:00.000Z' } }];
}

test.beforeEach(async ({ page }) => {
  consoleErrors = [];
  page.on('console', message => {
    if (message.type() === 'error' && !message.text().includes('ERR_BLOCKED_BY_CLIENT.Inspector')) consoleErrors.push(message.text());
  });
  page.on('pageerror', error => consoleErrors.push(error.message));
  await page.addInitScript(({ expiration, nearExpiration, watchlist, portfolio }) => {
    if (sessionStorage.getItem('put_scanner_e2e_seeded') === 'true') return;
    sessionStorage.setItem('put_scanner_e2e_seeded', 'true');
    localStorage.setItem('scanner_option_expirations_v1', JSON.stringify({ TQQQ: { dates: [nearExpiration, expiration], updatedAt: new Date().toISOString() } }));
    localStorage.setItem('put_scanner_watchlist', JSON.stringify(watchlist));
    localStorage.setItem('put_scanner_portfolio_trades', JSON.stringify(portfolio));
  }, { expiration: EXACT_EXPIRATION, nearExpiration: NEAR_EXPIRATION, watchlist: seededWatchlist(), portfolio: seededPortfolio() });
  marketHarness = await installDeterministicMarketApi(page);
});

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    await testInfo.attach('page-url.txt', { body: page.url(), contentType: 'text/plain' });
    await testInfo.attach('console-errors.txt', { body: consoleErrors.join('\n') || '(none)', contentType: 'text/plain' });
  }
});

test('viewport workflow smoke is local, deterministic, and usable', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const project = testInfo.project.name;
  if (project === 'desktop-1440x900') {
    await page.goto('/');
    await expect(page.getByText('Analyze Ticker').first()).toBeVisible();
    await page.goto('/options/TQQQ');
    await expect(page.getByText('TQQQ', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /Strike/i })).toBeVisible();
    await page.getByRole('row').filter({ hasText: '90.00' }).last().click();
    await expect(page.getByText('Secured-Cash Yield').first()).toBeVisible();
    await page.goto('/watchlist');
    await expect(page.getByRole('heading', { name: 'Watchlist' })).toBeVisible();
    await page.goto('/portfolio');
    await expect(page.getByRole('heading', { name: 'Portfolio', exact: true })).toBeVisible();
    await page.goto('/pulse');
    await expect(page.getByText('ETF Pulse').first()).toBeVisible();
    await page.getByRole('button', { name: 'Account' }).click();
    await expect(page.getByRole('heading', { name: 'Put Scanner Account' })).toBeVisible();
  } else if (project === 'tablet-1024x768') {
    await page.goto('/screener');
    await expect(page.getByRole('button', { name: /Load|Run Screener/i }).first()).toBeVisible();
    await page.goto('/options/TQQQ');
    await expect(page.getByText('TQQQ', { exact: true }).first()).toBeVisible();
  } else if (project === 'portrait-375x667') {
    await page.goto('/');
    await expect(page.getByText('Analyze Ticker').first()).toBeVisible();
    await page.getByRole('form', { name: 'Analyze ticker' }).getByPlaceholder('NVDA').fill('SPY');
    await page.getByRole('form', { name: 'Analyze ticker' }).getByRole('button', { name: /Analyze/ }).click();
    await expect(page).toHaveURL('/options/SPY');
    await page.getByRole('button', { name: 'Back to Scanner' }).click();
    await page.getByRole('link', { name: 'Watchlist', exact: true }).click();
    await expect(page.getByText('Watchlist').first()).toBeVisible();
    await page.getByRole('button', { name: 'Refresh watchlist' }).click();
    await expect(page.getByRole('button', { name: 'Refresh watchlist' })).toBeEnabled();
    await page.goto('/options/TQQQ');
    await expect(page.getByText('TQQQ', { exact: true }).first()).toBeVisible();
    const longExpiry = page.getByRole('button', { name: /Jan 29/ });
    await longExpiry.click();
    await expect(longExpiry).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Open details for $90.00 Put' }).click();
    await expect(page.getByText('Secured-Cash Yield').first()).toBeVisible();
    await page.getByRole('button', { name: 'Close option details' }).click();
  } else if (project === 'portrait-390x844') {
    await page.goto('/portfolio');
    await expect(page.getByText('Portfolio').first()).toBeVisible();
    const analytics = page.getByRole('button', { name: 'Portfolio Analytics' });
    await analytics.click();
    await expect(analytics).toHaveAttribute('aria-expanded', 'true');
    await page.getByRole('button', { name: 'Account' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    await page.getByRole('button', { name: 'Close Account' }).last().click();
    await expect(dialog).toHaveCount(0);
  } else if (project === 'portrait-430x932') {
    await page.goto('/pulse');
    await expect(page.getByText('ETF Pulse').first()).toBeVisible();
    await page.goto('/screener');
    await page.getByRole('button', { name: 'Run Screener' }).click();
    await page.getByRole('button', { name: 'Run scan' }).click();
    await expect(page.getByText(/^Results/).first()).toBeVisible();
  } else if (project === 'landscape-667x375') {
    await page.goto('/');
    await expect(page.getByText('Analyze Ticker').first()).toBeVisible();
    await page.goto('/options/TQQQ');
    await expect(page.getByText('TQQQ', { exact: true }).first()).toBeVisible();
    const longExpiry = page.getByRole('button', { name: /Jan 29/ });
    await longExpiry.click();
    await expect(longExpiry).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Open details for $90.00 Put' }).click();
    await expect(page.getByText('Secured-Cash Yield').first()).toBeVisible();
    await page.goto('/watchlist');
    await expect(page.getByText('Watchlist').first()).toBeVisible();
  } else {
    await page.goto('/screener');
    await expect(page.getByRole('button', { name: /Load|Run Screener/i }).first()).toBeVisible();
    await page.goto('/portfolio');
    await expect(page.getByText('Portfolio').first()).toBeVisible();
    await page.goto('/pulse');
    await expect(page.getByText('ETF Pulse').first()).toBeVisible();
    await page.goto('/?account-ui-fixture=synced');
    await expect(page.getByRole('dialog')).toBeVisible();
  }
  expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
});

test('Screener retries failed batches only and preserves successful rows', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440x900', 'one deterministic desktop request-count scenario');
  await page.unroute('**/api/**');
  const harness = await installDeterministicMarketApi(page, { failScreenerChunkOnce: 1 });
  await page.goto('/screener');
  const deltaFilter = page.locator('label').filter({ hasText: /^Delta \(abs\)/ }).locator('..').locator('select').first();
  await deltaFilter.selectOption('below_0.25');
  await page.getByRole('button', { name: /Load|Run Screener/i }).first().click();
  await page.getByRole('button', { name: /Run scan|Confirm/i }).click();
  await expect(page.getByText('Some results could not be loaded.')).toBeVisible();
  const requestsBeforeLocalExpirationFilter = [...harness.counts.values()].reduce((sum, count) => sum + count, 0);
  const expirationFilter = page.locator('label').filter({ hasText: /^Expiration/ }).locator('..').locator('select').first();
  await expirationFilter.selectOption('all');
  await expect(page.getByRole('button', { name: 'Retry failed results' })).toBeVisible();
  await page.waitForTimeout(100);
  expect([...harness.counts.values()].reduce((sum, count) => sum + count, 0)).toBe(requestsBeforeLocalExpirationFilter);
  const rowsBefore = await page.locator('tbody tr').count();
  await page.getByRole('button', { name: 'Retry failed results' }).click();
  await expect(page.getByText('Some results could not be loaded.')).toHaveCount(0);
  expect(await page.locator('tbody tr').count()).toBeGreaterThan(rowsBefore);
  expect(harness.counts.get('screener-batch')).toBe(15);
  expect(harness.counts.get('screener-1')).toBe(2);
  const requestsBeforeLocalActions = [...harness.counts.values()].reduce((sum, count) => sum + count, 0);
  const moneynessFilter = page.locator('label').filter({ hasText: /^Moneyness/ }).locator('..').locator('select').first();
  await moneynessFilter.selectOption('otm_only');
  await page.getByRole('columnheader', { name: /Symbol/i }).click();
  await page.getByRole('button', { name: /Open option details for/i }).first().click();
  await expect(page.getByRole('complementary').getByText('Net-Risk Return', { exact: true }).first()).toBeVisible();
  await page.getByRole('complementary').getByRole('button', { name: /Close option detail/i }).click();
  expect([...harness.counts.values()].reduce((sum, count) => sum + count, 0)).toBe(requestsBeforeLocalActions);
  expect(consoleErrors.length).toBeGreaterThan(0);
  expect(consoleErrors.every(error => error.includes('503'))).toBe(true);
});

test('Scanner filters stay client-side and exact expiry navigation is refresh-safe', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440x900', 'one request-graph Scanner scenario');
  await page.goto('/');
  await expect(page.getByPlaceholder(/Filter by ticker/i)).toBeVisible();
  const requestsBeforeFilter = [...marketHarness.counts.values()].reduce((sum, count) => sum + count, 0);
  await page.getByPlaceholder(/Filter by ticker/i).fill('TQQQ');
  await expect(page.getByText('1 results')).toBeVisible();
  await page.waitForTimeout(100);
  expect([...marketHarness.counts.values()].reduce((sum, count) => sum + count, 0)).toBe(requestsBeforeFilter);
  const expiration = page.locator('label').filter({ hasText: /^Expiration/ }).locator('..').locator('select').first();
  await expiration.selectOption(`date_${EXACT_EXPIRATION}`);
  const card = page.locator(`a[href="/options/TQQQ?expiry=2027-01-01"]`).first();
  await expect(card).toBeVisible();
  const requestsBeforeHover = [...marketHarness.counts.values()].reduce((sum, count) => sum + count, 0);
  await card.hover();
  await page.waitForTimeout(100);
  expect([...marketHarness.counts.values()].reduce((sum, count) => sum + count, 0)).toBe(requestsBeforeHover);
  const requestsBeforeClick = [...marketHarness.counts.values()].reduce((sum, count) => sum + count, 0);
  await card.click();
  await expect(page).toHaveURL(/\/options\/TQQQ\?expiry=2027-01-01$/);
  await expect(page.getByRole('row').filter({ hasText: '90.00' }).last()).toBeVisible();
  const detailCalls = marketHarness.counts.get('ticker-detail') ?? 0;
  expect(detailCalls).toBeGreaterThanOrEqual(1);
  expect(detailCalls).toBeLessThanOrEqual(2);
  expect(([...marketHarness.counts.values()].reduce((sum, count) => sum + count, 0)) - requestsBeforeClick).toBeLessThanOrEqual(2);
  await page.goBack();
  await expect(page).toHaveURL(/expiry=2027-01-01/);
  await expiration.selectOption('lte_30dte');
  await expect(page.locator('a[href="/options/TQQQ"]').first()).toBeVisible();
});

test('Watchlist refresh races and failures preserve current durable intent', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440x900', 'one deterministic Watchlist race scenario');
  await page.goto('/watchlist');
  await expect(page.getByRole('table').getByText('keep current note')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh All' })).toBeEnabled();
  const priceCallsBeforeRefresh = marketHarness.counts.get('prices') ?? 0;
  const optionCallsBeforeRefresh = marketHarness.counts.get('options') ?? 0;
  marketHarness.delays.set('options', 400);
  await page.getByRole('button', { name: 'Refresh All' }).click();
  await page.getByRole('button', { name: /Remove TQQQ/i }).first().click();
  await page.waitForTimeout(650);
  await expect(page.getByText(/No saved puts yet/)).toBeVisible();
  expect((marketHarness.counts.get('prices') ?? 0) - priceCallsBeforeRefresh).toBe(1);
  expect((marketHarness.counts.get('options') ?? 0) - optionCallsBeforeRefresh).toBe(1);
  expect(JSON.parse(await page.evaluate(() => localStorage.getItem('put_scanner_watchlist') || '[]')).data ?? []).toEqual([]);

  await page.evaluate(items => localStorage.setItem('put_scanner_watchlist', JSON.stringify(items)), seededWatchlist());
  await page.reload();
  marketHarness.failNext.add('options');
  await page.getByRole('button', { name: 'Refresh All' }).click();
  await expect(page.getByText(/Click Refresh All to retry/)).toBeVisible();
  await expect(page.getByRole('table').getByText('keep current note')).toBeVisible();
  expect(consoleErrors.length).toBeGreaterThan(0);
  expect(consoleErrors.every(error => error.includes('503'))).toBe(true);

  await page.evaluate(() => {
    const now = new Date();
    const iso = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
    const timestamp = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1_000);
    localStorage.setItem('put_scanner_watchlist', JSON.stringify([{ id: `SPY|put|${iso}|90`, ticker: 'SPY', expiry: iso, expiryTimestamp: timestamp, expiryFormatted: iso, strike: 90, optionType: 'put', addedAt: Date.now(), savedAt: Date.now(), note: 'expiration-day contract', status: 'live', snapshot: { underlyingPrice: 100, bid: 2, ask: 2.2, last: 2.1, delta: -0.2, iv: 48, dte: 0 } }]));
  });
  await page.reload();
  const expirationDayRow = page.getByRole('row').filter({ hasText: 'expiration-day contract' });
  await expect(expirationDayRow).toBeVisible();
  await expect(expirationDayRow).toContainText('0 DTE');
});

test('Portfolio analytics is local-only and quote refresh leaves durable trade facts unchanged', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440x900', 'one deterministic Portfolio mutation-boundary scenario');
  await page.goto('/portfolio');
  await expect(page.getByRole('heading', { name: 'Portfolio', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh Open Trades' })).toBeEnabled();
  await page.evaluate(() => {
    const holder = window as typeof window & { __putScannerOriginalSetItem?: Storage['setItem'] };
    const original = Storage.prototype.setItem;
    holder.__putScannerOriginalSetItem = original;
    Storage.prototype.setItem = function setItem(key: string, value: string) {
      if (key === 'put_scanner_portfolio_trades') throw new DOMException('E2E quota fixture', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await page.getByTitle('Delete').first().click();
  await expect(page.getByRole('alert')).toContainText("Put Scanner couldn't save this change on this browser.");
  await expect(page.getByRole('row').filter({ hasText: 'TQQQ' }).last()).toBeVisible();
  expect(await page.evaluate(() => {
    const parsed = JSON.parse(localStorage.getItem('put_scanner_portfolio_trades') || '[]');
    return (parsed.data ?? parsed).some((trade: { id: string }) => trade.id === 'e2e-trade-1');
  })).toBe(true);
  await page.evaluate(() => {
    const holder = window as typeof window & { __putScannerOriginalSetItem?: Storage['setItem'] };
    if (holder.__putScannerOriginalSetItem) Storage.prototype.setItem = holder.__putScannerOriginalSetItem;
    delete holder.__putScannerOriginalSetItem;
  });
  await page.getByRole('button', { name: 'Dismiss local save warning' }).click();
  const requestsBeforeToggle = [...marketHarness.counts.values()].reduce((sum, count) => sum + count, 0);
  const analytics = page.getByRole('button', { name: 'Expand Portfolio Analytics' });
  await expect(analytics).toHaveAttribute('aria-expanded', 'false');
  await analytics.click();
  await expect(page.getByText('Needs Attention').first()).toBeVisible();
  await expect(page.getByText(/50%\+ captured ·/i)).toBeVisible();
  expect([...marketHarness.counts.values()].reduce((sum, count) => sum + count, 0)).toBe(requestsBeforeToggle);
  await page.getByRole('button', { name: 'Collapse Portfolio Analytics' }).click();
  await expect(page.getByText('Needs Attention')).toHaveCount(0);
  await page.getByRole('button', { name: 'Expand Portfolio Analytics' }).click();
  const premiumCard = page.getByText('Premium Collected', { exact: true }).first().locator('..');
  const capturedCard = page.getByText('% Captured', { exact: true }).first().locator('..');
  const premiumBeforeMarkChange = await premiumCard.textContent();
  const capturedBeforeMarkChange = await capturedCard.textContent();
  const markToggle = page.getByText('Mark book at', { exact: true }).locator('..');
  await markToggle.getByRole('button', { name: 'Bid', exact: true }).click();
  await expect(capturedCard).not.toHaveText(capturedBeforeMarkChange ?? '');
  await expect(premiumCard).toHaveText(premiumBeforeMarkChange ?? '');
  expect([...marketHarness.counts.values()].reduce((sum, count) => sum + count, 0)).toBe(requestsBeforeToggle);
  const durableBefore = await page.evaluate(() => {
    const parsed = JSON.parse(localStorage.getItem('put_scanner_portfolio_trades') || '[]');
    return (parsed.data ?? parsed).map((trade: Record<string, unknown>) => Object.fromEntries(Object.entries(trade).filter(([key]) => key !== 'latestMarketData')));
  });
  const portfolioPricesBeforeRefresh = marketHarness.counts.get('prices') ?? 0;
  const portfolioOptionsBeforeRefresh = marketHarness.counts.get('options') ?? 0;
  const portfolioMaintenanceBeforeRefresh = marketHarness.counts.get('chart-history') ?? 0;
  await page.getByRole('button', { name: 'Refresh Open Trades' }).click();
  await expect(page.getByRole('button', { name: 'Refresh Open Trades' })).toBeEnabled();
  expect((marketHarness.counts.get('prices') ?? 0) - portfolioPricesBeforeRefresh).toBe(1);
  expect((marketHarness.counts.get('options') ?? 0) - portfolioOptionsBeforeRefresh).toBe(1);
  expect((marketHarness.counts.get('chart-history') ?? 0) - portfolioMaintenanceBeforeRefresh).toBe(0);
  const durableAfter = await page.evaluate(() => {
    const parsed = JSON.parse(localStorage.getItem('put_scanner_portfolio_trades') || '[]');
    return (parsed.data ?? parsed).map((trade: Record<string, unknown>) => Object.fromEntries(Object.entries(trade).filter(([key]) => key !== 'latestMarketData')));
  });
  expect(durableAfter).toEqual(durableBefore);
  const refreshedQuote = await page.evaluate(() => JSON.parse(localStorage.getItem('put_scanner_portfolio_trades') || '{}').localMarketData?.['e2e-trade-1']);
  expect(refreshedQuote?.optionLast).toBe(2.1);
  await expect(page.getByText('Schedule of Positions')).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /VIX @ Entry/i })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'TQQQ' }).last()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Close Candidates', exact: true })).toBeVisible();
});

test('Detail, drawer, Pulse cancellation, and mocked Account states remain bounded', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440x900', 'one consolidated deterministic desktop scenario');
  test.setTimeout(90_000);
  await page.goto('/options/SPY?expiry=2027-01-01');
  await expect(page.getByText('SPY', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: '90.00' }).last()).toBeVisible();
  await expect(page.getByRole('button', { name: /Jan 1 '27/ })).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => {
    const holder = window as typeof window & { __putScannerOriginalSetItem?: Storage['setItem'] };
    const original = Storage.prototype.setItem;
    holder.__putScannerOriginalSetItem = original;
    Storage.prototype.setItem = function setItem(key: string, value: string) {
      if (key === 'put_scanner_watchlist') throw new DOMException('E2E quota fixture', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  const addToWatchlist = page.getByTitle('Add to watchlist').first();
  await addToWatchlist.click();
  await expect(page.getByRole('alert')).toContainText("Put Scanner couldn't save this change on this browser.");
  await expect(addToWatchlist).toBeVisible();
  const storedTickers = await page.evaluate(() => {
    const parsed = JSON.parse(localStorage.getItem('put_scanner_watchlist') || '[]');
    return (parsed.data ?? parsed).map((item: { ticker: string }) => item.ticker);
  });
  expect(storedTickers).not.toContain('SPY');
  await page.evaluate(() => {
    const holder = window as typeof window & { __putScannerOriginalSetItem?: Storage['setItem'] };
    if (holder.__putScannerOriginalSetItem) Storage.prototype.setItem = holder.__putScannerOriginalSetItem;
    delete holder.__putScannerOriginalSetItem;
  });
  await page.getByRole('button', { name: 'Dismiss local save warning' }).click();
  const detailCalls = marketHarness.counts.get('ticker-detail') ?? 0;
  expect(detailCalls).toBeGreaterThanOrEqual(1);
  expect(detailCalls).toBeLessThanOrEqual(2);
  const beforeDrawer = [...marketHarness.counts.values()].reduce((sum, count) => sum + count, 0);
  await page.getByRole('row').filter({ hasText: '90.00' }).last().click();
  const drawer = page.getByRole('complementary');
  await expect(drawer.getByRole('heading', { name: 'Position Calculator' })).toBeVisible();
  for (const label of ['Last', 'Bid', 'Ask']) await expect(drawer.getByRole('button', { name: label, exact: true })).toBeVisible();
  for (const label of ['Secured-Cash Yield', 'Annualized Secured-Cash Yield', 'Net-Risk Return', 'Annualized Net-Risk Return', 'Breakeven', 'Delta', 'Bid/Ask Spread', 'Bid/Ask Spread %']) await expect(drawer.getByText(label, { exact: true }).first()).toBeVisible();
  await drawer.getByRole('textbox', { name: 'Contracts' }).fill('2');
  await expect(drawer.getByRole('textbox', { name: 'Contracts' })).toHaveValue('2');
  await expect(drawer.getByText('$400.00', { exact: true }).first()).toBeVisible();
  expect([...marketHarness.counts.values()].reduce((sum, count) => sum + count, 0)).toBe(beforeDrawer);
  await drawer.getByRole('button', { name: /Close option detail/i }).click();
  const optionsBeforeSwitch = marketHarness.counts.get('options') ?? 0;
  const alternateExpiry = page.getByRole('button', { name: /Jan 29/ });
  await alternateExpiry.click();
  await expect(alternateExpiry).toHaveAttribute('aria-pressed', 'true');
  expect((marketHarness.counts.get('options') ?? 0) - optionsBeforeSwitch).toBeLessThanOrEqual(2);
  await page.goto('/');
  await page.getByRole('form', { name: 'Analyze ticker' }).getByPlaceholder('NVDA').fill('NVDA');
  await page.getByRole('form', { name: 'Analyze ticker' }).getByRole('button', { name: /Analyze/ }).click();
  await expect(page).toHaveURL('/options/NVDA');
  await expect(page.getByRole('row').filter({ hasText: '90.00' }).last()).toBeVisible();

  marketHarness.unavailableRequestedExpiry.add('SPY');
  await page.goto('/options/SPY?expiry=2026-10-16');
  const fallbackExpiry = page.getByRole('button', { name: /Sep 18/ });
  await expect(fallbackExpiry).toHaveAttribute('aria-pressed', 'true');
  marketHarness.unavailableRequestedExpiry.delete('SPY');

  marketHarness.failuresRemaining.set('ticker-detail', 2);
  await page.goto('/options/IWM');
  await expect(page.getByRole('heading', { name: "We couldn't load options for IWM." })).toBeVisible();
  marketHarness.failuresRemaining.set('ticker-detail', 0);
  await page.getByRole('button', { name: 'Try Again' }).click();
  await expect(page.getByRole('row').filter({ hasText: '90.00' }).last()).toBeVisible();

  marketHarness.delays.set('etf-pulse', 350);
  await page.goto('/pulse');
  await expect(page.getByRole('status', { name: 'ETF Pulse loading' })).toBeVisible();
  await page.goto('/watchlist');
  await expect(page.getByRole('heading', { name: 'Watchlist' })).toBeVisible();
  await page.waitForTimeout(450);
  await expect(page.getByText('ETF Pulse Visuals')).toHaveCount(0);
  expect(marketHarness.aborted.get('etf-pulse') ?? 0).toBeGreaterThanOrEqual(1);
  marketHarness.delays.delete('etf-pulse');
  await page.goto('/pulse');
  await expect(page.getByText('ETF Pulse Visuals')).toBeVisible();
  const pulseCallsAfterPublication = marketHarness.counts.get('etf-pulse') ?? 0;
  await page.goto('/watchlist');
  await page.goto('/pulse');
  await expect(page.getByText('ETF Pulse Visuals')).toBeVisible();
  expect(marketHarness.counts.get('etf-pulse')).toBe(pulseCallsAfterPublication);
  await page.goto('/?account-ui-fixture=signed-out');
  await expect(page.getByTestId('account-ui-fixture')).toBeVisible();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Close Account' }).last().click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto('/?account-ui-fixture=synced');
  await expect(page.getByText(/All synced|Synced/i).first()).toBeVisible();
  await page.goto('/?account-ui-fixture=conflict');
  await expect(page.getByText(/conflict|Choose which copy/i).first()).toBeVisible();
  expect(consoleErrors.length).toBeGreaterThan(0);
  expect(consoleErrors.every(error => error.includes('503'))).toBe(true);
});
