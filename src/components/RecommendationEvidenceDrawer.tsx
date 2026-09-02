import { X } from 'lucide-react';
import { formatCurrency, formatNumber, formatPercentPoints } from '../lib/format.ts';
import { reasonCopy } from '../lib/recommendations/explanations.ts';
import type { RecommendationCandidate, RecommendationRun } from '../lib/recommendations/types.ts';
import { useResponsiveMode } from '../lib/responsive.ts';
import MobileBottomSheet from './mobile/MobileBottomSheet.tsx';

function valueOrDash(value: number | null | undefined, decimals = 2): string {
  return value == null || !Number.isFinite(value) ? '—' : value.toFixed(decimals);
}

function EvidenceContent({ candidate, run }: { candidate: RecommendationCandidate; run: RecommendationRun }) {
  const range = candidate.pricing.indicativeRange;
  return (
    <div className="recommendation-evidence-content space-y-3">
      <section className="recommendation-evidence-section">
        <div className="recommendation-evidence-section__title">Decision basis</div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
          <EvidenceMetric label="Verdict" value={candidate.verdict} />
          <EvidenceMetric label="Provenance" value={candidate.pricing.provenance.replace(/_/g, ' ')} />
          <EvidenceMetric label="Pricing" value={candidate.pricing.confidence} />
          <EvidenceMetric label="Actionability" value={candidate.pricing.actionability} />
          <EvidenceMetric label="Evidence" value={candidate.evidenceQuality} />
          <EvidenceMetric label="Robustness" value={candidate.robustness.classification} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <KeyFigure label="Bid" value={formatCurrency(candidate.pricing.directBid)} />
          <KeyFigure label="Ask" value={formatCurrency(candidate.pricing.directAsk)} />
          <KeyFigure label="Indicative Credit" value={range ? `${formatCurrency(range.low)}–${formatCurrency(range.high)}` : '—'} />
          <KeyFigure label="Attractive At" value={candidate.minimumAttractiveCredit.credit == null ? 'Unavailable' : `≥ ${formatCurrency(candidate.minimumAttractiveCredit.credit)}`} />
        </div>
        <p className="mt-2 text-[11px] leading-5" style={{ color: 'var(--text-muted)' }}>
          Attractive At is a policy hurdle, not fair value or an expected execution price. A missing bid is never replaced.
        </p>
      </section>

      <section className="recommendation-evidence-section">
        <div className="recommendation-evidence-section__title">Same-expiration price surface</div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-[11px] font-mono tabular-nums">
            <thead><tr>{['Role', 'Strike', 'Bid', 'Ask', 'Last', 'Δ', 'IV', 'Spread', 'OI', 'Vol'].map(label => <th key={label} className="px-1.5 py-1 text-right first:text-left">{label}</th>)}</tr></thead>
            <tbody>
              {candidate.pricing.surface.neighbors.map(neighbor => (
                <tr key={`${neighbor.side}-${neighbor.strike}`} data-candidate={neighbor.side === 'CANDIDATE' ? 'true' : undefined}>
                  <td className="px-1.5 py-1 text-left">{neighbor.side}</td>
                  <td className="px-1.5 py-1 text-right">{formatCurrency(neighbor.strike)}</td>
                  <td className="px-1.5 py-1 text-right">{formatCurrency(neighbor.bid)}</td>
                  <td className="px-1.5 py-1 text-right">{formatCurrency(neighbor.ask)}</td>
                  <td className="px-1.5 py-1 text-right">{formatCurrency(neighbor.last)}</td>
                  <td className="px-1.5 py-1 text-right">{valueOrDash(neighbor.delta)}</td>
                  <td className="px-1.5 py-1 text-right">{neighbor.iv == null ? '—' : formatPercentPoints(neighbor.iv, 1)}</td>
                  <td className="px-1.5 py-1 text-right">{neighbor.spreadPercent == null ? '—' : `${(neighbor.spreadPercent * 100).toFixed(0)}%`}</td>
                  <td className="px-1.5 py-1 text-right">{formatNumber(neighbor.openInterest)}</td>
                  <td className="px-1.5 py-1 text-right">{formatNumber(neighbor.volume)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
          <AuditTag label={`Bracket ${candidate.pricing.surface.bracketed ? 'yes' : 'no'}`} />
          <AuditTag label={`Monotonic ${candidate.pricing.surface.monotonic ? 'yes' : 'no'}`} />
          <AuditTag label={`Coherent ${candidate.pricing.surface.coherent ? 'yes' : 'no'}`} />
        </div>
        <div className="mt-2 space-y-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {[...new Set(candidate.pricing.surface.reasonCodes)].map(code => <div key={code}>{reasonCopy(code)}</div>)}
        </div>
      </section>

      <section className="recommendation-evidence-section">
        <div className="recommendation-evidence-section__title">Underlying and market context</div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          {candidate.underlying.evidence.map(item => <EvidenceMetric key={item.label} label={item.label} value={item.value} />)}
        </div>
        <p className="mt-2 text-xs leading-5" style={{ color: 'var(--text-secondary)' }}>
          {run.market.regime.label} · {run.market.posture.label} · {run.market.regime.putSellingImplication}
        </p>
      </section>

      <section className="recommendation-evidence-section">
        <div className="recommendation-evidence-section__title">Policy checks and skeptic</div>
        <div className="space-y-1">
          {candidate.policyChecks.map((check, index) => (
            <div key={`${check.code}-${index}`} className="grid grid-cols-[4.5rem_1fr] gap-2 border-b py-1 text-[11px] last:border-0" style={{ borderColor: 'var(--border)' }}>
              <span style={{ color: check.passed ? 'var(--text-muted)' : 'var(--yellow)' }}>{check.passed ? 'CLEAR' : 'NOT CLEAR'}</span>
              <span style={{ color: 'var(--text-secondary)' }}>{check.detail}</span>
            </div>
          ))}
        </div>
        <div className="mt-2 rounded-lg p-2.5 text-xs" style={{ backgroundColor: 'var(--surface-alt)', border: '1px solid var(--border)' }}>
          <span className="font-semibold" style={{ color: 'var(--text)' }}>Skeptic: </span>
          <span style={{ color: 'var(--text-muted)' }}>{candidate.skeptic.message}</span>
        </div>
      </section>

      <section className="recommendation-evidence-section">
        <div className="recommendation-evidence-section__title">Dominance and pairwise evidence</div>
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <KeyFigure label="Dominates" value={candidate.dominates.length ? candidate.dominates.join(', ') : 'None'} />
          <KeyFigure label="Dominated By" value={candidate.dominatedBy.length ? candidate.dominatedBy.join(', ') : 'None'} />
        </div>
        {candidate.comparisons.length > 0 ? (
          <div className="mt-2 space-y-1.5">
            {candidate.comparisons.map(comparison => (
              <div key={comparison.otherCandidateId} className="rounded-lg p-2 text-[11px]" style={{ backgroundColor: 'var(--surface-alt)' }}>
                <div className="font-mono font-semibold" style={{ color: 'var(--text)' }}>{comparison.relationship.replace(/_/g, ' ')} · {comparison.otherCandidateId}</div>
                <div className="mt-0.5 uppercase tracking-wide" style={{ color: 'var(--text-dim)' }}>{comparison.reasonCodes.map(code => code.replace(/_/g, ' ')).join(' · ')}</div>
                <div className="mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  {[...comparison.advantages.map(item => `+ ${item}`), ...comparison.disadvantages.map(item => `− ${item}`)].join(' · ') || 'No material difference.'}
                </div>
              </div>
            ))}
          </div>
        ) : <p className="mt-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>No material finalist comparison was required.</p>}
      </section>
    </div>
  );
}

function EvidenceMetric({ label, value }: { label: string; value: string }) {
  return <div className="flex min-w-0 items-start justify-between gap-2 border-b py-1" style={{ borderColor: 'var(--border)' }}><span style={{ color: 'var(--text-muted)' }}>{label}</span><span className="text-right font-mono" style={{ color: 'var(--text)' }}>{value}</span></div>;
}

function KeyFigure({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 rounded-lg p-2" style={{ backgroundColor: 'var(--surface-alt)', border: '1px solid var(--border)' }}><div className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>{label}</div><div className="mt-0.5 break-words font-mono text-xs font-semibold tabular-nums" style={{ color: 'var(--text)' }}>{value}</div></div>;
}

function AuditTag({ label }: { label: string }) {
  return <span className="rounded px-1.5 py-0.5" style={{ color: 'var(--text-muted)', backgroundColor: 'var(--surface-alt)', border: '1px solid var(--border)' }}>{label}</span>;
}

export default function RecommendationEvidenceDrawer({
  candidate,
  run,
  onClose,
  onOpenContract,
  onToggleWatch,
  watched,
  onViewChain,
}: {
  candidate: RecommendationCandidate;
  run: RecommendationRun;
  onClose: () => void;
  onOpenContract: () => void;
  onToggleWatch: () => void;
  watched: boolean;
  onViewChain: () => void;
}) {
  const { isPhone } = useResponsiveMode();
  const title = `${candidate.ticker} ${formatCurrency(candidate.strike)} Put`;
  const actions = <div className="grid grid-cols-3 gap-2"><button type="button" className="button-secondary min-h-10 rounded-lg px-2 text-xs font-semibold" onClick={onOpenContract}>Open Contract</button><button type="button" className="button-secondary min-h-10 rounded-lg px-2 text-xs font-semibold" onClick={onToggleWatch}>{watched ? 'Watching' : 'Watch'}</button><button type="button" className="button-primary min-h-10 rounded-lg px-2 text-xs font-semibold" onClick={onViewChain}>View Chain</button></div>;

  if (isPhone) {
    return <MobileBottomSheet title={title} description={`${candidate.expirationLabel} · ${candidate.verdict}`} onClose={onClose} footer={actions} className="recommendation-evidence-sheet"><EvidenceContent candidate={candidate} run={run} /></MobileBottomSheet>;
  }
  return (
    <div className="fixed inset-0 z-[90] flex justify-end" role="dialog" aria-modal="true" aria-label={`${title} recommendation evidence`}>
      <button type="button" className="absolute inset-0 bg-black/60" aria-label="Close recommendation evidence" onClick={onClose} />
      <aside className="recommendation-evidence-drawer overlay-panel relative z-10 flex h-full w-full max-w-[720px] flex-col" style={{ backgroundColor: 'var(--bg)', borderLeft: '1px solid var(--border)' }}>
        <header className="flex flex-none items-start justify-between gap-3 border-b px-5 py-4" style={{ borderColor: 'var(--border)' }}>
          <div><div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>Recommendation evidence · {candidate.verdict}</div><h2 className="mt-1 text-lg font-semibold" style={{ color: 'var(--text)' }}>{title}</h2><p className="text-xs" style={{ color: 'var(--text-muted)' }}>{candidate.expirationLabel}</p></div>
          <button type="button" onClick={onClose} className="pressable flex h-10 w-10 items-center justify-center rounded-full" style={{ backgroundColor: 'var(--surface-alt)', color: 'var(--text-muted)' }} aria-label="Close recommendation evidence"><X className="h-5 w-5" /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4"><EvidenceContent candidate={candidate} run={run} /></div>
        <footer className="flex-none border-t px-5 py-3" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>{actions}</footer>
      </aside>
    </div>
  );
}
