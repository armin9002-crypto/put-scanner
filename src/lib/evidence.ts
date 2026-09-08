import type { MarketDataRequestMeta } from './marketDataRequest.ts';
import type { OptionChainMeta } from './types.ts';

export type RunCoverageState = 'updating' | 'complete' | 'partial' | 'failed';
export type EvidenceFreshness = 'current' | 'cached-current' | 'retained-stale' | 'unavailable';
export type EvidenceSource = 'memory' | 'persistent' | 'network' | 'stale-fallback' | 'snapshot' | 'unknown';

export interface EvidenceProvenance {
  observedAt: number | null;
  marketDataThrough?: number | null;
  cachedAt?: number | null;
  source: EvidenceSource;
  retentionReason?: string | null;
}

export interface RunCoverage {
  state: RunCoverageState;
  requested: number;
  succeeded: number;
  failed: number;
  unit: string;
}

export type ProgressState =
  | { kind: 'indeterminate'; stage: string }
  | { kind: 'determinate'; stage: string; unit: string; completed: number; total: number };

export function evidenceFreshnessFromRequestMeta(meta: Pick<MarketDataRequestMeta, 'source' | 'staleFallbackUsed'>): EvidenceFreshness {
  if (meta.staleFallbackUsed || meta.source === 'stale-fallback') return 'retained-stale';
  return meta.source === 'network' ? 'current' : 'cached-current';
}

export function evidenceFreshnessFromChainMeta(meta: Pick<OptionChainMeta, 'source' | 'staleFallbackUsed'> | null | undefined): EvidenceFreshness {
  if (!meta) return 'unavailable';
  if (meta.staleFallbackUsed === true || meta.source === 'stale') return 'retained-stale';
  return meta.source === 'network' || meta.source === 'fresh' ? 'current' : 'cached-current';
}

export function provenanceFromRequestMeta(meta: Pick<MarketDataRequestMeta, 'source' | 'fetchedAt' | 'staleFallbackUsed'> & { cachedAt?: number | null }, retentionReason?: string | null): EvidenceProvenance {
  return {
    observedAt: Number.isFinite(meta.fetchedAt) ? meta.fetchedAt : null,
    cachedAt: meta.cachedAt ?? null,
    source: meta.source,
    retentionReason: retentionReason ?? (meta.staleFallbackUsed ? 'Current acquisition failed; prior trusted evidence was retained.' : null),
  };
}

export function coverageState(requested: number, succeeded: number, failed: number, updating = false): RunCoverageState {
  if (updating) return 'updating';
  if (requested <= 0) return failed > 0 ? 'failed' : 'complete';
  if (succeeded <= 0 && failed > 0) return 'failed';
  if (failed > 0 || succeeded < requested) return 'partial';
  return 'complete';
}

export function indeterminateProgress(stage: string): ProgressState {
  return { kind: 'indeterminate', stage };
}

export function determinateProgress(stage: string, unit: string, completed: number, total: number): ProgressState {
  return { kind: 'determinate', stage, unit, completed: Math.max(0, completed), total: Math.max(0, total) };
}
