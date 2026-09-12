import { expect, test } from '@playwright/test';

const requiredProjects = new Set(['desktop-1440x900', 'portrait-390x844', 'landscape-844x390']);

test('Recommendation execution context and nested overlays fit required viewports at Small and Large text', async ({ page }, testInfo) => {
  test.skip(!requiredProjects.has(testInfo.project.name), 'Focused Phase B viewport only.');
  const marketRequests: string[] = [];
  page.on('request', request => {
    if (/\/api\//.test(request.url())) marketRequests.push(request.url());
  });

  await page.addInitScript(() => {
    localStorage.setItem('put_scanner_theme', 'dark');
    localStorage.setItem('theme', 'dark');
    localStorage.setItem('theme_migration_version', '2');
  });

  for (const textSize of ['small', 'large']) {
    await page.goto('/recommendations?recommendations-fixture=conditional', { waitUntil: 'domcontentloaded' });
    await page.evaluate(size => localStorage.setItem('put_scanner_text_size', size), textSize);
    await page.reload({ waitUntil: 'domcontentloaded' });

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('html')).toHaveAttribute('data-text-size', textSize);
    await expect(page.locator('.recommendations-market-line__closed')).toContainText('Market closed');
    await expect(page.locator('.recommendation-conditional-strip')).toContainText('Market gap');
    await expect(page.getByText('CONDITIONAL', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open Contract', exact: true }).first()).toBeVisible();
    await expect(page.locator('.recommendation-card__copy-preview').first()).toBeVisible();
    if (testInfo.project.name === 'portrait-390x844') await expect(page.locator('.recommendation-card__copy-more').first()).toBeVisible();

    const pageOverflows = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(pageOverflows).toBe(false);

    const conditionalCard = page.locator('.recommendation-card').filter({ hasText: 'CONDITIONAL' }).first();
    const evidenceTrigger = conditionalCard.getByRole('button', { name: 'Evidence', exact: true });
    await evidenceTrigger.click();
    const dialog = page.locator('[role="dialog"]').filter({ hasText: 'Execution quality' }).first();
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Execution quality');
    await expect(dialog).toContainText('Market integrity');
    await expect(dialog).toContainText('Trusted Bid');
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);
    const requestsBeforeOverlay = marketRequests.length;

    const bodyWasUnlocked = await page.evaluate(() => document.body.style.overflow === '');
    expect(bodyWasUnlocked).toBe(false);
    await dialog.getByRole('button', { name: 'Open Contract', exact: true }).click();
    const optionDrawer = page.locator('.option-detail-drawer, .option-drawer-mobile').last();
    const optionDialog = page.locator('[role="dialog"]').last();
    await expect(optionDrawer).toBeVisible();
    await expect(page.locator('[role="dialog"]')).toHaveCount(2);
    await expect(dialog).toBeVisible();
    await expect(optionDialog).toHaveAttribute('aria-modal', 'true');
    await expect(page.locator('.page-frame')).toHaveAttribute('inert', '');
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');

    if (testInfo.project.name.startsWith('desktop-')) {
      await page.locator('.option-drawer-desktop > button.motion-backdrop').click();
    } else {
      await page.keyboard.press('Escape');
    }
    await expect(optionDrawer).toBeHidden();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Open Contract', exact: true })).toBeFocused();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(evidenceTrigger).toBeFocused();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
    await expect(page.locator('.page-frame')).not.toHaveAttribute('inert', '');
    expect(marketRequests.length).toBe(requestsBeforeOverlay, 'nested overlay transitions remain request-free');
  }
});
