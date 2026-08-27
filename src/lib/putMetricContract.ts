export const PUT_METRIC_CONTRACT = {
  premiumPerContract: {
    label: 'Premium per Contract',
    formula: 'option price × 100',
    denominator: null,
  },
  grossSecuredCash: {
    label: 'Gross Secured Cash',
    formula: 'strike × 100 × contracts',
    denominator: null,
  },
  netMaximumLossCapital: {
    label: 'Net Maximum-Loss Capital',
    formula: 'gross secured cash − total premium',
    denominator: null,
  },
  securedCashYield: {
    label: 'Secured-Cash Yield',
    formula: 'premium ÷ gross strike cash',
    denominator: 'gross secured cash',
  },
  annualizedSecuredCashYield: {
    label: 'Annualized Secured-Cash Yield',
    formula: 'secured-cash yield × 365 ÷ DTE',
    denominator: 'gross secured cash',
  },
  entryNetRiskReturn: {
    label: 'Entry Net-Risk Return',
    formula: 'premium collected ÷ entry net maximum-loss capital',
    denominator: 'entry net maximum-loss capital',
  },
  annualizedEntryNetRiskReturn: {
    label: 'Annualized Entry Net-Risk Return',
    formula: 'entry net-risk return × 365 ÷ original DTE',
    denominator: 'entry net maximum-loss capital',
  },
  remainingLiabilityOnEntryNetRisk: {
    label: 'Remaining Liability / Entry Net Risk',
    formula: 'current buyback cost ÷ entry net maximum-loss capital',
    denominator: 'entry net maximum-loss capital',
  },
  annualizedRemainingLiabilityOnEntryNetRisk: {
    label: 'Annualized Remaining Liability / Entry Net Risk',
    formula: 'remaining-liability ratio × 365 ÷ remaining DTE',
    denominator: 'entry net maximum-loss capital',
  },
  annualizedRemainingPremiumOnCurrentNetRisk: {
    label: 'Annualized Remaining Premium / Current Net Risk',
    formula: 'current buyback cost ÷ (gross secured cash − current buyback cost) × 365 ÷ remaining DTE',
    denominator: 'current net maximum-loss capital',
  },
} as const;
