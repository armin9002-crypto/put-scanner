import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BrainCircuit, ExternalLink, Gauge, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { buildEtfPulseRows, getEtfPulseUniverse, readEtfPulseRowsCache, type EtfPulseLoadResult } from '../lib/etfPulseData';
import type { EtfPulseRow } from '../lib/etfPulseMetrics';
import { formatCurrency, formatNumber, formatPercent, formatRelativeAge } from '../lib/format';
import { isFiniteNumber } from '../lib/optionMetrics';
import { loadPortfolioTrades, type PortfolioTrade } from '../lib/portfolioStorage';
import { getWatchlist, type WatchlistItem } from '../lib/watchlist';
import { loadCachedTradeScan, saveTradeScan } from '../lib/tradeCockpit/cache';
import { postureFromRegime, criteriaAdjustmentsForStyle } from '../lib/tradeCockpit/posture';
import { analyzeRegime } from '../lib/tradeCockpit/regime';
import { estimateOptionRequests, runTradeScan } from '../lib/tradeCockpit/scan';
import type { CandidateBucket, ScanCriteria, TradeCandidate, TradeScanResult, TradeStyle, UniverseMode } from '../lib/tradeCockpit/types';

const DASH = '\u2014';
const BUCKETS: CandidateBucket[] = ['Best Clean Setups', 'Healthy Pullbacks', 'High Yield / High Risk', 'Already Exposed', 'Avoid / Falling Knives', 'Near Misses'];

type CandidateSortField = 'ticker' | 'expiry' | 'dte' | 'strike' | 'bid' | 'delta' | 'distanceToStrike' | 'breakeven' | 'breakevenCushion' | 'annualizedYieldBid' | 'spreadPercent' | 'openInterest' | 'volume' | 'etfTrend' | 'rsi14' | 'distance50' | 'distance200' | 'label' | 'score';

interface CandidateSort {
  field: CandidateSortField;
  direction: 'asc' | 'desc';
}

function pct(value: number | null | undefined, decimals = 1): string {
  return isFiniteNumber(value) ? formatPercent(value, decimals) : DASH;
}

function price(value: number | null | undefined): string {
  return isFiniteNumber(value) ? formatCurrency(value, 2) : DASH;
}

function optionPrice(value: number | null | undefined): string {
  return isFiniteNumber(value) ? value.toFixed(2) : DASH;
}

function valueColor(value: number | null | undefined): string {
  if (!isFiniteNumber(value) || Math.abs(value) < 0.0005) return 'var(--text-dim)';
  return value >= 0 ? 'var(--green)' : 'var(--red)';
}

function badgeColor(label: string): { color: string; bg: string; border: string } {
  if (label.includes('Risk-On') || label === 'Clean' || label === 'Balanced') return { color: 'var(--green)', bg: 'rgba(34,197,94,0.10)', border: 'rgba(34,197,94,0.25)' };
  if (label.includes('Healthy') || label === 'Opportunistic') return { color: 'var(--accent-light)', bg: 'var(--accent-bg)', border: 'var(--accent-border)' };
  if (label.includes('Choppy') || label.includes('Pullback') || label === 'Defensive') return { color: 'var(--yellow)', bg: 'rgba(250,204,21,0.10)', border: 'rgba(250,204,21,0.25)' };
  if (label.includes('Risk') || label.includes('Avoid') || label === 'Very Defensive') return { color: 'var(--red)', bg: 'rgba(239,68,68,0.10)', border: 'rgba(239,68,68,0.25)' };
  return { color: 'var(--text-muted)', bg: 'var(--surface-alt)', border: 'var(--border)' };
}

function MiniBadge({ label }: { label: string }) {
  const style = badgeColor(label);
  return <span className="inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap" style={{ color: style.color, backgroundColor: style.bg, border: `1px solid ${style.border}` }}>{label}</span>;
}

function defaultCriteria(postureMaxDelta = 0.2, postureDistance = 0.25): ScanCriteria {
  return {
    tradeStyle: 'Balanced',
    universeMode: 'Regime-filtered',
    minDte: 14,
    maxDte: 90,
    maxDelta: postureMaxDelta,
    minDistanceToStrike: postureDistance,
    minOpenInterest: 50,
    maxSpreadPercent: 0.35,
    maxTickers: 8,
    maxExpirationsPerTicker: 2,
    maxCandidatesPerTicker: 5,
  };
}

function grossRisk(trade: PortfolioTrade): number {
  return trade.status === 'open' ? trade.strike * 100 * trade.contracts : 0;
}

function candidateSortValue(candidate: TradeCandidate, field: CandidateSortField): number | string | null {
  switch (field) {
    case 'ticker': return candidate.ticker;
    case 'expiry': return candidate.expiryTimestamp;
    case 'dte': return candidate.dte;
    case 'strike': return candidate.strike;
    case 'bid': return candidate.bid;
    case 'delta': return candidate.delta == null ? null : Math.abs(candidate.delta);
    case 'distanceToStrike': return candidate.distanceToStrike;
    case 'breakeven': return candidate.breakeven;
    case 'breakevenCushion': return candidate.breakevenCushion;
    case 'annualizedYieldBid': return candidate.annualizedYieldBid;
    case 'spreadPercent': return candidate.spreadPercent;
    case 'openInterest': return candidate.openInterest;
    case 'volume': return candidate.volume;
    case 'etfTrend': return candidate.etfTrend;
    case 'rsi14': return candidate.rsi14;
    case 'distance50': return candidate.distance50;
    case 'distance200': return candidate.distance200;
    case 'label': return candidate.label;
    case 'score': return candidate.score;
    default: return candidate.score;
  }
}

function selectScanUniverse(criteria: ScanCriteria, rows: EtfPulseRow[], portfolioTrades: PortfolioTrade[], watchlist: WatchlistItem[]): string[] {
  if (criteria.universeMode === 'Watchlist only') return [...new Set(watchlist.map(item => item.ticker.toUpperCase()))].sort();
  if (criteria.universeMode === 'Portfolio tickers only') return [...new Set(portfolioTrades.filter(trade => trade.status === 'open').map(trade => trade.ticker.toUpperCase()))].sort();

  const baseRows = rows.length > 0 ? rows : getEtfPulseUniverse().map(etf => ({
    ticker: etf.ticker,
    trend: 'Neutral',
    distance200: null,
    distance50: null,
    recentDrawdown30: null,
    realizedVolatility20: null,
    rsi14: null,
  } as EtfPulseRow));

  const filtered = criteria.universeMode === 'All ETF universe'
    ? baseRows
    : baseRows.filter(row => {
      if (criteria.tradeStyle === 'Speculative') return true;
      if (criteria.tradeStyle === 'Aggressive') return row.trend !== 'Downtrend' || (row.rsi14 ?? 99) < 35;
      return (row.distance200 ?? 0) >= 0 && row.trend !== 'Downtrend' && (row.recentDrawdown30 ?? 0) > -0.18;
    });

  return filtered
    .sort((a, b) => {
      const aScore = (a.trend === 'Strong Uptrend' ? 3 : a.trend === 'Uptrend' ? 2 : a.trend === 'Weakening' ? 1 : 0) + ((a.realizedVolatility20 ?? 0) * 0.5);
      const bScore = (b.trend === 'Strong Uptrend' ? 3 : b.trend === 'Uptrend' ? 2 : b.trend === 'Weakening' ? 1 : 0) + ((b.realizedVolatility20 ?? 0) * 0.5);
      return bScore - aScore;
    })
    .map(row => row.ticker)
    .slice(0, criteria.maxTickers);
}

function buildPortfolioWarnings(trades: PortfolioTrade[]): string[] {
  const open = trades.filter(trade => trade.status === 'open');
  if (open.length === 0) return ['No open portfolio exposure loaded.'];
  const byTicker = new Map<string, number>();
  const byExpiry = new Map<string, number>();
  open.forEach(trade => {
    byTicker.set(trade.ticker, (byTicker.get(trade.ticker) ?? 0) + grossRisk(trade));
    byExpiry.set(trade.expiration, (byExpiry.get(trade.expiration) ?? 0) + grossRisk(trade));
  });
  const total = [...byTicker.values()].reduce((sum, value) => sum + value, 0);
  const largestTicker = [...byTicker.entries()].sort((a, b) => b[1] - a[1])[0];
  const largestExpiry = [...byExpiry.entries()].sort((a, b) => b[1] - a[1])[0];
  const warnings = [
    `Open gross risk: ${formatCurrency(total, 0)} across ${open.length} trades.`,
    largestTicker ? `Largest ticker exposure: ${largestTicker[0]} ${formatCurrency(largestTicker[1], 0)}.` : '',
    largestExpiry ? `Largest expiry bucket: ${largestExpiry[0]} ${formatCurrency(largestExpiry[1], 0)}.` : '',
  ].filter(Boolean);
  if (byTicker.size === 1) warnings.push('All open risk is currently in one ticker.');
  return warnings;
}

function buildSetupGroups(rows: EtfPulseRow[]) {
  return {
    extended: rows.filter(row => (row.trend === 'Strong Uptrend' || row.trend === 'Uptrend') && ((row.position52Week ?? 0) >= 0.9 || row.isOverbought)).slice(0, 6),
    pullbacks: rows.filter(row => (row.distance200 ?? -1) > 0 && (row.rsi14 ?? 99) >= 35 && (row.rsi14 ?? 99) <= 55 && (row.returns.thirtyDay ?? 0) < 0).slice(0, 6),
    oversold: rows.filter(row => row.isOversold).slice(0, 6),
    falling: rows.filter(row => row.trend === 'Downtrend' || ((row.distance50 ?? 0) < 0 && (row.distance200 ?? 0) < 0)).slice(0, 6),
  };
}

export default function TradeCockpitPage() {
  const navigate = useNavigate();
  const [pulseResult, setPulseResult] = useState<EtfPulseLoadResult | null>(null);
  const [portfolioTrades, setPortfolioTrades] = useState<PortfolioTrade[]>([]);
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [scanResult, setScanResult] = useState<TradeScanResult | null>(null);
  const [loadingPulse, setLoadingPulse] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<{ completed: number; total: number; ticker?: string }>({ completed: 0, total: 0 });
  const [criteria, setCriteria] = useState<ScanCriteria>(() => defaultCriteria());
  const [sort, setSort] = useState<CandidateSort>({ field: 'score', direction: 'desc' });

  useEffect(() => {
    const cachedPulse = readEtfPulseRowsCache();
    setPulseResult(cachedPulse);
    setPortfolioTrades(loadPortfolioTrades());
    setWatchlist(getWatchlist());
    setScanResult(loadCachedTradeScan());
  }, []);

  const pulseRows = useMemo(() => pulseResult?.rows ?? [], [pulseResult?.rows]);
  const regime = useMemo(() => analyzeRegime(pulseRows, pulseResult?.fetchedAt ?? null), [pulseRows, pulseResult?.fetchedAt]);
  const posture = useMemo(() => postureFromRegime(regime), [regime]);

  useEffect(() => {
    setCriteria(current => ({
      ...current,
      maxDelta: posture.maxDelta,
      minDistanceToStrike: posture.minDistanceToStrike,
      minDte: Math.min(current.minDte, posture.dteMin),
      maxDte: Math.max(current.maxDte, posture.dteMax),
    }));
  }, [posture.maxDelta, posture.minDistanceToStrike, posture.dteMin, posture.dteMax]);

  const selectedTickers = useMemo(() => selectScanUniverse(criteria, pulseRows, portfolioTrades, watchlist), [criteria, portfolioTrades, pulseRows, watchlist]);
  const estimatedRequests = estimateOptionRequests(selectedTickers, criteria);
  const currentResultsStale = scanResult != null && JSON.stringify(scanResult.criteria) !== JSON.stringify(criteria);
  const allScanRows = useMemo(() => [...(scanResult?.candidates ?? []), ...(scanResult?.nearMisses ?? [])], [scanResult?.candidates, scanResult?.nearMisses]);
  const portfolioWarnings = useMemo(() => buildPortfolioWarnings(portfolioTrades), [portfolioTrades]);
  const setupGroups = useMemo(() => buildSetupGroups(pulseRows), [pulseRows]);
  const sortedCandidates = useMemo(() => {
    const candidates = allScanRows;
    return [...candidates].sort((a, b) => {
      const direction = sort.direction === 'asc' ? 1 : -1;
      const aValue = candidateSortValue(a, sort.field);
      const bValue = candidateSortValue(b, sort.field);
      if (aValue == null && bValue == null) return 0;
      if (aValue == null) return 1;
      if (bValue == null) return -1;
      if (typeof aValue === 'string' || typeof bValue === 'string') return String(aValue).localeCompare(String(bValue)) * direction;
      return (aValue - bValue) * direction;
    });
  }, [allScanRows, sort]);

  const updateCriteria = <K extends keyof ScanCriteria>(key: K, value: ScanCriteria[K]) => {
    setCriteria(current => ({ ...current, [key]: value }));
  };

  const applyStyle = (style: TradeStyle) => {
    const adjustment = criteriaAdjustmentsForStyle(style);
    setCriteria(current => ({
      ...current,
      tradeStyle: style,
      maxDelta: adjustment.maxDelta,
      minDistanceToStrike: adjustment.minDistanceToStrike,
      minDte: adjustment.dteMin,
      maxDte: adjustment.dteMax,
    }));
  };

  const loadPulseData = async () => {
    setLoadingPulse(true);
    try {
      setPulseResult(await buildEtfPulseRows({ forceRefresh: false }));
    } finally {
      setLoadingPulse(false);
    }
  };

  const handleRunScan = async () => {
    if (selectedTickers.length === 0) return;
    if (estimatedRequests > 50 && !window.confirm(`Estimated option-chain requests: ${estimatedRequests}. Cached chains may reduce this. Continue?`)) return;
    if (estimatedRequests > 75 && !window.confirm('This scan is above the normal hard cap. Continue anyway?')) return;
    setScanning(true);
    setScanProgress({ completed: 0, total: selectedTickers.length });
    try {
      const result = await runTradeScan({
        tickers: selectedTickers,
        pulseRows,
        portfolioTrades,
        criteria,
        onProgress: setScanProgress,
      });
      saveTradeScan(result);
      setScanResult(result);
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-2.75rem)] px-3 sm:px-4 lg:px-6 py-4" style={{ backgroundColor: 'var(--bg)' }}>
      <div className="max-w-[1800px] mx-auto space-y-4">
        <header className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2" style={{ color: 'var(--text)' }}>
              <Gauge className="w-5 h-5" style={{ color: 'var(--accent-light)' }} /> Trade Cockpit
            </h1>
            <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>Market regime, put-selling posture, and today&apos;s setup quality.</p>
          </div>
          <div className="text-xs lg:text-right" style={{ color: 'var(--text-muted)' }}>
            <div>Regime data: {pulseResult ? formatRelativeAge(pulseResult.fetchedAt) : 'Not loaded'}</div>
            <div>Trade scan: {scanResult ? formatRelativeAge(scanResult.fetchedAt) : 'No cached scan'}</div>
          </div>
        </header>

        <section className="rounded-lg p-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <span className="text-xs uppercase tracking-wide" style={{ color: 'var(--text-dim)' }}>Market Read</span>
                <MiniBadge label={regime.label} />
                <MiniBadge label={`${regime.confidence} confidence`} />
                <MiniBadge label={posture.label} />
              </div>
              <div className="grid grid-cols-1 xl:grid-cols-[1.1fr_0.9fr] gap-4">
                <div>
                  <h2 className="text-sm font-semibold mb-1" style={{ color: 'var(--text)' }}>Plain-English market read</h2>
                  <p className="text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>{regime.marketRead}</p>
                  <h2 className="text-sm font-semibold mt-4 mb-1" style={{ color: 'var(--text)' }}>What this means for selling puts</h2>
                  <p className="text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>{regime.putSellingImplication}</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <ListPanel title="Favor" items={regime.favor} />
                  <ListPanel title="Avoid" items={regime.avoid} />
                </div>
              </div>
              <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2">
                {regime.drivers.map(driver => <div key={driver} className="text-xs rounded px-2 py-1.5" style={{ color: 'var(--text-muted)', backgroundColor: 'var(--surface-alt)' }}>{driver}</div>)}
              </div>
              {regime.warnings.length > 0 && (
                <div className="mt-3 text-xs flex items-center gap-2" style={{ color: 'var(--yellow)' }}>
                  <AlertTriangle className="w-3.5 h-3.5" /> {regime.warnings.join(' ')}
                </div>
              )}
            </div>
            {!pulseResult && (
              <button type="button" onClick={loadPulseData} disabled={loadingPulse} className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium disabled:opacity-50" style={{ color: 'var(--text)', backgroundColor: 'var(--accent-bg)', border: '1px solid var(--accent-border)' }}>
                <RefreshCw className={`w-3.5 h-3.5 ${loadingPulse ? 'animate-spin' : ''}`} /> Load ETF Pulse Data
              </button>
            )}
          </div>
        </section>

        <section className="rounded-lg p-3" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <h2 className="text-base font-semibold mb-2" style={{ color: 'var(--text)' }}>Today&apos;s Put-Selling Rules</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-2">
            <RuleChip label="Max Delta" value={`<= ${(posture.maxDelta * 100).toFixed(0)} delta`} />
            <RuleChip label="Minimum Cushion" value={`${(posture.minDistanceToStrike * 100).toFixed(0)}%+`} />
            <RuleChip label="DTE Window" value={`${posture.dteMin}-${posture.dteMax} DTE`} />
            <RuleChip label="Prefer" value={posture.styleRecommendation} />
            <RuleChip label="Liquidity" value={posture.liquidityGuidance} />
          </div>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-2">
          <ScoreCard label="Market Tape" value={`QQQ ${regime.stats.qqqTrend} · SPY ${regime.stats.spyTrend}`} />
          <ScoreCard label="Breadth" value={`${pct(regime.stats.breadthAbove200)} above 200D · ${pct(regime.stats.breadthAbove50)} above 50D`} />
          <ScoreCard label="Extension" value={`${regime.stats.overboughtCount} overbought · QQQ ${pct(regime.stats.qqqPosition52Week)} of 52W range`} />
          <ScoreCard label="Volatility Context" value={regime.stats.vixTrend || regime.stats.vxnTrend ? `VIX ${regime.stats.vixTrend ?? DASH} · VXN ${regime.stats.vxnTrend ?? DASH}` : 'Volatility data unavailable'} />
          <ScoreCard label="Put Premium Posture" value={posture.label === 'Selective / Patient' ? 'Premium may be thinner; require better cushion' : posture.styleRecommendation} />
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-[0.75fr_1.25fr] gap-3">
          <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
            <h2 className="text-base font-semibold mb-2" style={{ color: 'var(--text)' }}>Portfolio-Aware Warnings</h2>
            <div className="space-y-2">
              {portfolioWarnings.map(warning => <div key={warning} className="text-xs rounded px-2 py-1.5" style={{ color: 'var(--text-muted)', backgroundColor: 'var(--surface-alt)' }}>{warning}</div>)}
            </div>
          </div>
          <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
            <h2 className="text-base font-semibold mb-2" style={{ color: 'var(--text)' }}>Market-Derived Setup Watchlist</h2>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
              <SetupList title="Strong but extended" rows={setupGroups.extended} />
              <SetupList title="Healthy pullbacks" rows={setupGroups.pullbacks} />
              <SetupList title="Oversold / speculative" rows={setupGroups.oversold} />
              <SetupList title="Falling knives" rows={setupGroups.falling} />
            </div>
          </div>
        </section>

        <section className="rounded-lg p-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-3 mb-3">
            <div>
              <h2 className="text-base font-semibold" style={{ color: 'var(--text)' }}>Trade Scan</h2>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Scans candidate puts only when you run it. Uses cached option chains where available.</p>
            </div>
            <button type="button" onClick={handleRunScan} disabled={scanning || selectedTickers.length === 0} className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold disabled:opacity-50" style={{ backgroundColor: 'var(--accent)', color: 'white' }}>
              <BrainCircuit className={`w-4 h-4 ${scanning ? 'animate-pulse' : ''}`} /> {scanning ? `Scanning ${scanProgress.completed}/${scanProgress.total}` : 'Run Trade Scan'}
            </button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2">
            <SelectControl label="Style" value={criteria.tradeStyle} options={['Conservative', 'Balanced', 'Aggressive', 'Speculative']} onChange={value => applyStyle(value as TradeStyle)} />
            <SelectControl label="Universe" value={criteria.universeMode} options={['Regime-filtered', 'Watchlist only', 'Portfolio tickers only', 'All ETF universe']} onChange={value => updateCriteria('universeMode', value as UniverseMode)} />
            <NumberControl label="Min DTE" value={criteria.minDte} onChange={value => updateCriteria('minDte', value)} />
            <NumberControl label="Max DTE" value={criteria.maxDte} onChange={value => updateCriteria('maxDte', value)} />
            <NumberControl label="Max Delta" value={criteria.maxDelta} step={0.01} onChange={value => updateCriteria('maxDelta', value)} />
            <NumberControl label="Min Cushion" value={criteria.minDistanceToStrike} step={0.01} onChange={value => updateCriteria('minDistanceToStrike', value)} />
            <NumberControl label="Min OI" value={criteria.minOpenInterest} onChange={value => updateCriteria('minOpenInterest', value)} />
            <NumberControl label="Max Spread" value={criteria.maxSpreadPercent} step={0.01} onChange={value => updateCriteria('maxSpreadPercent', value)} />
            <NumberControl label="Max Tickers" value={criteria.maxTickers} onChange={value => updateCriteria('maxTickers', value)} />
            <NumberControl label="Exps/Ticker" value={criteria.maxExpirationsPerTicker} onChange={value => updateCriteria('maxExpirationsPerTicker', value)} />
            <NumberControl label="Cands/Ticker" value={criteria.maxCandidatesPerTicker} onChange={value => updateCriteria('maxCandidatesPerTicker', value)} />
          </div>

          <div className="mt-3 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
            <div>
              Scanning {selectedTickers.length} ETFs: {selectedTickers.slice(0, 16).join(', ')}{selectedTickers.length > 16 ? '...' : ''}
            </div>
            <div style={{ color: estimatedRequests > 30 ? 'var(--yellow)' : 'var(--text-muted)' }}>
              Estimated option-chain requests: {estimatedRequests}. Cached chains may reduce this.
            </div>
          </div>
          {currentResultsStale && <div className="mt-2 text-xs" style={{ color: 'var(--yellow)' }}>Results were scanned using previous criteria. Re-run scan for a fresh candidate set.</div>}
          {scanResult && (
            <details className="mt-3 text-xs">
              <summary className="cursor-pointer" style={{ color: 'var(--text-muted)' }}>Scan diagnostics</summary>
              <div className="mt-2 rounded p-2 grid grid-cols-2 md:grid-cols-5 gap-2" style={{ backgroundColor: 'var(--surface-alt)', color: 'var(--text-muted)' }}>
                <span>Tickers: {scanResult.usage.tickersScanned}</span>
                <span>Expirations: {scanResult.usage.expirationsScanned}</span>
                <span>Estimated: {scanResult.usage.estimatedRequests}</span>
                <span>Network: {scanResult.usage.requestsMade}</span>
                <span>Cache hits: {scanResult.usage.cacheHits}</span>
                <span>Raw puts: {scanResult.diagnostics.rawPutContracts}</span>
                <span>OTM puts: {scanResult.diagnostics.otmPuts}</span>
                <span>Bid pass: {scanResult.diagnostics.passedBid}</span>
                <span>Delta pass: {scanResult.diagnostics.passedDelta}</span>
                <span>Cushion pass: {scanResult.diagnostics.passedCushion}</span>
                <span>OI pass: {scanResult.diagnostics.passedOpenInterest}</span>
                <span>Spread pass: {scanResult.diagnostics.passedSpread}</span>
                <span>Final: {scanResult.diagnostics.finalCandidates}</span>
              </div>
              {Object.keys(scanResult.diagnostics.exclusionReasons).length > 0 && (
                <div className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                  Top filters: {Object.entries(scanResult.diagnostics.exclusionReasons).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([reason, count]) => `${reason} (${count})`).join(', ')}
                </div>
              )}
            </details>
          )}
        </section>

        <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
          {BUCKETS.map(bucket => {
            const bucketCandidates = allScanRows.filter(candidate => candidate.bucket === bucket);
            return <BucketCard key={bucket} bucket={bucket} candidates={bucketCandidates} onOpen={ticker => navigate(`/options/${ticker}`)} />;
          })}
        </section>

        {scanResult && scanResult.candidates.length === 0 && (
          <section className="rounded-lg p-3" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
            <h2 className="text-base font-semibold" style={{ color: 'var(--text)' }}>No Strict Matches</h2>
            <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
              No candidates matched every filter. {scanResult.nearMisses.length > 0 ? 'Near-misses are shown above and in the table.' : 'The diagnostics below show where contracts were filtered out.'}
            </p>
            <div className="mt-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
              Most common filters: {Object.entries(scanResult.diagnostics.exclusionReasons).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([reason, count]) => `${reason} (${count})`).join(', ') || 'none recorded'}
            </div>
          </section>
        )}

        <section className="rounded-lg overflow-hidden" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="px-3 py-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1" style={{ borderBottom: '1px solid var(--border)' }}>
            <div>
              <h2 className="text-base font-semibold" style={{ color: 'var(--text)' }}>All Candidates</h2>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{scanResult ? scanResult.candidates.length === 0 ? `No strict candidates. Showing ${scanResult.nearMisses.length} near-misses from ${new Date(scanResult.fetchedAt).toLocaleTimeString()}.` : `Using cached trade scan from ${new Date(scanResult.fetchedAt).toLocaleTimeString()}.` : 'Run a trade scan to populate candidates.'}</p>
            </div>
            <p className="text-[11px]" style={{ color: 'var(--text-dim)' }}>Screening tool only, not financial advice.</p>
          </div>
          <CandidateTable candidates={sortedCandidates} sort={sort} setSort={setSort} onOpen={ticker => navigate(`/options/${ticker}`)} />
        </section>
      </div>
    </div>
  );
}

function ScoreCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-lg px-3 py-2" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-dim)' }}>{label}</div>
      <div className="text-sm font-semibold truncate" style={{ color: color ?? 'var(--text)' }}>{value}</div>
    </div>
  );
}

function ListPanel({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--surface-alt)', border: '1px solid var(--border)' }}>
      <div className="text-xs font-semibold mb-2" style={{ color: 'var(--text)' }}>{title}</div>
      <ul className="space-y-1">
        {items.map(item => <li key={item} className="text-xs leading-5" style={{ color: 'var(--text-muted)' }}>{item}</li>)}
      </ul>
    </div>
  );
}

function RuleChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg px-3 py-2 min-w-0" style={{ backgroundColor: 'var(--surface-alt)', border: '1px solid var(--border)' }}>
      <div className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-dim)' }}>{label}</div>
      <div className="text-xs font-medium truncate" title={value} style={{ color: 'var(--text-secondary)' }}>{value}</div>
    </div>
  );
}

function SetupList({ title, rows }: { title: string; rows: EtfPulseRow[] }) {
  return (
    <div className="rounded-lg p-2" style={{ backgroundColor: 'var(--surface-alt)', border: '1px solid var(--border)' }}>
      <div className="text-xs font-semibold mb-2" style={{ color: 'var(--text)' }}>{title}</div>
      {rows.length === 0 ? (
        <div className="text-[11px]" style={{ color: 'var(--text-dim)' }}>None in cached data.</div>
      ) : (
        <div className="space-y-1">
          {rows.map(row => (
            <div key={row.ticker} className="flex items-center justify-between gap-2 text-[11px]">
              <span className="font-mono font-semibold" style={{ color: 'var(--accent-light)' }}>{row.ticker}</span>
              <span className="truncate" style={{ color: 'var(--text-muted)' }}>{row.trend} · RSI {row.rsi14 == null ? DASH : row.rsi14.toFixed(0)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SelectControl({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <label className="min-w-0">
      <span className="block text-[10px] mb-1" style={{ color: 'var(--text-dim)' }}>{label}</span>
      <select value={value} onChange={event => onChange(event.target.value)} className="w-full rounded px-2 py-1.5 text-xs outline-none" style={{ color: 'var(--text)', backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)' }}>
        {options.map(option => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

function NumberControl({ label, value, step = 1, onChange }: { label: string; value: number; step?: number; onChange: (value: number) => void }) {
  return (
    <label className="min-w-0">
      <span className="block text-[10px] mb-1" style={{ color: 'var(--text-dim)' }}>{label}</span>
      <input type="number" value={value} step={step} onChange={event => onChange(Number(event.target.value))} className="w-full rounded px-2 py-1.5 text-xs outline-none" style={{ color: 'var(--text)', backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)' }} />
    </label>
  );
}

function BucketCard({ bucket, candidates, onOpen }: { bucket: CandidateBucket; candidates: TradeCandidate[]; onOpen: (ticker: string) => void }) {
  return (
    <div className="rounded-lg p-3 min-w-0" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{bucket}</h3>
        <span className="text-[10px]" style={{ color: 'var(--text-dim)' }}>{candidates.length}</span>
      </div>
      {candidates.length === 0 ? (
        <div className="py-6 text-xs text-center" style={{ color: 'var(--text-muted)' }}>No candidates yet.</div>
      ) : (
        <div className="space-y-2">
          {candidates.slice(0, 5).map(candidate => (
            <button key={candidate.id} type="button" onClick={() => onOpen(candidate.ticker)} className="w-full rounded p-2 text-left hover:opacity-90" style={{ backgroundColor: 'var(--surface-alt)', border: '1px solid var(--border)' }}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs font-bold" style={{ color: 'var(--accent-light)' }}>{candidate.ticker} {candidate.expiryLabel} ${candidate.strike}</span>
                <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{Math.round(candidate.score)}</span>
              </div>
              <div className="mt-1 text-[11px]" style={{ color: 'var(--text-secondary)' }}>{pct(candidate.annualizedYieldBid)} AY · {candidate.delta == null ? DASH : Math.abs(candidate.delta).toFixed(2)} delta · {pct(candidate.distanceToStrike)} cushion</div>
              <div className="mt-1 text-[10px] truncate" style={{ color: 'var(--text-dim)' }}>{candidate.reason}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CandidateTable({ candidates, sort, setSort, onOpen }: { candidates: TradeCandidate[]; sort: CandidateSort; setSort: (sort: CandidateSort) => void; onOpen: (ticker: string) => void }) {
  const headers: Array<{ field: CandidateSortField; label: string }> = [
    { field: 'ticker', label: 'Ticker' },
    { field: 'expiry', label: 'Expiry' },
    { field: 'dte', label: 'DTE' },
    { field: 'strike', label: 'Strike' },
    { field: 'bid', label: 'Bid' },
    { field: 'delta', label: 'Delta' },
    { field: 'distanceToStrike', label: 'Dist Strike' },
    { field: 'breakeven', label: 'Breakeven' },
    { field: 'breakevenCushion', label: 'BE Cushion' },
    { field: 'annualizedYieldBid', label: 'AY Bid' },
    { field: 'spreadPercent', label: 'Spread' },
    { field: 'openInterest', label: 'OI' },
    { field: 'volume', label: 'Vol' },
    { field: 'etfTrend', label: 'ETF Trend' },
    { field: 'rsi14', label: 'RSI' },
    { field: 'distance50', label: 'vs 50D' },
    { field: 'distance200', label: 'vs 200D' },
    { field: 'label', label: 'Label' },
    { field: 'score', label: 'Score' },
  ];

  const changeSort = (field: CandidateSortField) => {
    setSort(sort.field === field ? { field, direction: sort.direction === 'asc' ? 'desc' : 'asc' } : { field, direction: 'desc' });
  };

  if (candidates.length === 0) {
    return <div className="px-3 py-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>No candidates matched current criteria. Try wider DTE, higher max delta, or Aggressive style.</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px] table-fixed" style={{ minWidth: 1760 }}>
        <thead className="sticky top-0 z-10" style={{ backgroundColor: 'var(--surface-alt)' }}>
          <tr>
            <th className="px-2 py-2 text-left w-[72px]" style={{ color: 'var(--text-muted)' }}>Open</th>
            {headers.map(header => (
              <th key={header.field} className="px-2 py-2 text-right whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
                <button type="button" onClick={() => changeSort(header.field)} className="hover:opacity-80">{header.label}{sort.field === header.field ? sort.direction === 'asc' ? ' ^' : ' v' : ''}</button>
              </th>
            ))}
            <th className="px-2 py-2 text-left w-[240px]" style={{ color: 'var(--text-muted)' }}>Reason</th>
          </tr>
        </thead>
        <tbody>
          {candidates.map(candidate => (
            <tr key={candidate.id} style={{ borderTop: '1px solid var(--border)' }}>
              <td className="px-2 py-1"><button type="button" onClick={() => onOpen(candidate.ticker)} className="inline-flex items-center gap-1" style={{ color: 'var(--accent-light)' }}><ExternalLink className="w-3 h-3" /> Open</button></td>
              <td className="px-2 py-1 text-right font-mono" style={{ color: 'var(--accent-light)' }}>{candidate.ticker}</td>
              <td className="px-2 py-1 text-right whitespace-nowrap">{candidate.expiryLabel}</td>
              <td className="px-2 py-1 text-right">{candidate.dte}</td>
              <td className="px-2 py-1 text-right">{optionPrice(candidate.strike)}</td>
              <td className="px-2 py-1 text-right">{optionPrice(candidate.bid)}</td>
              <td className="px-2 py-1 text-right">{candidate.delta == null ? DASH : Math.abs(candidate.delta).toFixed(2)}</td>
              <td className="px-2 py-1 text-right">{pct(candidate.distanceToStrike)}</td>
              <td className="px-2 py-1 text-right">{price(candidate.breakeven)}</td>
              <td className="px-2 py-1 text-right">{pct(candidate.breakevenCushion)}</td>
              <td className="px-2 py-1 text-right" style={{ color: valueColor(candidate.annualizedYieldBid) }}>{pct(candidate.annualizedYieldBid)}</td>
              <td className="px-2 py-1 text-right">{pct(candidate.spreadPercent)}</td>
              <td className="px-2 py-1 text-right">{formatNumber(candidate.openInterest, 0)}</td>
              <td className="px-2 py-1 text-right">{formatNumber(candidate.volume, 0)}</td>
              <td className="px-2 py-1 text-right whitespace-nowrap">{candidate.etfTrend}</td>
              <td className="px-2 py-1 text-right">{candidate.rsi14 == null ? DASH : candidate.rsi14.toFixed(1)}</td>
              <td className="px-2 py-1 text-right">{pct(candidate.distance50)}</td>
              <td className="px-2 py-1 text-right">{pct(candidate.distance200)}</td>
              <td className="px-2 py-1 text-right"><MiniBadge label={candidate.label} /></td>
              <td className="px-2 py-1 text-right">{Math.round(candidate.score)}</td>
              <td className="px-2 py-1 text-left truncate" title={[candidate.reason, ...candidate.warnings].join(' ')}>{candidate.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
