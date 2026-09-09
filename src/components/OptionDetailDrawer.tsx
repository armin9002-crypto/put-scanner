import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import {
  calculateBidAskSpread,
  calculateBidAskSpreadPercent,
  calculateAnnualizedSecuredCashYield,
  calculateBreakeven,
  calculatePositionMetrics,
  calculateSecuredCashYield,
  isFiniteNumber,
} from '../lib/optionMetrics';
import { formatCurrency, formatNumber, formatPercent, normalizeTimestampMs } from '../lib/format';
import { useResponsiveMode } from '../lib/responsive';
import {
  OPTION_QUOTE_DISPLAY_LABELS,
  buildOptionDrawerQuoteState,
  executableOptionPrice,
  formatOptionQuoteValue,
  orderedOptionQuoteEntries,
  type OptionQuoteDisplayField,
  type OptionSoldPriceBasis,
} from '../lib/optionQuoteDisplay';
import { shortPutMoneynessPresentation, type ShortPutMoneynessState } from '../lib/moneynessPresentation';
import { CALCULATED_PUT_DELTA_MODEL, type PutDeltaSource } from '../lib/putDelta';
import { getOptionLastTradeFreshness } from '../lib/optionLastTradeFreshness';
import { useBlockingOverlayBehavior } from '../lib/blockingOverlay';
import type { OptionIntegrityReasonCode, OptionIntegrityStatus } from '../lib/types';

export interface OptionDetail {
  strike: number;
  last: number | null;
  lastTradeDate: number | null;
  bid: number | null;
  ask: number | null;
  delta: number | null;
  deltaSource?: PutDeltaSource | null;
  deltaModelVersion?: string | null;
  gamma?: number | null;
  theta?: number | null;
  vega?: number | null;
  impliedVolatility: number | null;
  volume: number | null;
  openInterest: number | null;
  volOI: number | null;
  nomYieldBid: number | null;
  annYieldBid: number | null;
  nomYieldAsk: number | null;
  annYieldAsk: number | null;
  nomYieldLast: number | null;
  annYieldLast: number | null;
  otmItmPct: number | null;
  otmItmLabel: string;
  otmItmColor: string;
  otmItmState?: ShortPutMoneynessState;
  integrityStatus?: OptionIntegrityStatus;
  integrityReasonCodes?: OptionIntegrityReasonCode[];
  /** Defensive provenance marker; valuation-only Last is omitted from quote authority. */
  lastFallbackOnly?: boolean;
}

export interface AddToPortfolioDraft {
  option: OptionDetail;
  soldPrice: number;
  contracts: number;
  underlyingPrice: number | null;
}

interface OptionDetailDrawerProps {
  option: OptionDetail | null;
  ticker: string;
  expirationLabel: string;
  dte: number | null;
  underlyingPrice: number | null;
  onClose: () => void;
  onAddToPortfolio?: (draft: AddToPortfolioDraft) => void;
  /** Visual-only mobile arrangement for the Recommendations route. */
  mobileLayout?: 'recommendations';
}

function formatPlainNumber(value: number | null | undefined, decimals = 2): string {
  if (!isFiniteNumber(value)) return '—';
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatInteger(value: number | null | undefined): string {
  return formatNumber(value, 0);
}

function formatTradeTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  });
}

function formatTradeDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'America/New_York',
  });
}

function getLastTradeDetail(
  value: number | null | undefined,
  freshness = getOptionLastTradeFreshness(value),
): { trade: string; date: string; age: string; warning: string | null; color?: string } {
  const timestamp = normalizeTimestampMs(value);
  if (timestamp == null) return { trade: '\u2014', date: '\u2014', age: '\u2014', warning: null };

  const date = formatTradeDate(timestamp);
  const trade = `${date} ${formatTradeTime(timestamp)}`;
  if (freshness.ageSessions == null) {
    return { trade, date, age: 'Age unavailable', warning: 'Last trade age unavailable; use Last as a reference only.', color: 'var(--yellow)' };
  }
  const age = freshness.ageSessions === 0 ? '0 sessions' : `${freshness.ageSessions} session${freshness.ageSessions === 1 ? '' : 's'} ago`;
  if (freshness.freshness === 'recent') return { trade, date, age, warning: null, color: freshness.ageSessions === 0 ? 'var(--green)' : 'var(--text-muted)' };
  if (freshness.freshness === 'stale') {
    return { trade, date, age: `${age} - Stale`, warning: 'Last may be stale; use it only as an explicit reference.', color: freshness.color };
  }
  return { trade, date, age: `${age} - Very Stale`, warning: 'Last trade is very stale; use it only as an explicit reference.', color: freshness.color };
}

function deltaSourceLabel(option: Pick<OptionDetail, 'deltaSource' | 'deltaModelVersion'>): string {
  if (option.deltaSource === 'provider') return 'Provider exact-contract Delta';
  if (option.deltaSource === 'calculated') return `Calculated (${option.deltaModelVersion ?? CALCULATED_PUT_DELTA_MODEL.version})`;
  return 'Unavailable';
}

function MetricCard({ label, value, color = 'var(--text)' }: { label: string; value: string; color?: string }) {
  return (
    <div className="drawer-key-figure surface-inset rounded-lg p-2.5 sm:p-3 min-w-0" style={{ backgroundColor: 'var(--surface-alt)', border: '1px solid var(--border)' }}>
      <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-dim)' }}>{label}</div>
      <div className="text-sm sm:text-base font-mono font-semibold tabular-nums break-words" style={{ color }}>{value}</div>
    </div>
  );
}

function DetailRow({ label, value, color, compact = false }: { label: string; value: string; color?: string; compact?: boolean }) {
  return (
    <div className={`flex items-start justify-between gap-3 border-b last:border-b-0 min-w-0 ${compact ? 'py-1' : 'py-1.5'}`} style={{ borderColor: 'var(--border)' }}>
      <span className="text-xs min-w-0" style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span className="text-xs font-mono tabular-nums text-right min-w-0 break-words" style={{ color: color ?? 'var(--text)' }}>{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="drawer-section surface-card rounded-lg p-3 min-w-0" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
      <h3 className="text-[11px] uppercase tracking-wider font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>{title}</h3>
      {children}
    </section>
  );
}

function MobileMetric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="option-detail-mobile-metric min-w-0">
      <span>{label}</span>
      <b className="font-mono tabular-nums" style={{ color: color ?? 'var(--text)' }}>{value}</b>
    </div>
  );
}

export default function OptionDetailDrawer({
  option,
  ticker,
  expirationLabel,
  dte,
  underlyingPrice,
  onClose,
  onAddToPortfolio,
  mobileLayout,
}: OptionDetailDrawerProps) {
  const { isPhone } = useResponsiveMode();
  const titleId = useId();
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const setPanelRef = (element: HTMLElement | null) => { panelRef.current = element; };
  const moneyness = option?.otmItmState ? shortPutMoneynessPresentation(option.otmItmState) : null;
  const moneynessLabel = option?.otmItmLabel || moneyness?.label || '—';
  const moneynessColor = moneyness?.color ?? option?.otmItmColor;
  const quoteState = useMemo(() => option ? buildOptionDrawerQuoteState({
    last: option.last,
    lastTradeDate: option.lastFallbackOnly ? null : option.lastTradeDate,
    bid: option.bid,
    ask: option.ask,
    integrityStatus: option.integrityStatus,
    lastFallbackOnly: option.lastFallbackOnly,
  }) : null, [option]);
  const defaultPrice = quoteState?.defaultSoldPrice ?? null;
  const [contracts, setContracts] = useState('1');
  const [soldPrice, setSoldPrice] = useState('');
  const [soldPriceBasis, setSoldPriceBasis] = useState<OptionSoldPriceBasis | null>(null);

  useEffect(() => {
    setContracts('1');
    setSoldPrice(defaultPrice != null ? defaultPrice.value.toFixed(2) : '');
    setSoldPriceBasis(defaultPrice?.basis ?? null);
  }, [defaultPrice, option?.strike]);

  useBlockingOverlayBehavior({
    isOpen: Boolean(option),
    panelRef,
    overlayRef,
    onEscape: onClose,
  });

  if (!option) return null;

  const quoteIntegrityInvalid = quoteState?.integrityStatus === 'invalid';
  const quoteIntegrityDegraded = quoteState?.integrityStatus === 'degraded';
  const bid = option.bid;
  const ask = option.ask;
  const displayLast = option.lastFallbackOnly ? null : option.last;
  const displayLastTradeDate = option.lastFallbackOnly ? null : option.lastTradeDate;
  const executableBid = quoteState?.trustedBid ?? null;
  const executableAsk = quoteState?.trustedAsk ?? null;
  const mid = quoteState?.mid ?? null;
  const spread = calculateBidAskSpread(executableBid, executableAsk);
  const spreadPct = calculateBidAskSpreadPercent(executableBid, executableAsk);
  const lastTradeInfo = getLastTradeDetail(displayLastTradeDate, quoteState?.lastTradeFreshness);
  const compactLastTradeAge = lastTradeInfo.age.replace(/ - (?:Very )?Stale$/, '');
  const usableLast = quoteState?.trustedLast ?? null;

  const parsedSoldPrice = soldPrice.trim() === '' ? null : Number(soldPrice);
  const validSoldPrice = isFiniteNumber(parsedSoldPrice) && parsedSoldPrice > 0 ? parsedSoldPrice : null;
  const activeSoldPrice = validSoldPrice;
  const distanceToStrike = isFiniteNumber(underlyingPrice) && underlyingPrice > 0
    ? (underlyingPrice - option.strike) / underlyingPrice
    : null;

  const parsedContracts = contracts.trim() === '' ? null : Number(contracts);
  const validContracts = Number.isInteger(parsedContracts) && isFiniteNumber(parsedContracts) && parsedContracts >= 1 ? parsedContracts : null;
  const positionMetrics = calculatePositionMetrics({
    strike: option.strike,
    soldPrice: activeSoldPrice,
    contracts: validContracts,
    dte,
    underlyingPrice,
  });
  const topBreakeven = calculateBreakeven(option.strike, activeSoldPrice);
  const securedCashYield = calculateSecuredCashYield(activeSoldPrice, option.strike);
  const annualizedSecuredCashYield = calculateAnnualizedSecuredCashYield(activeSoldPrice, option.strike, dte);

  const setSoldPriceFromQuote = (basis: OptionQuoteDisplayField, value: number | null | undefined) => {
    if (quoteIntegrityInvalid) return;
    const executable = executableOptionPrice(value);
    if (executable == null) return;
    setSoldPrice(executable.toFixed(2));
    setSoldPriceBasis(basis);
  };

  const selectedBasisWarning = soldPriceBasis === 'last' ? lastTradeInfo.warning ?? (usableLast != null ? 'Last trade age unavailable; use it only as an explicit reference.' : null)
    : soldPriceBasis === 'manual' ? 'Manual price · hypothetical calculator basis.'
    : null;
  const selectedBasisWarningColor = soldPriceBasis === 'last' ? lastTradeInfo.color ?? 'var(--yellow)' : 'var(--text-muted)';

  const integrityWarning = quoteIntegrityInvalid
    ? 'Quote inconsistent · raw provider prices remain visible for audit; executable metrics are unavailable.'
    : quoteIntegrityDegraded
      ? 'Quote integrity degraded · usable evidence remains available with caution.'
      : null;

  if (isPhone && mobileLayout === 'recommendations') {
    const quoteOptions = orderedOptionQuoteEntries({ last: usableLast, bid: executableBid, mid, ask: executableAsk });
    return (
      <div ref={overlayRef} className="fixed inset-0 z-[120] option-drawer-mobile">
        <div ref={setPanelRef} className="mobile-trade-sheet absolute inset-0 overflow-y-auto outline-none" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} style={{ backgroundColor: 'var(--bg)' }}>
          <header className="mobile-trade-sheet__header drawer-header sticky top-0 z-20 border-b px-3 pb-2 pt-1" style={{ borderColor: 'var(--border)', backgroundColor: 'color-mix(in srgb, var(--bg) 96%, transparent)' }}>
            <div className="mx-auto mb-1.5 h-1 w-10 rounded-full" aria-hidden="true" style={{ backgroundColor: 'var(--border-strong)' }} />
            <div className="flex min-h-11 items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 id={titleId} className="truncate font-mono text-[18px] font-bold" style={{ color: 'var(--text)' }}>{ticker} {formatCurrency(option.strike, option.strike % 1 === 0 ? 0 : 2)} Put</h2>
                <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>{expirationLabel || '—'} · {isFiniteNumber(dte) ? `${dte} DTE` : '— DTE'} · Underlying {formatCurrency(underlyingPrice)}</p>
              </div>
              <button type="button" onClick={onClose} className="pressable flex h-11 w-11 flex-none items-center justify-center rounded-full" style={{ color: 'var(--text-muted)', backgroundColor: 'var(--surface-alt)' }} aria-label="Close option details"><X className="h-5 w-5" /></button>
            </div>
          </header>

          <div className="space-y-5 px-4 py-4">
            {integrityWarning && <p role="status" className="rounded-lg border px-3 py-2 text-xs" style={{ color: 'var(--yellow)', borderColor: 'var(--border)', backgroundColor: 'var(--surface-alt)' }}>{integrityWarning}</p>}
            <section>
              <div className="mobile-segmented drawer-quote-selector" role="group" aria-label="Select sold price quote">
                {quoteOptions.map(({ field, label, value }) => {
                  const selected = field === soldPriceBasis && isFiniteNumber(value) && activeSoldPrice === value;
                  return <button type="button" key={field} disabled={!isFiniteNumber(value)} onClick={() => setSoldPriceFromQuote(field, value)} className="pressable mobile-segmented__item disabled:opacity-35" data-selected={selected ? 'true' : 'false'} aria-pressed={selected}>{label}</button>;
                })}
              </div>
              <div className="mt-3 flex items-end justify-between border-b pb-3" style={{ borderColor: 'var(--border)' }}>
                <span className="text-[13px]" style={{ color: 'var(--text-muted)' }}>{activeSoldPrice == null ? 'No executable quote' : `Selected price · ${soldPriceBasis === 'manual' ? 'Manual' : soldPriceBasis ? OPTION_QUOTE_DISPLAY_LABELS[soldPriceBasis] : 'Quote'}`}</span>
                <span className="font-mono text-[26px] font-semibold tabular-nums" style={{ color: 'var(--accent-light)' }}>{formatCurrency(activeSoldPrice)}</span>
              </div>
              {selectedBasisWarning && <p className="mt-2 text-[11px] leading-4" style={{ color: selectedBasisWarningColor }}>{selectedBasisWarning}</p>}
              <div className="mt-1 divide-y" style={{ borderColor: 'var(--border)' }}>
                <DetailRow label="Nominal Yield" value={formatPercent(securedCashYield)} color="var(--accent-light)" />
                <DetailRow label="Annualized Yield" value={formatPercent(annualizedSecuredCashYield)} color="var(--green)" />
                <DetailRow label="Delta" value={formatPlainNumber(option.delta, 3)} />
                <DetailRow label="Delta source" value={deltaSourceLabel(option)} />
                <DetailRow label="Moneyness" value={moneynessLabel} color={moneynessColor || undefined} />
                <DetailRow label="Breakeven" value={formatCurrency(topBreakeven)} />
                <DetailRow label="Implied Volatility" value={isFiniteNumber(option.impliedVolatility) ? `${option.impliedVolatility.toFixed(1)}%` : '—'} />
                <DetailRow label="Open Interest" value={formatInteger(option.openInterest)} />
              </div>
            </section>

            <section className="border-t pt-4" style={{ borderColor: 'var(--border)' }}>
              <h3 className="mb-3 text-[16px] font-semibold" style={{ color: 'var(--text)' }}>Position Calculator</h3>
              <div className="grid grid-cols-2 gap-3">
                <label><span className="mobile-sheet-label">Contracts</span><input type="text" inputMode="numeric" value={contracts} onChange={event => /^\d*$/.test(event.target.value) && setContracts(event.target.value)} onBlur={() => { const value = Number(contracts); setContracts(Number.isInteger(value) && value >= 1 ? String(value) : '1'); }} className="mobile-control-field w-full font-mono" /></label>
                <label><span className="mobile-sheet-label">Sold Price</span><input type="number" inputMode="decimal" min={0.01} step="0.01" value={soldPrice} onChange={event => { const next = event.target.value; if (next === '' || Number(next) >= 0) { setSoldPrice(next); setSoldPriceBasis(next === '' ? null : 'manual'); } }} className="mobile-control-field w-full font-mono" /></label>
              </div>
              <div className="mt-3 divide-y" style={{ borderColor: 'var(--border)' }}>
                <DetailRow label="Premium" value={formatCurrency(positionMetrics.totalPremium)} color="var(--green)" />
                <DetailRow label="Net Risk" value={formatCurrency(positionMetrics.netCapitalAtRisk)} />
                <DetailRow label="Nominal Yield" value={formatPercent(securedCashYield)} color="var(--accent-light)" />
                <DetailRow label="Annualized Yield" value={formatPercent(annualizedSecuredCashYield)} color="var(--green)" />
              </div>
            </section>

            <details className="border-t pt-3" style={{ borderColor: 'var(--border)' }}>
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-[15px] font-semibold" style={{ color: 'var(--text)' }}>Market details <span style={{ color: 'var(--text-dim)' }}>+</span></summary>
              <div className="divide-y pb-4" style={{ borderColor: 'var(--border)' }}>
              {orderedOptionQuoteEntries({ last: displayLast, bid, mid, ask }).map(({ field, label, value }) => <DetailRow key={field} label={label} value={formatOptionQuoteValue(field, value, price => formatCurrency(price))} />)}
                <DetailRow label="Last Trade Date" value={lastTradeInfo.date} color={lastTradeInfo.color} />
                <DetailRow label="Last Trade Age" value={lastTradeInfo.age} color={lastTradeInfo.color} />
                <DetailRow label="Spread" value={`${formatCurrency(spread)} · ${formatPercent(spreadPct)}`} />
                <DetailRow label="Volume / OI" value={`${formatInteger(option.volume)} / ${formatInteger(option.openInterest)}`} />
                <DetailRow label="Gamma / Theta / Vega" value={`${formatPlainNumber(option.gamma, 3)} / ${formatPlainNumber(option.theta, 3)} / ${formatPlainNumber(option.vega, 3)}`} />
              </div>
            </details>
          </div>
        </div>
      </div>
    );
  }

  if (isPhone) {
    const quoteOptions = orderedOptionQuoteEntries({ last: usableLast, bid: executableBid, mid, ask: executableAsk });
    const addToPortfolio = () => {
      if (!onAddToPortfolio || activeSoldPrice == null || validContracts == null) return;
      onAddToPortfolio({ option, soldPrice: activeSoldPrice, contracts: validContracts, underlyingPrice });
    };
    return (
      <div ref={overlayRef} className="fixed inset-0 z-[120] option-drawer-mobile">
        <div ref={setPanelRef} className="mobile-trade-sheet absolute inset-0 overflow-y-auto outline-none" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} style={{ backgroundColor: 'var(--bg)' }}>
          <header className="mobile-trade-sheet__header drawer-header sticky top-0 z-20 border-b px-3 pb-2 pt-1" style={{ borderColor: 'var(--border)', backgroundColor: 'color-mix(in srgb, var(--bg) 96%, transparent)' }}>
            <div className="mx-auto mb-1.5 h-1 w-10 rounded-full" aria-hidden="true" style={{ backgroundColor: 'var(--border-strong)' }} />
            <div className="flex min-h-11 items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 id={titleId} className="truncate font-mono text-[18px] font-bold" style={{ color: 'var(--text)' }}>{ticker} {formatCurrency(option.strike, option.strike % 1 === 0 ? 0 : 2)} Put</h2>
                <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>{expirationLabel || '—'} · {isFiniteNumber(dte) ? `${dte} DTE` : '— DTE'} · Underlying {formatCurrency(underlyingPrice)}</p>
              </div>
              <button type="button" onClick={onClose} className="pressable flex h-11 w-11 flex-none items-center justify-center rounded-full" style={{ color: 'var(--text-muted)', backgroundColor: 'var(--surface-alt)' }} aria-label="Close option details"><X className="h-5 w-5" /></button>
            </div>
          </header>

          <div className="space-y-4 px-4 py-3">
            {integrityWarning && <p role="status" className="rounded-lg border px-3 py-2 text-xs" style={{ color: 'var(--yellow)', borderColor: 'var(--border)', backgroundColor: 'var(--surface-alt)' }}>{integrityWarning}</p>}
            <section className="option-detail-mobile-group" aria-labelledby="option-price-execution-heading">
              <h3 id="option-price-execution-heading">Price / Execution</h3>
              <div className="mobile-segmented drawer-quote-selector" role="group" aria-label="Select sold price quote">
                {quoteOptions.map(({ field, label, value }) => {
                  const selected = field === soldPriceBasis && isFiniteNumber(value) && activeSoldPrice === value;
                  return <button type="button" key={field} disabled={!isFiniteNumber(value)} onClick={() => setSoldPriceFromQuote(field, value)} className="pressable mobile-segmented__item disabled:opacity-35" data-selected={selected ? 'true' : 'false'} aria-pressed={selected}>{label}</button>;
                })}
              </div>
              <div className="option-detail-mobile-selected-price mt-2 flex items-end justify-between gap-3 border-b pb-2" style={{ borderColor: 'var(--border)' }}>
                <span style={{ color: 'var(--text-muted)' }}>{activeSoldPrice == null ? 'No executable quote' : `Selected price · ${soldPriceBasis === 'manual' ? 'Manual' : soldPriceBasis ? OPTION_QUOTE_DISPLAY_LABELS[soldPriceBasis] : 'Quote'}`}</span>
                <strong className="font-mono tabular-nums" style={{ color: activeSoldPrice == null ? 'var(--text-dim)' : 'var(--accent-light)' }}>{formatCurrency(activeSoldPrice)}</strong>
              </div>
              {selectedBasisWarning && <p className="mt-2 text-[11px] leading-4" style={{ color: selectedBasisWarningColor }}>{selectedBasisWarning}</p>}
              <div className="option-detail-mobile-metric-grid option-detail-mobile-metric-grid--quotes mt-2">
                <MobileMetric label="Bid" value={formatOptionQuoteValue('bid', bid, value => formatCurrency(value))} />
                <MobileMetric label="Ask" value={formatOptionQuoteValue('ask', ask, value => formatCurrency(value))} />
                <MobileMetric label="Spread" value={formatCurrency(spread)} />
              </div>
            </section>

            <section className="option-detail-mobile-group" aria-labelledby="option-yield-return-heading">
              <h3 id="option-yield-return-heading">Yield / Return</h3>
              <div className="option-detail-mobile-metric-grid">
                <MobileMetric label="Nominal Yield" value={formatPercent(securedCashYield)} color="var(--accent-light)" />
                <MobileMetric label="Annualized Yield" value={formatPercent(annualizedSecuredCashYield)} color="var(--green)" />
              </div>
            </section>

            <section className="option-detail-mobile-group" aria-labelledby="option-risk-heading">
              <h3 id="option-risk-heading">Risk</h3>
              <div className="option-detail-mobile-metric-grid option-detail-mobile-metric-grid--risk">
                <MobileMetric label="Delta" value={formatPlainNumber(option.delta, 3)} />
                <MobileMetric label="Delta source" value={deltaSourceLabel(option)} />
                <MobileMetric label="Moneyness" value={moneynessLabel} color={moneynessColor || undefined} />
                <MobileMetric label="Breakeven" value={formatCurrency(topBreakeven)} />
                <MobileMetric label="IV" value={isFiniteNumber(option.impliedVolatility) ? `${option.impliedVolatility.toFixed(1)}%` : '—'} />
              </div>
            </section>

            <section className="option-detail-mobile-group" aria-labelledby="option-market-liquidity-heading">
              <h3 id="option-market-liquidity-heading">Market / Liquidity</h3>
              <div className="option-detail-mobile-metric-grid option-detail-mobile-metric-grid--market">
                <MobileMetric label="Last" value={formatOptionQuoteValue('last', displayLast, value => formatCurrency(value))} />
                <MobileMetric label="Age" value={compactLastTradeAge} color={lastTradeInfo.color} />
                <MobileMetric label="Vol" value={formatInteger(option.volume)} />
                <MobileMetric label="OI" value={formatInteger(option.openInterest)} />
              </div>
            </section>

            <section className="border-t pt-4" style={{ borderColor: 'var(--border)' }}>
              <h3 className="mb-3 text-[16px] font-semibold" style={{ color: 'var(--text)' }}>Position Calculator</h3>
              <div className="grid grid-cols-2 gap-3">
                <label><span className="mobile-sheet-label">Contracts</span><input type="text" inputMode="numeric" value={contracts} onChange={event => /^\d*$/.test(event.target.value) && setContracts(event.target.value)} onBlur={() => { const value = Number(contracts); setContracts(Number.isInteger(value) && value >= 1 ? String(value) : '1'); }} className="mobile-control-field w-full font-mono" /></label>
                <label><span className="mobile-sheet-label">Sold Price</span><input type="number" inputMode="decimal" min={0.01} step="0.01" value={soldPrice} onChange={event => { const next = event.target.value; if (next === '' || Number(next) >= 0) { setSoldPrice(next); setSoldPriceBasis(next === '' ? null : 'manual'); } }} className="mobile-control-field w-full font-mono" /></label>
              </div>
              <div className="mt-3 divide-y" style={{ borderColor: 'var(--border)' }}>
                <DetailRow label="Premium" value={formatCurrency(positionMetrics.totalPremium)} color="var(--green)" />
                <DetailRow label="Net Risk" value={formatCurrency(positionMetrics.netCapitalAtRisk)} />
                <DetailRow label="Nominal Yield" value={formatPercent(securedCashYield)} color="var(--accent-light)" />
                <DetailRow label="Annualized Yield" value={formatPercent(annualizedSecuredCashYield)} color="var(--green)" />
              </div>
              {onAddToPortfolio && <button type="button" onClick={addToPortfolio} disabled={activeSoldPrice == null || validContracts == null} className="mobile-sheet-action primary mt-4 w-full disabled:opacity-45">Add to Portfolio</button>}
            </section>

            <details className="border-t pt-3" style={{ borderColor: 'var(--border)' }}>
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-[15px] font-semibold" style={{ color: 'var(--text)' }}>Market details <span style={{ color: 'var(--text-dim)' }}>+</span></summary>
              <div className="divide-y pb-4" style={{ borderColor: 'var(--border)' }}>
                {orderedOptionQuoteEntries({ last: displayLast, bid, mid, ask }).map(({ field, label, value }) => <DetailRow key={field} label={label} value={formatOptionQuoteValue(field, value, price => formatCurrency(price))} />)}
                <DetailRow label="Last Trade Date" value={lastTradeInfo.date} color={lastTradeInfo.color} />
                <DetailRow label="Last Trade Age" value={lastTradeInfo.age} color={lastTradeInfo.color} />
                <DetailRow label="Spread" value={`${formatCurrency(spread)} · ${formatPercent(spreadPct)}`} />
                <DetailRow label="Volume / OI" value={`${formatInteger(option.volume)} / ${formatInteger(option.openInterest)}`} />
                <DetailRow label="Gamma / Theta / Vega" value={`${formatPlainNumber(option.gamma, 3)} / ${formatPlainNumber(option.theta, 3)} / ${formatPlainNumber(option.vega, 3)}`} />
              </div>
            </details>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={overlayRef} className="fixed inset-0 z-[120] option-drawer-desktop">
      <button
        type="button"
        aria-label="Close option detail drawer"
        onClick={onClose}
        className="motion-backdrop absolute inset-0 bg-black/50"
      />
      <aside
        ref={setPanelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="option-detail-drawer drawer-shell overlay-panel absolute inset-x-0 bottom-0 max-h-[94dvh] w-full overflow-y-auto rounded-t-2xl p-3 sm:inset-y-0 sm:left-auto sm:right-0 sm:h-full sm:max-h-none sm:w-[480px] md:w-[520px] lg:w-[560px] sm:rounded-l-[14px] sm:rounded-r-none sm:p-5"
        style={{ backgroundColor: 'var(--bg)', borderLeft: '1px solid var(--border)' }}
      >
        <div className="mx-auto mb-2 h-1 w-10 rounded-full sm:hidden" aria-hidden="true" style={{ backgroundColor: 'var(--border-strong)' }} />
        <div className="option-detail-drawer__header sticky -top-3 z-10 -mx-3 mb-3 flex min-w-0 items-start justify-between gap-3 px-3 pb-3 sm:static sm:mx-0 sm:mb-4 sm:p-0">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg sm:text-xl font-bold font-mono break-words" style={{ color: 'var(--text)' }}>
              {ticker} {formatCurrency(option.strike, option.strike % 1 === 0 ? 0 : 2)} Put
            </h2>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              Exp {expirationLabel || '—'} • {isFiniteNumber(dte) ? `${dte} DTE` : '— DTE'}
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-dim)' }}>
              Underlying {formatCurrency(underlyingPrice)}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close option detail drawer"
            className="icon-button p-2 rounded-lg min-h-[44px] min-w-[44px] flex items-center justify-center"
            style={{ backgroundColor: 'var(--surface)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="drawer-key-figures grid grid-cols-1 min-[390px]:grid-cols-2 gap-2 mb-3 min-w-0">
          {integrityWarning && <div role="status" className="col-span-full rounded-lg border px-3 py-2 text-xs" style={{ color: 'var(--yellow)', borderColor: 'var(--border)', backgroundColor: 'var(--surface-alt)' }}>{integrityWarning}</div>}
          <MetricCard label="Option Price" value={formatCurrency(activeSoldPrice)} color="var(--accent-light)" />
          <MetricCard label="Breakeven" value={formatCurrency(topBreakeven)} />
          <MetricCard label="Downside Cushion" value={formatPercent(positionMetrics.downsideCushion)} color={isFiniteNumber(positionMetrics.downsideCushion) && positionMetrics.downsideCushion >= 0 ? 'var(--green)' : 'var(--red)'} />
          <MetricCard label="Annualized Yield" value={formatPercent(annualizedSecuredCashYield)} color={isFiniteNumber(annualizedSecuredCashYield) && annualizedSecuredCashYield >= 0.25 ? 'var(--green)' : 'var(--yellow)'} />
        </div>

        <div className="space-y-3">
          <Section title="Position Calculator">
            <div className="grid grid-cols-1 min-[390px]:grid-cols-2 gap-2 mb-3">
              <label className="block">
                <span className="block text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Contracts</span>
                <input
                  type="text"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  value={contracts}
                  onChange={event => {
                    const next = event.target.value;
                    if (/^\d*$/.test(next)) setContracts(next);
                  }}
                  onBlur={() => {
                    const value = Number(contracts);
                    setContracts(Number.isInteger(value) && value >= 1 ? String(value) : '1');
                  }}
                  className="w-full rounded-lg px-3 py-2 text-base sm:text-sm font-mono outline-none min-h-[44px]"
                  style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text)' }}
                />
              </label>
              <label className="block">
                <span className="block text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Sold Price</span>
                <input
                  type="number"
                  min={0.01}
                  step="0.01"
                  inputMode="decimal"
                  value={soldPrice}
                  onChange={event => {
                    const next = event.target.value;
                    if (next === '' || Number(next) >= 0) {
                      setSoldPrice(next);
                      setSoldPriceBasis(next === '' ? null : 'manual');
                    }
                  }}
                  className="w-full rounded-lg px-3 py-2 text-base sm:text-sm font-mono outline-none min-h-[44px]"
                  style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text)' }}
                />
              </label>
            </div>
            <div className="grid grid-cols-4 gap-1 mb-3 rounded-xl p-1 drawer-quote-selector" style={{ backgroundColor: 'var(--surface-alt)', border: '1px solid var(--border)' }} role="group" aria-label="Use market quote as sold price">
              {orderedOptionQuoteEntries({ last: usableLast, bid: executableBid, mid, ask: executableAsk }).map(({ field, label, value }) => (
                <button
                  key={field}
                  onClick={() => setSoldPriceFromQuote(field, value)}
                  disabled={!isFiniteNumber(value)}
                  className="pressable min-h-[44px] rounded-lg px-2 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-[40px]"
                  style={{ backgroundColor: soldPriceBasis === field && activeSoldPrice === value ? 'var(--accent)' : 'transparent', color: soldPriceBasis === field && activeSoldPrice === value ? 'white' : 'var(--accent-light)' }}
                >
                  {label}
                </button>
              ))}
            </div>
            {selectedBasisWarning && <p className="mb-3 text-[11px] leading-4" style={{ color: selectedBasisWarningColor }}>{selectedBasisWarning}</p>}
            {onAddToPortfolio && (
              <button
                type="button"
                onClick={() => {
                  if (activeSoldPrice == null || validContracts == null) return;
                  onAddToPortfolio({
                    option,
                    soldPrice: activeSoldPrice,
                    contracts: validContracts,
                    underlyingPrice,
                  });
                }}
                disabled={activeSoldPrice == null || validContracts == null}
                className="button-primary w-full mb-3 px-3 py-2 rounded-lg text-xs text-white disabled:opacity-50 disabled:cursor-not-allowed min-h-[42px]"
                style={{ backgroundColor: 'var(--accent)' }}
              >
                Add to Portfolio
              </button>
            )}
            <DetailRow label="Total Premium" value={formatCurrency(positionMetrics.totalPremium)} color="var(--green)" />
            <DetailRow label="Gross Risk" value={formatCurrency(positionMetrics.equityAtRisk)} />
            <DetailRow label="Net Risk" value={formatCurrency(positionMetrics.netCapitalAtRisk)} color="var(--red)" />
            <DetailRow label="Breakeven" value={formatCurrency(positionMetrics.breakeven)} />
            <DetailRow label="Nominal Yield" value={formatPercent(securedCashYield)} color="var(--accent-light)" />
            <DetailRow label="Annualized Yield" value={formatPercent(annualizedSecuredCashYield)} color="var(--green)" />
          </Section>

          <Section title="Market Quote">
            {orderedOptionQuoteEntries({ last: displayLast, bid, mid, ask }).map(({ field, label, value }) => <DetailRow key={field} label={label} value={formatOptionQuoteValue(field, value, price => formatCurrency(price))} />)}
            <DetailRow label="Last Trade Date" value={lastTradeInfo.date} color={lastTradeInfo.color} />
            <DetailRow label="Last Trade" value={lastTradeInfo.trade} color={lastTradeInfo.color} />
            <DetailRow label="Last Trade Age" value={lastTradeInfo.age} color={lastTradeInfo.color} />
            <DetailRow label="Bid/Ask Spread" value={formatCurrency(spread)} />
            <DetailRow label="Bid/Ask Spread %" value={formatPercent(spreadPct)} />
            <DetailRow label="Volume" value={formatInteger(option.volume)} />
            <DetailRow label="Open Interest" value={formatInteger(option.openInterest)} />
          </Section>

          <Section title="Risk / Option Metrics">
            <DetailRow label="Strike" value={formatCurrency(option.strike)} />
            <DetailRow label="Delta" value={formatPlainNumber(option.delta, 3)} />
            <DetailRow label="Delta source" value={deltaSourceLabel(option)} />
            <DetailRow label="IV" value={isFiniteNumber(option.impliedVolatility) ? `${option.impliedVolatility.toFixed(1)}%` : '—'} />
            <DetailRow label="Moneyness" value={moneynessLabel} color={moneynessColor || undefined} />
            <DetailRow label="DTE" value={isFiniteNumber(dte) ? `${dte}` : '—'} />
            <DetailRow label="Expiration" value={expirationLabel || '—'} />
            <DetailRow label="Distance to Strike" value={formatPercent(distanceToStrike)} />
          </Section>
        </div>
      </aside>
    </div>
  );
}
