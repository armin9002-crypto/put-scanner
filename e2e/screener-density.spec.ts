import { expect, test } from '@playwright/test';
import { installDeterministicMarketApi } from './fixtures/marketApi';
import { installDeterministicCloudAccount } from './fixtures/cloudAccount';

test('Screener controls stay usable and AY Last refinement is request-free', async ({ page }, testInfo) => {
  test.skip(!['desktop-1440x900', 'portrait-390x844'].includes(testInfo.project.name), 'desktop and phone control review');

  // Install market before cloud so the fixture routes preserve deterministic precedence.
  const market = await installDeterministicMarketApi(page);
  const cloud = await installDeterministicCloudAccount(page, { portfolio: [], watchlist: [], preferences: {} });
  await page.goto('/screener');
  await expect(page.getByRole('heading', { name: 'Screener', exact: true })).toBeVisible();

  if (testInfo.project.name === 'portrait-390x844') {
    await page.getByRole('button', { name: /^Filters/i }).click();
  }
  const ayBid = testInfo.project.name === 'portrait-390x844'
    ? page.getByText('Annualized Yield Bid', { exact: true })
    : page.getByLabel('Annualized Yield Bid', { exact: true });
  const ayLast = testInfo.project.name === 'portrait-390x844'
    ? page.getByText('Annualized Yield Last', { exact: true })
    : page.getByLabel('Annualized Yield Last', { exact: true });
  await expect(ayBid).toBeVisible();
  await expect(ayLast).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath(`screener-controls-${testInfo.project.name}.png`), animations: 'disabled', fullPage: false });

  if (testInfo.project.name === 'portrait-390x844') await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Load|Run Screener/i }).first().click();
  await page.getByRole('button', { name: /^(Confirm|Run scan)$/ }).click();
  await expect(page.getByText(/(?:contracts loaded|\d+ loaded)/i).first()).toBeVisible({ timeout: 120_000 });
  const marketBefore = [...market.counts.entries()];
  const cloudBefore = cloud.requests.length;

  if (testInfo.project.name === 'portrait-390x844') {
    await page.getByRole('button', { name: /^Filters/i }).click();
  }
  const ayLastSelect = page.getByRole('combobox', { name: 'Annualized Yield Last', exact: true });
  await ayLastSelect.selectOption('>5');
  await expect(ayLastSelect).toHaveValue('>5');
  expect([...market.counts.entries()]).toEqual(marketBefore);
  expect(cloud.requests.length).toBe(cloudBefore);
});
