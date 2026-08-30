export const PUT_METRIC_CONTRACT = {
  premiumPerContract: {
    label: 'Premium per Contract',
    formula: 'option price × 100',
    denominator: null,
  },
  grossSecuredCash: {
    label: 'Gross Risk',
    formula: 'strike × 100 × contracts',
    denominator: null,
  },
  netMaximumLossCapital: {
    label: 'Net Risk',
    formula: 'gross secured cash − total premium',
    denominator: null,
  },
  securedCashYield: {
    label: 'Nominal Yield',
    formula: 'premium ÷ gross strike cash',
    denominator: 'gross secured cash',
  },
  annualizedSecuredCashYield: {
    label: 'Annualized Yield',
    formula: 'secured-cash yield × 365 ÷ DTE',
    denominator: 'gross secured cash',
  },
  entryNetRiskReturn: {
    label: 'Entry NY',
    formula: 'premium collected ÷ entry net maximum-loss capital',
    denominator: 'entry net maximum-loss capital',
  },
  annualizedEntryNetRiskReturn: {
    label: 'Entry AY',
    formula: 'entry net-risk return × 365 ÷ original DTE',
    denominator: 'entry net maximum-loss capital',
  },
  remainingLiabilityOnEntryNetRisk: {
    label: 'Current NY',
    formula: 'current buyback cost ÷ entry net maximum-loss capital',
    denominator: 'entry net maximum-loss capital',
  },
  annualizedRemainingLiabilityOnEntryNetRisk: {
    label: 'Current AY',
    formula: 'remaining-liability ratio × 365 ÷ remaining DTE',
    denominator: 'entry net maximum-loss capital',
  },
  annualizedRemainingPremiumOnCurrentNetRisk: {
    label: 'Remaining AY to Maturity',
    formula: 'current buyback cost ÷ (gross secured cash − current buyback cost) × 365 ÷ remaining DTE',
    denominator: 'current net maximum-loss capital',
  },
} as const;
