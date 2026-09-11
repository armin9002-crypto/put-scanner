import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OPTION_QUOTE_TABLE_DISPLAY_ORDER } from '../src/lib/optionQuoteDisplay.ts';
import { resolvePortfolioMark } from '../src/lib/portfolioValuation.ts';
import { PORTFOLIO_MARK_BASIS_OPTIONS, readPortfolioMarkBasis } from '../src/lib/portfolioMarkPreference.ts';
import { createOptionsOrigin, parseOptionsOrigin } from '../src/lib/optionsNavigation.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function storage(value) {
  return { getItem: () => value };
}

function trade(market, status = 'open') {
  return { status, latestMarketData: market };
}

test('Portfolio Phase B Mark Book accepts Last, Bid, Mid, and Ask with the existing safe default', () => {
  assert.deepEqual(PORTFOLIO_MARK_BASIS_OPTIONS, ['last', 'bid', 'mid', 'ask']);
  assert.equal(readPortfolioMarkBasis(storage(null)), 'ask');
  for (const basis of PORTFOLIO_MARK_BASIS_OPTIONS) assert.equal(readPortfolioMarkBasis(storage(basis)), basis);
  assert.equal(readPortfolioMarkBasis(storage('legacy-garbage')), 'ask');
});

test('Portfolio Phase B Mid uses stored Mid, computes valid Bid/Ask Mid, and fails closed for crossed quotes', () => {
  assert.deepEqual(resolvePortfolioMark(trade({ optionMid: 2.1, optionBid: 2, optionAsk: 2.2, optionLast: 2.05 }), 'mid'), { value: 2.1, source: 'selected' });
  assert.deepEqual(resolvePortfolioMark(trade({ optionMid: null, optionBid: 2, optionAsk: 2.2, optionLast: 2.05 }), 'mid'), { value: 2.1, source: 'selected' });
  assert.deepEqual(resolvePortfolioMark(trade({ optionMid: null, optionBid: 2.2, optionAsk: 2, optionLast: null }), 'mid'), { value: null, source: 'unavailable' });
});

test('Portfolio Phase B preserves the valuation-only stale Last fallback', () => {
  assert.deepEqual(resolvePortfolioMark(trade({ optionMid: null, optionBid: null, optionAsk: null, optionLast: 1.4 }), 'mid'), { value: 1.4, source: 'last_fallback' });
});

test('Portfolio Phase B extends navigation state without invalidating old Portfolio origins', () => {
  const presentation = {
    sortField: 'realizedPnl',
    sortDir: 'desc',
    groupMode: 'underlying',
    mobileAnalytics: 'attention',
    analyticsExpanded: true,
    mobileHistoryOpen: true,
  };
  assert.equal(parseOptionsOrigin(createOptionsOrigin('portfolio', { presentation }))?.kind, 'portfolio');
  const extended = createOptionsOrigin('portfolio', {
    presentation: {
      ...presentation,
      onlyShowEtfs: false,
      historyOutcomeFilter: 'closed',
      historyGroupMode: 'underlying',
      historySortField: 'realizedPnl',
      historySortDir: 'desc',
      collapsedHistoryGroups: { 'underlying:TQQQ': false },
      historicalMetric: 'realizedIrr',
      historicalWindowMonths: 12,
    },
    scrollY: 1500,
    focusStrike: 90,
  });
  assert.equal(extended.scrollY, 1500);
  assert.equal(extended.focusStrike, 90);
  assert.equal(parseOptionsOrigin({ ...extended, focusStrike: 0 }), null);
  assert.equal(parseOptionsOrigin({ ...extended, presentation: { ...extended.presentation, collapsedHistoryGroups: Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`group-${index}`, true])) } }), null);
});

test('Portfolio Phase B keeps Mid out of generic option table presentation', async () => {
  assert.deepEqual(OPTION_QUOTE_TABLE_DISPLAY_ORDER, ['last', 'bid', 'ask']);
  const page = await readFile(path.join(root, 'src/pages/PortfolioPage.tsx'), 'utf8');
  assert.match(page, /PORTFOLIO_MARK_BASIS_OPTIONS/);
  assert.doesNotMatch(page, /OPTION_QUOTE_TABLE_DISPLAY_ORDER/);
});
