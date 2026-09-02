import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';

const captureEnabled = process.env.RECOMMENDATIONS_VISUAL_CAPTURE === 'final';
const outputRoot = path.join(process.cwd(), 'e2e-artifacts', 'recommendations', 'final');

const themes = ['dark', 'dark-blue', 'light', 'sepia'] as const;
const viewports = [
  { name: 'desktop-1920x1080', width: 1920, height: 1080 },
  { name: 'desktop-1440x900', width: 1440, height: 900 },
  { name: 'desktop-1280x800', width: 1280, height: 800 },
  { name: 'tablet-1024x768', width: 1024, height: 768 },
  { name: 'portrait-430x932', width: 430, height: 932 },
  { name: 'portrait-390x844', width: 390, height: 844 },
  { name: 'portrait-375x667', width: 375, height: 667 },
  { name: 'landscape-844x390', width: 844, height: 390 },
  { name: 'landscape-667x375', width: 667, height: 375 },
] as const;

async function openThemedPage(browser: Browser, theme: typeof themes[number], width: number, height: number) {
  const context = await browser.newContext({ viewport: { width, height } });
  await context.addInitScript(selectedTheme => {
    localStorage.setItem('put_scanner_theme', selectedTheme);
    localStorage.setItem('theme', selectedTheme);
    localStorage.setItem('theme_migration_version', '2');
  }, theme);
  const page = await context.newPage();
  return { context, page };
}

async function loadFixture(page: Page, fixture: 'actionable' | 'conditional' | 'no-trade' | 'incomplete') {
  await page.goto(`/recommendations?recommendations-fixture=${fixture}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('main .page-header__title')).toBeAttached();
  await expect(page.locator('.recommendations-verdict-strip')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.fonts.status)).toBe('loaded');
  await page.waitForTimeout(100);
}

async function assertNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
}

async function capture(page: Page, theme: string, name: string) {
  const directory = path.join(outputRoot, theme);
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, `${name}.png`), animations: 'disabled', fullPage: false });
}

test.describe('Recommendations visual matrix', () => {
  test('captures all required states, viewports, and themes', async ({ browser }, testInfo) => {
    test.skip(!captureEnabled || testInfo.project.name !== 'desktop-1440x900', 'Run with npm run visual:recommendations.');
    test.setTimeout(360_000);

    for (const theme of themes) {
      for (const viewport of viewports) {
        const { context, page } = await openThemedPage(browser, theme, viewport.width, viewport.height);
        await loadFixture(page, 'actionable');
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await assertNoHorizontalOverflow(page);
        await capture(page, theme, `${viewport.name}-actionable-recommendations`);
        await context.close();
      }

      const desktop = await openThemedPage(browser, theme, 1440, 900);
      await loadFixture(desktop.page, 'conditional');
      await expect(desktop.page.getByText('CONDITIONAL', { exact: true }).first()).toBeVisible();
      await capture(desktop.page, theme, 'desktop-conditional-opportunity');

      await loadFixture(desktop.page, 'no-trade');
      await expect(desktop.page.getByText('NO TRADE', { exact: true })).toBeVisible();
      await capture(desktop.page, theme, 'desktop-no-trade');

      await loadFixture(desktop.page, 'incomplete');
      await expect(desktop.page.getByText('ANALYSIS INCOMPLETE', { exact: true })).toBeVisible();
      await capture(desktop.page, theme, 'desktop-incomplete-run');

      await loadFixture(desktop.page, 'actionable');
      const board = desktop.page.getByRole('heading', { name: 'Opportunity Board' });
      await board.scrollIntoViewIfNeeded();
      await desktop.page.locator('.recommendations-expand-button').first().click();
      await capture(desktop.page, theme, 'desktop-mixed-opportunity-board');

      await desktop.page.getByRole('button', { name: 'Evidence', exact: true }).first().click();
      await expect(desktop.page.getByRole('dialog', { name: /recommendation evidence/i })).toBeVisible();
      await capture(desktop.page, theme, 'desktop-evidence-drawer');
      await desktop.context.close();

      const mobile = await openThemedPage(browser, theme, 390, 844);
      await loadFixture(mobile.page, 'actionable');
      await capture(mobile.page, theme, 'mobile-recommendations');

      const mobileBoard = mobile.page.getByRole('heading', { name: 'Opportunity Board' });
      await mobileBoard.scrollIntoViewIfNeeded();
      await mobile.page.locator('.recommendations-board-mobile-row__summary').first().click();
      await capture(mobile.page, theme, 'mobile-opportunity-board');

      await mobile.page.locator('.recommendations-board-mobile .recommendations-frontier-list button').first().click();
      await expect(mobile.page.getByRole('dialog')).toBeVisible();
      await capture(mobile.page, theme, 'mobile-evidence-sheet');
      await mobile.context.close();
    }
  });
});
