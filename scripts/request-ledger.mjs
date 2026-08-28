import { REQUEST_BUDGET_LEDGER } from '../src/lib/requestBudgets.ts';

const rows = Object.entries(REQUEST_BUDGET_LEDGER).map(([workflow, entry]) => ({
  workflow,
  browser: `${entry.expected.browserRequests}/${entry.ceiling.browserRequests}`,
  function: `${entry.expected.functionInvocations}/${entry.ceiling.functionInvocations}`,
  providerAcquisition: `${entry.expected.providerAcquisitions}/${entry.ceiling.providerAcquisitions}`,
  providerHttpMax: entry.providerHttpAttemptCeiling,
  fixture: entry.fixture,
}));

console.log('Put Scanner request ledger (expected/regression ceiling)');
console.table(rows);
