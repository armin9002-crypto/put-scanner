import { expect, test } from '@playwright/test';
import { installDeterministicCloudAccount } from './fixtures/cloudAccount';

const pendingTrade = {
  id: 'manual-worthless-pending',
  ticker: 'SOXL',
  optionType: 'put',
  strike: 50,
  expiration: '2025-06-20',
  contracts: 2,
  soldPrice: 1.2345,
  soldDate: '2025-05-01',
  status: 'expired_price_pending',
  resolutionType: 'expired_price_pending',
  resolutionWarning: 'Expiration economics remain pending because Yahoo reported an in-contract corporate action (dividend); adjusted option deliverables are not stored.',
  entryVixClose: 20.4,
  entryVixDate: '2025-05-01',
  entryVixSource: 'historical_close',
  entryDelta: -0.23,
  entryDeltaSource: 'manual',
  entryDeltaCapturedAt: '2026-08-30T12:00:00.000Z',
  createdAt: '2025-05-01T12:00:00.000Z',
  updatedAt: '2026-08-30T12:00:00.000Z',
};

test('manual worthless confirmation resolves History without market requests or a synthetic expiration price', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440x900', 'one deterministic desktop financial mutation scenario');
  const marketRequests: string[] = [];
  await page.route('**/api/**', async route => {
    marketRequests.push(route.request().url());
    await route.fulfill({ status: 501, contentType: 'application/json', body: JSON.stringify({ error: 'Unexpected market request.' }) });
  });
  const cloud = await installDeterministicCloudAccount(page, { portfolio: [pendingTrade], watchlist: [] });

  await page.goto('/portfolio');
  await expect(page.getByRole('heading', { name: 'Portfolio', exact: true })).toBeVisible();
  const pendingRow = page.getByRole('row').filter({ hasText: 'SOXL' }).last();
  await expect(pendingRow).toContainText('Expiration Price Pending');
  await expect(pendingRow.getByRole('button', { name: 'Confirm Worthless' })).toBeVisible();
  const requestsBeforeConfirmation = marketRequests.length;

  await pendingRow.getByRole('button', { name: 'Confirm Worthless' }).click();
  const dialog = page.getByRole('dialog', { name: 'Confirm expired worthless?' });
  await expect(dialog).toContainText('record final option value as $0 and keep Price @ Exp. unavailable');
  await dialog.getByRole('button', { name: 'Confirm Expired Worthless', exact: true }).click();

  const resolvedRow = page.getByRole('row').filter({ hasText: 'SOXL' }).last();
  await expect(resolvedRow).toContainText('Expired Worthless');
  await expect(resolvedRow).toContainText('$246.90');
  await expect(resolvedRow).toContainText('100.00%');
  await expect(resolvedRow.locator('td').nth(10)).toHaveText('—');
  await expect(resolvedRow.getByRole('button', { name: 'Set Expiration Close' })).toBeVisible();
  await expect(resolvedRow.getByRole('button', { name: 'Confirm Worthless' })).toHaveCount(0);
  await expect.poll(() => {
    const row = cloud.rows.find(candidate => candidate.namespace === 'portfolio');
    return (row?.payload.data as Array<Record<string, unknown>>)[0]?.resolutionSource;
  }).toBe('manual_worthless_confirmation');
  const durable = (cloud.rows.find(candidate => candidate.namespace === 'portfolio')?.payload.data as Array<Record<string, unknown>>)[0];
  expect(durable).toMatchObject({
    status: 'expired',
    resolutionType: 'expired_worthless',
    finalOptionValue: 0,
    percentCaptured: 1,
    resolvedDate: '2025-06-20',
  });
  expect(Number(durable.realizedPnl)).toBeCloseTo(246.9, 12);
  expect(durable).not.toHaveProperty('expirationClosePrice');
  expect(marketRequests).toHaveLength(requestsBeforeConfirmation);
});
