import { expect, test, type Locator, type Page } from '@playwright/test';
import { installDeterministicCloudAccount } from './fixtures/cloudAccount';
import { installDeterministicMarketApi } from './fixtures/marketApi';

const drawerProjects = new Set(['desktop-1440x900', 'portrait-390x844', 'landscape-844x390']);

function isPhone(projectName: string): boolean {
  return projectName !== 'desktop-1440x900';
}

function isCompactTable(projectName: string): boolean {
  return projectName.startsWith('portrait-');
}

async function openOptionDrawer(page: Page, projectName: string) {
  await page.goto('/options/TQQQ?expiry=2027-01-01');
  const row = isCompactTable(projectName)
    ? page.locator('.mobile-financial-table-row').filter({ hasText: '90.00' }).first()
    : page.locator('.option-desktop-chain tbody tr').filter({ hasText: '90.00' }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click();
  const drawer = isPhone(projectName)
    ? page.locator('.option-drawer-mobile [role="dialog"]')
    : page.locator('.option-detail-drawer');
  await expect(drawer).toBeVisible();
  return drawer;
}

async function expectCalculatorState(
  drawer: Locator,
  basis: 'Last' | 'Bid' | 'Mid' | 'Ask',
  price: string,
  nominal: string,
  premium: string,
  netRisk: string,
  breakeven: string,
  annualized: string,
) {
  await expect(drawer.getByRole('button', { name: basis, exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(drawer.getByRole('textbox', { name: 'Sold Price' })).toHaveValue(price);
  await expect(drawer.getByText(premium, { exact: true }).first()).toBeVisible();
  await expect(drawer.getByText(netRisk, { exact: true }).first()).toBeVisible();
  await expect(drawer.getByText(breakeven, { exact: true }).first()).toBeVisible();
  await expect(drawer.getByText(nominal, { exact: true }).first()).toBeVisible();
  await expect(drawer.getByText(annualized, { exact: true }).first()).toBeVisible();
}

test('Option Drawer keeps quote basis and every calculator metric synchronized across responsive layouts', async ({ page }, testInfo) => {
  test.skip(!drawerProjects.has(testInfo.project.name), 'representative desktop, phone, and landscape drawer layouts');
  await installDeterministicMarketApi(page, { optionCount: 8, firstOptionLast: 2.1, firstOptionBid: 2, firstOptionAsk: 2.25, firstOptionLastTradeDate: Math.floor(Date.parse('2026-09-01T15:00:00Z') / 1_000) });
  await installDeterministicCloudAccount(page, { portfolio: [], watchlist: [], preferences: {} });
  const drawer = await openOptionDrawer(page, testInfo.project.name);
  const dteText = await drawer.locator('p').filter({ hasText: /DTE/ }).first().textContent();
  const dte = Number(dteText?.match(/(\d+) DTE/)?.[1]);
  expect(Number.isFinite(dte) && dte > 0).toBe(true);
  const annualized = (price: number) => `${((price / 90) * (365 / dte) * 100).toFixed(2)}%`;

  await expectCalculatorState(drawer, 'Last', '2.1', '2.33%', '$210.00', '$8,790.00', '$87.90', annualized(2.1));
  await expect(drawer).toContainText(/Last (?:may be stale|trade is very stale)/);

  await drawer.getByRole('button', { name: 'Bid', exact: true }).click();
  await expectCalculatorState(drawer, 'Bid', '2', '2.22%', '$200.00', '$8,800.00', '$88.00', annualized(2));

  await drawer.getByRole('button', { name: 'Mid', exact: true }).click();
  await expectCalculatorState(drawer, 'Mid', '2.125', '2.36%', '$212.50', '$8,787.50', '$87.88', annualized(2.125));

  await drawer.getByRole('button', { name: 'Ask', exact: true }).click();
  await expectCalculatorState(drawer, 'Ask', '2.25', '2.50%', '$225.00', '$8,775.00', '$87.75', annualized(2.25));

  const soldPrice = drawer.getByRole('textbox', { name: 'Sold Price' });
  await soldPrice.fill('2.05');
  await expect(drawer.getByText('Manual price · hypothetical calculator basis.', { exact: true })).toBeVisible();
  await expect(soldPrice).toHaveValue('2.05');
  await expect(drawer.getByText('$205.00', { exact: true }).first()).toBeVisible();
  await expect(drawer.getByText('$8,795.00', { exact: true }).first()).toBeVisible();
  await expect(drawer.getByText('$87.95', { exact: true }).first()).toBeVisible();
  await expect(drawer.getByText('2.28%', { exact: true }).first()).toBeVisible();
  await expect(drawer.getByText(annualized(2.05), { exact: true }).first()).toBeVisible();
});

test('stale Last remains the default with no Bid and keeps its warning truthful', async ({ page }, testInfo) => {
  test.skip(!drawerProjects.has(testInfo.project.name), 'representative desktop, phone, and landscape drawer layouts');
  await installDeterministicMarketApi(page, { optionCount: 4, firstOptionLast: 2.1, firstOptionBid: 0, firstOptionAsk: 2.25, firstOptionLastTradeDate: Math.floor(Date.parse('2026-09-01T15:00:00Z') / 1_000) });
  await installDeterministicCloudAccount(page, { portfolio: [], watchlist: [], preferences: {} });
  const drawer = await openOptionDrawer(page, testInfo.project.name);
  await expect(drawer.getByRole('button', { name: 'Last', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(drawer.getByRole('button', { name: 'Bid', exact: true })).toBeDisabled();
  await expect(drawer.getByRole('textbox', { name: 'Sold Price' })).toHaveValue('2.1');
  await expect(drawer).toContainText(/Last (?:may be stale|trade is very stale)/);
  await expect(drawer).toContainText('$210.00');
  await expect(drawer).toContainText('$8,790.00');
});
