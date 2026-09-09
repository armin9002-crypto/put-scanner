import { expect, test } from '@playwright/test';

test('XAPP-019 nested Recommendation Evidence to Option Drawer keeps one active overlay', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440x900', 'focused desktop nested-overlay regression');

  await page.goto('/recommendations?recommendations-fixture=conditional', { waitUntil: 'domcontentloaded' });
  const card = page.locator('.recommendation-card').filter({ hasText: 'CONDITIONAL' }).first();
  const origin = card.getByRole('button', { name: 'Evidence', exact: true });
  await origin.click();

  const evidence = page.getByRole('dialog', { name: /recommendation evidence/i });
  await expect(evidence).toBeVisible();
  const evidenceClose = evidence.getByRole('button', { name: /Close recommendation evidence/i });
  await expect(evidenceClose).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(evidence.getByRole('button', { name: 'View Chain' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(evidenceClose).toBeFocused();
  expect(await page.locator('nav.app-desktop-nav').evaluate(element => element.closest('[inert]') !== null)).toBe(true);

  const openContract = evidence.getByRole('button', { name: 'Open Contract' });
  await openContract.click();
  const optionDrawer = page.locator('.option-detail-drawer');
  await expect(optionDrawer).toBeVisible();
  await expect(optionDrawer.getByRole('button', { name: /Close option detail drawer/i })).toBeFocused();
  expect(await evidence.evaluate(element => element.closest('[inert]') !== null)).toBe(true);
  expect(await page.locator('nav.app-desktop-nav').evaluate(element => element.closest('[inert]') !== null)).toBe(true);

  await page.keyboard.press('Escape');
  await expect(optionDrawer).toHaveCount(0);
  await expect(evidence).toBeVisible();
  await expect(openContract).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(evidence).toHaveCount(0);
  await expect(origin).toBeFocused();
  expect(await page.locator('nav.app-desktop-nav').evaluate(element => element.closest('[inert]') !== null)).toBe(false);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
});
