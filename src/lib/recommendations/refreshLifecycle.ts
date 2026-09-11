import type { RecommendationRefreshProgress } from './acquisition.ts';

export type RecommendationRefreshAttemptStatus = 'idle' | 'loading' | 'cancelled' | 'error';
export type RecommendationRefreshErrorKind = 'acquisition' | 'engine' | 'unknown';

export interface RecommendationRefreshAttemptIdle {
  status: 'idle';
  progress: null;
}

export interface RecommendationRefreshAttemptLoading {
  status: 'loading';
  progress: RecommendationRefreshProgress;
}

export interface RecommendationRefreshAttemptCancelled {
  status: 'cancelled';
  progress: null;
  hadPriorRun: boolean;
}

export interface RecommendationRefreshAttemptError {
  status: 'error';
  progress: null;
  kind: RecommendationRefreshErrorKind;
  hadPriorRun: boolean;
}

export type RecommendationRefreshAttempt =
  | RecommendationRefreshAttemptIdle
  | RecommendationRefreshAttemptLoading
  | RecommendationRefreshAttemptCancelled
  | RecommendationRefreshAttemptError;

export class RecommendationAcquisitionError extends Error {
  readonly kind = 'acquisition' as const;
  readonly causeError: unknown;

  constructor(causeError: unknown) {
    super('Market data acquisition did not complete.');
    this.name = 'RecommendationAcquisitionError';
    this.causeError = causeError;
  }
}

export class RecommendationEngineError extends Error {
  readonly kind = 'engine' as const;
  readonly causeError: unknown;

  constructor(causeError: unknown) {
    super('Deterministic recommendation analysis did not complete.');
    this.name = 'RecommendationEngineError';
    this.causeError = causeError;
  }
}

export function classifyRecommendationRefreshError(error: unknown): RecommendationRefreshErrorKind {
  if (error instanceof RecommendationAcquisitionError) return 'acquisition';
  if (error instanceof RecommendationEngineError) return 'engine';
  return 'unknown';
}

export function recommendationRefreshErrorTitle(kind: RecommendationRefreshErrorKind): string {
  if (kind === 'acquisition') return 'Market data acquisition failed.';
  if (kind === 'engine') return 'Recommendation analysis failed.';
  return 'Refresh failed.';
}

export function recommendationRefreshErrorDetail(kind: RecommendationRefreshErrorKind): string {
  if (kind === 'acquisition') return 'The current refresh could not acquire enough market data to complete.';
  if (kind === 'engine') return 'Market data was acquired, but deterministic decision processing did not complete.';
  return 'The current refresh did not complete.';
}
