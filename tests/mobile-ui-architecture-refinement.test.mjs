import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatNumber } from '../src/lib/format.ts';
import { calculateYieldPercent } from '../src/lib/optionMetrics.ts';
import { calculateCurrentOptionMark, calculateUnrealizedPnl } from '../src/lib/portfolioMetrics.ts';
import {
  executableOptionPrice,
  formatOptionQuoteValue,
  selectDefaultSoldPrice,
} from '../src/lib/optionQuoteDisplay.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('zero bid is non-executable while positive and fallback quotes retain their honest basis', () => {
  assert.equal(executableOptionPrice(0), null);
  assert.equal(formatOptionQuoteValue('bid', 0, value => `$${value.toFixed(2)}`), 'No Bid');
  assert.deepEqual(selectDefaultSoldPrice({ bid: 1.25, ask: 1.4, last: 1.3 }), { basis: 'bid', value: 1.25 });
  assert.deepEqual(selectDefaultSoldPrice({ bid: null, ask: 1.4, last: 1.3 }), { basis: 'last', value: 1.3 });
  assert.deepEqual(selectDefaultSoldPrice({ bid: 0, ask: 1.4, last: 1.3 }), { basis: 'last', value: 1.3 });
  assert.equal(selectDefaultSoldPrice({ bid: 0, ask: null, last: 0 }), null);
});

test('missing executable prices fail dependent yield closed without changing legitimate non-price zero display', () => {
  assert.deepEqual(calculateYieldPercent(executableOptionPrice(0), 100, 30), { nominal: null, annualized: null });
  assert.equal(formatOptionQuoteValue('last', 0, value => value.toFixed(2)), '—');
  assert.equal(formatNumber(0), '0');
});

test('a zero live quote cannot fabricate a Portfolio mark or downstream P&L', () => {
  const trade = {
    id: 'zero-bid', ticker: 'TQQQ', optionType: 'put', strike: 90, expiration: '2027-01-01', contracts: 1,
    soldPrice: 2, soldDate: '2026-08-20', status: 'open', createdAt: '2026-08-20T12:00:00.000Z',
    updatedAt: '2026-08-20T12:00:00.000Z', latestMarketData: { optionBid: 0, optionAsk: 2.2, optionLast: 2.1 },
  };
  assert.equal(calculateCurrentOptionMark(trade, 'bid'), null);
  assert.equal(calculateUnrealizedPnl(trade, 'bid'), null);
  assert.equal(calculateCurrentOptionMark(trade, 'ask'), 2.2);
  assert.equal(calculateCurrentOptionMark(trade, 'last'), 2.1);
});

test('portrait Portfolio exposes the exact eight-metric headline and one direct refresh path', async () => {
  const source = await readFile(path.join(root, 'src/pages/PortfolioPage.tsx'), 'utf8');
  const portraitStart = source.indexOf('if (isPhone && !isPhoneLandscape)');
  const portraitEnd = source.indexOf('\n  return (\n    <div className="portfolio-page', portraitStart);
  const portrait = source.slice(portraitStart, portraitEnd);
  for (const label of ['Premium', 'Gross Risk', 'Gain/Loss', 'Captured', 'Entry AY', 'Current AY', 'Avg Delta', 'Avg DTE']) {
    assert.match(portrait, new RegExp(`\\['${label}'`));
  }
  assert.doesNotMatch(portrait, /\['Net Risk'/);
  assert.match(portrait, /aria-label="Refresh open trades"[\s\S]*?<RefreshCw/);
  assert.match(portrait, /aria-label="Portfolio actions"[\s\S]*?<MoreHorizontal/);

  const actionsStart = portrait.indexOf('{mobileActionsOpen &&');
  const actionsEnd = portrait.indexOf('{(showAddModal', actionsStart);
  assert.doesNotMatch(portrait.slice(actionsStart, actionsEnd), /Refresh Open Trades/);
});
