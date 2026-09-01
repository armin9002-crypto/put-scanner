import { expect, test, type Page } from '@playwright/test';

async function openAddTrade(page: Page) {
  await page.goto('/portfolio');
  await expect(page.getByRole('heading', { name: 'Portfolio', exact: true })).toBeVisible();
  const mobileActions = page.getByRole('button', { name: 'Portfolio actions' });
  if (await mobileActions.isVisible()) {
    await mobileActions.click();
    await page.getByRole('button', { name: 'Add Trade', exact: true }).click();
  } else {
    await page.getByRole('button', { name: 'Add Trade', exact: true }).first().click();
  }
  await expect(page.getByRole('dialog', { name: 'Add Sold Put' })).toBeVisible();
}

test('Add Sold Put keeps Open compact and makes Historical entry explicit', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop-1440x900', 'one deterministic modal interaction');
  await openAddTrade(page);

  const dialog = page.getByRole('dialog', { name: 'Add Sold Put' });
  await expect(dialog.getByRole('radio', { name: /Open/ })).toHaveAttribute('aria-checked', 'true');
  await expect(dialog.getByLabel('Entry Delta (optional)')).toHaveCount(0);
  await expect(dialog.getByLabel('Entry IV (%)')).toHaveCount(0);

  await dialog.getByRole('radio', { name: /Historical \/ Realized/ }).click();
  await dialog.getByLabel('Ticker').fill('TQQQ');
  await dialog.getByLabel('Expiration').fill('2026-06-20');
  await dialog.getByLabel('Strike').fill('50');
  await dialog.getByLabel('Contracts').fill('2');
  await dialog.getByLabel('Sold Price (Net)').fill('1.2345');
  await dialog.getByLabel('Sold Date / Entry Date').fill('2026-05-01');
  const delta = dialog.getByLabel('Entry Delta (optional)');
  await expect(delta).toBeVisible();
  await delta.fill('0.1235');
  await delta.blur();
  await expect(delta).toHaveValue('-0.1235');
  const entryIv = dialog.getByLabel('Entry IV (%)');
  await expect(entryIv).toBeVisible();
  await entryIv.fill('65.4');
  await entryIv.blur();
  await expect(entryIv).toHaveValue('65.4');
  await expect(dialog.getByText('$246.90', { exact: true })).toBeVisible();
  await expect(dialog.getByText('$10,000', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('radio', { name: /Held to Expiration/ })).toHaveAttribute('aria-checked', 'true');
  await expect(dialog.getByRole('button', { name: 'Save & Add Another', exact: true })).toBeVisible();
  await expect(dialog.getByText(/Expiration price will be resolved through Portfolio Maintenance/i)).toBeVisible();

  await dialog.getByLabel('Expiration').fill('2026-09-18');
  await expect(dialog.getByRole('radio', { name: /Open/ })).toHaveAttribute('aria-checked', 'true');
  await expect(dialog.getByLabel('Entry Delta (optional)')).toHaveCount(0);
  await expect(dialog.getByLabel('Entry IV (%)')).toHaveCount(0);
  await dialog.getByLabel('Expiration').fill('2026-06-20');
  await expect(dialog.getByRole('radio', { name: /Historical \/ Realized/ })).toHaveAttribute('aria-checked', 'true');
  await expect(dialog.getByLabel('Entry IV (%)')).toBeVisible();

  await dialog.getByRole('radio', { name: /Closed \/ Bought Back/ }).click();
  await expect(dialog.getByLabel('Close Date')).toBeVisible();
  await expect(dialog.getByLabel('Close Price')).toBeVisible();
  await dialog.getByLabel('Close Date').fill('2026-06-20');
  await dialog.getByLabel('Close Price').fill('0.25');
  await dialog.getByRole('radio', { name: /Assigned \(Confirmed\)/ }).click();
  await expect(dialog.getByLabel('Close Date')).toHaveCount(0);
  await expect(dialog.getByLabel('Close Price')).toHaveCount(0);
  await expect(dialog.getByText(/confirmed brokerage event/i)).toBeVisible();
});

test('Add Sold Put keeps the dialog open when a durable save is unavailable', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop-1440x900', 'one deterministic save-failure interaction');
  await openAddTrade(page);
  const dialog = page.getByRole('dialog', { name: 'Add Sold Put' });
  await dialog.getByLabel('Ticker').fill('TQQQ');
  await dialog.getByLabel('Expiration').fill('2099-06-20');
  await dialog.getByLabel('Strike').fill('50');
  await dialog.getByLabel('Contracts').fill('1');
  await dialog.getByLabel('Sold Price').fill('1.25');
  await dialog.getByLabel('Sold Date').fill('2026-08-30');
  await dialog.getByRole('button', { name: 'Save Trade', exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('alert')).toContainText('Could not save this trade');
});
