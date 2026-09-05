import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Download, Info, Loader2, RefreshCw, Star, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import ErrorBoundary from '../components/ErrorBoundary.tsx';
import type { OptionDetail } from '../components/OptionDetailDrawer.tsx';
import RecommendationEvidenceDrawer from '../components/RecommendationEvidenceDrawer.tsx';
import { PageHeader, SectionHeader } from '../components/ui/PageHeader.tsx';
import { formatCurrency, formatDateTime, formatPercentPoints } from '../lib/format.ts';
import { persistOnlyEvaluateAtLeast60Dte, readOnlyEvaluateAtLeast60Dte } from '../lib/recommendationPreferences.ts';
import { createLatestScreenerScanGate } from '../lib/screenerAcquisition.ts';
import { getInMemoryRecommendationRun, publishInMemoryRecommendationRun, refreshRecommendations, type RecommendationRefreshProgress } from '../lib/recommendations/acquisition.ts';
import { buildRecommendationBoardRows, type RecommendationBoardRow, type RecommendationBoardSort } from '../lib/recommendations/board.ts';
import { RECOMMENDATION_POLICY } from '../lib/recommendations/policy.ts';
import { recommendationLastTradeText, transactionRecencyTone } from '../lib/recommendations/presentation.ts';
import { priceDiscoveryLabel } from '../lib/recommendations/ranking.ts';
import type { CandidateVerdict, RecommendationBand, RecommendationCandidate, RecommendationDistinction, RecommendationRun, RecommendationSelection } from '../lib/recommendations/types.ts';
import { buildRecommendationVisualFixture, type RecommendationVisualFixture } from '../lib/recommendations/visualFixtures.ts';
import { technicalStateLabel } from '../lib/underlyingTechnical.ts';
import { addToWatchlist, getWatchlist, makeWatchlistId, removeFromWatchlist, type WatchlistItem } from '../lib/watchlist.ts';

const OptionDetailDrawer = lazy(() => import('../components/OptionDetailDrawer.tsx'));
const DISTINCTION_LABEL: Record<RecommendationDistinction, string> = {
  BEST_OVERALL: 'BEST OVERALL',
  MORE_DEFENSIVE: 'MORE DEFENSIVE',
  HIGHER_COMPENSATION: 'HIGHER COMPENSATION',
};

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
  selection,
  asOf,
  watched,
  onEvidence,
  onOpen,
  onWatch,
}: {
  candidate: RecommendationCandidate;
  selection: RecommendationSelection;
  asOf: string;
  watched: boolean;
  onEvidence: () => void;
  onOpen: () => void;
  onWatch: () => void;
}) {
  const range = candidate.pricing.indicativeRange;
  const ayRange = candidate.economics.indicativeAnnualizedYieldRangePct;
  const displaysExecutableBidAy = candidate.pricing.discoveryTier !== 'INSUFFICIENT_PRICE_DISCOVERY'
    && candidate.economics.annualizedYieldBidPct != null;
  const headlineAy = displaysExecutableBidAy
    ? percent(candidate.economics.annualizedYieldBidPct)
    : ayRange
      ? `${percent(ayRange.low)}–${percent(ayRange.high)}`
      : '—';
  const distinctions = selection.distinctions.map(distinction => DISTINCTION_LABEL[distinction]);
  return (
    <article className="recommendation-card surface-card">
      <button type="button" className="recommendation-card__summary" onClick={onEvidence}>
        <div className="min-w-0">
          <div className="recommendation-card__eyebrow">#{selection.shortlistRank} {distinctions.length > 0 ? `· ${distinctions.join(' · ')}` : '· RANKED OPPORTUNITY'}</div>
          <div className="recommendation-card__identity">{candidate.ticker} ${candidate.strike.toFixed(2)} Put <span>· {candidate.expirationLabel}</span></div>
          <div className="recommendation-card__hero-metric"><strong>{headlineAy}</strong><span>{displaysExecutableBidAy ? 'AY at Bid' : ayRange ? 'Indicative AY Range' : 'AY unavailable'}</span></div>
          <div className="recommendation-card__metrics">{delta(candidate.economics.delta)} Δ <span>·</span> {percent(candidate.economics.moneynessPct, 0)} OTM <span>·</span> {candidate.dte} DTE</div>
          <div className="recommendation-card__last-trade" data-recency={transactionRecencyTone(candidate.pricing.exactTradeRecency)}>{recommendationLastTradeText(candidate.pricing, asOf)}</div>
          <div className="recommendation-card__discovery">{priceDiscoveryLabel(candidate.pricing.discoveryTier)} · Confidence {candidate.pricing.confidence}</div>
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
          <div><strong>WHY THIS</strong><p>{candidate.why}</p></div>
          <div><strong>MAIN TRADE-OFF</strong><p>{candidate.tradeoff}</p></div>
        </div>
        {candidate.verdict === 'CONDITIONAL' && (
          <div className="recommendation-conditional-strip">
            <span>Direct Bid {formatCurrency(candidate.pricing.directBid)}</span>
            <span>Ask {formatCurrency(candidate.pricing.directAsk)}</span>
            <span>Indicative {range ? `${formatCurrency(range.low)}–${formatCurrency(range.high)}` : '—'}</span>
            <strong>Minimum {candidate.minimumAttractiveCredit.credit == null ? 'unavailable' : `≥ ${formatCurrency(candidate.minimumAttractiveCredit.credit)}`}</strong>
            <span>Pricing Confidence {candidate.pricing.confidence}</span>
            <span>Actionability {candidate.pricing.actionability}</span>
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

function DecisionTrace({ run }: { run: RecommendationRun }) {
  return (
    <details className="recommendations-decision-trace">
      <summary><span>Decision Trace</span><small>Counts, definitions, coverage, and overlapping rejection reasons</small><ChevronDown className="h-4 w-4" /></summary>
      <div className="recommendations-decision-trace__body">
        <div className="recommendations-decision-trace__stages">
          {run.decisionTrace.stages.map(stage => <div key={stage.key}><strong>{stage.count.toLocaleString()}</strong><span>{stage.label}</span><small>{stage.definition}</small></div>)}
        </div>
        <div className="recommendations-decision-trace__coverage">
          <strong>Coverage</strong>
          <span>{run.coverage.successfullyAnalyzedUnderlyings.length}/{run.coverage.requestedForOptionScan.length} option underlyings analyzed</span>
          <span>{run.coverage.failedBatches.length} failed batches · {run.coverage.failedUnderlyings.length} failed underlyings</span>
          <span>{run.coverage.pulse.loaded}/{run.coverage.pulse.requested} Pulse rows loaded{run.coverage.pulse.stale ? ' · stale evidence present' : ''}</span>
        </div>
        <div className="recommendations-decision-trace__rejections">
          <strong>Top rejection reasons</strong>
          <p>Counts overlap because one contract can fail more than one independent check.</p>
          {run.decisionTrace.topRejectionReasons.length > 0
            ? run.decisionTrace.topRejectionReasons.map(reason => <div key={reason.code}><span>{reason.label}</span><b>{reason.count}</b></div>)
            : <span>No rejected-contract reasons in this run.</span>}
        </div>
      </div>
    </details>
  );
}

function MethodologyModal({ run, onClose, onExport }: { run: RecommendationRun; onClose: () => void; onExport: () => void }) {
  return (
    <div className="recommendation-methodology-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="recommendation-methodology-modal" role="dialog" aria-modal="true" aria-labelledby="recommendation-methodology-title">
        <header><div><span>DETERMINISTIC POLICY</span><h2 id="recommendation-methodology-title">Full Methodology</h2></div><button type="button" aria-label="Close methodology" onClick={onClose}><X className="h-4 w-4" /></button></header>
        <div className="recommendation-methodology-modal__content">
          <p className="recommendation-methodology-lead">Hard gates first, then deterministic relative ranking. There is no numerical score, recommendation quota, or minimum shortlist size.</p>
          <div className="recommendation-methodology-grid">
            <article><strong>1 · Market Regime</strong><p>{run.market.regime.label} · {run.market.posture.label}. Broad SPY/QQQ, breadth, and volatility context informs hurdles but remains separate from ticker technical state.</p></article>
            <article><strong>2 · Underlying Technical Assessment</strong><p>The shared deterministic Phase A state supplies structure, momentum, reset/extension, volatility stress, and evidence quality. Recommendations does not reimplement those thresholds.</p></article>
            <article><strong>3 · Contract eligibility</strong><p>Identity, positive strike/underlying, DTE, and quote ordering must be valid. Severe underlying hard-fails remain vetoes.</p></article>
            <article><strong>4 · DTE</strong><p>{run.universe.onlyEvaluateAtLeast60Dte ? `Only ${run.universe.minimumDte}+ DTE is evaluated` : 'Shorter expirations are allowed'}, bounded at {run.universe.maximumDte} DTE. Posture DTE is context and compensation input, not a hard veto.</p></article>
            <article><strong>5 · Delta</strong><p>Absolute Delta must be available and no greater than the current posture maximum of {run.market.posture.maxDelta.toFixed(2)}.</p></article>
            <article><strong>6 · Strike cushion</strong><p>The strike must be at least {percent(run.market.posture.minDistanceToStrike * 100, 0)} below spot under the current posture.</p></article>
            <article><strong>7 · Breakeven cushion</strong><p>The canonical entry-price basis must leave at least {percent(run.market.posture.minDistanceToBreakeven * 100, 0)} downside cushion.</p></article>
            <article><strong>8 · IV / realized-vol compensation</strong><p>IV and IV-versus-realized context are independent qualitative evidence; missing evidence is not replaced with zero.</p></article>
            <article><strong>9 · Absolute AY hurdle</strong><p>The base {run.market.regime.label} hurdle is {percent(RECOMMENDATION_POLICY.compensation.minimumAnnualizedYieldByRegime[run.market.regime.label] * 100)} before versioned duration, cushion, Delta, WATCH, and relative-frontier premiums.</p></article>
            <article><strong>10 · Pricing basis</strong><p>A usable direct Bid produces AY at Bid. A coherent no-bid bracket produces an Indicative AY Range. Last is never treated as current executable seller credit.</p></article>
            <article><strong>11 · Exact Last Trade recency</strong><p>Recent means ≤{RECOMMENDATION_POLICY.pricing.recentTransactionMaximumTradingSessions} U.S. equity trading sessions. {RECOMMENDATION_POLICY.pricing.recentTransactionMaximumTradingSessions + 1}–{RECOMMENDATION_POLICY.pricing.veryStaleTransactionTradingSessions} is stale/intermediate; &gt;{RECOMMENDATION_POLICY.pricing.veryStaleTransactionTradingSessions} is very stale.</p></article>
            <article><strong>12 · Nearby-strike transaction proxy</strong><p>Only same-expiration puts within ±{percent(RECOMMENDATION_POLICY.pricing.maximumNearbyStrikeDistanceRatio * 100, 0)} and traded within {RECOMMENDATION_POLICY.pricing.recentTransactionMaximumTradingSessions} sessions qualify. Two-sided recent brackets are strongest; one neighbor within {percent(RECOMMENDATION_POLICY.pricing.veryCloseNearbyStrikeDistanceRatio * 100, 0)} is moderate with a credible direct market.</p></article>
            <article><strong>13 · Spread, liquidity, and surface</strong><p>Tight/acceptable direct spreads are ≤{percent(RECOMMENDATION_POLICY.pricing.tightSpreadPercent * 100, 0)} / ≤{percent(RECOMMENDATION_POLICY.pricing.acceptableSpreadPercent * 100, 0)}. Monotonicity, Delta continuity, IV continuity, bracket spacing, and quote corruption remain explicit checks.</p></article>
            <article><strong>14 · Robustness</strong><p>Seven bounded scenarios perturb the AY hurdle, Delta/cushion boundaries, and available price. The result is High, Moderate, or Low—not a probability.</p></article>
            <article><strong>15 · Skeptic / veto</strong><p>The strongest typed objection is recorded. Broken trends, invalid/risk-failing contracts, insufficient discovery, serious dominance losses, and Low robustness can veto promotion.</p></article>
            <article><strong>16 · Comparison / dominance</strong><p>Comparable contracts and cross-tenor alternatives preserve material AY, Delta, cushion, pricing, actionability, and duration tradeoffs. Losses feed rank after stronger evidence tiers.</p></article>
            <article><strong>17 · Verdict</strong><p>Actionable, Conditional, Watch, and Pass are hard-gate outcomes. Verdict is not rank and does not guarantee surfacing.</p></article>
            <article><strong>18 · Actionability rank</strong><p>Verdict, price discovery, pricing actionability/confidence, robustness, shared technical state, skeptic, comparison losses, AY margin, cushion, Delta, then canonical contract identity are compared in that order.</p></article>
            <article><strong>19 · Ranked shortlist</strong><p>Every genuine Actionable/Conditional candidate is ranked; at most {RECOMMENDATION_POLICY.selection.maximumShortlistSize} distinct contracts surface. Diversity can act only inside equal verdict + discovery + robustness + technical tiers, before a third same-ticker contract.</p></article>
            <article><strong>20 · Why fewer than 8–15 can be correct</strong><p>8–15 is not a quota. There is no minimum or filler: if only two contracts survive, two surface; if none survive, NO TRADE is the correct complete-run result.</p></article>
            <article><strong>Versions</strong><p>Engine v{run.engineVersion} · Policy v{run.policyVersion}. Snapshot, rank metadata, pricing evidence, provenance, diagnostics, and outputs are exportable and replayable.</p></article>
          </div>
        </div>
        <footer><button type="button" className="button-secondary" onClick={onExport}><Download className="h-3.5 w-3.5" />Export Evaluation Snapshot</button><button type="button" className="button-primary" onClick={onClose}>Done</button></footer>
      </section>
    </div>
  );
}

function HowRecommendationsWork({ run }: { run: RecommendationRun }) {
  const visibleStages = run.decisionTrace.stages.filter(stage => ['TRACKED_UNDERLYINGS', 'CHAINS_ACQUIRED', 'CONTRACTS_EVALUATED', 'POLICY_SURVIVORS', 'SURFACED_SHORTLIST'].includes(stage.key));
  return (
    <section className="recommendations-how surface-card">
      <div className="recommendations-how__heading"><div><span>How Recommendations Work</span><p>Hard gates first, then deterministic relative ranking. Diagnostic counts overlap and are not a subtractive funnel.</p></div></div>
      <div className="recommendations-how__pipeline">{visibleStages.map((stage, index) => <div key={stage.key}><small>{index + 1}</small><strong>{stage.count.toLocaleString()}</strong><span>{stage.label}</span></div>)}</div>
      <DecisionTrace run={run} />
    </section>
  );
}

export default function RecommendationsPage() {
  const navigate = useNavigate();
  const visualFixture = import.meta.env.DEV || import.meta.env.VITE_UI_VISUAL_FIXTURES === 'true'
    ? new URLSearchParams(window.location.search).get('recommendations-fixture') as RecommendationVisualFixture | null
    : null;
  const [run, setRun] = useState<RecommendationRun | null>(() => visualFixture ? buildRecommendationVisualFixture(visualFixture) : getInMemoryRecommendationRun());
  const [onlyEvaluateAtLeast60Dte, setOnlyEvaluateAtLeast60Dte] = useState(readOnlyEvaluateAtLeast60Dte);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<RecommendationRefreshProgress>({ stage: 'UNDERLYINGS', completed: 0, total: 0 });
  const [error, setError] = useState('');
  const [boardSort, setBoardSort] = useState<RecommendationBoardSort>('actionability');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [evidenceCandidateId, setEvidenceCandidateId] = useState<string | null>(null);
  const [drawerCandidateId, setDrawerCandidateId] = useState<string | null>(null);
  const [watchIds, setWatchIds] = useState<Set<string>>(watchedIds);
  const [showAllBoardRows, setShowAllBoardRows] = useState(false);
  const [showMethodology, setShowMethodology] = useState(false);
  const refreshGateRef = useRef(createLatestScreenerScanGate());

  useEffect(() => () => refreshGateRef.current.cancel(), []);

  const handleRefresh = useCallback(async () => {
    const refresh = refreshGateRef.current.begin();
    setLoading(true);
    setError('');
    setProgress({ stage: 'UNDERLYINGS', completed: 0, total: 0 });
    try {
      const result = await refreshRecommendations({
        scanId: `recommendations-${refresh.id}`,
        onlyEvaluateAtLeast60Dte,
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
  }, [onlyEvaluateAtLeast60Dte]);

  const candidateById = useMemo(() => new Map(run?.candidates.map(candidate => [candidate.id, candidate]) ?? []), [run]);
  const surfaced = useMemo(() => {
    const seen = new Set<string>();
    return run?.recommendations.flatMap(selection => {
      const candidate = candidateById.get(selection.candidateId);
      if (!candidate || seen.has(candidate.id)) return [];
      seen.add(candidate.id);
      return [{ selection, candidate }];
    }) ?? [];
  }, [candidateById, run]);
  const boardRows = useMemo(() => run ? buildRecommendationBoardRows(run, boardSort) : [], [boardSort, run]);
  const visibleBoardRows = showAllBoardRows ? boardRows : boardRows.slice(0, 8);
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

  const actionableCount = surfaced.filter(item => item.candidate.verdict === 'ACTIONABLE').length;
  const conditionalCount = surfaced.filter(item => item.candidate.verdict === 'CONDITIONAL').length;
  const runPreferenceMismatch = run != null && run.universe.onlyEvaluateAtLeast60Dte !== onlyEvaluateAtLeast60Dte;
  const recommendedTickers = new Set(surfaced.map(item => item.candidate.ticker));
  const boardSummary = {
    recommended: boardRows.filter(row => recommendedTickers.has(row.underlying.ticker)).length,
    watch: boardRows.filter(row => !recommendedTickers.has(row.underlying.ticker) && row.verdict === 'WATCH').length,
    pass: boardRows.filter(row => !row.hardFailed && !recommendedTickers.has(row.underlying.ticker) && row.verdict === 'PASS').length,
    hardFail: boardRows.filter(row => row.hardFailed).length,
  };

  const updateMinimumDtePreference = (value: boolean) => {
    setOnlyEvaluateAtLeast60Dte(value);
    persistOnlyEvaluateAtLeast60Dte(value);
  };

  return (
    <div className="recommendations-page min-h-screen overflow-x-hidden" style={{ backgroundColor: 'var(--bg)' }}>
      <div className="page-frame page-frame--wide">
        <PageHeader
          title="Recommendations"
          description="A deterministic, skeptical market assessment that is comfortable returning no trade."
          meta={run ? <div className="recommendations-header-meta"><span>Updated {formatDateTime(Date.parse(run.asOf))}</span><span>{run.coverage.trackedUnderlyings.length} tracked → {run.coverage.requestedForOptionScan.length} qualified → {run.coverage.contractsEvaluated.toLocaleString()} contracts → {surfaced.length} surfaced</span></div> : <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>No market scan runs on page load.</span>}
          actions={<div className="recommendations-header-actions"><button type="button" className="button-secondary recommendations-methodology-trigger" onClick={() => setShowMethodology(true)} disabled={!run}><Info className="h-4 w-4" />Methodology</button><label className="recommendations-dte-toggle"><input type="checkbox" checked={onlyEvaluateAtLeast60Dte} onChange={event => updateMinimumDtePreference(event.target.checked)} /><span>Only evaluate options ≥60 DTE</span></label><button type="button" className="button-primary" onClick={() => void handleRefresh()}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}{loading ? statusLabel(progress) : 'Refresh Recommendations'}</button></div>}
        />

        {error && <div role="alert" className="mb-3 flex items-start gap-2 rounded-lg border p-3 text-sm" style={{ color: 'var(--yellow)', borderColor: 'color-mix(in srgb, var(--yellow) 35%, var(--border))', backgroundColor: 'var(--surface)' }}><AlertTriangle className="mt-0.5 h-4 w-4 flex-none" /><div><strong>Refresh failed.</strong> {error} Successful prior in-memory results remain unchanged.</div></div>}
        {runPreferenceMismatch && <div role="status" className="recommendations-refresh-required"><Info className="h-4 w-4" /><span>The 60-DTE preference changed. This displayed run keeps its original {run?.universe.onlyEvaluateAtLeast60Dte ? '60+ DTE' : 'bounded all-DTE'} universe; refresh to apply the new setting.</span></div>}

        {!run ? (
          <section className="recommendations-ready-state surface-card">
            <div className="recommendations-ready-state__mark">MARKET MODE · V2</div>
            <h2>Nothing has been analyzed yet.</h2>
            <p>Refresh explicitly to reuse ETF Pulse context, qualify underlyings, acquire the bounded Screener universe, and run the local decision engine.</p>
            <div className="recommendations-ready-state__facts"><span>0 automatic scans</span><span>Tracked ETF universe</span><span>Up to 3 representative expirations</span><span>No AI or model calls</span></div>
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

            {surfaced.length > 0 && <section className="recommendations-primary-section"><SectionHeader title="Top Opportunities" description={`Ranked policy survivors · maximum ${RECOMMENDATION_POLICY.selection.maximumShortlistSize}, no minimum. Open Evidence for the complete audit trail.`} /><div className="recommendations-primary-grid">{surfaced.map(({ selection, candidate }) => <RecommendationCard key={candidate.id} candidate={candidate} selection={selection} asOf={run.asOf} watched={watchIds.has(makeWatchlistId(candidate.ticker, candidate.expiration, candidate.strike))} onEvidence={() => setEvidenceCandidateId(candidate.id)} onOpen={() => openContract(candidate)} onWatch={() => toggleWatch(candidate)} />)}</div></section>}

            <HowRecommendationsWork run={run} />

            <section className="recommendations-why-section surface-card">
              <SectionHeader title="Why Only These / Near Misses" description="The engine is intentionally comfortable surfacing nothing; these are the closest rejected alternatives." />
              {run.nearMisses.length > 0 ? <div>{run.nearMisses.map(nearMiss => <button type="button" key={nearMiss.candidateId} onClick={() => setEvidenceCandidateId(nearMiss.candidateId)}><span>{nearMiss.text}</span><ChevronRight className="h-4 w-4" /></button>)}</div> : <p>No near miss had enough evidence and economics to merit promotion.</p>}
            </section>

            <section className="recommendations-board-section surface-card">
              <SectionHeader title="Full Opportunity Board / Audit" description="One row per tracked underlying; representative selection and sorting use the canonical request-free rank." actions={<label className="recommendations-board-sort"><span>Sort</span><select value={boardSort} onChange={event => setBoardSort(event.target.value as RecommendationBoardSort)}><option value="actionability">Actionability</option><option value="ticker">Ticker</option><option value="setup">Setup</option></select></label>} />
              <div className="recommendations-board-summary"><span>{boardSummary.recommended} recommended</span><span>{boardSummary.watch} watch</span><span>{boardSummary.pass} pass</span><span>{boardSummary.hardFail} hard-fail</span></div>
              <div className="recommendations-board-desktop hidden md:block">
                <table className="w-full text-[11px] tabular-nums"><thead><tr>{['', '#', 'Ticker', 'Technical', 'Setup', 'Representative', 'AY / Price Basis', 'Δ', 'OTM', 'Discovery / Action', 'Verdict'].map(label => <th key={label} className="px-2 py-2 text-right first:text-left nth-[3]:text-left">{label}</th>)}</tr></thead><tbody>{visibleBoardRows.map(row => <BoardDesktopRow key={row.underlying.ticker} row={row} expanded={expanded.has(row.underlying.ticker)} onToggle={() => setExpanded(current => { const next = new Set(current); if (next.has(row.underlying.ticker)) next.delete(row.underlying.ticker); else next.add(row.underlying.ticker); return next; })} onEvidence={setEvidenceCandidateId} run={run} />)}</tbody></table>
              </div>
              <div className="recommendations-board-mobile md:hidden">{visibleBoardRows.map(row => <BoardMobileRow key={row.underlying.ticker} row={row} expanded={expanded.has(row.underlying.ticker)} onToggle={() => setExpanded(current => { const next = new Set(current); if (next.has(row.underlying.ticker)) next.delete(row.underlying.ticker); else next.add(row.underlying.ticker); return next; })} onEvidence={setEvidenceCandidateId} run={run} />)}</div>
              {boardRows.length > 8 && <button type="button" className="recommendations-board-show-all" onClick={() => setShowAllBoardRows(value => !value)}>{showAllBoardRows ? 'Show top 8' : `Show all ${boardRows.length}`}<ChevronDown className={`h-4 w-4 ${showAllBoardRows ? 'rotate-180' : ''}`} /></button>}
            </section>
          </>
        )}
      </div>

      {run && evidenceCandidate && <RecommendationEvidenceDrawer candidate={evidenceCandidate} run={run} onClose={() => setEvidenceCandidateId(null)} onOpenContract={() => openContract(evidenceCandidate)} onToggleWatch={() => toggleWatch(evidenceCandidate)} watched={watchIds.has(makeWatchlistId(evidenceCandidate.ticker, evidenceCandidate.expiration, evidenceCandidate.strike))} onViewChain={() => navigate(`/options/${evidenceCandidate.ticker}`)} />}
      {run && showMethodology && <MethodologyModal run={run} onClose={() => setShowMethodology(false)} onExport={exportSnapshot} />}
      {drawerCandidate && <ErrorBoundary title="Option drawer unavailable" message="Close it and try again."><Suspense fallback={null}><OptionDetailDrawer option={optionDetail(drawerCandidate)} ticker={drawerCandidate.ticker} expirationLabel={drawerCandidate.expirationLabel} dte={drawerCandidate.dte} underlyingPrice={drawerCandidate.underlyingPrice} onClose={() => setDrawerCandidateId(null)} /></Suspense></ErrorBoundary>}
    </div>
  );
}

function compactCandidateLine(candidate: RecommendationCandidate): string {
  const ay = candidate.economics.annualizedYieldBidPct;
  if (ay != null && candidate.pricing.discoveryTier !== 'INSUFFICIENT_PRICE_DISCOVERY') return `${percent(ay)} AY at Bid`;
  const range = candidate.economics.indicativeAnnualizedYieldRangePct;
  return range ? `${percent(range.low)}–${percent(range.high)} indicative AY` : 'Pricing insufficient';
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

function BoardDesktopRow({ row, expanded, onToggle, onEvidence, run }: { row: RecommendationBoardRow; expanded: boolean; onToggle: () => void; onEvidence: (candidateId: string) => void; run: RecommendationRun }) {
  const candidate = row.candidate;
  return <><tr className="recommendations-board-row" data-hard-fail={row.hardFailed || undefined}><td className="px-1 py-1"><button type="button" className="recommendations-expand-button" onClick={onToggle} aria-expanded={expanded}>{expanded ? <ChevronDown /> : <ChevronRight />}</button></td><td className="px-2 py-1 text-right font-mono">{candidate?.rank ? `#${candidate.rank.ordinal}` : '—'}</td><td className="px-2 py-1 text-left font-mono font-bold">{row.underlying.ticker}</td><td className="px-2 py-1 text-right">{technicalStateLabel(row.underlying.technicalAssessment.state)}</td><td className="px-2 py-1 text-right">{row.underlying.setup}</td><td className="px-2 py-1 text-right">{candidate ? <button type="button" className="font-mono underline-offset-2 hover:underline" onClick={() => onEvidence(candidate.id)}>${candidate.strike.toFixed(2)}P · {candidate.dte}D</button> : '—'}</td><td className="px-2 py-1 text-right">{candidate ? compactCandidateLine(candidate) : row.hardFailed ? 'Rejected before chain scan' : '—'}</td><td className="px-2 py-1 text-right font-mono">{candidate ? delta(candidate.economics.delta) : '—'}</td><td className="px-2 py-1 text-right font-mono">{candidate ? percent(candidate.economics.moneynessPct, 0) : '—'}</td><td className="px-2 py-1 text-right">{candidate ? <><span className="block">{priceDiscoveryLabel(candidate.pricing.discoveryTier)}</span><small>{candidate.pricing.actionability}</small></> : '—'}</td><td className="px-2 py-1 text-right"><VerdictBadge verdict={row.verdict} /></td></tr>{expanded && <tr className="recommendations-frontier-row"><td colSpan={11}><FrontierRows run={run} ticker={row.underlying.ticker} onEvidence={onEvidence} /></td></tr>}</>;
}

function BoardMobileRow({ row, expanded, onToggle, onEvidence, run }: { row: RecommendationBoardRow; expanded: boolean; onToggle: () => void; onEvidence: (candidateId: string) => void; run: RecommendationRun }) {
  const candidate = row.candidate;
  return <div className="recommendations-board-mobile-row" data-hard-fail={row.hardFailed || undefined}><button type="button" className="recommendations-board-mobile-row__summary" onClick={onToggle} aria-expanded={expanded}><div><span className="font-mono font-bold">{candidate?.rank ? `#${candidate.rank.ordinal} · ` : ''}{row.underlying.ticker}</span><small>{technicalStateLabel(row.underlying.technicalAssessment.state)} · {row.underlying.setup}</small></div><div className="text-right"><span className="font-mono">{candidate ? `$${candidate.strike.toFixed(2)}P · ${compactCandidateLine(candidate)}` : row.hardFailed ? 'Rejected pre-chain' : 'No valid contract'}</span><small>{candidate ? `${priceDiscoveryLabel(candidate.pricing.discoveryTier)} · ${candidate.pricing.actionability} · ${delta(candidate.economics.delta)} Δ` : `Evidence ${row.underlying.evidenceQuality}`}</small></div><VerdictBadge verdict={row.verdict} /><ChevronRight className={`h-4 w-4 transition-transform ${expanded ? 'rotate-90' : ''}`} /></button>{expanded && <FrontierRows run={run} ticker={row.underlying.ticker} onEvidence={onEvidence} />}</div>;
}
