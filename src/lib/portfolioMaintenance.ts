import { isExpiredUnresolvedOpenTrade } from './portfolioExpirationArchive.ts';
import { isFiniteNumber } from './optionMetrics.ts';
import { isValidEntryIv, recoverEntryDeltaFromStoredSnapshot, recoverEntryIvFromStoredSnapshot } from './portfolioEntryDelta.ts';
import type { PortfolioTrade } from './portfolioStorage.ts';

export interface PortfolioMaintenanceAssessment {
  expiredLifecycleReview: PortfolioTrade[];
  expirationPricePending: PortfolioTrade[];
  missingEntryVix: PortfolioTrade[];
  recoverableEntryDelta: PortfolioTrade[];
  historicalEntryDeltaUnavailable: PortfolioTrade[];
  recoverableEntryIv: PortfolioTrade[];
  historicalEntryIvUnavailable: PortfolioTrade[];
}

export function assessPortfolioMaintenance(trades: PortfolioTrade[], now = new Date()): PortfolioMaintenanceAssessment {
  const missingEntryDelta = trades.filter(trade => !isFiniteNumber(trade.entryDelta));
  const missingEntryIv = trades.filter(trade => !isValidEntryIv(trade.entryIv));
  return {
    expiredLifecycleReview: trades.filter(trade => isExpiredUnresolvedOpenTrade(trade, now)),
    expirationPricePending: trades.filter(trade => trade.status === 'expired_price_pending'),
    missingEntryVix: trades.filter(trade => !isFiniteNumber(trade.entryVixClose)),
    recoverableEntryDelta: missingEntryDelta.filter(trade => recoverEntryDeltaFromStoredSnapshot(trade) != null),
    historicalEntryDeltaUnavailable: missingEntryDelta.filter(trade => recoverEntryDeltaFromStoredSnapshot(trade) == null),
    recoverableEntryIv: missingEntryIv.filter(trade => recoverEntryIvFromStoredSnapshot(trade) != null),
    historicalEntryIvUnavailable: missingEntryIv.filter(trade => recoverEntryIvFromStoredSnapshot(trade) == null),
  };
}
