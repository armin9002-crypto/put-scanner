export type RequestBudgetWorkflow =
  | 'scanner-load'
  | 'screener-entry'
  | 'screener-full-scan'
  | 'watchlist-refresh'
  | 'portfolio-refresh'
  | 'portfolio-entry-delta-capture'
  | 'portfolio-entry-vix-maintenance'
  | 'portfolio-lifecycle-maintenance'
  | 'ticker-detail'
  | 'expiration-change'
  | 'option-drawer'
  | 'etf-pulse';

export interface RequestBudgetCounts {
  browserRequests: number;
  functionInvocations: number;
  providerAcquisitions: number;
}

export interface RequestBudgetLedgerEntry {
  expected: RequestBudgetCounts;
  ceiling: RequestBudgetCounts;
  providerHttpAttemptCeiling: number;
  fixture: string;
}

// Provider acquisitions are logical market-data operations. Provider HTTP attempts are
// reported separately because Yahoo session/crumb acquisition and a 401/403 retry can
// add transport attempts without multiplying the product workflow.
export const REQUEST_BUDGET_LEDGER: Record<RequestBudgetWorkflow, RequestBudgetLedgerEntry> = {
  'scanner-load': {
    expected: { browserRequests: 6, functionInvocations: 6, providerAcquisitions: 8 },
    ceiling: { browserRequests: 6, functionInvocations: 6, providerAcquisitions: 8 },
    providerHttpAttemptCeiling: 8,
    fixture: '42 Scanner symbols, one price batch, fund metadata, and four market charts',
  },
  'screener-entry': {
    expected: { browserRequests: 2, functionInvocations: 2, providerAcquisitions: 8 },
    ceiling: { browserRequests: 2, functionInvocations: 2, providerAcquisitions: 8 },
    providerHttpAttemptCeiling: 13,
    fixture: 'one expiration dataset plus VIX',
  },
  'screener-full-scan': {
    expected: { browserRequests: 14, functionInvocations: 14, providerAcquisitions: 126 },
    ceiling: { browserRequests: 14, functionInvocations: 14, providerAcquisitions: 126 },
    providerHttpAttemptCeiling: 196,
    fixture: '42 ETFs in fourteen fixed three-symbol batches, nine logical acquisitions each',
  },
  'watchlist-refresh': {
    expected: { browserRequests: 2, functionInvocations: 2, providerAcquisitions: 2 },
    ceiling: { browserRequests: 2, functionInvocations: 2, providerAcquisitions: 2 },
    providerHttpAttemptCeiling: 7,
    fixture: 'one ticker and one unique option chain',
  },
  'portfolio-refresh': {
    expected: { browserRequests: 3, functionInvocations: 3, providerAcquisitions: 3 },
    ceiling: { browserRequests: 3, functionInvocations: 3, providerAcquisitions: 3 },
    providerHttpAttemptCeiling: 13,
    fixture: 'two tickers and two unique open-trade option chains; quote-only',
  },
  'portfolio-entry-delta-capture': {
    expected: { browserRequests: 0, functionInvocations: 0, providerAcquisitions: 0 },
    ceiling: { browserRequests: 1, functionInvocations: 1, providerAcquisitions: 1 },
    providerHttpAttemptCeiling: 6,
    fixture: 'one same-market-date exact contract; cached chain costs zero, cold manual/OCR capture costs one bounded chain acquisition',
  },
  'portfolio-entry-vix-maintenance': {
    expected: { browserRequests: 1, functionInvocations: 1, providerAcquisitions: 1 },
    ceiling: { browserRequests: 1, functionInvocations: 1, providerAcquisitions: 1 },
    providerHttpAttemptCeiling: 6,
    fixture: 'one explicit historical VIX date-range maintenance request; local history cache can reduce this to zero',
  },
  'portfolio-lifecycle-maintenance': {
    expected: { browserRequests: 1, functionInvocations: 1, providerAcquisitions: 1 },
    ceiling: { browserRequests: 1, functionInvocations: 1, providerAcquisitions: 1 },
    providerHttpAttemptCeiling: 6,
    fixture: 'one explicit expired-position history acquisition; richer local history cache can reduce this to zero',
  },
  'ticker-detail': {
    expected: { browserRequests: 1, functionInvocations: 1, providerAcquisitions: 4 },
    ceiling: { browserRequests: 1, functionInvocations: 1, providerAcquisitions: 4 },
    providerHttpAttemptCeiling: 9,
    fixture: 'one consolidated detail request: options, daily price, intraday price, and volatility history',
  },
  'expiration-change': {
    expected: { browserRequests: 1, functionInvocations: 1, providerAcquisitions: 1 },
    ceiling: { browserRequests: 1, functionInvocations: 1, providerAcquisitions: 1 },
    providerHttpAttemptCeiling: 6,
    fixture: 'one explicit option-chain expiration',
  },
  'option-drawer': {
    expected: { browserRequests: 0, functionInvocations: 0, providerAcquisitions: 0 },
    ceiling: { browserRequests: 0, functionInvocations: 0, providerAcquisitions: 0 },
    providerHttpAttemptCeiling: 0,
    fixture: 'calculator and quote-basis interactions use the selected row',
  },
  'etf-pulse': {
    expected: { browserRequests: 1, functionInvocations: 1, providerAcquisitions: 44 },
    ceiling: { browserRequests: 1, functionInvocations: 1, providerAcquisitions: 44 },
    providerHttpAttemptCeiling: 44,
    fixture: 'one aggregate dataset with 44 cold history acquisitions',
  },
};

export function assertWithinRequestBudget(workflow: RequestBudgetWorkflow, observed: RequestBudgetCounts): void {
  const budget = REQUEST_BUDGET_LEDGER[workflow].ceiling;
  (Object.keys(budget) as Array<keyof RequestBudgetCounts>).forEach(metric => {
    if (!Number.isFinite(observed[metric]) || observed[metric] < 0 || observed[metric] > budget[metric]) {
      throw new Error(`${workflow} ${metric} request budget exceeded: ${observed[metric]} > ${budget[metric]}`);
    }
  });
}

export function failedScreenerRetryBudget(failedBatchCount: number): RequestBudgetCounts {
  const batches = Math.max(0, Math.min(14, Math.floor(failedBatchCount)));
  return { browserRequests: batches, functionInvocations: batches, providerAcquisitions: batches * 9 };
}

export function uniqueChainRefreshBudget(tickerCount: number, uniqueChainCount: number): RequestBudgetCounts {
  const tickers = Math.max(0, Math.floor(tickerCount));
  const chains = Math.max(0, Math.floor(uniqueChainCount));
  const priceBatches = tickers === 0 ? 0 : Math.ceil(tickers / 20);
  return {
    browserRequests: (tickers === 0 ? 0 : 1) + chains,
    functionInvocations: (tickers === 0 ? 0 : 1) + chains,
    providerAcquisitions: priceBatches + chains,
  };
}
