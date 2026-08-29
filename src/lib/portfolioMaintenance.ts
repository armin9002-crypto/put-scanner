import { isExpiredUnresolvedOpenTrade } from './portfolioExpirationArchive.ts';
import { isFiniteNumber } from './optionMetrics.ts';
import { recoverEntryDeltaFromStoredSnapshot } from './portfolioEntryDelta.ts';
import type { PortfolioTrade } from './portfolioStorage.ts';

export interface PortfolioMaintenanceAssessment {
  expiredLifecycleReview: PortfolioTrade[];
  expirationPricePending: PortfolioTrade[];
  missingEntryVix: PortfolioTrade[];
  recoverableEntryDelta: PortfolioTrade[];
  historicalEntryDeltaUnavailable: PortfolioTrade[];
}

export function assessPortfolioMaintenance(trades: PortfolioTrade[], now = new Date()): PortfolioMaintenanceAssessment {
  const missingEntryDelta = trades.filter(trade => !isFiniteNumber(trade.entryDelta));
  return {
    expiredLifecycleReview: trades.filter(trade => isExpiredUnresolvedOpenTrade(trade, now)),
    expirationPricePending: trades.filter(trade => trade.status === 'expired_price_pending'),
    missingEntryVix: trades.filter(trade => !isFiniteNumber(trade.entryVixClose)),
    recoverableEntryDelta: missingEntryDelta.filter(trade => recoverEntryDeltaFromStoredSnapshot(trade) != null),
    historicalEntryDeltaUnavailable: missingEntryDelta.filter(trade => recoverEntryDeltaFromStoredSnapshot(trade) == null),
  };
}
