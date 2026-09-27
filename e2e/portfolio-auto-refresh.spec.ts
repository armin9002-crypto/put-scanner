import { test, expect } from '@playwright/test';
import { installDeterministicCloudAccount } from './fixtures/cloudAccount';
import { installDeterministicMarketApi } from './fixtures/marketApi';

test('Portfolio route-entry refresh survives Strict Mode effect replay', async ({ page }) => {
  const market = await installDeterministicMarketApi(page);
  market.delays.set('prices', 250);
  market.delays.set('options', 300);
  await installDeterministicCloudAccount(page, {
    portfolio: [{ id: 'probe', ticker: 'LABU', optionType: 'put', strike: 90, expiration: '2028-01-21', contracts: 2, soldPrice: 8, soldDate: '2026-01-02', status: 'open', createdAt: '2026-01-02T15:00:00Z', updatedAt: '2026-01-02T15:00:00Z' }],
    watchlist: [],
    preferences: { portfolioMarkBasis: 'bid', portfolioGroupMode: 'none' },
  });
  await page.goto('/portfolio');
  await expect(page.getByRole('heading', { name: 'Portfolio', exact: true })).toBeVisible();
  const refresh = page.getByRole('button', { name: /Refresh open trades/i });
  await expect.poll(() => market.counts.get('prices') ?? 0).toBe(1);
  await expect(refresh).toBeDisabled();
  await refresh.dispatchEvent('click');
  expect(market.counts.get('prices') ?? 0).toBe(1);
  await expect(refresh).toBeEnabled({ timeout: 10_000 });
  expect(market.counts.get('prices') ?? 0).toBe(1);
  expect(market.aborted.get('prices') ?? 0).toBe(0);
  expect(market.counts.get('options') ?? 0).toBe(1);
});
