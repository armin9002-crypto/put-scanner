import { expect, test } from '@playwright/test';
import { installDeterministicMarketApi } from './fixtures/marketApi';
import { installDeterministicCloudAccount } from './fixtures/cloudAccount';

test('scanner evidence is transient across hover leave, Escape, and scroll', async ({ page }) => {
  await installDeterministicMarketApi(page);
  await installDeterministicCloudAccount(page, { portfolio: [], watchlist: [], preferences: {} });
  await page.goto('/');

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

test('scanner Opportunity Set controls keep a wrapped compact layout', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('desktop-') && !testInfo.project.name.startsWith('portrait-'), 'desktop and phone layout captures only');
  await installDeterministicMarketApi(page);
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
