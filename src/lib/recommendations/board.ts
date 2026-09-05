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
  return [...run.candidates]
    .filter(candidate => candidate.ticker === ticker)
    .sort(compareRecommendationCandidates)[0] ?? null;
}

export function buildRecommendationBoardRows(run: RecommendationRun, sort: RecommendationBoardSort): RecommendationBoardRow[] {
  const rows = run.underlyingAssessments.map(underlying => {
    const candidate = recommendationRepresentativeCandidate(run, underlying.ticker);
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
