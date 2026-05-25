import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';

export interface OptionDetail {
  strike: number;
  last: number | null;
  bid: number | null;
  ask: number | null;
  delta: number;
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

interface OptionDetailDrawerProps {
  option: OptionDetail | null;
  ticker: string;
  expirationLabel: string;
  dte: number | null;
  underlyingPrice: number | null;
  onClose: () => void;
}

function isValidNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function formatCurrency(value: number | null | undefined, decimals = 2): string {
  if (!isValidNumber(value)) return '—';
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatPlainNumber(value: number | null | undefined, decimals = 2): string {
  if (!isValidNumber(value)) return '—';
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatInteger(value: number | null | undefined): string {
  if (!isValidNumber(value)) return '—';
  return Math.round(value).toLocaleString('en-US');
}

function formatPercent(value: number | null | undefined, decimals = 2): string {
  if (!isValidNumber(value)) return '—';
  return `${(value * 100).toFixed(decimals)}%`;
}

function getMidPrice(option: OptionDetail): number | null {
  const bid = option.bid;
  const ask = option.ask;
  if (isValidNumber(bid) && isValidNumber(ask) && bid > 0 && ask > 0) {
    return (bid + ask) / 2;
  }
  return null;
}

function getDefaultSoldPrice(option: OptionDetail): number | null {
  if (isValidNumber(option.bid) && option.bid >= 0) return option.bid;
  const mid = getMidPrice(option);
  if (isValidNumber(mid)) return mid;
  if (isValidNumber(option.last) && option.last > 0) return option.last;
  return null;
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
}: OptionDetailDrawerProps) {
  const defaultPrice = useMemo(() => option ? getDefaultSoldPrice(option) : null, [option]);
  const [contracts, setContracts] = useState(1);
  const [soldPrice, setSoldPrice] = useState('');

  useEffect(() => {
    setContracts(1);
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
  const spread = isValidNumber(bid) && isValidNumber(ask) ? ask - bid : null;
  const spreadPct = isValidNumber(spread) && isValidNumber(mid) && mid > 0 ? spread / mid : null;

  const parsedSoldPrice = soldPrice.trim() === '' ? null : Number(soldPrice);
  const validSoldPrice = isValidNumber(parsedSoldPrice) && parsedSoldPrice >= 0 ? parsedSoldPrice : null;
  const optionPrice = validSoldPrice;
  const premiumPerContract = isValidNumber(optionPrice) ? optionPrice * 100 : null;
  const breakeven = isValidNumber(optionPrice) ? option.strike - optionPrice : null;
  const downsideCushion = isValidNumber(underlyingPrice) && underlyingPrice > 0 && isValidNumber(breakeven)
    ? (underlyingPrice - breakeven) / underlyingPrice
    : null;
  const simpleYield = isValidNumber(optionPrice) && option.strike > 0 ? optionPrice / option.strike : null;
  const annualizedYield = isValidNumber(simpleYield) && isValidNumber(dte) && dte > 0 ? simpleYield * (365 / dte) : null;
  const distanceToStrike = isValidNumber(underlyingPrice) && underlyingPrice > 0
    ? (underlyingPrice - option.strike) / underlyingPrice
    : null;

  const validContracts = Number.isInteger(contracts) && contracts >= 1 ? contracts : null;
  const totalPremium = isValidNumber(validSoldPrice) && isValidNumber(validContracts) ? validSoldPrice * 100 * validContracts : null;
  const totalEquityAtRisk = isValidNumber(validContracts) ? option.strike * 100 * validContracts : null;
  const calculatorBreakeven = isValidNumber(validSoldPrice) ? option.strike - validSoldPrice : null;
  const maxLoss = isValidNumber(totalEquityAtRisk) && isValidNumber(totalPremium) ? totalEquityAtRisk - totalPremium : null;
  const netCapitalAtRisk = maxLoss;
  const returnOnRisk = isValidNumber(totalPremium) && isValidNumber(netCapitalAtRisk) && netCapitalAtRisk > 0
    ? totalPremium / netCapitalAtRisk
    : null;
  const annualizedReturn = isValidNumber(returnOnRisk) && isValidNumber(dte) && dte > 0 ? returnOnRisk * (365 / dte) : null;

  const setSoldPriceFromQuote = (value: number | null | undefined) => {
    if (isValidNumber(value) && value >= 0) setSoldPrice(value.toFixed(2));
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
              Exp {expirationLabel || '—'} • {isValidNumber(dte) ? `${dte} DTE` : '— DTE'}
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
          <MetricCard label="Premium / Contract" value={formatCurrency(premiumPerContract)} color="var(--accent-light)" />
          <MetricCard label="Breakeven" value={formatCurrency(breakeven)} />
          <MetricCard label="Downside Cushion" value={formatPercent(downsideCushion)} color={isValidNumber(downsideCushion) && downsideCushion >= 0 ? 'var(--green)' : 'var(--red)'} />
          <MetricCard label="Annualized Yield" value={formatPercent(annualizedYield)} color={isValidNumber(annualizedYield) && annualizedYield >= 0.25 ? 'var(--green)' : 'var(--yellow)'} />
        </div>

        <div className="space-y-3">
          <Section title="Position Calculator">
            <div className="grid grid-cols-1 min-[390px]:grid-cols-2 gap-2 mb-3">
              <label className="block">
                <span className="block text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Contracts</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  value={contracts}
                  onChange={event => setContracts(Math.max(1, Math.floor(Number(event.target.value) || 1)))}
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
                  disabled={!isValidNumber(value as number | null)}
                  className="px-3 py-2 sm:py-1.5 rounded-lg text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed min-h-[40px]"
                  style={{ backgroundColor: 'var(--accent-bg)', color: 'var(--accent-light)', border: '1px solid var(--accent-border)' }}
                >
                  {label}
                </button>
              ))}
            </div>
            <DetailRow label="Total Premium" value={formatCurrency(totalPremium)} color="var(--green)" />
            <DetailRow label="Total Equity at Risk" value={formatCurrency(totalEquityAtRisk)} />
            <DetailRow label="Maximum Loss" value={formatCurrency(maxLoss)} color="var(--red)" />
            <DetailRow label="Breakeven Price" value={formatCurrency(calculatorBreakeven)} />
            <DetailRow label="Net Capital at Risk" value={formatCurrency(netCapitalAtRisk)} />
            <DetailRow label="Return on Risk" value={formatPercent(returnOnRisk)} color="var(--accent-light)" />
            <DetailRow label="Annualized Return" value={formatPercent(annualizedReturn)} color="var(--green)" />
          </Section>

          <Section title="Key Trade Metrics">
            <DetailRow compact label="Option Price" value={formatCurrency(optionPrice)} />
            <DetailRow compact label="Premium per Contract" value={formatCurrency(premiumPerContract)} />
            <DetailRow compact label="Breakeven Share Price" value={formatCurrency(breakeven)} />
            <DetailRow compact label="Downside Cushion" value={formatPercent(downsideCushion)} />
            <DetailRow compact label="Simple Yield" value={formatPercent(simpleYield)} />
            <DetailRow compact label="Annualized Yield" value={formatPercent(annualizedYield)} />
            <DetailRow compact label="Bid/Ask Spread" value={formatCurrency(spread)} />
            <DetailRow compact label="Bid/Ask Spread %" value={formatPercent(spreadPct)} />
          </Section>

          <Section title="Liquidity">
            <DetailRow label="Bid" value={formatCurrency(bid)} />
            <DetailRow label="Ask" value={formatCurrency(ask)} />
            <DetailRow label="Mid" value={formatCurrency(mid)} />
            <DetailRow label="Last" value={formatCurrency(option.last)} />
            <DetailRow label="Volume" value={formatInteger(option.volume)} />
            <DetailRow label="Open Interest" value={formatInteger(option.openInterest)} />
            <DetailRow label="Vol / OI" value={formatPlainNumber(option.volOI)} />
            <DetailRow label="Spread" value={formatCurrency(spread)} />
            <DetailRow label="Spread %" value={formatPercent(spreadPct)} />
          </Section>

          <Section title="Greeks / Market Data">
            <DetailRow label="Strike" value={formatCurrency(option.strike)} />
            <DetailRow label="Delta" value={formatPlainNumber(option.delta, 3)} />
            <DetailRow label="Gamma" value={formatPlainNumber(option.gamma, 4)} />
            <DetailRow label="Theta" value={formatPlainNumber(option.theta, 4)} />
            <DetailRow label="Vega" value={formatPlainNumber(option.vega, 4)} />
            <DetailRow label="IV" value={isValidNumber(option.impliedVolatility) ? `${option.impliedVolatility.toFixed(1)}%` : '—'} />
            <DetailRow label="Moneyness" value={option.otmItmLabel || '—'} color={option.otmItmColor || undefined} />
            <DetailRow label="DTE" value={isValidNumber(dte) ? `${dte}` : '—'} />
            <DetailRow label="Expiration" value={expirationLabel || '—'} />
            <DetailRow label="Underlying Price" value={formatCurrency(underlyingPrice)} />
            <DetailRow label="Distance to Strike" value={formatPercent(distanceToStrike)} />
          </Section>
        </div>
      </aside>
    </div>
  );
}
