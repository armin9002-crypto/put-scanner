import { compareRecommendationCandidates } from './ranking.ts';
import type { CandidateVerdict, RecommendationBand, RecommendationCandidate, RecommendationRun, UnderlyingAssessment } from './types.ts';

export type RecommendationBoardSort = 'actionability' | 'ticker' | 'setup';

export interface RecommendationBoardRow {
  underlying: UnderlyingAssessment;
  candidate: RecommendationCandidate | null;
  verdict: CandidateVerdict;
  hardFailed: boolean;
}

const SETUP_RANK: Record<RecommendationBand, number> = { STRONG: 0, GOOD: 1, MIXED: 2, WEAK: 3 };

export function recommendationRepresentativeCandidate(run: RecommendationRun, ticker: string): RecommendationCandidate | null {
  let representative: RecommendationCandidate | null = null;
  for (const candidate of run.candidates) {
    if (candidate.ticker !== ticker) continue;
    if (!representative || compareRecommendationCandidates(candidate, representative) < 0) representative = candidate;
  }
  return representative;
}

export function buildRecommendationBoardRows(run: RecommendationRun, sort: RecommendationBoardSort): RecommendationBoardRow[] {
  const representativeByTicker = new Map<string, RecommendationCandidate>();
  run.candidates.forEach(candidate => {
    const current = representativeByTicker.get(candidate.ticker);
    if (!current || compareRecommendationCandidates(candidate, current) < 0) representativeByTicker.set(candidate.ticker, candidate);
  });
  const rows = run.underlyingAssessments.map(underlying => {
    const candidate = representativeByTicker.get(underlying.ticker) ?? null;
    return {
      underlying,
      candidate,
      verdict: candidate?.verdict ?? 'PASS',
      hardFailed: underlying.qualification === 'HARD_FAIL',
    } satisfies RecommendationBoardRow;
  });
  return rows.sort((left, right) => {
    if (sort === 'ticker') return left.underlying.ticker.localeCompare(right.underlying.ticker);
    if (sort === 'setup') {
      return SETUP_RANK[left.underlying.setup] - SETUP_RANK[right.underlying.setup]
        || left.underlying.ticker.localeCompare(right.underlying.ticker);
    }
    if (!left.candidate && !right.candidate) return left.underlying.ticker.localeCompare(right.underlying.ticker);
    if (!left.candidate) return 1;
    if (!right.candidate) return -1;
    return compareRecommendationCandidates(left.candidate, right.candidate)
      || left.underlying.ticker.localeCompare(right.underlying.ticker);
  });
}
