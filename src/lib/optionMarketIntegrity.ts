import type {
  OptionChainIntegrity,
  OptionContract,
  OptionIntegrityReasonCode,
  OptionIntegrityStatus,
} from './types.ts';

export const OPTION_INTEGRITY_TOLERANCE = 0.011;
const WIDE_MARKET_RATIO = 1.5;
const PERVASIVE_INVALID_RATIO = 0.8;

interface MutableAssessment {
  status: OptionIntegrityStatus;
  reasons: Set<OptionIntegrityReasonCode>;
}

function finitePositive(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function raise(assessments: MutableAssessment[], index: number, status: Exclude<OptionIntegrityStatus, 'clean'>, reason: OptionIntegrityReasonCode): void {
  const target = assessments[index];
  target.reasons.add(reason);
  if (status === 'invalid' || target.status === 'clean') target.status = status;
}

export function parseYahooOptionSymbol(symbol: string | null | undefined): { expiration: number | null; type: 'C' | 'P' | null; strike: number | null } {
  const match = symbol?.match(/(\d{6})([CP])(\d{8})$/);
  if (!match) return { expiration: null, type: null, strike: null };
  const [, yymmdd, type, strikeRaw] = match;
  return {
    expiration: Math.floor(Date.UTC(2000 + Number(yymmdd.slice(0, 2)), Number(yymmdd.slice(2, 4)) - 1, Number(yymmdd.slice(4, 6))) / 1_000),
    type: type as 'C' | 'P',
    strike: Number(strikeRaw) / 1_000,
  };
}

/** Assesses a same-expiration put surface in O(n log n) time and O(n) space. */
export function assessPutOptionSurface(
  contracts: readonly OptionContract[],
  context: { requestedExpiration?: number | null; returnedExpiration?: number | null } = {},
): { puts: OptionContract[]; integrity: OptionChainIntegrity } {
  const indexed = contracts
    .map((contract, originalIndex) => ({ contract, originalIndex }))
    .filter(item => Number.isFinite(item.contract.strike) && item.contract.strike > 0)
    .sort((left, right) => left.contract.strike - right.contract.strike || left.originalIndex - right.originalIndex);
  const assessments: MutableAssessment[] = contracts.map(() => ({ status: 'clean', reasons: new Set() }));
  const chainReasons = new Set<OptionIntegrityReasonCode>();
  const expectedExpiration = context.requestedExpiration ?? context.returnedExpiration ?? null;

  if (context.requestedExpiration != null && context.returnedExpiration != null && context.requestedExpiration !== context.returnedExpiration) {
    chainReasons.add('CHAIN_EXPIRATION_MISMATCH');
    assessments.forEach((_, index) => raise(assessments, index, 'invalid', 'CHAIN_EXPIRATION_MISMATCH'));
  }

  indexed.forEach(({ contract, originalIndex }) => {
    const { bid, ask } = contract;
    if (finitePositive(bid) && finitePositive(ask) && bid > ask + OPTION_INTEGRITY_TOLERANCE) {
      raise(assessments, originalIndex, 'invalid', 'CROSSED_MARKET');
    } else if (finitePositive(bid) && finitePositive(ask) && ask >= bid) {
      const midpoint = (bid + ask) / 2;
      if (midpoint > 0 && (ask - bid) / midpoint > WIDE_MARKET_RATIO) raise(assessments, originalIndex, 'degraded', 'VERY_WIDE_MARKET');
    }
    const identity = parseYahooOptionSymbol(contract.contractSymbol);
    if (contract.contractSymbol && identity.type == null) raise(assessments, originalIndex, 'invalid', 'CONTRACT_IDENTITY_MISMATCH');
    if (identity.type != null && identity.type !== 'P') raise(assessments, originalIndex, 'invalid', 'CONTRACT_IDENTITY_MISMATCH');
    if ((identity.expiration != null && expectedExpiration != null && identity.expiration !== expectedExpiration)
      || (identity.strike != null && Math.abs(identity.strike - contract.strike) > 0.001)) {
      raise(assessments, originalIndex, 'invalid', 'CONTRACT_IDENTITY_MISMATCH');
    }
  });

  let minimumHigherAsk = Number.POSITIVE_INFINITY;
  let minimumHigherAskIndex = -1;
  for (let sortedIndex = indexed.length - 1; sortedIndex >= 0; sortedIndex -= 1) {
    const { contract, originalIndex } = indexed[sortedIndex];
    if (finitePositive(contract.bid) && minimumHigherAskIndex >= 0 && contract.bid > minimumHigherAsk + OPTION_INTEGRITY_TOLERANCE) {
      raise(assessments, originalIndex, 'invalid', 'PUT_EXECUTABLE_MONOTONICITY');
      raise(assessments, minimumHigherAskIndex, 'invalid', 'PUT_EXECUTABLE_MONOTONICITY');
    }
    if (finitePositive(contract.ask) && contract.ask < minimumHigherAsk) {
      minimumHigherAsk = contract.ask;
      minimumHigherAskIndex = originalIndex;
    }
  }

  let minimumAskMinusStrike = Number.POSITIVE_INFINITY;
  let minimumAskMinusStrikeIndex = -1;
  indexed.forEach(({ contract, originalIndex }) => {
    if (finitePositive(contract.bid) && minimumAskMinusStrikeIndex >= 0
      && contract.bid - contract.strike > minimumAskMinusStrike + OPTION_INTEGRITY_TOLERANCE) {
      raise(assessments, originalIndex, 'invalid', 'PUT_VERTICAL_MAX_VALUE');
      raise(assessments, minimumAskMinusStrikeIndex, 'invalid', 'PUT_VERTICAL_MAX_VALUE');
    }
    if (finitePositive(contract.ask) && contract.ask - contract.strike < minimumAskMinusStrike) {
      minimumAskMinusStrike = contract.ask - contract.strike;
      minimumAskMinusStrikeIndex = originalIndex;
    }
  });

  const puts = contracts.map((contract, index) => ({ ...contract, integrity: { status: assessments[index].status, reasonCodes: [...assessments[index].reasons] } }));
  const invalidCount = assessments.filter(item => item.status === 'invalid').length;
  const degradedCount = assessments.filter(item => item.status === 'degraded').length;
  const cleanCount = assessments.length - invalidCount - degradedCount;
  assessments.forEach(item => item.reasons.forEach(reason => chainReasons.add(reason)));
  const pervasive = contracts.length > 0 && invalidCount >= 3 && invalidCount / contracts.length >= PERVASIVE_INVALID_RATIO;
  if (pervasive) chainReasons.add('PERVASIVE_CONTRACT_FAILURE');
  const status: OptionIntegrityStatus = chainReasons.has('CHAIN_EXPIRATION_MISMATCH') || pervasive || (contracts.length > 0 && invalidCount === contracts.length)
    ? 'invalid'
    : invalidCount > 0 || degradedCount > 0 ? 'degraded' : 'clean';

  return { puts, integrity: { status, reasonCodes: [...chainReasons], contractCount: contracts.length, cleanCount, degradedCount, invalidCount } };
}

export function isOptionContractIntegrityInvalid(contract: Pick<OptionContract, 'integrity'> | null | undefined): boolean {
  return contract?.integrity?.status === 'invalid';
}

export function trustedOptionPrice(contract: Pick<OptionContract, 'integrity' | 'bid' | 'ask' | 'last'>, field: 'bid' | 'ask' | 'last'): number | null {
  const value = contract[field];
  return !isOptionContractIntegrityInvalid(contract) && typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}
