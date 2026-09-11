import { expect, test } from '@playwright/test';

const requiredProjects = new Set(['desktop-1440x900', 'portrait-390x844', 'landscape-844x390']);

test('Recommendation execution context fits required viewports at Small and Large text', async ({ page }, testInfo) => {
  test.skip(!requiredProjects.has(testInfo.project.name), 'Focused Phase B viewport only.');

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
    await conditionalCard.getByRole('button', { name: 'Evidence', exact: true }).click();
    const dialog = page.getByRole('dialog').first();
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Execution quality');
    await expect(dialog).toContainText('Market integrity');
    await expect(dialog).toContainText('Trusted Bid');
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);
  }
});
