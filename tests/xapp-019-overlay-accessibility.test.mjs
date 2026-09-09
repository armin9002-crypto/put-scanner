import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFile(path.join(root, file), 'utf8');

test('XAPP-019 shared blocking overlay behavior covers the interaction contract', async () => {
  const source = await read('src/lib/blockingOverlay.ts');
  assert.match(source, /FOCUSABLE_SELECTOR/);
  assert.match(source, /element\.isConnected/);
  assert.match(source, /overlayStack/);
  assert.match(source, /bodyScrollLockCount/);
  assert.match(source, /event\.key === 'Escape'/);
  assert.match(source, /event\.key !== 'Tab'/);
  assert.match(source, /event\.shiftKey/);
  assert.match(source, /previousFocus/);
  assert.match(source, /element\.inert = true/);
  assert.match(source, /aria-hidden/);
  assert.match(source, /reconcileInertness/);
});

test('required blocking overlays consume the shared primitive without changing request/data surfaces', async () => {
  const files = [
    'src/components/mobile/MobileBottomSheet.tsx',
    'src/components/OptionDetailDrawer.tsx',
    'src/components/RecommendationEvidenceDrawer.tsx',
    'src/components/InteractivePriceChartModal.tsx',
    'src/components/UnderlyingHoldingsModal.tsx',
    'src/pages/EtfPulsePage.tsx',
  ];
  for (const file of files) {
    const source = await read(file);
    assert.match(source, /useBlockingOverlayBehavior/);
    assert.match(source, /aria-modal="true"/);
  }

  const optionDrawer = await read('src/components/OptionDetailDrawer.tsx');
  assert.match(optionDrawer, /selectLegacyRecommendationSoldPrice/);
  assert.match(optionDrawer, /window\.location\.pathname === '\/recommendations'/);
  assert.doesNotMatch(optionDrawer, /document\.body\.style\.overflow/);

  const chart = await read('src/components/InteractivePriceChartModal.tsx');
  assert.match(chart, /void loadChart\(\)/);
  assert.match(chart, /getChartHistory\(normalizedProxyTicker, timeframe\)/);
  assert.doesNotMatch(chart, /document\.body\.style\.overflow/);

  const holdings = await read('src/components/UnderlyingHoldingsModal.tsx');
  assert.match(holdings, /void loadHoldings\(false\)/);
  assert.doesNotMatch(holdings, /document\.body\.style\.overflow/);
});

test('high-risk workflow adoption stays behavior-only at the overlay boundary', async () => {
  const files = [
    'src/components/DataBackupModal.tsx',
    'src/components/PortfolioMaintenanceModal.tsx',
    'src/components/PortfolioScreenshotImportModal.tsx',
    'src/components/PortfolioHistoricalExcelImportModal.tsx',
    'src/pages/RecommendationsPage.tsx',
  ];
  for (const file of files) assert.match(await read(file), /useBlockingOverlayBehavior/);
  assert.match(await read('src/components/PortfolioHistoricalExcelImportModal.tsx'), /escapeEnabled: busy === null/);
});
