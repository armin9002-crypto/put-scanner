import { useEffect, useMemo, useState } from 'react';
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
import { orderedOptionQuoteEntries } from '../lib/optionQuoteDisplay';
import type { PutDeltaSource } from '../lib/putDelta';

export interface OptionDetail {
  strike: number;
  last: number | null;
  lastTradeDate: number | null;
  bid: number | null;
  ask: number | null;
  delta: number | null;
  deltaSource?: PutDeltaSource | null;
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

function getMidPrice(option: OptionDetail): number | null {
  const bid = option.bid;
  const ask = option.ask;
  if (isFiniteNumber(bid) && isFiniteNumber(ask) && bid > 0 && ask > 0) {
    return (bid + ask) / 2;
  }
  return null;
}

function getDefaultSoldPrice(option: OptionDetail): number | null {
  if (isFiniteNumber(option.bid) && option.bid >= 0) return option.bid;
  const mid = getMidPrice(option);
  if (isFiniteNumber(mid)) return mid;
  if (isFiniteNumber(option.last) && option.last > 0) return option.last;
  return null;
}

function isUsableLastPrice(value: number | null | undefined): value is number {
  return isFiniteNumber(value) && value > 0;
}

function calendarDayDiff(timestamp: number, now = Date.now()): number {
  const tradeDate = new Date(timestamp);
  const currentDate = new Date(now);
  const tradeMidnight = new Date(tradeDate.getFullYear(), tradeDate.getMonth(), tradeDate.getDate()).getTime();
  const currentMidnight = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate()).getTime();
  return Math.max(0, Math.floor((currentMidnight - tradeMidnight) / (24 * 60 * 60 * 1000)));
}

function formatTradeTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatTradeDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function getLastTradeInfo(value: number | null | undefined): { trade: string; age: string; color?: string } {
  const timestamp = normalizeTimestampMs(value);
  if (timestamp == null) return { trade: '—', age: '—' };

  const dayDiff = calendarDayDiff(timestamp);
  if (dayDiff === 0) {
    return { trade: `Today ${formatTradeTime(timestamp)}`, age: 'Today', color: 'var(--green)' };
  }
  if (dayDiff === 1) {
    return { trade: `Yesterday ${formatTradeTime(timestamp)}`, age: 'Yesterday', color: 'var(--text-muted)' };
  }
  if (dayDiff <= 2) {
    return { trade: `${dayDiff}d ago`, age: `${dayDiff}d ago`, color: 'var(--text-muted)' };
  }
  if (dayDiff <= 7) {
    return { trade: `${dayDiff}d ago`, age: `${dayDiff}d ago - Stale`, color: 'var(--yellow)' };
  }
  return { trade: `${dayDiff}d ago`, age: `${dayDiff}d ago - Very Stale`, color: 'var(--red)' };
}

function getLastTradeDetail(value: number | null | undefined): { trade: string; date: string; age: string; warning: string | null; color?: string } {
  const timestamp = normalizeTimestampMs(value);
  if (timestamp == null) return { trade: '\u2014', date: '\u2014', age: '\u2014', warning: null };

  const legacyInfo = getLastTradeInfo(value);
  const dayDiff = calendarDayDiff(timestamp);
  const date = formatTradeDate(timestamp);
  if (dayDiff === 0) {
    return { trade: legacyInfo.trade, date, age: 'Today', warning: null, color: 'var(--green)' };
  }
  if (dayDiff === 1) {
    return { trade: legacyInfo.trade, date, age: 'Yesterday', warning: null, color: 'var(--text-muted)' };
  }
  if (dayDiff <= 2) {
    return { trade: legacyInfo.trade, date, age: `${dayDiff}d ago`, warning: null, color: 'var(--text-muted)' };
  }
  if (dayDiff <= 7) {
    return { trade: legacyInfo.trade, date, age: `${dayDiff}d ago - Stale`, warning: 'Last may be stale; check Last Trade Date.', color: 'var(--yellow)' };
  }
  return { trade: legacyInfo.trade, date, age: `${dayDiff}d ago - Very Stale`, warning: 'Last trade is very stale; use bid/ask with extra care.', color: 'var(--red)' };
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

export default function OptionDetailDrawer({
  option,
  ticker,
  expirationLabel,
  dte,
  underlyingPrice,
  onClose,
  onAddToPortfolio,
}: OptionDetailDrawerProps) {
  const { isPhone } = useResponsiveMode();
  const defaultPrice = useMemo(() => option ? getDefaultSoldPrice(option) : null, [option]);
  const [contracts, setContracts] = useState('1');
  const [soldPrice, setSoldPrice] = useState('');

  useEffect(() => {
    setContracts('1');
    setSoldPrice(defaultPrice != null ? defaultPrice.toFixed(2) : '');
  }, [defaultPrice, option?.strike]);

  useEffect(() => {
    if (!option) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [option, onClose]);

  if (!option) return null;

  const bid = option.bid;
  const ask = option.ask;
  const mid = getMidPrice(option);
  const spread = calculateBidAskSpread(bid, ask);
  const spreadPct = calculateBidAskSpreadPercent(bid, ask);
  const lastTradeInfo = getLastTradeDetail(option.lastTradeDate);
  const usableLast = isUsableLastPrice(option.last) ? option.last : null;

  const parsedSoldPrice = soldPrice.trim() === '' ? null : Number(soldPrice);
  const validSoldPrice = isFiniteNumber(parsedSoldPrice) && parsedSoldPrice >= 0 ? parsedSoldPrice : null;
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

  const setSoldPriceFromQuote = (value: number | null | undefined) => {
    if (isFiniteNumber(value) && value >= 0) setSoldPrice(value.toFixed(2));
  };

  if (isPhone) {
    const quoteOptions = orderedOptionQuoteEntries({ last: usableLast, bid, mid, ask });
    const addToPortfolio = () => {
      if (!onAddToPortfolio || activeSoldPrice == null || validContracts == null) return;
      onAddToPortfolio({ option, soldPrice: activeSoldPrice, contracts: validContracts, underlyingPrice });
    };
    return (
      <div className="fixed inset-0 z-[90] option-drawer-mobile" role="dialog" aria-modal="true" aria-label={`${ticker} ${formatCurrency(option.strike)} put details`}>
        <div className="mobile-trade-sheet absolute inset-0 overflow-y-auto" style={{ backgroundColor: 'var(--bg)' }}>
          <header className="mobile-trade-sheet__header drawer-header sticky top-0 z-20 border-b px-3 pb-2 pt-1" style={{ borderColor: 'var(--border)', backgroundColor: 'color-mix(in srgb, var(--bg) 96%, transparent)' }}>
            <div className="mx-auto mb-1.5 h-1 w-10 rounded-full" aria-hidden="true" style={{ backgroundColor: 'var(--border-strong)' }} />
            <div className="flex min-h-11 items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate font-mono text-[18px] font-bold" style={{ color: 'var(--text)' }}>{ticker} {formatCurrency(option.strike, option.strike % 1 === 0 ? 0 : 2)} Put</h2>
                <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>{expirationLabel || '—'} · {isFiniteNumber(dte) ? `${dte} DTE` : '— DTE'} · Underlying {formatCurrency(underlyingPrice)}</p>
              </div>
              <button type="button" onClick={onClose} className="pressable flex h-11 w-11 flex-none items-center justify-center rounded-full" style={{ color: 'var(--text-muted)', backgroundColor: 'var(--surface-alt)' }} aria-label="Close option details"><X className="h-5 w-5" /></button>
            </div>
          </header>

          <div className="space-y-5 px-4 py-4">
            <section>
              <div className="mobile-segmented drawer-quote-selector" role="group" aria-label="Select sold price quote">
                {quoteOptions.map(({ field, label, value }) => {
                  const selected = isFiniteNumber(value) && activeSoldPrice === value;
                  return <button type="button" key={field} disabled={!isFiniteNumber(value)} onClick={() => setSoldPriceFromQuote(value)} className="pressable mobile-segmented__item disabled:opacity-35" data-selected={selected ? 'true' : 'false'} aria-pressed={selected}>{label}</button>;
                })}
              </div>
              <div className="mt-3 flex items-end justify-between border-b pb-3" style={{ borderColor: 'var(--border)' }}>
                <span className="text-[13px]" style={{ color: 'var(--text-muted)' }}>Selected price</span>
                <span className="font-mono text-[26px] font-semibold tabular-nums" style={{ color: 'var(--accent-light)' }}>{formatCurrency(activeSoldPrice)}</span>
              </div>
              <div className="mt-1 divide-y" style={{ borderColor: 'var(--border)' }}>
                <DetailRow label="Nominal Yield" value={formatPercent(securedCashYield)} color="var(--accent-light)" />
                <DetailRow label="Annualized Yield" value={formatPercent(annualizedSecuredCashYield)} color="var(--green)" />
                <DetailRow label="Delta" value={formatPlainNumber(option.delta, 3)} />
                <DetailRow label="Moneyness" value={option.otmItmLabel || '—'} color={option.otmItmColor || undefined} />
                <DetailRow label="Breakeven" value={formatCurrency(topBreakeven)} />
                <DetailRow label="Implied Volatility" value={isFiniteNumber(option.impliedVolatility) ? `${option.impliedVolatility.toFixed(1)}%` : '—'} />
                <DetailRow label="Open Interest" value={formatInteger(option.openInterest)} />
              </div>
            </section>

            <section className="border-t pt-4" style={{ borderColor: 'var(--border)' }}>
              <h3 className="mb-3 text-[16px] font-semibold" style={{ color: 'var(--text)' }}>Position Calculator</h3>
              <div className="grid grid-cols-2 gap-3">
                <label><span className="mobile-sheet-label">Contracts</span><input type="text" inputMode="numeric" value={contracts} onChange={event => /^\d*$/.test(event.target.value) && setContracts(event.target.value)} onBlur={() => { const value = Number(contracts); setContracts(Number.isInteger(value) && value >= 1 ? String(value) : '1'); }} className="mobile-control-field w-full font-mono" /></label>
                <label><span className="mobile-sheet-label">Sold Price</span><input type="number" inputMode="decimal" min={0} step="0.01" value={soldPrice} onChange={event => { const next = event.target.value; if (next === '' || Number(next) >= 0) setSoldPrice(next); }} className="mobile-control-field w-full font-mono" /></label>
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
                {orderedOptionQuoteEntries({ last: option.last, bid, mid, ask }).map(({ field, label, value }) => <DetailRow key={field} label={label} value={formatCurrency(value)} />)}
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
    <div className="fixed inset-0 z-[70] option-drawer-desktop">
      <button
        type="button"
        aria-label="Close option detail drawer"
        onClick={onClose}
        className="absolute inset-0 bg-black/50"
      />
      <aside
        className="option-detail-drawer drawer-shell overlay-panel absolute inset-x-0 bottom-0 max-h-[94dvh] w-full overflow-y-auto rounded-t-2xl p-3 sm:inset-y-0 sm:left-auto sm:right-0 sm:h-full sm:max-h-none sm:w-[480px] md:w-[520px] lg:w-[560px] sm:rounded-l-[14px] sm:rounded-r-none sm:p-5"
        style={{ backgroundColor: 'var(--bg)', borderLeft: '1px solid var(--border)' }}
      >
        <div className="mx-auto mb-2 h-1 w-10 rounded-full sm:hidden" aria-hidden="true" style={{ backgroundColor: 'var(--border-strong)' }} />
        <div className="option-detail-drawer__header sticky -top-3 z-10 -mx-3 mb-3 flex min-w-0 items-start justify-between gap-3 px-3 pb-3 sm:static sm:mx-0 sm:mb-4 sm:p-0">
          <div className="min-w-0">
            <h2 className="text-lg sm:text-xl font-bold font-mono break-words" style={{ color: 'var(--text)' }}>
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
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  value={soldPrice}
                  onChange={event => {
                    const next = event.target.value;
                    if (next === '' || Number(next) >= 0) setSoldPrice(next);
                  }}
                  className="w-full rounded-lg px-3 py-2 text-base sm:text-sm font-mono outline-none min-h-[44px]"
                  style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text)' }}
                />
              </label>
            </div>
            <div className="grid grid-cols-4 gap-1 mb-3 rounded-xl p-1 drawer-quote-selector" style={{ backgroundColor: 'var(--surface-alt)', border: '1px solid var(--border)' }} role="group" aria-label="Use market quote as sold price">
              {orderedOptionQuoteEntries({ last: usableLast, bid, mid, ask }).map(({ field, label, value }) => (
                <button
                  key={field}
                  onClick={() => setSoldPriceFromQuote(value)}
                  disabled={!isFiniteNumber(value)}
                  className="pressable min-h-[44px] rounded-lg px-2 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-[40px]"
                  style={{ backgroundColor: activeSoldPrice === value ? 'var(--accent)' : 'transparent', color: activeSoldPrice === value ? 'white' : 'var(--accent-light)' }}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="mb-3 text-[11px] leading-4" style={{ color: lastTradeInfo.warning ? lastTradeInfo.color : 'var(--text-dim)' }}>
              Last may be stale; check Last Trade Date{lastTradeInfo.warning ? ` - ${lastTradeInfo.warning}` : '.'}
            </p>
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
            {orderedOptionQuoteEntries({ last: option.last, bid, mid, ask }).map(({ field, label, value }) => <DetailRow key={field} label={label} value={formatCurrency(value)} />)}
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
            <DetailRow label="IV" value={isFiniteNumber(option.impliedVolatility) ? `${option.impliedVolatility.toFixed(1)}%` : '—'} />
            <DetailRow label="Moneyness" value={option.otmItmLabel || '—'} color={option.otmItmColor || undefined} />
            <DetailRow label="DTE" value={isFiniteNumber(dte) ? `${dte}` : '—'} />
            <DetailRow label="Expiration" value={expirationLabel || '—'} />
            <DetailRow label="Distance to Strike" value={formatPercent(distanceToStrike)} />
          </Section>
        </div>
      </aside>
    </div>
  );
}
