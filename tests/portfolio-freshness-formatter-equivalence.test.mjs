import test from 'node:test';
import assert from 'node:assert/strict';
import { elapsedMarketSessions } from '../src/lib/portfolioQuoteFreshness.ts';
import { elapsedUsEquityTradingSessions } from '../src/lib/usMarketCalendar.ts';

const originalKey = value => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  }).formatToParts(date);
  const get = type => parts.find(part => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
};

test('elapsed market sessions preserves date-key conversion across boundaries and invalid dates', () => {
  const cases = [
    [Date.UTC(2024, 2, 8, 23), Date.UTC(2024, 2, 11, 16)], // DST
    [Date.UTC(2024, 11, 31, 23), Date.UTC(2025, 0, 2, 16)], // year boundary
    [Date.UTC(2024, 5, 14, 16), Date.UTC(2024, 5, 17, 16)], // weekend
    [Date.UTC(2024, 10, 27, 16), Date.UTC(2024, 10, 29, 16)], // Thanksgiving holiday
    [new Date('invalid'), Date.UTC(2024, 0, 2)],
  ];
  for (const [from, to] of cases) {
    assert.equal(elapsedMarketSessions(from, to), elapsedUsEquityTradingSessions(originalKey(from), originalKey(to)));
  }
});

test('elapsed market sessions default target remains call-time current date', t => {
  const from = Date.UTC(2024, 0, 2, 16);
  t.mock.timers.enable({ apis: ['Date'], now: from });
  assert.equal(elapsedMarketSessions(from), 0);
  t.mock.timers.tick(86_400_000);
  assert.equal(elapsedMarketSessions(from), 1);
});
