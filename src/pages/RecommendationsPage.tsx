import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Download, Loader2, RefreshCw, Star } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import ErrorBoundary from '../components/ErrorBoundary.tsx';
import type { OptionDetail } from '../components/OptionDetailDrawer.tsx';
import RecommendationEvidenceDrawer from '../components/RecommendationEvidenceDrawer.tsx';
import { PageHeader, SectionHeader } from '../components/ui/PageHeader.tsx';
import { formatCurrency, formatDateTime, formatPercentPoints } from '../lib/format.ts';
import { createLatestScreenerScanGate } from '../lib/screenerAcquisition.ts';
import { getInMemoryRecommendationRun, publishInMemoryRecommendationRun, refreshRecommendations, type RecommendationRefreshProgress } from '../lib/recommendations/acquisition.ts';
import type { CandidateVerdict, RecommendationBand, RecommendationCandidate, RecommendationClass, RecommendationRun, UnderlyingAssessment } from '../lib/recommendations/types.ts';
import { buildRecommendationVisualFixture, type RecommendationVisualFixture } from '../lib/recommendations/visualFixtures.ts';
import { addToWatchlist, getWatchlist, makeWatchlistId, removeFromWatchlist, type WatchlistItem } from '../lib/watchlist.ts';

const OptionDetailDrawer = lazy(() => import('../components/OptionDetailDrawer.tsx'));
type BoardSort = 'ticker' | 'setup' | 'verdict';

const VERDICT_RANK: Record<CandidateVerdict, number> = { ACTIONABLE: 0, CONDITIONAL: 1, WATCH: 2, PASS: 3 };
const SETUP_RANK: Record<RecommendationBand, number> = { STRONG: 0, GOOD: 1, MIXED: 2, WEAK: 3 };
const CLASS_LABEL: Record<RecommendationClass, string> = {
  BEST_OVERALL: 'BEST OVERALL',
  MORE_DEFENSIVE: 'MORE DEFENSIVE',
  HIGHER_COMPENSATION: 'HIGHER COMPENSATION',
  CONDITIONAL_PRICE_OPPORTUNITY: 'CONDITIONAL PRICE OPPORTUNITY',
};

interface BoardRow {
  underlying: UnderlyingAssessment;
  candidate: RecommendationCandidate | null;
  verdict: CandidateVerdict;
  hardFailed: boolean;
}

function optionDetail(candidate: RecommendationCandidate): OptionDetail {
  const row = candidate.canonicalRow;
  return {
    strike: row.strike,
    last: row.last,
    lastTradeDate: row.lastTradeDate,
    bid: row.bid,
    ask: row.ask,
    delta: row.delta,
    impliedVolatility: row.iv,
    volume: row.volume,
    openInterest: row.openInterest,
    volOI: row.volOI,
    nomYieldBid: row.nomYieldBid,
    annYieldBid: row.annYieldBid,
    nomYieldAsk: row.nomYieldAsk,
    annYieldAsk: row.annYieldAsk,
    nomYieldLast: row.nomYieldLast,
    annYieldLast: row.annYieldLast,
    otmItmPct: row.moneynessPct,
    otmItmLabel: row.moneynessLabel,
    otmItmColor: row.moneynessColor,
  };
}

function watchedIds(): Set<string> {
  try {
    return new Set(getWatchlist().map(item => item.id));
  } catch {
    return new Set();
  }
}

function watchlistItem(candidate: RecommendationCandidate): WatchlistItem {
  const row = candidate.canonicalRow;
  const expiry = new Date(candidate.expiration * 1_000).toISOString().split('T')[0];
  const now = Date.now();
  return {
    id: makeWatchlistId(candidate.ticker, expiry, candidate.strike),
    ticker: candidate.ticker,
    expiry,
    expiryTimestamp: candidate.expiration,
    expiryFormatted: candidate.expirationLabel,
    strike: candidate.strike,
    optionType: 'put',
    addedAt: now,
    savedAt: now,
    updatedAt: now,
    note: '',
    status: 'saved',
    snapshot: {
      underlyingPrice: candidate.underlyingPrice,
      bid: row.bid,
      ask: row.ask,
      last: row.last,
      lastTradeDate: row.lastTradeDate,
      delta: row.delta,
      iv: row.iv,
      dte: row.dte,
      volume: row.volume,
      openInterest: row.openInterest,
      nominalYieldBid: row.nomYieldBid,
      annualizedYieldBid: row.annYieldBid,
      annualizedYieldAsk: row.annYieldAsk,
      moneynessPct: row.moneynessPct,
      moneynessLabel: row.moneynessLabel,
    },
  };
}

function representativeCandidate(run: RecommendationRun, ticker: string): RecommendationCandidate | null {
  const recommendationIds = new Set(run.recommendations.map(selection => selection.candidateId));
  return [...run.candidates]
    .filter(candidate => candidate.ticker === ticker)
    .sort((left, right) => Number(recommendationIds.has(right.id)) - Number(recommendationIds.has(left.id))
      || VERDICT_RANK[left.verdict] - VERDICT_RANK[right.verdict]
      || left.dominatedBy.length - right.dominatedBy.length
      || left.expiration - right.expiration
      || left.strike - right.strike)[0] ?? null;
}

function buildBoardRows(run: RecommendationRun, sort: BoardSort): BoardRow[] {
  const rows = run.underlyingAssessments.map(underlying => {
    const candidate = representativeCandidate(run, underlying.ticker);
    return {
      underlying,
      candidate,
      verdict: candidate?.verdict ?? 'PASS',
      hardFailed: underlying.qualification === 'HARD_FAIL',
    } satisfies BoardRow;
  });
  return rows.sort((left, right) => sort === 'ticker'
    ? left.underlying.ticker.localeCompare(right.underlying.ticker)
    : sort === 'setup'
      ? SETUP_RANK[left.underlying.setup] - SETUP_RANK[right.underlying.setup] || left.underlying.ticker.localeCompare(right.underlying.ticker)
      : VERDICT_RANK[left.verdict] - VERDICT_RANK[right.verdict] || left.underlying.ticker.localeCompare(right.underlying.ticker));
}

function percent(value: number | null, decimals = 1): string {
  return value == null ? '—' : formatPercentPoints(value, decimals);
}

function delta(value: number | null): string {
  return value == null ? '—' : value.toFixed(2);
}

function statusLabel(progress: RecommendationRefreshProgress): string {
  if (progress.stage === 'UNDERLYINGS') return `Analyzing underlyings ${progress.completed}/${progress.total}`;
  if (progress.stage === 'CONTRACTS') return `Acquiring contracts ${progress.completed}/${progress.total}`;
  return 'Applying deterministic policy';
}

function VerdictBadge({ verdict }: { verdict: CandidateVerdict }) {
  return <span className="recommendation-verdict-badge" data-verdict={verdict}>{verdict}</span>;
}

function LensRow({ label, value }: { label: string; value: RecommendationBand }) {
  return <div className="recommendation-lens-row"><span>{label}</span><strong data-band={value}>{value}</strong></div>;
}

function RecommendationCard({
  candidate,
  className,
  watched,
  onEvidence,
  onOpen,
  onWatch,
}: {
  candidate: RecommendationCandidate;
  className: RecommendationClass;
  watched: boolean;
  onEvidence: () => void;
  onOpen: () => void;
  onWatch: () => void;
}) {
  const range = candidate.pricing.indicativeRange;
  return (
    <article className="recommendation-card surface-card">
      <button type="button" className="recommendation-card__summary" onClick={onEvidence}>
        <div className="min-w-0">
          <div className="recommendation-card__eyebrow">{CLASS_LABEL[className]}</div>
          <div className="recommendation-card__identity">{candidate.ticker} ${candidate.strike.toFixed(2)} Put <span>· {candidate.expirationLabel}</span></div>
          <div className="recommendation-card__metrics">
            {candidate.economics.annualizedYieldBidPct != null ? `${percent(candidate.economics.annualizedYieldBidPct)} AY Bid` : range ? `${formatCurrency(range.low)}–${formatCurrency(range.high)} indicative credit` : 'Pricing insufficient'}
            <span>·</span> {delta(candidate.economics.delta)} Δ <span>·</span> {percent(candidate.economics.moneynessPct, 0)} OTM <span>·</span> {candidate.dte} DTE
          </div>
        </div>
        <div className="flex flex-none items-center gap-2"><VerdictBadge verdict={candidate.verdict} /><ChevronRight className="h-4 w-4" style={{ color: 'var(--text-dim)' }} /></div>
      </button>
      <div className="recommendation-card__body">
        <div className="recommendation-card__lenses">
          <LensRow label="Compensation" value={candidate.lenses.compensation} />
          <LensRow label="Cushion" value={candidate.lenses.cushion} />
          <LensRow label="Volatility" value={candidate.lenses.volatilityOpportunity} />
          <LensRow label="Underlying" value={candidate.lenses.underlyingSetup} />
          <LensRow label="Pricing" value={candidate.lenses.pricingConfidence} />
          <LensRow label="Actionability" value={candidate.lenses.actionability} />
        </div>
        <div className="recommendation-card__copy">
          <div><strong>Why it made the cut</strong><p>{candidate.why}</p></div>
          <div><strong>Trade-off</strong><p>{candidate.tradeoff}</p></div>
        </div>
        {candidate.verdict === 'CONDITIONAL' && (
          <div className="recommendation-conditional-strip">
            <span>Bid {formatCurrency(candidate.pricing.directBid)}</span>
            <span>Ask {formatCurrency(candidate.pricing.directAsk)}</span>
            <span>Indicative {range ? `${formatCurrency(range.low)}–${formatCurrency(range.high)}` : '—'}</span>
            <strong>Attractive At {candidate.minimumAttractiveCredit.credit == null ? 'unavailable' : `≥ ${formatCurrency(candidate.minimumAttractiveCredit.credit)}`}</strong>
          </div>
        )}
      </div>
      <footer className="recommendation-card__actions">
        <button type="button" className="button-secondary" onClick={onOpen}>Open Contract</button>
        <button type="button" className="button-secondary" onClick={onWatch}><Star className={`h-3.5 w-3.5 ${watched ? 'fill-current' : ''}`} />{watched ? 'Watching' : 'Watch'}</button>
        <button type="button" className="button-ghost" onClick={onEvidence}>Evidence</button>
      </footer>
    </article>
  );
}

export default function RecommendationsPage() {
  const navigate = useNavigate();
  const visualFixture = import.meta.env.DEV || import.meta.env.VITE_UI_VISUAL_FIXTURES === 'true'
    ? new URLSearchParams(window.location.search).get('recommendations-fixture') as RecommendationVisualFixture | null
    : null;
  const [run, setRun] = useState<RecommendationRun | null>(() => visualFixture ? buildRecommendationVisualFixture(visualFixture) : getInMemoryRecommendationRun());
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<RecommendationRefreshProgress>({ stage: 'UNDERLYINGS', completed: 0, total: 44 });
  const [error, setError] = useState('');
  const [boardSort, setBoardSort] = useState<BoardSort>('verdict');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [evidenceCandidateId, setEvidenceCandidateId] = useState<string | null>(null);
  const [drawerCandidateId, setDrawerCandidateId] = useState<string | null>(null);
  const [watchIds, setWatchIds] = useState<Set<string>>(watchedIds);
  const refreshGateRef = useRef(createLatestScreenerScanGate());

  useEffect(() => () => refreshGateRef.current.cancel(), []);

  const handleRefresh = useCallback(async () => {
    const refresh = refreshGateRef.current.begin();
    setLoading(true);
    setError('');
    setProgress({ stage: 'UNDERLYINGS', completed: 0, total: 44 });
    try {
      const result = await refreshRecommendations({
        scanId: `recommendations-${refresh.id}`,
        signal: refresh.signal,
        onProgress: next => { if (refresh.isCurrent()) setProgress(next); },
      });
      if (!refresh.isCurrent()) return;
      publishInMemoryRecommendationRun(result.run);
      setRun(result.run);
      setWatchIds(watchedIds());
    } catch (refreshError) {
      if (refresh.isCurrent() && (refreshError as { name?: unknown })?.name !== 'AbortError') {
        setError(refreshError instanceof Error ? refreshError.message : 'Recommendations could not be refreshed.');
      }
    } finally {
      if (refresh.isCurrent()) setLoading(false);
    }
  }, []);

  const candidateById = useMemo(() => new Map(run?.candidates.map(candidate => [candidate.id, candidate]) ?? []), [run]);
  const surfaced = useMemo(() => run?.recommendations.flatMap(selection => {
    const candidate = candidateById.get(selection.candidateId);
    return candidate ? [{ selection, candidate }] : [];
  }) ?? [], [candidateById, run]);
  const boardRows = useMemo(() => run ? buildBoardRows(run, boardSort) : [], [boardSort, run]);
  const evidenceCandidate = evidenceCandidateId ? candidateById.get(evidenceCandidateId) ?? null : null;
  const drawerCandidate = drawerCandidateId ? candidateById.get(drawerCandidateId) ?? null : null;

  const toggleWatch = useCallback((candidate: RecommendationCandidate) => {
    const item = watchlistItem(candidate);
    const stored = watchIds.has(item.id) ? removeFromWatchlist(item.id) : addToWatchlist(item);
    setWatchIds(new Set(stored.map(saved => saved.id)));
  }, [watchIds]);

  const exportSnapshot = useCallback(() => {
    if (!run) return;
    const blob = new Blob([`${JSON.stringify(run, null, 2)}\n`], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `put-scanner-recommendations-v${run.engineVersion}-${run.asOf.slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [run]);

  const openContract = (candidate: RecommendationCandidate) => {
    setEvidenceCandidateId(null);
    setDrawerCandidateId(candidate.id);
  };

  const actionableCount = run?.candidates.filter(candidate => candidate.verdict === 'ACTIONABLE').length ?? 0;
  const conditionalCount = run?.candidates.filter(candidate => candidate.verdict === 'CONDITIONAL').length ?? 0;

  return (
    <div className="recommendations-page min-h-screen overflow-x-hidden" style={{ backgroundColor: 'var(--bg)' }}>
      <div className="page-frame page-frame--wide">
        <PageHeader
          title="Recommendations"
          description="A deterministic, skeptical market assessment that is comfortable returning no trade."
          meta={run ? <div className="recommendations-header-meta"><span>Last refreshed {formatDateTime(Date.parse(run.asOf))}</span><span>{run.coverage.successfullyAnalyzedUnderlyings.length}/{run.coverage.requestedForOptionScan.length} option underlyings</span><span>Engine v{run.engineVersion} · Policy v{run.policyVersion}</span></div> : <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>No market scan runs on page load.</span>}
          actions={<div className="flex gap-2">{run && <button type="button" className="button-secondary recommendations-export-button" onClick={exportSnapshot}><Download className="h-3.5 w-3.5" /><span>Export Evaluation Snapshot</span></button>}<button type="button" className="button-primary" onClick={() => void handleRefresh()}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}{loading ? statusLabel(progress) : 'Refresh Recommendations'}</button></div>}
        />

        {error && <div role="alert" className="mb-3 flex items-start gap-2 rounded-lg border p-3 text-sm" style={{ color: 'var(--yellow)', borderColor: 'color-mix(in srgb, var(--yellow) 35%, var(--border))', backgroundColor: 'var(--surface)' }}><AlertTriangle className="mt-0.5 h-4 w-4 flex-none" /><div><strong>Refresh failed.</strong> {error} Successful prior in-memory results remain unchanged.</div></div>}

        {!run ? (
          <section className="recommendations-ready-state surface-card">
            <div className="recommendations-ready-state__mark">MARKET MODE · V1</div>
            <h2>Nothing has been analyzed yet.</h2>
            <p>Refresh explicitly to reuse ETF Pulse context, qualify underlyings, acquire the bounded Screener universe, and run the local decision engine.</p>
            <div className="recommendations-ready-state__facts"><span>0 automatic scans</span><span>42 tracked ETFs</span><span>2 standard expirations per ticker</span><span>No AI or model calls</span></div>
          </section>
        ) : (
          <>
            <section className="recommendations-market-line surface-card">
              <span className="recommendations-market-line__label">Market context</span>
              <strong>{run.market.regime.label}</strong><span>·</span><strong>{run.market.posture.label}</strong><span>·</span><span>{run.market.regime.putSellingImplication}</span>
            </section>

            <section className="recommendations-verdict-strip" data-status={run.operationalStatus === 'INCOMPLETE' ? 'incomplete' : run.runVerdict === 'NO_TRADE' ? 'no-trade' : 'opportunities'}>
              <div>
                <div className="recommendations-verdict-strip__label">{run.operationalStatus === 'INCOMPLETE' ? 'ANALYSIS INCOMPLETE' : run.runVerdict === 'NO_TRADE' ? 'NO TRADE' : `${actionableCount} ACTIONABLE · ${conditionalCount} CONDITIONAL`}</div>
                <p>{run.operationalStatus === 'INCOMPLETE'
                  ? `Whole-universe judgment withheld. ${run.coverage.failedBatches.length} failed batch(es); ${run.coverage.failedUnderlyings.length} underlyings have missing acquisition evidence.`
                  : run.runVerdict === 'NO_TRADE'
                    ? 'Nothing in the complete analyzed opportunity set provides sufficient compensation relative to downside cushion, underlying quality, pricing evidence, and available alternatives.'
                    : 'Only contracts that clear absolute economics, risk, evidence, skeptic, and robustness policy are surfaced.'}</p>
              </div>
              <div className="recommendations-verdict-strip__coverage"><span>{run.coverage.contractsEvaluated.toLocaleString()} contracts</span><span>{run.coverage.expirationsCovered.reduce((sum, item) => sum + item.expirationDates.length, 0)} chains</span><span>{run.coverage.hardFailedBeforeChainAcquisition.length} underlying hard-fails</span></div>
            </section>

            {surfaced.length > 0 && <section className="recommendations-primary-section"><SectionHeader title="Primary recommendations" description="Decision first; full audit evidence is available on demand." /><div className="recommendations-primary-grid">{surfaced.map(({ selection, candidate }) => <RecommendationCard key={`${selection.class}-${candidate.id}`} candidate={candidate} className={selection.class} watched={watchIds.has(makeWatchlistId(candidate.ticker, candidate.expiration, candidate.strike))} onEvidence={() => setEvidenceCandidateId(candidate.id)} onOpen={() => openContract(candidate)} onWatch={() => toggleWatch(candidate)} />)}</div></section>}

            <section className="recommendations-board-section surface-card">
              <SectionHeader title="Opportunity Board" description="One row per tracked underlying; expansion uses only this in-memory run." actions={<label className="recommendations-board-sort"><span>Sort</span><select value={boardSort} onChange={event => setBoardSort(event.target.value as BoardSort)}><option value="verdict">Verdict</option><option value="ticker">Ticker</option><option value="setup">Setup</option></select></label>} />
              <div className="recommendations-board-desktop hidden md:block">
                <table className="w-full text-[11px] tabular-nums"><thead><tr>{['', 'Ticker', 'Setup', 'Volatility', 'Frontier Contract', 'AY / Price Basis', 'Δ', 'OTM', 'Pricing', 'Action', 'Verdict'].map(label => <th key={label} className="px-2 py-2 text-right first:text-left nth-[2]:text-left">{label}</th>)}</tr></thead><tbody>{boardRows.map(row => <BoardDesktopRow key={row.underlying.ticker} row={row} expanded={expanded.has(row.underlying.ticker)} onToggle={() => setExpanded(current => { const next = new Set(current); if (next.has(row.underlying.ticker)) next.delete(row.underlying.ticker); else next.add(row.underlying.ticker); return next; })} onEvidence={setEvidenceCandidateId} run={run} />)}</tbody></table>
              </div>
              <div className="recommendations-board-mobile md:hidden">{boardRows.map(row => <BoardMobileRow key={row.underlying.ticker} row={row} expanded={expanded.has(row.underlying.ticker)} onToggle={() => setExpanded(current => { const next = new Set(current); if (next.has(row.underlying.ticker)) next.delete(row.underlying.ticker); else next.add(row.underlying.ticker); return next; })} onEvidence={setEvidenceCandidateId} run={run} />)}</div>
            </section>

            {run.nearMisses.length > 0 && <section className="recommendations-near-misses surface-card"><SectionHeader title="Near Misses / Why Not" /><div className="grid gap-1.5">{run.nearMisses.map(nearMiss => <button type="button" key={nearMiss.candidateId} onClick={() => setEvidenceCandidateId(nearMiss.candidateId)}><span>{nearMiss.text}</span><ChevronRight className="h-4 w-4" /></button>)}</div></section>}
          </>
        )}
      </div>

      {run && evidenceCandidate && <RecommendationEvidenceDrawer candidate={evidenceCandidate} run={run} onClose={() => setEvidenceCandidateId(null)} onOpenContract={() => openContract(evidenceCandidate)} onToggleWatch={() => toggleWatch(evidenceCandidate)} watched={watchIds.has(makeWatchlistId(evidenceCandidate.ticker, evidenceCandidate.expiration, evidenceCandidate.strike))} onViewChain={() => navigate(`/options/${evidenceCandidate.ticker}`)} />}
      {drawerCandidate && <ErrorBoundary title="Option drawer unavailable" message="Close it and try again."><Suspense fallback={null}><OptionDetailDrawer option={optionDetail(drawerCandidate)} ticker={drawerCandidate.ticker} expirationLabel={drawerCandidate.expirationLabel} dte={drawerCandidate.dte} underlyingPrice={drawerCandidate.underlyingPrice} onClose={() => setDrawerCandidateId(null)} /></Suspense></ErrorBoundary>}
    </div>
  );
}

function compactCandidateLine(candidate: RecommendationCandidate): string {
  const ay = candidate.economics.annualizedYieldBidPct;
  if (ay != null) return `${percent(ay)} AY Bid`;
  const range = candidate.pricing.indicativeRange;
  return range ? `${formatCurrency(range.low)}–${formatCurrency(range.high)} indicative` : 'Pricing insufficient';
}

function FrontierRows({ run, ticker, onEvidence }: { run: RecommendationRun; ticker: string; onEvidence: (candidateId: string) => void }) {
  const frontierIds = run.frontiers.find(frontier => frontier.ticker === ticker)?.candidateIds ?? [];
  const candidates = frontierIds.flatMap(id => {
    const candidate = run.candidates.find(item => item.id === id);
    return candidate ? [candidate] : [];
  });
  if (candidates.length === 0) return <div className="recommendations-frontier-empty">Rejected before contract acquisition or no valid frontier contract.</div>;
  return <div className="recommendations-frontier-list">{candidates.map(candidate => <button type="button" key={candidate.id} onClick={() => onEvidence(candidate.id)}><span className="font-mono font-semibold">${candidate.strike.toFixed(2)}P · {candidate.dte} DTE</span><span>{compactCandidateLine(candidate)} · {delta(candidate.economics.delta)} Δ · {percent(candidate.economics.moneynessPct, 0)} OTM</span><VerdictBadge verdict={candidate.verdict} /></button>)}</div>;
}

function BoardDesktopRow({ row, expanded, onToggle, onEvidence, run }: { row: BoardRow; expanded: boolean; onToggle: () => void; onEvidence: (candidateId: string) => void; run: RecommendationRun }) {
  const candidate = row.candidate;
  return <><tr className="recommendations-board-row" data-hard-fail={row.hardFailed || undefined}><td className="px-1 py-1"><button type="button" className="recommendations-expand-button" onClick={onToggle} aria-expanded={expanded}>{expanded ? <ChevronDown /> : <ChevronRight />}</button></td><td className="px-2 py-1 text-left font-mono font-bold">{row.underlying.ticker}</td><td className="px-2 py-1 text-right">{row.underlying.setup}</td><td className="px-2 py-1 text-right">{candidate?.lenses.volatilityOpportunity ?? '—'}</td><td className="px-2 py-1 text-right">{candidate ? <button type="button" className="font-mono underline-offset-2 hover:underline" onClick={() => onEvidence(candidate.id)}>${candidate.strike.toFixed(2)}P · {candidate.dte}D</button> : '—'}</td><td className="px-2 py-1 text-right">{candidate ? compactCandidateLine(candidate) : row.hardFailed ? 'Rejected before chain scan' : '—'}</td><td className="px-2 py-1 text-right font-mono">{candidate ? delta(candidate.economics.delta) : '—'}</td><td className="px-2 py-1 text-right font-mono">{candidate ? percent(candidate.economics.moneynessPct, 0) : '—'}</td><td className="px-2 py-1 text-right">{candidate?.pricing.confidence ?? row.underlying.evidenceQuality}</td><td className="px-2 py-1 text-right">{candidate?.pricing.actionability ?? '—'}</td><td className="px-2 py-1 text-right"><VerdictBadge verdict={row.verdict} /></td></tr>{expanded && <tr className="recommendations-frontier-row"><td colSpan={11}><FrontierRows run={run} ticker={row.underlying.ticker} onEvidence={onEvidence} /></td></tr>}</>;
}

function BoardMobileRow({ row, expanded, onToggle, onEvidence, run }: { row: BoardRow; expanded: boolean; onToggle: () => void; onEvidence: (candidateId: string) => void; run: RecommendationRun }) {
  const candidate = row.candidate;
  return <div className="recommendations-board-mobile-row" data-hard-fail={row.hardFailed || undefined}><button type="button" className="recommendations-board-mobile-row__summary" onClick={onToggle} aria-expanded={expanded}><div><span className="font-mono font-bold">{row.underlying.ticker}</span><small>{row.underlying.setup} setup</small></div><div className="text-right"><span className="font-mono">{candidate ? `$${candidate.strike.toFixed(2)}P · ${compactCandidateLine(candidate)}` : row.hardFailed ? 'Rejected pre-chain' : 'No valid contract'}</span><small>{candidate ? `${delta(candidate.economics.delta)} Δ · ${percent(candidate.economics.moneynessPct, 0)} OTM · Pricing ${candidate.pricing.confidence}` : `Evidence ${row.underlying.evidenceQuality}`}</small></div><VerdictBadge verdict={row.verdict} /><ChevronRight className={`h-4 w-4 transition-transform ${expanded ? 'rotate-90' : ''}`} /></button>{expanded && <FrontierRows run={run} ticker={row.underlying.ticker} onEvidence={onEvidence} />}</div>;
}
