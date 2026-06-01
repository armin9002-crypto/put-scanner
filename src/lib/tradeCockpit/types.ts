import type { EtfPulseRow } from '../etfPulseMetrics';
import type { PortfolioTrade } from '../portfolioStorage';

export type RegimeLabel = 'Complacent Risk-On' | 'Healthy Risk-On' | 'Healthy Pullback' | 'Choppy / Elevated Vol' | 'Risk-Off' | 'Oversold Panic' | 'Mixed / No Edge';
export type RegimeConfidence = 'Low' | 'Medium' | 'High';
export type PostureLabel = 'Selective / Patient' | 'Balanced' | 'Defensive' | 'Very Defensive' | 'Opportunistic';
export type TradeStyle = 'Conservative' | 'Balanced' | 'Aggressive' | 'Speculative';
export type UniverseMode = 'Regime-filtered' | 'Watchlist only' | 'Portfolio tickers only' | 'All ETF universe';
export type CandidateLabel = 'Clean' | 'Healthy Pullback' | 'High Yield / High Risk' | 'Speculative' | 'Avoid' | 'Already Exposed' | 'Illiquid';
export type CandidateBucket = 'Best Clean Setups' | 'Healthy Pullbacks' | 'High Yield / High Risk' | 'Avoid / Falling Knives' | 'Already Exposed' | 'Near Misses';

export interface RegimeAnalysis {
  label: RegimeLabel;
  confidence: RegimeConfidence;
  explanation: string;
  marketRead: string;
  putSellingImplication: string;
  favor: string[];
  avoid: string[];
  drivers: string[];
  warnings: string[];
  stats: {
    spyTrend: string;
    qqqTrend: string;
    breadthAbove50: number | null;
    breadthAbove200: number | null;
    downtrendCount: number;
    oversoldCount: number;
    overboughtCount: number;
    medianThirtyDayReturn: number | null;
    medianRealizedVolatility20: number | null;
    spyRsi: number | null;
    qqqRsi: number | null;
    spyPosition52Week: number | null;
    qqqPosition52Week: number | null;
    vixTrend: string | null;
    vxnTrend: string | null;
    biggestThirtyDayWinners: Array<{ ticker: string; value: number }>;
    biggestThirtyDayLosers: Array<{ ticker: string; value: number }>;
  };
  fetchedAt: number | null;
}

export interface TradePosture {
  label: PostureLabel;
  styleRecommendation: string;
  maxDelta: number;
  minDistanceToStrike: number;
  minDistanceToBreakeven: number;
  dteMin: number;
  dteMax: number;
  liquidityGuidance: string;
  explanation: string;
}

export interface ScanCriteria {
  tradeStyle: TradeStyle;
  universeMode: UniverseMode;
  minDte: number;
  maxDte: number;
  maxDelta: number;
  minDistanceToStrike: number;
  minOpenInterest: number;
  maxSpreadPercent: number;
  maxTickers: number;
  maxExpirationsPerTicker: number;
  maxCandidatesPerTicker: number;
}

export interface TradeCandidate {
  id: string;
  ticker: string;
  expiryTimestamp: number;
  expiryIso: string;
  expiryLabel: string;
  dte: number;
  strike: number;
  bid: number;
  ask: number | null;
  last: number | null;
  delta: number | null;
  currentPrice: number | null;
  distanceToStrike: number | null;
  breakeven: number | null;
  breakevenCushion: number | null;
  nominalYieldBid: number | null;
  annualizedYieldBid: number | null;
  spreadPercent: number | null;
  openInterest: number | null;
  volume: number | null;
  etfTrend: string;
  rsi14: number | null;
  distance50: number | null;
  distance200: number | null;
  recentDrawdown30: number | null;
  realizedVolatility20: number | null;
  opportunityScore: number;
  riskScore: number;
  fitScore: number;
  score: number;
  label: CandidateLabel;
  bucket: CandidateBucket;
  reason: string;
  warnings: string[];
  failedFilters?: string[];
  watchlisted: boolean;
  alreadyExposed: boolean;
}

export interface ScanDiagnostics {
  tickersSelected: number;
  expirationsSelected: number;
  optionChainsRequested: number;
  chainsLoadedFromCache: number;
  chainsFetchedFromNetwork: number;
  rawPutContracts: number;
  otmPuts: number;
  passedDte: number;
  passedBid: number;
  passedDelta: number;
  passedCushion: number;
  passedOpenInterest: number;
  passedSpread: number;
  finalCandidates: number;
  exclusionReasons: Record<string, number>;
}

export interface ScanUsage {
  tickersScanned: number;
  expirationsScanned: number;
  estimatedRequests: number;
  requestsMade: number;
  cacheHits: number;
  failures: Array<{ ticker: string; message: string }>;
}

export interface TradeScanResult {
  criteria: ScanCriteria;
  scannedTickers: string[];
  candidates: TradeCandidate[];
  nearMisses: TradeCandidate[];
  diagnostics: ScanDiagnostics;
  usage: ScanUsage;
  fetchedAt: number;
}

export interface CockpitContext {
  pulseRows: EtfPulseRow[];
  portfolioTrades: PortfolioTrade[];
  watchlistTickers: Set<string>;
}
