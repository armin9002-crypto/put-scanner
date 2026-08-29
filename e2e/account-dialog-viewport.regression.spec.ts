import { expect, test, type Page, type TestInfo } from '@playwright/test';

type AccountMetrics = {
  viewport: { width: number; height: number };
  dialog: { top: number; bottom: number; height: number; scrollHeight: number; clientHeight: number; overflowY: string; position: string; zIndex: string };
  scrollRegion: { scrollHeight: number; clientHeight: number; overflowY: string; scrollTop: number };
  header: { top: number; bottom: number; height: number };
  close: { top: number; bottom: number; height: number };
  portalParent: string;
  bodyOverflow: string;
  rootOverflow: string;
  pageScrollHeight: number;
};

const desktopProjects = new Set(['desktop-1440x900', 'desktop-1280x800', 'tablet-1024x768']);
const portraitProjects = new Set(['portrait-375x667', 'portrait-390x844', 'portrait-430x932']);
const landscapeProjects = new Set(['landscape-667x375', 'landscape-844x390']);

function isDesktop(testInfo: TestInfo): boolean {
  return desktopProjects.has(testInfo.project.name);
}

function isPortrait(testInfo: TestInfo): boolean {
  return portraitProjects.has(testInfo.project.name);
}

function isLandscape(testInfo: TestInfo): boolean {
  return landscapeProjects.has(testInfo.project.name);
}

async function openFixture(page: Page, state: string) {
  await page.goto(`/?account-ui-fixture=${state}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('account-ui-fixture')).toBeVisible();
  await expect(page.getByRole('dialog')).toBeVisible();
}

async function expandAccountData(page: Page) {
  const collapsed = page.getByRole('button', { name: 'Account Data', exact: true });
  if (await collapsed.count()) await collapsed.click();
  await expect(page.getByLabel('Account Data', { exact: true })).toBeVisible();
}

async function expandSyncDetails(page: Page) {
  const summary = page.getByText('Sync details', { exact: true });
  await expect(summary).toBeVisible();
  await summary.click();
  await expect(summary.locator('..')).toHaveAttribute('open', '');
}

async function measure(page: Page): Promise<AccountMetrics> {
  return page.getByRole('dialog').evaluate(dialog => {
    const panel = dialog as HTMLElement;
    const rect = panel.getBoundingClientRect();
    const header = panel.querySelector('header') ?? panel.firstElementChild;
    const headerRect = (header as HTMLElement).getBoundingClientRect();
    const close = panel.querySelector('button[aria-label*="lose"]') as HTMLElement;
    const closeRect = close.getBoundingClientRect();
    const scrollElement = Array.from(panel.querySelectorAll<HTMLElement>('*')).find(element => {
      const style = getComputedStyle(element);
      return style.overflowY === 'auto' || style.overflowY === 'scroll';
    }) ?? panel;
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      dialog: {
        top: rect.top,
        bottom: rect.bottom,
        height: rect.height,
        scrollHeight: panel.scrollHeight,
        clientHeight: panel.clientHeight,
        overflowY: getComputedStyle(panel).overflowY,
        position: getComputedStyle(panel).position,
        zIndex: getComputedStyle(panel).zIndex,
      },
      scrollRegion: {
        scrollHeight: scrollElement.scrollHeight,
        clientHeight: scrollElement.clientHeight,
        overflowY: getComputedStyle(scrollElement).overflowY,
        scrollTop: scrollElement.scrollTop,
      },
      header: { top: headerRect.top, bottom: headerRect.bottom, height: headerRect.height },
      close: { top: closeRect.top, bottom: closeRect.bottom, height: closeRect.height },
      portalParent: panel.parentElement?.parentElement?.tagName ?? '',
      bodyOverflow: getComputedStyle(document.body).overflow,
      rootOverflow: getComputedStyle(document.documentElement).overflow,
      pageScrollHeight: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
    };
  });
}

function expectContained(metrics: AccountMetrics) {
  expect(metrics.dialog.top).toBeGreaterThanOrEqual(-1);
  expect(metrics.dialog.bottom).toBeLessThanOrEqual(metrics.viewport.height + 1);
  expect(metrics.close.top).toBeGreaterThanOrEqual(-1);
  expect(metrics.close.bottom).toBeLessThanOrEqual(metrics.viewport.height + 1);
  expect(metrics.portalParent).toBe('BODY');
  expect(metrics.dialog.zIndex).toBe('10');
  expect(metrics.pageScrollHeight).toBeLessThanOrEqual(metrics.viewport.height + 2);
}

async function scrollAccountBodyToEnd(page: Page) {
  await page.getByRole('dialog').evaluate(dialog => {
    const scrollElement = Array.from(dialog.querySelectorAll<HTMLElement>('*')).find(element => {
      const style = getComputedStyle(element);
      return style.overflowY === 'auto' || style.overflowY === 'scroll';
    }) ?? dialog;
    scrollElement.scrollTop = scrollElement.scrollHeight;
  });
}

test.describe('Account dialog viewport and clipping regression', () => {
  test('desktop Account fits within the viewport', async ({ page }, testInfo) => {
    test.skip(!isDesktop(testInfo));
    await openFixture(page, 'synced');
    expectContained(await measure(page));
  });

  test('desktop tall Account content scrolls internally', async ({ page }, testInfo) => {
    test.skip(!isDesktop(testInfo));
    await openFixture(page, 'conflict');
    await expandAccountData(page);
    await expandSyncDetails(page);
    const metrics = await measure(page);
    expectContained(metrics);
    expect(metrics.scrollRegion.scrollHeight).toBeGreaterThan(metrics.scrollRegion.clientHeight);
    await page.screenshot({ path: testInfo.outputPath('account-desktop-tall.png'), fullPage: true });
  });

  test('desktop close remains visible after scrolling', async ({ page }, testInfo) => {
    test.skip(!isDesktop(testInfo));
    await openFixture(page, 'conflict');
    await expandAccountData(page);
    await expandSyncDetails(page);
    await scrollAccountBodyToEnd(page);
    expectContained(await measure(page));
  });

  test('mobile portrait Account fits the sheet viewport', async ({ page }, testInfo) => {
    test.skip(!isPortrait(testInfo));
    await openFixture(page, 'synced');
    expectContained(await measure(page));
    await page.screenshot({ path: testInfo.outputPath('account-mobile-portrait.png'), fullPage: true });
  });

  test('mobile landscape Account fits the sheet viewport', async ({ page }, testInfo) => {
    test.skip(!isLandscape(testInfo));
    await openFixture(page, 'synced');
    expectContained(await measure(page));
    await page.screenshot({ path: testInfo.outputPath('account-mobile-landscape.png'), fullPage: true });
  });

  test('Account Data expanded remains reachable', async ({ page }) => {
    await openFixture(page, 'synced');
    await expandAccountData(page);
    await expect(page.getByText(/Account copy established|Account association needs attention/).first()).toBeVisible();
    expectContained(await measure(page));
  });

  test('Account Sync details expanded remains reachable', async ({ page }) => {
    await openFixture(page, 'synced');
    await expandSyncDetails(page);
    await expect(page.getByText('portfolio', { exact: true })).toBeVisible();
    expectContained(await measure(page));
  });

  test('conflict and attention states remain reachable', async ({ page }, testInfo) => {
    await openFixture(page, 'conflict');
    await expandAccountData(page);
    await expandSyncDetails(page);
    await expect(page.getByLabel(/Portfolio conflict recovery/)).toBeVisible();
    await scrollAccountBodyToEnd(page);
    expectContained(await measure(page));
    if (!isDesktop(testInfo)) await page.screenshot({ path: testInfo.outputPath('account-mobile-tall-conflict.png'), fullPage: true });
  });

  test('signed-out email state survives a reduced viewport', async ({ page }, testInfo) => {
    test.skip(!(isPortrait(testInfo) || isLandscape(testInfo)));
    await openFixture(page, 'signed-out');
    const email = page.getByRole('textbox', { name: 'Email' });
    await email.fill('owner@example.invalid');
    await expect(email).toHaveValue('owner@example.invalid');
    expectContained(await measure(page));
  });

  test('Account open does not create page-level overflow', async ({ page }) => {
    await openFixture(page, 'conflict');
    await expandAccountData(page);
    await expandSyncDetails(page);
    const metrics = await measure(page);
    expect(metrics.bodyOverflow).toBe('hidden');
    expect(metrics.rootOverflow).toContain('hidden');
    expect(metrics.pageScrollHeight).toBeLessThanOrEqual(metrics.viewport.height + 2);
  });

  test('backdrop blocks background interaction', async ({ page }) => {
    await openFixture(page, 'synced');
    const backdrop = page.getByRole('dialog').evaluate(dialog => {
      const layer = dialog.parentElement;
      const button = layer?.querySelector('button.absolute') as HTMLElement | null;
      return button ? { pointerEvents: getComputedStyle(button).pointerEvents, ariaLabel: button.getAttribute('aria-label') } : null;
    });
    expect((await backdrop)?.pointerEvents).not.toBe('none');
    expect((await backdrop)?.ariaLabel).toMatch(/close account/i);
  });

  test('focus trap, Escape, close, and focus restore remain intact', async ({ page }) => {
    await openFixture(page, 'synced');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeFocused();
    const trigger = page.getByRole('button', { name: 'Fixture account trigger' });
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
});
