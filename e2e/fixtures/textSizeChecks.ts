import { expect, type Page, type Locator } from '@playwright/test';

export async function checkChartScale(page: Page, labels: Locator) {
  const original = await page.locator('html').getAttribute('data-text-size');
  const paths = await page.locator('svg path[d]').evaluateAll(elements => elements.map(el => el.getAttribute('d')));
  const applySize = async (size: string) => page.locator('html').evaluate(async (el, value) => {
    el.setAttribute('data-text-size', value);
    // SVG used font values settle on paint after inherited custom properties change.
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  }, size);
  await applySize('small');
  const small = await labels.evaluateAll(elements => elements.map(el => parseFloat(getComputedStyle(el).fontSize)));
  expect(small.length).toBeGreaterThan(0);
  for (const [size, scale] of [['medium', 1.16], ['large', 1.32]] as const) {
    await applySize(size);
    const fonts = await labels.evaluateAll(elements => elements.map(el => parseFloat(getComputedStyle(el).fontSize)));
    expect(fonts.length).toBe(small.length);
    const names = await labels.evaluateAll(elements => elements.map(el => el.outerHTML));
    expect(fonts.flatMap((font, i) => Math.abs(font - small[i] * scale) > 0.015
      ? [{ label: names[i], actual: font, expected: small[i] * scale }] : []), `${size} chart labels`).toEqual([]);
    expect(await page.locator('svg path[d]').evaluateAll(elements => elements.map(el => el.getAttribute('d')))).toEqual(paths);
  }
  await applySize(original!);
}

export async function checkNavigation(page: Page) {
  const overlaps = await page.locator('.mobile-bottom-nav a:visible').evaluateAll(links => links.flatMap((link, index) => {
    const label = link.querySelector('span'); const next = links[index + 1]?.querySelector('span');
    if (!label || !next) return [];
    return label.getBoundingClientRect().right > next.getBoundingClientRect().left + 1 ? [label.textContent] : [];
  }));
  expect(overlaps, 'bottom navigation labels do not overlap').toEqual([]);
  const nav = page.locator('.mobile-bottom-nav[aria-label="Primary navigation"]:visible');
  if (await nav.count()) await expect(nav.locator('a')).toHaveCount(6);
  const clippedTabs = await page.locator('.pulse-mobile-controls [role="tab"]:visible').evaluateAll(elements => elements
    .filter((el, index) => {
      const range = document.createRange(); range.selectNodeContents(el);
      const text = range.getBoundingClientRect();
      // The approved 1.16 layout paints into the segmented group's padding.
      // Check the visible group and adjacent text, not the smaller button box.
      const group = el.closest('.mobile-segmented')!.getBoundingClientRect();
      const next = elements[index + 1];
      if (next) {
        range.selectNodeContents(next);
        if (text.right > range.getBoundingClientRect().left) return true;
      }
      return text.left < group.left - 1 || text.right > group.right + 1;
    }).map(el => el.textContent));
  expect(clippedTabs, 'Pulse view labels fit their controls').toEqual([]);
}

/** Compare the same rendered text nodes during a real preference cycle. */
export async function typographySample(page: Page) {
  return page.evaluate(() => [...document.querySelectorAll<HTMLElement>('body *')]
    .filter(el => el.children.length === 0 && el.textContent?.trim() && el.checkVisibility()
      && !el.closest('.text-size-control') && el.getBoundingClientRect().width > 0)
    .map(el => {
      const style = getComputedStyle(el); const box = el.getBoundingClientRect();
      return { tag: el.tagName, text: el.textContent, font: parseFloat(style.fontSize),
        line: style.lineHeight, x: box.x, y: box.y, w: box.width, h: box.height };
    }).filter(el => !/ago|Updated|Refreshed|Saved|AM|PM/.test(el.text || '')));
}

export async function checkMobileTable(page: Page) {
  const owner = page.locator('.mobile-financial-table-scroll:visible');
  if (!await owner.count()) return;
  const result = await owner.evaluate(element => {
    const header = element.querySelector<HTMLElement>('thead th')!;
    const identity = element.querySelector<HTMLElement>('tbody .mobile-financial-table-identity')!;
    if (!identity) throw new Error('Expected populated financial table');
    const initial = { x: identity.getBoundingClientRect().x, y: header.getBoundingClientRect().y };
    const clipped = [...element.querySelectorAll<HTMLElement>('tbody th, tbody td')].filter(cell => {
      // Native table cells must hold their full financial text, including nested labels.
      return cell.scrollWidth > cell.clientWidth + 1;
    }).map(cell => cell.textContent);
    element.scrollLeft = 250; element.scrollTop = 150;
    const after = { x: identity.getBoundingClientRect().x, y: header.getBoundingClientRect().y };
    const result = { initial, after, scrollLeft: element.scrollLeft,
      overflow: element.scrollWidth > element.clientWidth,
      bounds: element.getBoundingClientRect().right <= innerWidth + 1,
      visibleHeight: element.clientHeight,
      header: getComputedStyle(header).position, identity: getComputedStyle(identity).position,
      background: getComputedStyle(identity).backgroundColor, clipped };
    element.scrollLeft = 0; element.scrollTop = 0;
    return result;
  });
  expect(result.overflow).toBe(true);
  expect(result.bounds).toBe(true);
  expect(result.visibleHeight).toBeGreaterThan(44);
  expect(result.scrollLeft).toBeGreaterThan(0);
  expect(result.header).toBe('sticky');
  expect(result.identity).toBe('sticky');
  expect(result.background).not.toBe('rgba(0, 0, 0, 0)');
  expect(result.after.x).toBeCloseTo(result.initial.x, 1);
  expect(result.after.y).toBeCloseTo(result.initial.y, 1);
  expect(result.clipped).toEqual([]);
}

export async function checkOverlay(page: Page) {
  const dialog = page.locator('[role="dialog"]:visible').last();
  await expect(dialog).toBeVisible();
  const bounds = await dialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(-1);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  expect(bounds!.y).toBeGreaterThanOrEqual(-1);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1);
  const close = dialog.getByRole('button', { name: /close|dismiss/i }).first();
  if (await close.count()) {
    await close.scrollIntoViewIfNeeded();
    await expect(close).toBeInViewport();
  }
  const last = dialog.locator('button:visible, input:visible, textarea:visible, select:visible').last();
  if (await last.count()) {
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
  }
}
