import { expect, test } from '@playwright/test';
import { installDeterministicMarketApi } from './fixtures/marketApi';
import { SCREENER_CHUNKS } from '../shared/screenerUniverse.js';

test('Screener full-universe confirmation ignores rapid duplicate activation', async ({ page }, testInfo) => {
  test.skip(!['desktop-1440x900', 'portrait-390x844'].includes(testInfo.project.name));
  const market = await installDeterministicMarketApi(page);
  market.delays.set('screener-batch', 300);
  await page.goto('/screener');
  await page.getByRole('button', { name: /Load|Run Screener/i }).first().click();
  const confirm = page.getByRole('button', { name: /^(Confirm|Run scan)$/i });
  await confirm.waitFor({ state: 'visible' });
  await confirm.evaluate(button => {
    const click = () => button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    click();
    click();
  });
  if (testInfo.project.name === 'portrait-390x844') {
    await expect(page.locator('.screener-mobile-context .status-badge')).toContainText('loaded', { timeout: 60_000 });
  } else {
    await expect(page.locator('.screener-header-meta')).toContainText('contracts loaded', { timeout: 60_000 });
  }
  expect(market.counts.get('screener-batch') ?? 0).toBe(SCREENER_CHUNKS.length);
  expect(market.aborted.get('screener-batch') ?? 0).toBe(0);
});
