import { useLayoutEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import {
  isScannerOptionSnapshotStale,
  scannerLiquidityLabelText,
  type ScannerLiquidityLabel,
  type ScannerOptionSnapshot,
  type ScannerSnapshotDiagnostic,
  type SnapshotConfidence,
} from '../lib/scannerOptionSnapshot';
import { formatOptionQuoteValue, orderedOptionQuoteEntries } from '../lib/optionQuoteDisplay';

function liquidityColor(label: ScannerLiquidityLabel | undefined): string {
  if (label === 'very_liquid' || label === 'liquid') return 'var(--green)';
  if (label === 'medium') return 'var(--yellow)';
  if (label === 'thin') return 'var(--orange)';
  if (label === 'illiquid') return 'var(--red)';
  return 'var(--text-dim)';
}

function formatSnapshotMoney(value: number | null | undefined): string {
  return value != null && Number.isFinite(value) ? `$${value.toFixed(2)}` : '—';
}

function formatSnapshotDate(timestamp: number | null | undefined): string {
  if (timestamp == null || !Number.isFinite(timestamp)) return '—';
  return new Date(timestamp * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function formatSnapshotNumber(value: number | null | undefined, fractionDigits = 0): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

function formatSnapshotUpdatedAt(value: string | null | undefined): string {
  if (!value) return '—';
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString('en-US') : '—';
}

function confidenceText(value: SnapshotConfidence | null | undefined): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : '—';
}

function expirationConfidence(snapshot: ScannerOptionSnapshot | null | undefined): SnapshotConfidence | null {
  if (snapshot?.expirationSelectionTier === 'ideal') return 'high';
  if (snapshot?.expirationSelectionTier === 'normal') return 'normal';
  if (snapshot?.expirationSelectionTier === 'expanded') return 'reduced';
  if (snapshot?.expirationSelectionTier === 'broad') return 'low';
  return null;
}

function snapshotIvText(snapshot: ScannerOptionSnapshot | null | undefined): string {
  const iv = snapshot?.atmPutIv;
  if (iv == null || !Number.isFinite(iv) || iv <= 0) return '—';
  return `${iv.toLocaleString('en-US', { maximumFractionDigits: 1 })}%`;
}

function methodologyText(snapshot: ScannerOptionSnapshot | null | undefined): string {
  if (!snapshot?.atmIvMethod) return '—';
  if (snapshot.atmIvMethod === 'interpolated') {
    return snapshot.atmLowerStrike != null && snapshot.atmUpperStrike != null
      ? `Interpolated between ${formatSnapshotMoney(snapshot.atmLowerStrike)} and ${formatSnapshotMoney(snapshot.atmUpperStrike)} puts`
      : 'Interpolated between bracketing puts';
  }
  return snapshot.atmStrike != null
    ? `Nearest valid ${formatSnapshotMoney(snapshot.atmStrike)} put`
    : 'Nearest valid put';
}

function SnapshotMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 leading-5">
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span className="font-mono tabular-nums text-right" style={{ color: 'var(--text)' }}>{value}</span>
    </div>
  );
}

export function ScannerSnapshotEvidence({
  snapshot,
  diagnostic,
}: {
  snapshot: ScannerOptionSnapshot | null | undefined;
  diagnostic: ScannerSnapshotDiagnostic | null | undefined;
}) {
  const stale = snapshot ? isScannerOptionSnapshotStale(snapshot) : false;
  const liquidityText = scannerLiquidityLabelText(snapshot?.liquidityLabel ?? 'unavailable');
  const expirationText = snapshot
    ? `${formatSnapshotDate(snapshot.expiration)} · ${formatSnapshotNumber(snapshot.dte)} DTE`
    : '—';
  const integrityText = snapshot?.integrityStatus
    ? snapshot.integrityStatus.charAt(0).toUpperCase() + snapshot.integrityStatus.slice(1)
    : 'Unavailable';

  return (
    <>
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="text-xs font-semibold">Options Snapshot</div>
      </div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>IV benchmark</div>
      <div className="mb-1 text-[10px] leading-4" style={{ color: 'var(--text-muted)' }}>Selected expiration confirms listed availability. IV and liquidity use the bounded benchmark chain shown below.</div>
      <SnapshotMetric label="Target" value="60 DTE ATM put" />
      <SnapshotMetric label="Used" value={expirationText} />
      <SnapshotMetric label="Expiration tier" value={snapshot?.expirationSelectionTier ? snapshot.expirationSelectionTier.replace('_', ' ') : '—'} />
      <SnapshotMetric label="Expiration confidence" value={confidenceText(expirationConfidence(snapshot))} />
      <SnapshotMetric label="Method" value={methodologyText(snapshot)} />
      <SnapshotMetric
        label="ATM moneyness"
        value={snapshot?.atmMoneynessPercent != null && Number.isFinite(snapshot.atmMoneynessPercent)
          ? `${snapshot.atmMoneynessPercent >= 0 ? '+' : ''}${snapshot.atmMoneynessPercent.toFixed(1)}%`
          : '—'}
      />
      <SnapshotMetric label="ATM IV" value={snapshotIvText(snapshot)} />
      <SnapshotMetric label="ATM confidence" value={confidenceText(snapshot?.atmConfidence)} />
      <SnapshotMetric label="Price source" value={snapshot?.underlyingPriceSource ? snapshot.underlyingPriceSource.replace('_', ' ') : '—'} />
      <div className="mb-1 mt-2 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>Liquidity benchmark</div>
      <SnapshotMetric label="Target" value="30% OTM put" />
      <SnapshotMetric label="Used" value={snapshot?.liquidityStrike != null && snapshot.actualOtmPercent != null && Number.isFinite(snapshot.actualOtmPercent) ? `${formatSnapshotMoney(snapshot.liquidityStrike)} · ${snapshot.actualOtmPercent.toFixed(1)}% OTM` : '—'} />
      <SnapshotMetric label="Selection tier" value={snapshot?.liquiditySelectionTier ? snapshot.liquiditySelectionTier.replace('_', ' ') : '—'} />
      {orderedOptionQuoteEntries({ last: snapshot?.last, bid: snapshot?.bid, mid: snapshot?.midpoint, ask: snapshot?.ask }).map(({ field, label, value }) => <SnapshotMetric key={field} label={label} value={formatOptionQuoteValue(field, value, formatSnapshotMoney)} />)}
      <SnapshotMetric label="Last Trade" value={formatSnapshotDate(snapshot?.lastTradeDate)} />
      <SnapshotMetric label="Open Interest" value={formatSnapshotNumber(snapshot?.openInterest)} />
      <SnapshotMetric label="Volume" value={formatSnapshotNumber(snapshot?.volume)} />
      <SnapshotMetric label="Spread" value={snapshot?.spreadPercent != null && Number.isFinite(snapshot.spreadPercent) ? `${formatSnapshotMoney(snapshot.absoluteSpread)} · ${(snapshot.spreadPercent * 100).toFixed(1)}%` : '—'} />
      <SnapshotMetric label="Nearby bids" value={snapshot ? `${snapshot.neighboringStrikesWithBid} of ${snapshot.neighboringStrikeCount}` : '—'} />
      <div className="mt-2 flex items-center justify-between gap-3 border-t pt-1.5" style={{ borderColor: 'var(--border)' }}>
        <span style={{ color: 'var(--text-muted)' }}>Liquidity</span>
        <span className="font-semibold" style={{ color: liquidityColor(snapshot?.liquidityLabel) }}>{liquidityText}</span>
      </div>
      <SnapshotMetric label="Confidence" value={confidenceText(snapshot?.liquidityConfidence)} />
      <SnapshotMetric label="Evidence integrity" value={integrityText} />
      {snapshot?.integrityStatus === 'degraded' && <div className="mt-1 leading-4" style={{ color: 'var(--yellow)' }}>Degraded evidence: numeric metrics remain visible, but this is not trusted Liquid evidence.</div>}
      {snapshot?.integrityStatus === 'invalid' && <div className="mt-1 leading-4" style={{ color: 'var(--red)' }}>Invalid evidence: trusted IV/liquidity qualification is unavailable.</div>}
      {snapshot?.spreadGuardrail && <div className="mt-1 leading-4" style={{ color: 'var(--text-dim)' }}>{snapshot.spreadGuardrail}</div>}
      {snapshot?.fallbackReason && <div className="mt-1 leading-4" style={{ color: 'var(--yellow)' }}>{snapshot.fallbackReason}</div>}
      {snapshot?.unavailableReason && <div className="mt-1 leading-4" style={{ color: 'var(--red)' }}>Unavailable: {snapshot.unavailableReason}</div>}
      {diagnostic && (
        <div className="mt-1 leading-4" style={{ color: diagnostic.status === 'failed' ? 'var(--red)' : 'var(--yellow)' }}>
          Last update {diagnostic.status}: {diagnostic.reason}
        </div>
      )}
      <div className="mt-1 text-[10px]" style={{ color: 'var(--text-dim)' }}>
        Updated: {formatSnapshotUpdatedAt(snapshot?.updatedAt)}{stale ? ' · Stale' : ''}
      </div>
    </>
  );
}

interface ScannerEvidencePopoverProps {
  id: string;
  ticker: string;
  anchor: HTMLElement | null;
  snapshot: ScannerOptionSnapshot | null | undefined;
  diagnostic: ScannerSnapshotDiagnostic | null | undefined;
  onClose: (restoreFocus?: boolean) => void;
}

interface EvidencePlacement {
  top: number;
  left: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export default function ScannerEvidencePopover({ id, ticker, anchor, snapshot, diagnostic, onClose }: ScannerEvidencePopoverProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [placement, setPlacement] = useState<EvidencePlacement | null>(null);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel || !anchor?.isConnected) {
      onClose(false);
      return undefined;
    }

    const place = () => {
      if (!anchor.isConnected || !panel.isConnected) {
        onClose(false);
        return;
      }
      const anchorRect = anchor.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const gutter = 8;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const preferredLeft = anchorRect.right - panelRect.width;
      const left = clamp(preferredLeft, gutter, viewportWidth - panelRect.width - gutter);
      const below = anchorRect.bottom + gutter;
      const above = anchorRect.top - panelRect.height - gutter;
      const top = below + panelRect.height <= viewportHeight - gutter || above < gutter ? below : above;
      setPlacement({ top: clamp(top, gutter, viewportHeight - panelRect.height - gutter), left });
    };

    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor, onClose]);

  return (
    <div
      ref={panelRef}
      id={id}
      role="region"
      aria-label={`${ticker} options evidence`}
      className="scanner-snapshot-tooltip fixed z-[60] max-h-[calc(100dvh-1rem)] w-[min(320px,calc(100vw-1rem))] overflow-y-auto rounded-lg px-3 py-2 text-[11px] shadow-xl"
      style={{
        top: placement?.top ?? 0,
        left: placement?.left ?? 0,
        visibility: placement ? 'visible' : 'hidden',
        backgroundColor: 'var(--surface)',
        border: '1px solid var(--border)',
        color: 'var(--text)',
        boxShadow: 'var(--shadow-overlay)',
      }}
      onKeyDown={event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose(true);
        }
      }}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>Evidence for {ticker}</span>
        <button type="button" className="tap-target -mr-2 -mt-1 inline-flex h-8 w-8 items-center justify-center rounded-md" onClick={() => onClose(true)} aria-label="Close options evidence">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <ScannerSnapshotEvidence snapshot={snapshot} diagnostic={diagnostic} />
    </div>
  );
}
