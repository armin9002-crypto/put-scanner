import { expect, test } from '@playwright/test';
import { installDeterministicMarketApi } from './fixtures/marketApi';
import { installDeterministicCloudAccount } from './fixtures/cloudAccount';

test('scanner evidence is transient across hover leave, Escape, and scroll', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith('portrait-') || testInfo.project.name.startsWith('landscape-'), 'Evidence trigger is desktop-only by design');
  await page.clock.install({ time: '2027-01-02T12:00:00Z' });
  await installDeterministicMarketApi(page, { expirationFetchedAt: Date.parse('2027-01-02T12:00:00Z') });
  await installDeterministicCloudAccount(page, { portfolio: [], watchlist: [], preferences: {} });
  await page.goto('/');
  await expect(page.locator('.instrument-card').first()).toBeVisible({ timeout: 30_000 });

  const trigger = page.getByRole('button', { name: /Show .*options evidence/ }).first();
  await expect(trigger).toBeVisible();
  await trigger.hover();
  const evidence = page.getByRole('region', { name: /options evidence/i });
  await expect(evidence).toBeVisible();
  await page.mouse.move(4, 4);
  await expect(evidence).toBeHidden();

  await trigger.focus();
  await expect(evidence).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(evidence).toBeHidden();
  await trigger.evaluate((element) => (element as HTMLElement).blur());
  await trigger.focus();
  await expect(evidence).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 500));
  await expect(evidence).toBeHidden();
});

test('portrait Scanner rows keep only essential information and no evidence trigger', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('portrait-'), 'portrait layout coverage only');
  await page.clock.install({ time: '2027-01-02T12:00:00Z' });
  await installDeterministicMarketApi(page, { expirationFetchedAt: Date.parse('2027-01-02T12:00:00Z') });
  await installDeterministicCloudAccount(page, { portfolio: [], watchlist: [], preferences: {} });
  await page.goto('/');

  await expect(page.getByPlaceholder('Search ticker')).toBeVisible();
  const row = page.locator('.mobile-etf-row').first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: /Show .*options evidence/ })).toHaveCount(0);
  await expect(row).not.toContainText(/5D|1M|3M|52W|IV60|Assets|Liquid/i);
  await expect(page.getByText('Selected expiration confirms exact listed availability')).toHaveCount(0);
  expect(await row.evaluate(element => element.getBoundingClientRect().height)).toBeLessThanOrEqual(60);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
});

test('scanner Opportunity Set controls keep a wrapped compact layout', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('desktop-') && !testInfo.project.name.startsWith('portrait-'), 'desktop and phone layout captures only');
  await page.clock.install({ time: '2027-01-02T12:00:00Z' });
  await installDeterministicMarketApi(page, { expirationFetchedAt: Date.parse('2027-01-02T12:00:00Z') });
  await installDeterministicCloudAccount(page, { portfolio: [], watchlist: [], preferences: {} });
  await page.goto('/');
  const controls = page.getByRole('region', { name: 'Opportunity Set filters' });
  if (testInfo.project.name.startsWith('portrait-')) {
    await page.getByRole('button', { name: /^Filters/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog')).toContainText('Leverage');
  } else {
    await expect(controls).toBeVisible();
    await expect(controls).toContainText('Selected expiration confirms exact listed availability');
  }
  await page.screenshot({ path: testInfo.outputPath(`scanner-controls-${testInfo.project.name}.png`), animations: 'disabled', fullPage: false });
});
