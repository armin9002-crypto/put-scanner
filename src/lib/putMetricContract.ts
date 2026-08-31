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
  entryNominalYield: {
    label: 'Entry NY',
    formula: 'net sold price ÷ strike',
    denominator: 'gross secured cash',
  },
  entryAnnualizedYield: {
    label: 'Entry AY',
    formula: 'Entry NY × 365 ÷ original DTE',
    denominator: 'gross secured cash',
  },
  currentNominalYield: {
    label: 'Current NY',
    formula: 'selected current mark ÷ strike',
    denominator: 'gross secured cash',
  },
  currentAnnualizedYield: {
    label: 'Current AY',
    formula: 'Current NY × 365 ÷ remaining DTE',
    denominator: 'gross secured cash',
  },
  annualizedRemainingPremiumOnCurrentNetRisk: {
    label: 'Remaining AY to Maturity',
    formula: 'current buyback cost ÷ (gross secured cash − current buyback cost) × 365 ÷ remaining DTE',
    denominator: 'current net maximum-loss capital',
  },
} as const;
