import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeUiTextSize, nextUiTextSize, readUiTextSize, uiTextCssPx, UI_TEXT_SIZE_STORAGE_KEY } from '../src/lib/uiTextSizePreference.ts';

test('text size defaults safely and cycles Small → Medium → Large → Small', () => {
  for (const value of [null, '', 'Small', 'huge', '1.16']) assert.equal(normalizeUiTextSize(value), 'small');
  for (const size of ['small', 'medium', 'large']) assert.equal(normalizeUiTextSize(size), size);
  assert.deepEqual(['small', nextUiTextSize('small'), nextUiTextSize('medium'), nextUiTextSize('large')], ['small', 'medium', 'large', 'small']);
});

test('device-local text size reads persistence and tolerates unavailable storage', () => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
      getItem(key) { assert.equal(key, 'put_scanner_text_size'); return 'large'; },
    } });
    assert.equal(UI_TEXT_SIZE_STORAGE_KEY, 'put_scanner_text_size');
    assert.equal(readUiTextSize(), 'large');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('blocked'); } });
    assert.equal(readUiTextSize(), 'small');
  } finally {
    if (prior) Object.defineProperty(globalThis, 'localStorage', prior);
    else delete globalThis.localStorage;
  }
});

test('computed chart labels use the shared CSS scale without chart subscriptions', () => {
  assert.equal(uiTextCssPx(10), 'calc(10px * var(--ui-text-scale, 1))');
  assert.equal(uiTextCssPx(8.5), 'calc(8.5px * var(--ui-text-scale, 1))');
});

test('text preference stays outside account persistence and precedes Theme in both navs', () => {
  const source = file => readFileSync(new URL(file, import.meta.url), 'utf8');
  const provider = source('../src/lib/uiTextSize.tsx');
  assert.match(provider, /document.documentElement.setAttribute\('data-text-size', textSize\)/);
  assert.match(provider, /localStorage.setItem\(UI_TEXT_SIZE_STORAGE_KEY, textSize\)/);
  assert.match(provider, /notifyLocalStorageFailure\(\)/);
  assert.doesNotMatch(provider, /cloud|supabase|fetch\(|portfolio|watchlist/i);
  assert.equal([...source('../src/App.tsx').matchAll(/<TextSizeControl\s*\/>\s*<ThemeToggle\s*\/>/g)].length, 2);
  const styles = source('../src/index.css');
  assert.match(styles, /data-text-size="medium"\] \{ --ui-text-scale: 1\.08/);
  assert.match(styles, /data-text-size="large"\] \{ --ui-text-scale: 1\.16/);
  assert.match(styles, /font-size: calc\(16px \* var\(--ui-text-scale\)\)/);
});
