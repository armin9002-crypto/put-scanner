import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const home = readFileSync(new URL('../src/pages/HomePage.tsx', import.meta.url), 'utf8');
const evidence = readFileSync(new URL('../src/components/ScannerSnapshotEvidence.tsx', import.meta.url), 'utf8');
const card = readFileSync(new URL('../src/components/ETFCard.tsx', import.meta.url), 'utf8');

test('scanner evidence dismisses when the originating trigger loses pointer or focus ownership', () => {
  assert.match(home, /document\.addEventListener\('pointerout', handlePointerOut\)/);
  assert.match(home, /document\.addEventListener\('focusout', handleFocusOut\)/);
  assert.match(home, /origin && activeEvidence\.anchor\.contains\(origin\) && \(!next \|\| !activeEvidence\.anchor\.contains\(next\)\)\) closeEvidence\(\)/);
});

test('scanner evidence dismisses on scroll while retaining Escape close and focus restoration', () => {
  assert.match(evidence, /const dismissOnScroll = \(\) => onClose\(false\)/);
  assert.match(evidence, /window\.addEventListener\('scroll', dismissOnScroll, true\)/);
  assert.match(evidence, /event\.key === 'Escape'[\s\S]*onClose\(true\)/);
  assert.match(card, /event\.key === 'Escape'[\s\S]*onEvidenceClose\?\.\(true\)/);
});
