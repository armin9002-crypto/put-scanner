export type RequestBudgetWorkflow =
  | 'scanner-load'
  | 'screener-entry'
  | 'screener-full-scan'
  | 'watchlist-refresh'
  | 'portfolio-refresh'
  | 'ticker-detail'
  | 'expiration-change'
  | 'option-drawer'
  | 'etf-pulse';

export interface RequestBudget {
  browserRequests: number;
  vercelResponses: number;
  providerAttempts: number;
}

export const REQUEST_BUDGETS: Record<RequestBudgetWorkflow, RequestBudget> = {
  'scanner-load': { browserRequests: 6, vercelResponses: 6, providerAttempts: 8 },
  'screener-entry': { browserRequests: 2, vercelResponses: 2, providerAttempts: 8 },
  'screener-full-scan': { browserRequests: 14, vercelResponses: 14, providerAttempts: 126 },
  'watchlist-refresh': { browserRequests: 2, vercelResponses: 2, providerAttempts: 8 },
  'portfolio-refresh': { browserRequests: 3, vercelResponses: 3, providerAttempts: 12 },
  'ticker-detail': { browserRequests: 1, vercelResponses: 1, providerAttempts: 4 },
  'expiration-change': { browserRequests: 1, vercelResponses: 1, providerAttempts: 3 },
  'option-drawer': { browserRequests: 0, vercelResponses: 0, providerAttempts: 0 },
  'etf-pulse': { browserRequests: 1, vercelResponses: 1, providerAttempts: 44 },
};

export function assertWithinRequestBudget(workflow: RequestBudgetWorkflow, observed: RequestBudget): void {
  const budget = REQUEST_BUDGETS[workflow];
  (Object.keys(budget) as Array<keyof RequestBudget>).forEach(metric => {
    if (!Number.isFinite(observed[metric]) || observed[metric] < 0 || observed[metric] > budget[metric]) {
      throw new Error(`${workflow} ${metric} request budget exceeded: ${observed[metric]} > ${budget[metric]}`);
    }
  });
}

export function failedScreenerRetryBudget(failedBatchCount: number): RequestBudget {
  const batches = Math.max(0, Math.min(14, Math.floor(failedBatchCount)));
  return { browserRequests: batches, vercelResponses: batches, providerAttempts: batches * 9 };
}

export function uniqueChainRefreshBudget(tickerCount: number, uniqueChainCount: number): RequestBudget {
  const tickers = Math.max(0, Math.floor(tickerCount));
  const chains = Math.max(0, Math.floor(uniqueChainCount));
  const priceBatches = tickers === 0 ? 0 : Math.ceil(tickers / 20);
  return {
    browserRequests: (tickers === 0 && chains === 0 ? 0 : 1) + chains,
    vercelResponses: (tickers === 0 && chains === 0 ? 0 : 1) + chains,
    providerAttempts: priceBatches + chains,
  };
}
