export type RegimeLabel = 'Complacent Risk-On' | 'Healthy Risk-On' | 'Healthy Pullback' | 'Choppy / Elevated Vol' | 'Risk-Off' | 'Oversold Panic' | 'Mixed / No Edge';
export type RegimeConfidence = 'Low' | 'Medium' | 'High';
export type PostureLabel = 'Selective / Patient' | 'Balanced' | 'Defensive' | 'Very Defensive' | 'Opportunistic';

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
