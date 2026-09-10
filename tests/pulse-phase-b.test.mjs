import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFile(path.join(root, file), 'utf8');

test('PULSE-004 exposes canonical technical reasons through an on-demand accessible control', async () => {
  const source = await read('src/pages/EtfPulsePage.tsx');

  assert.match(source, /function TechnicalStateExplanation/);
  assert.match(source, /presentUnderlyingTechnicalAssessment\(row\.technicalAssessment\)/);
  assert.match(source, /row\.technicalAssessment\.reasonCodes\.map/);
  assert.match(source, /Canonical signals/);
  assert.match(source, /aria-expanded=\{open\}/);
  assert.match(source, /aria-controls=\{panelId\}/);
  assert.match(source, /role="region" aria-labelledby=\{triggerId\}/);
  assert.match(source, /event\.key === 'Escape'/);
  assert.doesNotMatch(source, /technical state explanation[\s\S]{0,500}fetch\s*\(/i);
});

test('PULSE-005 keeps both Performance Window controls on one state owner and keeps Regime display-only', async () => {
  const source = await read('src/pages/EtfPulsePage.tsx');

  assert.equal((source.match(/\[selectedVisualPeriod, setSelectedVisualPeriod\]/g) ?? []).length, 1);
  assert.ok((source.match(/<VisualPeriodSelector value=\{selectedVisualPeriod\}/g) ?? []).length >= 3, 'top and lower responsive selector locations remain present');
  assert.match(source, /const regime = useMemo\(\(\) => result && result\.rows\.length > 0 \? deriveMarketRegime\(\{/);
  assert.match(source, /marketDataThrough: result\.marketDataThrough,[\s\S]*\}\) : null, \[result\]\);/);
  const regimeBlock = source.slice(source.indexOf('const regime ='), source.indexOf('const posture ='));
  assert.doesNotMatch(regimeBlock, /filteredRows/);
});

test('PULSE-007 gives Heatmap and Momentum Quadrant stable ticker semantics without financial interpolation', async () => {
  const source = await read('src/pages/EtfPulsePage.tsx');

  assert.match(source, /key=\{row\.ticker\}[\s\S]*data-pulse-ticker=\{row\.ticker\}/);
  assert.match(source, /aria-label=\{`\$\{row\.ticker\} · \$\{period\} return \$\{formatPct\(value\)\} · \$\{technicalState\.label\}/);
  assert.match(source, /const \[selectedTicker, setSelectedTicker\] = useState/);
  assert.match(source, /className="pulse-quadrant-companion"/);
  assert.match(source, /aria-label=\{`Select \$\{row\.ticker\}; \$\{period\} return \$\{formatPct\(x\)\}; RSI \$\{y\.toFixed\(1\)\}; technical state \$\{technicalState\.label\}`\}/);
  assert.match(source, /key=\{row\.ticker\}/);
  assert.doesNotMatch(source, /transition\s*:\s*cx|transition\s*:\s*cy/);
});

test('PULSE-012 keeps local Pulse empty states and reduced-motion behavior in the existing CSS architecture', async () => {
  const [page, styles] = await Promise.all([read('src/pages/EtfPulsePage.tsx'), read('src/index.css')]);

  assert.match(page, /No ETFs match these filters\./);
  assert.match(page, /No ETFs with return and RSI data match the current filters\./);
  assert.match(page, /pulse-mobile-visual-period/);
  assert.match(styles, /:where\(a, button, input, select, textarea, summary\):focus-visible/);
  assert.match(styles, /\.pulse-quadrant-companion button\[aria-pressed="true"\]/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styles, /transition-duration: 0\.01ms !important/);
  assert.match(styles, /\.pulse-technical-explanation__panel[\s\S]*width: min\(22rem, calc\(100vw - 1rem\)\)/);
  const heatmapTransition = styles.match(/\.pulse-heatmap-tile\s*\{[^}]*transition:\s*([^;]+)/)?.[1] ?? '';
  assert.doesNotMatch(heatmapTransition, /background-color/);
});
