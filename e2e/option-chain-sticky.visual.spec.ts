import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { installDeterministicCloudAccount } from './fixtures/cloudAccount';
import { installDeterministicMarketApi } from './fixtures/marketApi';

const phase = process.env.UI_OVERHAUL_CAPTURE;
const suite = process.env.UI_OVERHAUL_SUITE;
const outputRoot = path.join(process.cwd(), 'e2e-artifacts', 'option-chain-sticky', phase || 'disabled');
const portraitProjects = new Set(['portrait-375x667', 'portrait-390x844', 'portrait-430x932']);
const landscapeProjects = new Set(['landscape-667x375', 'landscape-844x390']);
const desktopProjects = new Set(['desktop-1440x900', 'desktop-1280x800', 'tablet-1024x768']);

async function settle(page: Page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(300);
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  const directory = path.join(outputRoot, testInfo.project.name);
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, `${name}.png`), animations: 'disabled', fullPage: false });
}

async function openDetail(page: Page) {
  await page.goto('/options/TQQQ');
  await expect(page.getByText('TQQQ', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  await settle(page);
}

async function scrollPortraitChain(page: Page, index: number) {
  await page.locator('.mobile-option-chain-row:not(.mobile-option-chain-row--skeleton)').nth(index).evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
  await page.waitForTimeout(80);
}

async function scrollDesktopChain(page: Page, ratio: number) {
  const scrollOwner = page.locator('.option-desktop-chain .overflow-auto').first();
  await scrollOwner.evaluate((element, value) => { element.scrollTop = element.scrollHeight * value; }, ratio);
  await page.waitForTimeout(80);
}

test.describe('Mobile Option Chain sticky header visual matrix', () => {
  test.skip(!(phase === 'before' || phase === 'after') || suite !== 'option-chain-sticky', 'Run with UI_OVERHAUL_CAPTURE=before|after UI_OVERHAUL_SUITE=option-chain-sticky.');

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      if (!localStorage.getItem('put_scanner_theme')) localStorage.setItem('put_scanner_theme', 'dark');
      localStorage.removeItem('put_scanner_portfolio_trades');
      localStorage.removeItem('put_scanner_watchlist');
    });
  });

  test('captures portrait sticky states and landscape/desktop regressions', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await installDeterministicMarketApi(page, { optionCount: 72 });
    await installDeterministicCloudAccount(page, { portfolio: [], watchlist: [], preferences: {} });
    const project = testInfo.project.name;
    if (portraitProjects.has(project)) {
      await openDetail(page);
      const rows = page.locator('.mobile-option-chain-row:not(.mobile-option-chain-row--skeleton)');
      await expect(rows).toHaveCount(72);
      const header = page.locator('.mobile-option-chain-header');
      await expect(header).toBeVisible();
      await capture(page, testInfo, 'top');

      await scrollPortraitChain(page, 35);
      const midMetrics = await page.evaluate(() => {
        const chainHeader = document.querySelector<HTMLElement>('.mobile-option-chain-header');
        const appHeader = document.querySelector<HTMLElement>('.mobile-option-header');
        const row = document.querySelector<HTMLElement>('.mobile-option-chain-row:not(.mobile-option-chain-row--skeleton)');
        if (!chainHeader || !appHeader || !row) return null;
        const chainStyle = getComputedStyle(chainHeader);
        const rowStyle = getComputedStyle(row);
        return {
          scrollY: window.scrollY,
          routeScrollTop: document.querySelector<HTMLElement>('.mobile-route-page')?.scrollTop ?? 0,
          headerPosition: chainStyle.position,
          headerTop: chainHeader.getBoundingClientRect().top,
          headerBottom: chainHeader.getBoundingClientRect().bottom,
          appHeaderBottom: appHeader.getBoundingClientRect().bottom,
          viewportHeight: window.innerHeight,
          headerGrid: chainStyle.gridTemplateColumns,
          rowGrid: rowStyle.gridTemplateColumns,
          stickyOffset: getComputedStyle(document.querySelector<HTMLElement>('.mobile-route-page')!).getPropertyValue('--mobile-option-chain-sticky-top').trim(),
        };
      });
      await capture(page, testInfo, 'mid-scroll');
      if (phase === 'after') {
        expect(midMetrics).not.toBeNull();
        expect((midMetrics?.routeScrollTop ?? 0) + (midMetrics?.scrollY ?? 0)).toBeGreaterThan(0);
        expect(midMetrics?.headerPosition).toBe('sticky');
        expect(midMetrics?.headerTop).toBeGreaterThanOrEqual((midMetrics?.appHeaderBottom ?? 0) - 1);
        expect(midMetrics?.headerTop).toBeLessThan((midMetrics?.appHeaderBottom ?? 0) + 2);
        expect(midMetrics?.headerBottom).toBeLessThanOrEqual((midMetrics?.viewportHeight ?? 0) + 1);
        expect(midMetrics?.headerGrid).toBe(midMetrics?.rowGrid);
        expect(midMetrics?.stickyOffset).toMatch(/\d+px/);
      }

      await scrollPortraitChain(page, 71);
      await capture(page, testInfo, 'bottom');
      const bottomMetrics = await page.evaluate(() => {
        const header = document.querySelector<HTMLElement>('.mobile-option-chain-header');
        const appHeader = document.querySelector<HTMLElement>('.mobile-option-header');
        if (!header || !appHeader) return null;
        return { top: header.getBoundingClientRect().top, appBottom: appHeader.getBoundingClientRect().bottom };
      });
      if (phase === 'after') expect(bottomMetrics?.top).toBeGreaterThanOrEqual((bottomMetrics?.appBottom ?? 0) - 1);

      const star = page.getByRole('button', { name: 'Add to watchlist' }).first();
      await star.scrollIntoViewIfNeeded();
      await star.click();
      await expect(page.getByRole('button', { name: 'Remove from watchlist' }).first()).toBeVisible();
      await expect(page.getByRole('dialog')).toHaveCount(0);

      const tappedRow = rows.nth(40);
      await tappedRow.scrollIntoViewIfNeeded();
      await tappedRow.click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await capture(page, testInfo, 'drawer-open');
      await page.getByRole('button', { name: 'Close option details' }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      const alternateExpiry = page.locator('.mobile-option-header button[aria-pressed="false"]').last();
      if (await alternateExpiry.count()) {
        await alternateExpiry.click();
        await expect(rows).toHaveCount(72);
        await scrollPortraitChain(page, 35);
        await expect(header).toHaveCSS('position', 'sticky');
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
      expect(overflow).toBe(true);
    } else if (landscapeProjects.has(project)) {
      await openDetail(page);
      await expect(page.locator('.option-desktop-chain')).toBeVisible();
      await capture(page, testInfo, 'top');
      await scrollDesktopChain(page, 0.5);
      await capture(page, testInfo, 'mid-scroll');
      const midMetrics = await page.evaluate(() => {
        const owner = document.querySelector<HTMLElement>('.option-desktop-chain .overflow-auto');
        const header = document.querySelector<HTMLElement>('.option-desktop-chain thead th');
        return owner && header ? { ownerTop: owner.getBoundingClientRect().top, headerTop: header.getBoundingClientRect().top, position: getComputedStyle(header).position } : null;
      });
      if (phase === 'after') {
        expect(midMetrics?.position).toBe('sticky');
        expect(midMetrics?.headerTop).toBeGreaterThanOrEqual((midMetrics?.ownerTop ?? 0) - 1);
        expect(midMetrics?.headerTop).toBeLessThan((midMetrics?.ownerTop ?? 0) + 2);
      }
      await scrollDesktopChain(page, 1);
      await capture(page, testInfo, 'bottom');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    } else if (desktopProjects.has(project)) {
      await openDetail(page);
      await expect(page.locator('.option-desktop-chain')).toBeVisible();
      await capture(page, testInfo, 'desktop-regression');
    }
  });

  test('captures sticky header across all four themes', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'portrait-390x844' || phase !== 'after' || suite !== 'option-chain-sticky', 'Theme coverage runs once at portrait 390px after implementation.');
    test.setTimeout(120_000);
    await installDeterministicMarketApi(page, { optionCount: 72 });
    await installDeterministicCloudAccount(page, { portfolio: [], watchlist: [], preferences: {} });
    for (const theme of ['dark', 'dark-blue', 'light', 'sepia'] as const) {
      await page.goto('/options/TQQQ');
      await page.evaluate(value => localStorage.setItem('put_scanner_theme', value), theme);
      await page.reload();
      await expect(page.locator('.mobile-option-chain-header')).toBeVisible({ timeout: 20_000 });
      await settle(page);
      await scrollPortraitChain(page, 35);
      await expect(page.locator('.mobile-option-chain-header')).toHaveCSS('position', 'sticky');
      await capture(page, testInfo, `theme-${theme}-mid-scroll`);
    }
  });
});
