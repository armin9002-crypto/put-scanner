import { expect, test } from '@playwright/test';
import { installDeterministicMarketApi } from './fixtures/marketApi';
import { installDeterministicCloudAccount } from './fixtures/cloudAccount';

test('kinetic workstation interaction walkthrough', async ({ page }, info) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await installDeterministicMarketApi(page);
  await page.route('**/api/chart-history?**', route => {
    const params = new URL(route.request().url()).searchParams;
    const points = Array.from({ length: 60 }, (_, i) => ({ timestamp: 1_787_000_000 + i * 3600, date: new Date((1_787_000_000 + i * 3600) * 1000).toISOString(), price: 95 + i / 10 + Math.sin(i / 5) }));
    return route.fulfill({ json: { ticker: params.get('ticker'), displayTicker: params.get('ticker'), timeframe: params.get('timeframe') || '1D', points, corporateActions: [], previousClose: 95, latestPrice: points.at(-1)?.price, fetchedAt: Date.now(), metadata: { interval: '1h' } } });
  });
  await installDeterministicCloudAccount(page, { portfolio: [], watchlist: [] });
  await page.addInitScript(() => {
    localStorage.setItem('put_scanner_theme', 'dark');
    localStorage.setItem('theme_migration_version', '2');
  });
  await page.goto('/');
  const marketCard = page.locator('.scanner-market-card:visible, .mobile-market-strip__item:visible').first();
  await expect(marketCard).toBeVisible();
  await page.screenshot({ path: `e2e-artifacts/kinetic/${process.env.KINETIC_CAPTURE || 'final'}-${info.project.name}-scanner.png` });
  await marketCard.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.screenshot({ path: `e2e-artifacts/kinetic/${process.env.KINETIC_CAPTURE || 'final'}-${info.project.name}-chart.png` });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto('/options/TQQQ');
  await expect(page.locator('.mobile-financial-table-row:visible, .option-desktop-chain tbody tr:visible').first()).toBeVisible();
  await page.locator('.mobile-financial-table-row:visible, .option-desktop-chain tbody tr:visible').first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.screenshot({ path: `e2e-artifacts/kinetic/${process.env.KINETIC_CAPTURE || 'final'}-${info.project.name}-drawer.png` });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  for (const route of ['/pulse', '/recommendations?recommendations-fixture=conditional', '/portfolio', '/watchlist', '/screener']) {
    await page.goto(route);
    await expect(page.locator('main')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  expect(errors).toEqual([]);
});

test('overlay choreography preserves focus, identity and request isolation', async ({ page }, info) => {
  test.setTimeout(90_000);
  const market = await installDeterministicMarketApi(page);
  await installDeterministicCloudAccount(page, { portfolio: [], watchlist: [] });
  await page.goto('/recommendations?recommendations-fixture=conditional');
  const card = page.locator('.recommendation-card').filter({ hasText: 'CONDITIONAL' }).first();
  const origin = card.getByRole('button', { name: 'Evidence', exact: true });
  await origin.click();
  const evidence = page.getByRole('dialog');
  await expect(evidence).toBeVisible();
  // Pause the actual CSS animation to inspect a real intermediate frame.
  const sample = await evidence.evaluate(el => {
    // Browser automation can arrive after a short entrance has finished.
    // Restart the same CSS animation, as the existing motion regression does.
    (el as HTMLElement).style.animationName = 'none';
    void (el as HTMLElement).offsetWidth;
    (el as HTMLElement).style.animationName = '';
    const animation = el.getAnimations().find(a => a instanceof CSSAnimation && /ui-(drawer|sheet)$/.test(a.animationName));
    if (!animation) throw new Error('Expected a directional evidence entrance');
    animation.pause();
    animation.currentTime = 80;
    const style = getComputedStyle(el);
    return { duration: animation.effect?.getTiming().duration, translate: style.translate, opacity: Number(style.opacity) };
  });
  expect(sample.duration).toBe(320);
  expect(sample.opacity).toBeGreaterThan(0);
  expect(sample.opacity).toBeLessThan(1);
  expect(sample.translate).not.toBe('none');
  await page.screenshot({ path: `e2e-artifacts/kinetic/mid-entrance-${info.project.name}.png` });
  await evidence.getByRole('button', { name: 'Open Contract', exact: true }).focus();
  const requestsBefore = [...market.counts];
  const closing = await evidence.evaluate(el => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    // Simulate activation of the still-focused action in the same close frame.
    // It must not open another financial workflow after dismissal was requested.
    (document.activeElement as HTMLButtonElement).click();
    const exit = el.getAnimations().find(a => a instanceof CSSAnimation && a.animationName.endsWith('-exit'));
    if (!exit) throw new Error('Expected the CSS exit animation');
    exit.pause();
    exit.currentTime = 0;
    const exitStyle = getComputedStyle(el);
    const exitStart = { opacity: Number(exitStyle.opacity), translate: exitStyle.translate };
    exit.play();
    return { state: el.getAttribute('data-motion-closing'), bodyOverflow: document.body.style.overflow,
      opacity: Number((el as HTMLElement).style.getPropertyValue('--motion-exit-opacity')),
      translate: (el as HTMLElement).style.getPropertyValue('--motion-exit-translate'),
      exitStart,
      nestedDrawer: !!document.querySelector('.option-drawer-desktop, .option-drawer-mobile') };
  });
  expect(closing.state).toBe('true');
  expect(closing.bodyOverflow).toBe('hidden');
  expect(closing.opacity).toBeCloseTo(sample.opacity, 3);
  expect(closing.translate).toBe(sample.translate);
  expect(closing.exitStart.opacity).toBeCloseTo(sample.opacity, 3);
  expect(closing.exitStart.translate).toBe(sample.translate);
  expect(closing.nestedDrawer).toBe(false);
  await page.keyboard.press('Escape');
  await expect(evidence).toHaveCount(0);
  await expect(origin).toBeFocused();
  expect([...market.counts]).toEqual(requestsBefore);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
  await origin.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.getByRole('dialog').evaluate(el => getComputedStyle(el).animationName)).toBe('none');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(origin).toBeFocused();
});

test('market refresh feedback follows acquisition without additional requests', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-1440x900', 'market rail refresh is the desktop control');
  const api = await installDeterministicMarketApi(page);
  await page.goto('/');
  const rail = page.locator('.scanner-market-rail');
  await expect(rail).toHaveAttribute('data-refreshing', 'false');
  await page.waitForLoadState('networkidle');
  const before = api.counts.get('price') ?? 0;
  api.delays.set('price', 700);
  await page.getByRole('button', { name: 'Refresh market charts', exact: true }).first().click();
  await expect(rail).toHaveAttribute('data-refreshing', 'true');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await rail.locator('.scanner-market-card').count()).toBe(4);
  await page.screenshot({ path: 'e2e-artifacts/kinetic/market-refresh-active.png' });
  await expect(rail).toHaveAttribute('data-refreshing', 'false');
  await page.waitForTimeout(400);
  expect(api.counts.get('price')).toBe(before + 4);
  expect(await rail.evaluate(el => getComputedStyle(el, '::after').opacity)).toBe('0');
});
