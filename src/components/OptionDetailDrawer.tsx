import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import {
  calculateBidAskSpread,
  calculateBidAskSpreadPercent,
  calculateBreakeven,
  calculatePositionMetrics,
  isFiniteNumber,
} from '../lib/optionMetrics';
import { formatCurrency, formatNumber, formatPercent, normalizeTimestampMs } from '../lib/format';

export interface OptionDetail {
  strike: number;
  last: number | null;
  lastTradeDate: number | null;
  bid: number | null;
  ask: number | null;
  delta: number | null;
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

function getLastTradeInfo(value: number | null | undefined): { trade: string; age: string; color?: string } {
  const timestamp = normalizeTimestampMs(value);
  if (timestamp == null) return { trade: 'â€”', age: 'â€”' };

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

function MetricCard({ label, value, color = 'var(--text)' }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-lg p-2.5 sm:p-3 min-w-0" style={{ backgroundColor: 'var(--surface-alt)', border: '1px solid var(--border)' }}>
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
    <section className="rounded-lg p-3 min-w-0" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
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
  const defaultPrice = useMemo(() => option ? getDefaultSoldPrice(option) : null, [option]);
  const [contracts, setContracts] = useState('1');
  const [soldPrice, setSoldPrice] = useState('');

  useEffect(() => {
    setContracts('1');
    setSoldPrice(defaultPrice != null ? defaultPrice.toFixed(2) : '');
  }, [defaultPrice, option?.strike]);

  useEffect(() => {
    if (!option) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [option, onClose]);

  if (!option) return null;

  const bid = option.bid;
  const ask = option.ask;
  const mid = getMidPrice(option);
  const spread = calculateBidAskSpread(bid, ask);
  const spreadPct = calculateBidAskSpreadPercent(bid, ask);
  const lastTradeInfo = getLastTradeInfo(option.lastTradeDate);

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

  const setSoldPriceFromQuote = (value: number | null | undefined) => {
    if (isFiniteNumber(value) && value >= 0) setSoldPrice(value.toFixed(2));
  };

  return (
    <div className="fixed inset-0 z-[70]">
      <button
        type="button"
        aria-label="Close option detail drawer"
        onClick={onClose}
        className="absolute inset-0 bg-black/50"
      />
      <aside
        className="absolute inset-x-0 bottom-0 max-h-[94vh] w-full overflow-y-auto rounded-t-2xl p-3 shadow-2xl sm:inset-y-0 sm:left-auto sm:right-0 sm:h-full sm:max-h-none sm:w-[480px] md:w-[520px] lg:w-[560px] sm:rounded-none sm:p-5"
        style={{ backgroundColor: 'var(--bg)', borderLeft: '1px solid var(--border)' }}
      >
        <div className="flex items-start justify-between gap-3 mb-4 min-w-0">
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
            className="p-2 rounded-lg transition-all min-h-[44px] min-w-[44px] flex items-center justify-center"
            style={{ backgroundColor: 'var(--surface)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 min-[390px]:grid-cols-2 gap-2 mb-3 min-w-0">
          <MetricCard label="Option Price" value={formatCurrency(activeSoldPrice)} color="var(--accent-light)" />
          <MetricCard label="Breakeven" value={formatCurrency(topBreakeven)} />
          <MetricCard label="Downside Cushion" value={formatPercent(positionMetrics.downsideCushion)} color={isFiniteNumber(positionMetrics.downsideCushion) && positionMetrics.downsideCushion >= 0 ? 'var(--green)' : 'var(--red)'} />
          <MetricCard label="Ann. Return" value={formatPercent(positionMetrics.annualizedReturn)} color={isFiniteNumber(positionMetrics.annualizedReturn) && positionMetrics.annualizedReturn >= 0.25 ? 'var(--green)' : 'var(--yellow)'} />
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
            <div className="flex flex-wrap gap-2 mb-3">
              {[
                ['Bid', bid],
                ['Mid', mid],
                ['Ask', ask],
              ].map(([label, value]) => (
                <button
                  key={label as string}
                  onClick={() => setSoldPriceFromQuote(value as number | null)}
                  disabled={!isFiniteNumber(value as number | null)}
                  className="px-3 py-2 sm:py-1.5 rounded-lg text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed min-h-[40px]"
                  style={{ backgroundColor: 'var(--accent-bg)', color: 'var(--accent-light)', border: '1px solid var(--accent-border)' }}
                >
                  {label}
                </button>
              ))}
            </div>
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
                className="w-full mb-3 px-3 py-2 rounded-lg text-xs font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed min-h-[42px]"
                style={{ backgroundColor: 'var(--accent)' }}
              >
                Add to Portfolio
              </button>
            )}
            <DetailRow label="Total Premium" value={formatCurrency(positionMetrics.totalPremium)} color="var(--green)" />
            <DetailRow label="Equity at Risk" value={formatCurrency(positionMetrics.equityAtRisk)} />
            <DetailRow label="Max Loss" value={formatCurrency(positionMetrics.maximumLoss)} color="var(--red)" />
            <DetailRow label="Net Capital at Risk" value={formatCurrency(positionMetrics.netCapitalAtRisk)} />
            <DetailRow label="Breakeven" value={formatCurrency(positionMetrics.breakeven)} />
            <DetailRow label="Return on Risk" value={formatPercent(positionMetrics.returnOnRisk)} color="var(--accent-light)" />
            <DetailRow label="Annualized Return" value={formatPercent(positionMetrics.annualizedReturn)} color="var(--green)" />
          </Section>

          <Section title="Market Quote">
            <DetailRow label="Bid" value={formatCurrency(bid)} />
            <DetailRow label="Ask" value={formatCurrency(ask)} />
            <DetailRow label="Mid" value={formatCurrency(mid)} />
            <DetailRow label="Last" value={formatCurrency(option.last)} />
            <DetailRow label="Last Trade" value={lastTradeInfo.trade} />
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
