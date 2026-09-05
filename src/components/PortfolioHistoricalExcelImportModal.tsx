import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Loader2, ShieldCheck, Upload, X } from 'lucide-react';
import { useAccountState } from '../lib/cloudState/accountStateContext.ts';
import {
  enrichHistoricalExcelEntryVix,
  historicalExcelDestinationLabel,
  historicalExcelStateLabel,
  parseHistoricalExcelWorkbook,
  summarizeHistoricalExcelImport,
  type HistoricalExcelParseResult,
  type StagedHistoricalExcelLot,
} from '../lib/portfolioHistoricalExcelImport.ts';
import { toDurablePortfolioState, type PortfolioTrade } from '../lib/portfolioStorage.ts';
import {
  buildPortfolioHistoricalCsvExport,
  downloadPortfolioHistoricalCsvExport,
} from '../lib/portfolioHistoricalCsvExport.ts';
import type { MarkBasis } from '../lib/portfolioMetrics.ts';
import { downloadPutScannerBackup } from '../lib/userDataBackup.ts';

interface Props {
  trades: PortfolioTrade[];
  markBasis: MarkBasis;
  onClose: () => void;
  onImported: () => void;
}

interface ImportReceipt {
  importedLots: number;
  affectedContracts: number;
  newContracts: number;
  skippedDuplicates: number;
  reviewRows: number;
  blockedRows: number;
  expirationPrices: number;
  closeContextPrices: number;
  entryVixCount: number;
  backupFilename: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The workbook could not be staged safely. No data was changed.';
}

function money(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? '—' : `$${value.toFixed(2)}`;
}

function number(value: number | null | undefined, digits = 2): string {
  return value == null || !Number.isFinite(value) ? '—' : value.toFixed(digits);
}

function stateColor(row: StagedHistoricalExcelLot): string {
  if (row.state === 'ready') return 'var(--green)';
  if (row.state === 'blocked') return 'var(--red)';
  return 'var(--yellow)';
}

function lifecycleLabel(row: StagedHistoricalExcelLot): string {
  return row.lifecycle === 'expired_worthless' ? 'Expired Worthless' : row.lifecycle === 'closed_manually' ? 'Closed' : 'Unavailable';
}

function rowIssueText(row: StagedHistoricalExcelLot): string {
  if (row.issues.length > 0) return row.issues.map(issue => issue.message).join(' ');
  if (row.state === 'possible_duplicate') return 'An identical source lot appears elsewhere in this workbook. Include it only if it is genuinely a separate fill.';
  if (row.state === 'possible_existing_duplicate') return `This lot matches an existing Portfolio lot${row.matchingExistingLotId ? ` (${row.matchingExistingLotId})` : ''}.`;
  return 'No issues.';
}

export default function PortfolioHistoricalExcelImportModal({ trades, markBasis, onClose, onImported }: Props) {
  const account = useAccountState();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const [result, setResult] = useState<HistoricalExcelParseResult | null>(null);
  const [reviewPortfolioRevision, setReviewPortfolioRevision] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [showProblemsOnly, setShowProblemsOnly] = useState(false);
  const [busy, setBusy] = useState<'parsing' | 'importing' | null>(null);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<ImportReceipt | null>(null);
  const [mode, setMode] = useState<'import' | 'export'>('import');
  const accountReady = account.phase === 'ready' && account.cloud !== null && account.userId !== null;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && busy === null) onClose();
    };
    window.addEventListener('keydown', keydown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', keydown);
      previousFocus?.focus();
    };
  }, [busy, onClose]);

  const summary = useMemo(() => result ? summarizeHistoricalExcelImport(result) : null, [result]);
  const visibleRows = useMemo(() => result?.rows.filter(row => !showProblemsOnly || row.state !== 'ready') ?? [], [result, showProblemsOnly]);
  const selectedRows = useMemo(() => result?.rows.filter(row => row.proposedTrade && selectedIds.has(row.stagingId)) ?? [], [result, selectedIds]);
  const exportOutput = useMemo(() => buildPortfolioHistoricalCsvExport(trades, markBasis), [markBasis, trades]);

  const exportCsv = () => {
    setError('');
    try {
      downloadPortfolioHistoricalCsvExport(exportOutput);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : 'The CSV could not be downloaded.');
    }
  };

  const stageWorkbook = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy('parsing');
    setError('');
    setReceipt(null);
    setResult(null);
    setSelectedIds(new Set());
    setExpandedIds(new Set());
    try {
      if (!accountReady || !account.cloud) throw new Error('Sign in and load your cloud account before staging a historical import.');
      const parsed = await parseHistoricalExcelWorkbook(await file.arrayBuffer(), file.name, { existingTrades: trades });
      const enriched = await enrichHistoricalExcelEntryVix(parsed);
      setReviewPortfolioRevision(account.cloud.portfolio.revision);
      setResult(enriched);
    } catch (stageError) {
      setError(errorMessage(stageError));
    } finally {
      setBusy(null);
    }
  };

  const toggleRow = (row: StagedHistoricalExcelLot) => {
    if (!row.proposedTrade || row.state === 'blocked' || row.state === 'needs_review' || receipt) return;
    if (!selectedIds.has(row.stagingId) && (row.state === 'possible_duplicate' || row.state === 'possible_existing_duplicate')) {
      const accepted = window.confirm(`${rowIssueText(row)}\n\nInclude this source row as a separate lot anyway?`);
      if (!accepted) return;
    }
    setSelectedIds(current => {
      const next = new Set(current);
      if (next.has(row.stagingId)) next.delete(row.stagingId);
      else next.add(row.stagingId);
      return next;
    });
  };

  const selectAllReady = () => {
    if (!result || receipt) return;
    setSelectedIds(new Set(result.rows.filter(row => row.state === 'ready' && row.proposedTrade).map(row => row.stagingId)));
  };

  const commitImport = async () => {
    if (!result || !summary || reviewPortfolioRevision == null || selectedRows.length === 0 || receipt) return;
    setBusy('importing');
    setError('');
    const selectedTrades = selectedRows.flatMap(row => row.proposedTrade ? [row.proposedTrade] : []);
    const commit = await account.commitHistoricalPortfolioImport({
      reviewPortfolioRevision,
      trades: toDurablePortfolioState(selectedTrades),
      acknowledgedExistingDuplicateIds: selectedRows
        .filter(row => row.state === 'possible_existing_duplicate' && row.proposedTrade)
        .map(row => row.proposedTrade!.id),
      appVersion: import.meta.env.VITE_APP_VERSION || '0.0.0',
      downloadBackup: backup => downloadPutScannerBackup(backup, 'pre-historical-import-backup'),
    });
    if (!commit.ok) {
      setError(commit.message);
      setBusy(null);
      return;
    }
    const contracts = new Set(selectedRows.flatMap(row => row.contractKey ? [row.contractKey] : []));
    const newContracts = new Set(selectedRows.filter(row => row.destination === 'new_contract_position').flatMap(row => row.contractKey ? [row.contractKey] : []));
    setReceipt({
      importedLots: commit.importedCount,
      affectedContracts: contracts.size,
      newContracts: newContracts.size,
      skippedDuplicates: result.rows.filter(row => (row.state === 'possible_duplicate' || row.state === 'possible_existing_duplicate') && !selectedIds.has(row.stagingId)).length,
      reviewRows: summary.needsReview,
      blockedRows: summary.blocked,
      expirationPrices: selectedRows.filter(row => row.source.priceSemantic === 'expiration_underlying' && row.source.underlyingHistoricalPrice != null).length,
      closeContextPrices: selectedRows.filter(row => row.source.priceSemantic === 'manual_close_underlying' && row.source.underlyingHistoricalPrice != null).length,
      entryVixCount: selectedRows.filter(row => row.proposedTrade?.entryVixClose != null).length,
      backupFilename: commit.backupFilename,
    });
    setBusy(null);
    onImported();
  };

  const toggleExpanded = (id: string) => setExpandedIds(current => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  return (
    <div className="fixed inset-0 z-[110] flex items-end justify-center bg-black/75 p-0 md:items-center md:p-3" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target && busy === null) onClose(); }}>
      <section className="flex max-h-[96dvh] w-full flex-col overflow-hidden rounded-t-2xl shadow-2xl md:max-w-[98vw] md:rounded-2xl" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} role="dialog" aria-modal="true" aria-labelledby="historical-excel-title">
        <header className="flex flex-none items-start justify-between gap-3 border-b px-4 py-3 md:px-5" style={{ borderColor: 'var(--border)' }}>
          <div className="min-w-0">
            <div className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5" style={{ color: 'var(--accent-light)' }} /><h2 id="historical-excel-title" className="text-base font-semibold" style={{ color: 'var(--text)' }}>Import / Export Historical Excel</h2></div>
            <p className="mt-1 text-xs leading-5" style={{ color: 'var(--text-muted)' }}>{mode === 'import' ? 'V5 historical lots only. The workbook stays in this browser session and is never uploaded.' : 'Export every canonical Portfolio lot without changing account data or refreshing markets.'}</p>
          </div>
          <button ref={closeButtonRef} type="button" onClick={onClose} disabled={busy !== null} className="pressable flex h-11 w-11 flex-none items-center justify-center rounded-full disabled:opacity-40" aria-label="Close historical Excel import or export" style={{ color: 'var(--text-muted)', backgroundColor: 'var(--surface-alt)' }}><X className="h-5 w-5" /></button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-5">
          <div className="mb-4 grid grid-cols-2 rounded-lg p-1" role="tablist" aria-label="Historical Excel mode" style={{ backgroundColor: 'var(--surface-alt)', border: '1px solid var(--border)' }}>
            {([['import', 'Import Excel'], ['export', 'Export CSV']] as const).map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={mode === value} onClick={() => { setMode(value); setError(''); }} disabled={busy !== null} className="pressable min-h-10 rounded-md px-3 text-xs font-semibold disabled:opacity-40" style={mode === value ? { color: 'var(--accent-light)', backgroundColor: 'var(--accent-bg)', border: '1px solid var(--accent-border)' } : { color: 'var(--text-muted)', border: '1px solid transparent' }}>{label}</button>)}
          </div>
          {error && <div className="mb-3 rounded-lg border px-3 py-2 text-xs leading-5" role="alert" style={{ color: 'var(--red)', backgroundColor: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.28)' }}>{error}</div>}
          {mode === 'import' ? <>
          {!accountReady && <div className="rounded-lg border px-3 py-2 text-xs leading-5" role="alert" style={{ color: 'var(--yellow)', borderColor: 'color-mix(in srgb, var(--yellow) 35%, var(--border))' }}>Historical Excel Import is available only after a signed-in cloud account is fully loaded and idle.</div>}
          {receipt && summary && (
            <section className="mb-4 rounded-xl border p-4" style={{ backgroundColor: 'rgba(34,197,94,0.08)', borderColor: 'rgba(34,197,94,0.3)' }} aria-label="Historical import receipt">
              <div className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5" style={{ color: 'var(--green)' }} /><h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Authoritative cloud import confirmed</h3></div>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4 lg:grid-cols-9">
                <div><dt style={{ color: 'var(--text-dim)' }}>Imported lots</dt><dd className="font-mono font-semibold">{receipt.importedLots}</dd></div>
                <div><dt style={{ color: 'var(--text-dim)' }}>Affected contracts</dt><dd className="font-mono font-semibold">{receipt.affectedContracts}</dd></div>
                <div><dt style={{ color: 'var(--text-dim)' }}>New contracts</dt><dd className="font-mono font-semibold">{receipt.newContracts}</dd></div>
                <div><dt style={{ color: 'var(--text-dim)' }}>Skipped duplicates</dt><dd className="font-mono font-semibold">{receipt.skippedDuplicates}</dd></div>
                <div><dt style={{ color: 'var(--text-dim)' }}>Review / blocked</dt><dd className="font-mono font-semibold">{receipt.reviewRows} / {receipt.blockedRows}</dd></div>
                <div><dt style={{ color: 'var(--text-dim)' }}>Expiration prices</dt><dd className="font-mono font-semibold">{receipt.expirationPrices}/{receipt.importedLots}</dd></div>
                <div><dt style={{ color: 'var(--text-dim)' }}>Close context prices</dt><dd className="font-mono font-semibold">{receipt.closeContextPrices}/{receipt.importedLots}</dd></div>
                <div><dt style={{ color: 'var(--text-dim)' }}>Entry VIX</dt><dd className="font-mono font-semibold">{receipt.entryVixCount}/{receipt.importedLots}</dd></div>
                <div><dt style={{ color: 'var(--text-dim)' }}>Expiration requests</dt><dd className="font-mono font-semibold">0</dd></div>
              </dl>
              <p className="mt-3 break-all text-[11px]" style={{ color: 'var(--text-muted)' }}>Safety backup initiated: {receipt.backupFilename}</p>
            </section>
          )}

          {!result && !receipt && (
            <section className="mx-auto max-w-2xl rounded-xl border p-5 text-center" style={{ backgroundColor: 'var(--surface-alt)', borderColor: 'var(--border)' }}>
              <ShieldCheck className="mx-auto h-7 w-7" style={{ color: 'var(--accent-light)' }} />
              <h3 className="mt-2 text-sm font-semibold" style={{ color: 'var(--text)' }}>Stage a V5 workbook for review</h3>
              <p className="mt-2 text-xs leading-5" style={{ color: 'var(--text-muted)' }}>.xlsx only, up to 10 MB. Formulas in required cells fail closed. Nothing is written while parsing, validating, enriching, filtering, or selecting.</p>
              <button type="button" disabled={!accountReady || busy !== null} onClick={() => fileInputRef.current?.click()} className="button-primary pressable mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-5 text-sm font-semibold text-white disabled:opacity-40" style={{ backgroundColor: 'var(--accent)' }}>{busy === 'parsing' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} {busy === 'parsing' ? 'Parsing workbook…' : 'Choose Excel Workbook'}</button>
            </section>
          )}

          {result && summary && (
            <>
              {!receipt && <div className="rounded-lg border px-3 py-2 text-center text-xs font-bold tracking-wide" style={{ color: 'var(--yellow)', backgroundColor: 'rgba(250,204,21,0.08)', borderColor: 'rgba(250,204,21,0.25)' }}>NO DATA HAS BEEN CHANGED YET.</div>}
              <section className="mt-3 rounded-xl border p-3" style={{ backgroundColor: 'var(--surface-alt)', borderColor: 'var(--border)' }}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0"><p className="truncate text-sm font-semibold" style={{ color: 'var(--text)' }}>{result.fileName}</p><p className="text-[11px]" style={{ color: 'var(--text-dim)' }}>{result.worksheetName} · header R{result.headerRowNumber}C{result.headerColumnNumber} · {result.dateSystem} date system · {result.formulaCellCount} formula cells</p></div>
                  <button type="button" disabled={busy !== null || Boolean(receipt)} onClick={() => fileInputRef.current?.click()} className="pressable min-h-9 rounded-lg border px-3 text-xs font-semibold disabled:opacity-40" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>Choose Another</button>
                </div>
                <dl className="mt-3 grid grid-cols-3 gap-2 text-[11px] sm:grid-cols-5 lg:grid-cols-10">
                  {[
                    ['Rows', summary.rowsParsed], ['Ready', summary.ready], ['Review', summary.needsReview], ['Blocked', summary.blocked],
                    ['Duplicates', summary.possibleDuplicate], ['Existing dupes', summary.possibleExistingDuplicate], ['Selected', selectedRows.length],
                    ['Historical prices', summary.historicalUnderlyingPricesSupplied], ['Expiration prices', summary.expirationUnderlyingPricesSupplied], ['Entry VIX', summary.entryVixEnriched],
                  ].map(([label, value]) => <div key={label} className="rounded-lg px-2 py-2" style={{ backgroundColor: 'var(--surface)' }}><dt style={{ color: 'var(--text-dim)' }}>{label}</dt><dd className="mt-0.5 font-mono text-sm font-semibold" style={{ color: 'var(--text)' }}>{value}</dd></div>)}
                </dl>
                <p className="mt-2 text-[11px] leading-4" style={{ color: 'var(--text-muted)' }}>Underlying source coverage: {summary.expirationUnderlyingPricesSupplied} expiration and {summary.manualCloseUnderlyingPricesSupplied} manual-close prices. Expiration-price provider requests: 0. Entry VIX requests: {result.entryVixNetworkRequests}.{result.entryVixWarning ? ` ${result.entryVixWarning}` : ''}</p>
              </section>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button type="button" onClick={selectAllReady} disabled={Boolean(receipt)} className="pressable min-h-10 rounded-lg px-3 text-xs font-semibold disabled:opacity-40" style={{ backgroundColor: 'var(--accent-bg)', color: 'var(--accent-light)', border: '1px solid var(--accent-border)' }}>Select All Ready</button>
                <button type="button" onClick={() => setSelectedIds(new Set())} disabled={Boolean(receipt)} className="pressable min-h-10 rounded-lg border px-3 text-xs font-semibold disabled:opacity-40" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>Clear Selection</button>
                <label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border px-3 text-xs" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}><input type="checkbox" checked={showProblemsOnly} onChange={event => setShowProblemsOnly(event.target.checked)} className="h-4 w-4" /> Show Problems Only</label>
              </div>

              <div className="mt-3 hidden max-w-full overflow-x-auto rounded-xl border md:block" style={{ borderColor: 'var(--border)' }}>
                <table className="min-w-[2480px] border-collapse text-[11px]" style={{ color: 'var(--text)' }}>
                  <thead className="sticky top-0 z-10" style={{ backgroundColor: 'var(--surface-alt)' }}>
                    <tr className="uppercase tracking-wider" style={{ color: 'var(--text-dim)', borderBottom: '1px solid var(--border)' }}>
                      <th colSpan={3} className="px-2 py-1.5 text-left font-semibold">Audit</th>
                      <th colSpan={13} className="px-2 py-1.5 text-left font-semibold">Source data</th>
                      <th colSpan={1} className="px-2 py-1.5 text-left font-semibold">Enriched</th>
                      <th colSpan={2} className="px-2 py-1.5 text-left font-semibold">Destination / duplicate</th>
                      <th colSpan={4} className="px-2 py-1.5 text-left font-semibold">Resulting app state</th>
                    </tr>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      {['Select', 'Source Row', 'Row State', 'Ticker', 'Expiration', 'Strike', 'Contracts', 'Sold Date', 'Sold Price', 'Entry Delta', 'Entry IV', 'Source Status', 'Source Outcome', 'Close Date', 'OPTION Close Price', 'Underlying Price / Context', 'Entry VIX', 'Contract Key', 'Destination', 'Resulting lifecycle', 'Premium', 'Realized P&L', 'Provenance / Issues'].map(label => <th key={label} className="whitespace-nowrap px-2 py-2 text-left font-semibold">{label}</th>)}
                    </tr>
                  </thead>
                  <tbody>{visibleRows.map(row => {
                    const selectable = Boolean(row.proposedTrade) && row.state !== 'blocked' && row.state !== 'needs_review' && !receipt;
                    return <tr key={row.stagingId} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td className="px-2 py-2"><input aria-label={`Select source row ${row.sourceRowNumber}`} type="checkbox" checked={selectedIds.has(row.stagingId)} disabled={!selectable} onChange={() => toggleRow(row)} className="h-5 w-5" /></td>
                      <td className="px-2 py-2 font-mono">{row.sourceRowNumber}</td>
                      <td className="whitespace-nowrap px-2 py-2 font-semibold" style={{ color: stateColor(row) }}>{historicalExcelStateLabel(row.state)}</td>
                      <td className="px-2 py-2 font-semibold">{row.source.ticker ?? '—'}</td><td className="px-2 py-2 font-mono">{row.source.expiration ?? '—'}</td><td className="px-2 py-2 text-right font-mono">{money(row.source.strike)}</td><td className="px-2 py-2 text-right font-mono">{row.source.contracts ?? '—'}</td><td className="px-2 py-2 font-mono">{row.source.soldDate ?? '—'}</td><td className="px-2 py-2 text-right font-mono">{money(row.source.soldPrice)}</td><td className="px-2 py-2 text-right font-mono">{number(row.source.entryDelta, 4)}</td><td className="px-2 py-2 text-right font-mono">{row.source.entryIv == null ? '—' : `${number(row.source.entryIv)}%`}</td><td className="px-2 py-2">{row.source.status || '—'}</td><td className="px-2 py-2">{row.source.outcome || '—'}</td><td className="px-2 py-2 font-mono">{row.source.closeDate ?? '—'}</td><td className="px-2 py-2 text-right font-mono" title={row.lifecycle === 'expired_worthless' ? 'Source placeholder; ignored for expiration economics' : 'Option buyback price per share'}>{money(row.source.optionClosePrice)}{row.lifecycle === 'expired_worthless' ? ' · ignored' : ''}</td><td className="px-2 py-2 text-right font-mono" title={row.source.priceSemantic === 'manual_close_underlying' ? 'Historical underlying price persisted on the manually closed Portfolio lot' : 'Source-provided underlying expiration price'}>{money(row.source.underlyingHistoricalPrice)}{row.source.priceSemantic === 'manual_close_underlying' ? ' · persisted' : ' · source'}</td><td className="px-2 py-2 text-right font-mono">{number(row.proposedTrade?.entryVixClose)}</td><td className="px-2 py-2 font-mono">{row.contractKey ?? '—'}</td><td className="px-2 py-2">{historicalExcelDestinationLabel(row.destination)}</td><td className="px-2 py-2">{lifecycleLabel(row)}</td><td className="px-2 py-2 text-right font-mono">{money(row.proposedTrade?.premiumCollected)}</td><td className="px-2 py-2 text-right font-mono">{money(row.proposedTrade?.realizedPnl)}</td><td className="max-w-[360px] px-2 py-2 leading-4" title={rowIssueText(row)}>{row.lifecycle === 'expired_worthless' && row.proposedTrade ? `${row.proposedTrade.resolutionWarning} ` : ''}{rowIssueText(row)}</td>
                    </tr>;
                  })}</tbody>
                </table>
              </div>

              <div className="mt-3 grid gap-2 md:hidden">{visibleRows.map(row => {
                const expanded = expandedIds.has(row.stagingId);
                const selectable = Boolean(row.proposedTrade) && row.state !== 'blocked' && row.state !== 'needs_review' && !receipt;
                return <article key={row.stagingId} className="rounded-xl border p-3" style={{ backgroundColor: 'var(--surface-alt)', borderColor: 'var(--border)' }}>
                  <div className="flex items-center gap-3"><input aria-label={`Select source row ${row.sourceRowNumber}`} type="checkbox" checked={selectedIds.has(row.stagingId)} disabled={!selectable} onChange={() => toggleRow(row)} className="h-6 w-6 flex-none" /><button type="button" onClick={() => toggleExpanded(row.stagingId)} aria-expanded={expanded} className="min-w-0 flex-1 text-left"><div className="flex items-center justify-between gap-2"><b className="truncate text-sm" style={{ color: 'var(--text)' }}>{row.source.ticker ?? 'Invalid row'} {row.source.strike != null ? money(row.source.strike) : ''} Put</b><span className="whitespace-nowrap text-[10px] font-semibold" style={{ color: stateColor(row) }}>{historicalExcelStateLabel(row.state)}</span></div><p className="mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>{row.source.contracts ?? '—'} contracts · sold {row.source.soldDate ?? '—'} at {money(row.source.soldPrice)} · row {row.sourceRowNumber}</p></button></div>
                  {expanded && <div className="mt-3 border-t pt-3 text-[11px] leading-5" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}><p className="mb-1 font-semibold uppercase tracking-wider">Source data</p><dl className="grid grid-cols-2 gap-x-3 gap-y-1"><div><dt>Expiration</dt><dd className="font-mono" style={{ color: 'var(--text)' }}>{row.source.expiration ?? '—'}</dd></div><div><dt>Entry Delta / IV</dt><dd className="font-mono" style={{ color: 'var(--text)' }}>{number(row.source.entryDelta, 4)} / {row.source.entryIv == null ? '—' : `${number(row.source.entryIv)}%`}</dd></div><div><dt>Source lifecycle</dt><dd style={{ color: 'var(--text)' }}>{row.source.status || '—'} / {row.source.outcome || '—'}</dd></div><div><dt>OPTION Close Price</dt><dd className="font-mono" style={{ color: 'var(--text)' }}>{money(row.source.optionClosePrice)}{row.lifecycle === 'expired_worthless' ? ' · ignored' : ''}</dd></div><div><dt>Underlying price</dt><dd className="font-mono" style={{ color: 'var(--text)' }}>{money(row.source.underlyingHistoricalPrice)}{row.source.priceSemantic === 'manual_close_underlying' ? ' · persisted as closeUnderlyingPrice' : ' · source expiration price'}</dd></div></dl><p className="mb-1 mt-3 font-semibold uppercase tracking-wider">Destination / duplicate</p><dl className="grid grid-cols-1 gap-y-1"><div><dt>Canonical contract key</dt><dd className="break-all font-mono" style={{ color: 'var(--text)' }}>{row.contractKey ?? '—'}</dd></div><div><dt>Destination</dt><dd style={{ color: 'var(--text)' }}>{historicalExcelDestinationLabel(row.destination)}</dd></div></dl><p className="mb-1 mt-3 font-semibold uppercase tracking-wider">Resulting app state</p><dl className="grid grid-cols-2 gap-x-3 gap-y-1"><div><dt>Lifecycle</dt><dd style={{ color: 'var(--text)' }}>{lifecycleLabel(row)}</dd></div><div><dt>Entry VIX</dt><dd className="font-mono" style={{ color: 'var(--text)' }}>{number(row.proposedTrade?.entryVixClose)}</dd></div><div><dt>Premium / Realized P&amp;L</dt><dd className="font-mono" style={{ color: 'var(--text)' }}>{money(row.proposedTrade?.premiumCollected)} / {money(row.proposedTrade?.realizedPnl)}</dd></div></dl><p className="mt-2" style={{ color: row.state === 'ready' ? 'var(--text-dim)' : stateColor(row) }}>{row.lifecycle === 'expired_worthless' && row.proposedTrade ? `${row.proposedTrade.resolutionWarning} ` : ''}{rowIssueText(row)}</p></div>}
                </article>;
              })}</div>
            </>
          )}
          </> : (
            <section className="mx-auto max-w-3xl rounded-xl border p-4 sm:p-5" aria-label="Portfolio CSV export" style={{ backgroundColor: 'var(--surface-alt)', borderColor: 'var(--border)' }}>
              <div className="flex items-start gap-3">
                <Download className="mt-0.5 h-5 w-5 flex-none" style={{ color: 'var(--accent-light)' }} />
                <div className="min-w-0"><h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Export canonical Portfolio lots</h3><p className="mt-1 text-xs leading-5" style={{ color: 'var(--text-muted)' }}>One CSV row per independently tracked lot, including open and resolved entries. Export is read-only.</p></div>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                {[['Open lots', exportOutput.summary.openLots], ['Resolved lots', exportOutput.summary.resolvedLots], ['Total lots', exportOutput.summary.totalLots]].map(([label, value]) => <div key={label} className="rounded-lg px-3 py-2.5" style={{ backgroundColor: 'var(--surface)' }}><dt style={{ color: 'var(--text-dim)' }}>{label}</dt><dd className="mt-1 font-mono text-base font-semibold tabular-nums" style={{ color: 'var(--text)' }}>{value}</dd></div>)}
                <div className="rounded-lg px-3 py-2.5" style={{ backgroundColor: 'var(--surface)' }}><dt style={{ color: 'var(--text-dim)' }}>Current-market coverage</dt><dd className="mt-1 font-mono text-base font-semibold tabular-nums" style={{ color: 'var(--text)' }}>{exportOutput.summary.currentMarketCoveredLots}/{exportOutput.summary.openLots}</dd></div>
              </dl>
              <p className="mt-4 rounded-lg border px-3 py-2 text-xs leading-5" style={{ color: 'var(--text-muted)', borderColor: 'var(--border)' }}>Current-market columns use currently loaded Portfolio data. Refresh Open Trades first if you want fresher marks.</p>
              <p className="mt-2 text-[11px] leading-4" style={{ color: 'var(--text-dim)' }}>Yields, volatility, capture, IRR, and distance percentages are exported as percentage-point numbers. Missing values are blank.</p>
              <button type="button" onClick={exportCsv} disabled={exportOutput.summary.totalLots === 0} className="button-primary pressable mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg px-5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto" style={{ backgroundColor: 'var(--accent)' }}><Download className="h-4 w-4" /> Export CSV</button>
            </section>
          )}
        </div>

        {mode === 'import' && result && summary && <footer className="flex flex-none flex-col gap-2 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between md:px-5" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
          <div className="flex items-start gap-2 text-[11px] leading-4" style={{ color: 'var(--text-muted)' }}><AlertTriangle className="mt-0.5 h-4 w-4 flex-none" style={{ color: 'var(--yellow)' }} /><span>This import is additive. Existing Portfolio/history will not be replaced. The backup step confirms download initiation, not physical saving by the operating system.</span></div>
          <button type="button" disabled={!accountReady || busy !== null || selectedRows.length === 0 || Boolean(receipt)} onClick={() => void commitImport()} className="button-primary pressable flex min-h-11 flex-none items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40" style={{ backgroundColor: 'var(--accent)' }}>{busy === 'importing' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}{receipt ? 'Import Verified' : busy === 'importing' ? 'Backing up and importing…' : `Download Safety Backup & Import ${selectedRows.length} Selected ${selectedRows.length === 1 ? 'Lot' : 'Lots'}`}</button>
        </footer>}
        <input ref={fileInputRef} type="file" accept="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xlsx" className="hidden" onChange={event => void stageWorkbook(event)} />
      </section>
    </div>
  );
}
