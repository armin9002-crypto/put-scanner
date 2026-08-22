import { migratePreferencesState } from '../src/lib/durablePreferences.ts';
import { migratePortfolioState } from '../src/lib/portfolioStorage.ts';
import { migrateWatchlistState } from '../src/lib/watchlist.ts';

function trade(index, closed = false) {
  const created = new Date(Date.UTC(2025, 0, 1 + (index % 250))).toISOString();
  return {
    id: `synthetic-trade-${index}`,
    ticker: ['TQQQ', 'SOXL', 'UPRO', 'FAS'][index % 4],
    optionType: 'put',
    strike: 30 + (index % 80),
    expiration: '2027-01-15',
    contracts: 1 + (index % 5),
    soldPrice: 0.75 + (index % 20) / 10,
    soldDate: created.slice(0, 10),
    entrySnapshot: { underlyingPrice: 72.5, bid: 1.15, ask: 1.25, last: 1.2, iv: 0.42, delta: -0.21 },
    entryVixClose: 18.42,
    entryVixDate: created.slice(0, 10),
    entryVixSource: 'historical_close',
    status: closed ? 'closed' : 'open',
    notes: `Synthetic durable planning note ${index}`,
    createdAt: created,
    updatedAt: created,
    ...(closed ? {
      closePrice: 0.15,
      closeDate: '2026-08-01',
      resolvedDate: '2026-08-01',
      resolutionSource: 'expiration_close',
      realizedPnl: 110,
      percentCaptured: 88,
      premiumCollected: 125,
      daysHeld: 45,
    } : {}),
  };
}

function portfolio(openCount, historyCount) {
  const input = [
    ...Array.from({ length: openCount }, (_, index) => trade(index, false)),
    ...Array.from({ length: historyCount }, (_, index) => trade(openCount + index, true)),
  ];
  const migrated = migratePortfolioState(0, input);
  if (migrated.status !== 'ok') throw new Error('Synthetic Portfolio fixture failed validation.');
  return migrated.state.data;
}

function watchlist(count) {
  const input = Array.from({ length: count }, (_, index) => {
    const ticker = `ETF${String(index).padStart(3, '0')}`;
    const strike = 20 + index;
    return {
      id: `${ticker}|put|2027-01-15|${strike}`,
      ticker,
      expiry: '2027-01-15',
      expiryTimestamp: 1_800_000_000 + index,
      expiryFormatted: "Jan 15 '27",
      strike,
      optionType: 'put',
      addedAt: 1_766_000_000_000 + index,
      savedAt: 1_766_000_000_000 + index,
      note: `Synthetic watchlist note ${index}`,
    };
  });
  const migrated = migrateWatchlistState(0, input);
  if (migrated.status !== 'ok') throw new Error('Synthetic Watchlist fixture failed validation.');
  return migrated.state.data;
}

function preferences() {
  const migrated = migratePreferencesState(0, {
    theme: 'sepia',
    portfolioMarkBasis: 'bid',
    portfolioGroupMode: 'underlying',
    showNominalYield: true,
  });
  if (migrated.status !== 'ok') throw new Error('Synthetic Preferences fixture failed validation.');
  return migrated.data;
}

function bytes(data) {
  return Buffer.byteLength(JSON.stringify({ data }), 'utf8');
}

const measurements = {
  portfolio: {
    light_2_open_1_history: bytes(portfolio(2, 1)),
    representative_15_open_8_history: bytes(portfolio(15, 8)),
    heavy_300_open_200_history: bytes(portfolio(300, 200)),
  },
  watchlist: {
    normal_20: bytes(watchlist(20)),
    heavy_200: bytes(watchlist(200)),
  },
  preferences: {
    normal_4_non_default: bytes(preferences()),
  },
};

process.stdout.write(`${JSON.stringify(measurements, null, 2)}\n`);
