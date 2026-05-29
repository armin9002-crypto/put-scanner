import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Clipboard, Copy, FileImage, Upload, X } from 'lucide-react';
import { formatCurrency, formatDate, formatOptionPrice } from '../lib/format';
import type { PortfolioTrade } from '../lib/portfolioStorage';
import {
  applyPortfolioImportPlan,
  buildPortfolioImportPlan,
  getImportDifferences,
  isImportableRow,
  makePortfolioContractKey,
  parseBrokerageScreenshotOcr,
  validateParsedBrokerageRow,
  type ExistingTradeAction,
  type ImportEditableRow,
  type ParsedImportAction,
  type ParsedBrokerageOptionRow,
  type PortfolioImportDiagnostics,
  type PortfolioImportParseResult,
  type PortfolioImportPlan,
  type PortfolioImportOcrWord,
} from '../lib/portfolioScreenshotImport';

interface PortfolioScreenshotImportModalProps {
  trades: PortfolioTrade[];
  onClose: () => void;
  onApply: (trades: PortfolioTrade[]) => void;
}

type OcrStatus = 'idle' | 'loading' | 'reading' | 'done' | 'error';

const DASH = '\u2014';

export default function PortfolioScreenshotImportModal({ trades, onClose, onApply }: PortfolioScreenshotImportModalProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [status, setStatus] = useState<OcrStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [rows, setRows] = useState<ImportEditableRow[]>([]);
  const [missingActions, setMissingActions] = useState<Record<string, ExistingTradeAction['action']>>({});
  const [soldDate, setSoldDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [diagnostics, setDiagnostics] = useState<PortfolioImportDiagnostics | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showMissing, setShowMissing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [imageUrl]);

  const plan = useMemo(() => {
    const base = buildPortfolioImportPlan(rows, trades);
    const missingFromImport = base.missingFromImport.map(action => ({
      ...action,
      action: missingActions[action.key] ?? action.action,
    }));
    return { ...base, missingFromImport };
  }, [missingActions, rows, trades]);

  const selectedImportableCount = plan.adds.length + plan.updates.length;

  useEffect(() => {
    setRows(previous => previous.map(row => {
      if (row.dateAcquiredEdited || row.importAction !== 'add') return row;
      return { ...row, dateAcquired: soldDate };
    }));
  }, [soldDate]);

  const handleFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('Please choose a PNG, JPG, JPEG, or WebP image.');
      return;
    }
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    setImageUrl(URL.createObjectURL(file));
    setFileName(file.name || 'Pasted screenshot');
    setRows([]);
    setDiagnostics(null);
    setMissingActions({});
    setError('');
    setStatus('loading');
    setProgress(0);

    try {
      const tesseract = await import('tesseract.js');
      setStatus('reading');
      const worker = await tesseract.createWorker('eng', 1, {
        logger: (message: { status?: string; progress?: number }) => {
          if (message.status === 'recognizing text' && typeof message.progress === 'number') {
            setProgress(Math.round(message.progress * 100));
          }
        },
      });
      try {
        const parsed = await runOcrImportPasses(file, async (processed, passLabel, dimensions) => {
          await worker.setParameters({
            tessedit_pageseg_mode: passLabel === 'fallback' ? tesseract.PSM.SPARSE_TEXT : tesseract.PSM.SINGLE_BLOCK,
            preserve_interword_spaces: '1',
            user_defined_dpi: '300',
          });
          const result = await worker.recognize(processed.blob, {}, { text: true, tsv: true, hocr: true, blocks: true });
          const extracted = extractTesseractWords(result.data);
          const parsedResult = parseBrokerageScreenshotOcr({
            text: result.data.text,
            words: extracted.words,
          });
          return {
            ...parsedResult,
            diagnostics: {
              ...parsedResult.diagnostics,
              ocrWordCount: extracted.words.length,
              ocrLineCount: extracted.lineCount || parsedResult.diagnostics.ocrLineCount,
              ocrWordSource: extracted.source,
              ocrPassUsed: passLabel,
              tesseractVersion: result.data.version,
              tsvPresent: extracted.tsvPresent,
              hocrPresent: extracted.hocrPresent,
              blocksPresent: extracted.blocksPresent,
              structuredOcrUnavailable: extracted.words.length === 0,
              originalImage: dimensions.original,
              preprocessedImage: dimensions.processed,
            },
          };
        });
        const parsedRows = createEditableImportRows(parsed.rows, trades, soldDate);
        setRows(parsedRows);
        setDiagnostics(parsed.diagnostics);
        setStatus('done');
        if (parsedRows.length === 0) {
          setError('No sold put rows were detected. You can cancel and add trades manually.');
        } else if (parsed.diagnostics.warnings.length > 0) {
          setError(parsed.diagnostics.warnings.join(' '));
        }
      } finally {
        await worker.terminate();
      }
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'OCR failed. The screenshot was not imported.');
    }
  }, [imageUrl, soldDate, trades]);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const file = [...(event.clipboardData?.files ?? [])].find(item => item.type.startsWith('image/'));
      if (file) {
        event.preventDefault();
        void handleFile(file);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [handleFile]);

  const applyImport = () => {
    const nowIso = new Date().toISOString();
    onApply(applyPortfolioImportPlan(plan, trades, soldDate || nowIso.split('T')[0], nowIso));
  };

  return (
    <div className="fixed inset-0 z-[85]">
      <button type="button" aria-label="Close import modal" onClick={onClose} className="absolute inset-0 bg-black/55" />
      <div className="absolute inset-x-2 top-3 bottom-3 md:inset-x-4 md:top-4 md:bottom-4 xl:inset-x-1/2 xl:top-[4vh] xl:bottom-auto xl:w-[min(96vw,1600px)] xl:h-[min(92vh,1000px)] xl:-translate-x-1/2 rounded-lg overflow-hidden p-3 sm:p-4 shadow-2xl flex flex-col" style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)' }}>
        <div className="flex items-start justify-between gap-3 mb-3 flex-shrink-0">
          <div className="min-w-0">
            <h2 className="text-lg font-bold" style={{ color: 'var(--text)' }}>Import Screenshot</h2>
            <p className="text-xs mt-1 max-w-2xl" style={{ color: 'var(--text-muted)' }}>
              Paste or drag a brokerage positions screenshot. The app will extract sold put positions and let you review before importing.
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg min-h-[40px] min-w-[40px]" style={{ backgroundColor: 'var(--surface)', color: 'var(--text-muted)', border: '1px solid var(--border)' }} aria-label="Cancel import">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[360px_minmax(0,1fr)] 2xl:grid-cols-[400px_minmax(0,1fr)] gap-3 min-h-0 flex-1 overflow-y-auto lg:overflow-hidden">
          <div className="space-y-3 min-w-0 lg:overflow-y-auto lg:pr-1">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={event => event.preventDefault()}
              onDrop={event => {
                event.preventDefault();
                const file = [...event.dataTransfer.files].find(item => item.type.startsWith('image/'));
                if (file) void handleFile(file);
              }}
              className="w-full rounded-lg p-4 text-center min-h-[140px] flex flex-col items-center justify-center gap-2"
              style={{ backgroundColor: 'var(--surface)', color: 'var(--text)', border: '1px dashed var(--accent-border)' }}
            >
              <Upload className="w-8 h-8" style={{ color: 'var(--accent-light)' }} />
              <span className="text-sm font-medium">Drop image or click to upload</span>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>PNG, JPG, JPEG, or WebP. Ctrl+V paste also works.</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={event => {
                const file = event.target.files?.[0];
                if (file) void handleFile(file);
                event.target.value = '';
              }}
            />

            {imageUrl ? (
              <div className="rounded-lg p-2" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
                <div className="flex items-center gap-2 text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
                  <FileImage className="w-3.5 h-3.5" /> <span className="truncate">{fileName}</span>
                </div>
                <img src={imageUrl} alt="Brokerage screenshot preview" className="w-full max-h-[260px] 2xl:max-h-[330px] object-contain rounded" />
              </div>
            ) : (
              <div className="rounded-lg p-3 text-xs flex items-start gap-2" style={{ backgroundColor: 'var(--surface)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                <Clipboard className="w-4 h-4 flex-shrink-0" />
                Screenshots stay local. OCR runs in your browser and the raw image is not stored.
              </div>
            )}

            {status !== 'idle' && (
              <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
                <div className="flex items-center justify-between text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
                  <span>{status === 'loading' ? 'Preparing OCR...' : status === 'reading' ? 'Reading screenshot...' : status === 'done' ? 'OCR complete' : 'OCR failed'}</span>
                  {status === 'reading' && <span className="font-mono">{progress}%</span>}
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--surface-alt)' }}>
                  <div className="h-full rounded-full" style={{ width: `${status === 'done' ? 100 : progress}%`, backgroundColor: status === 'error' ? 'var(--red)' : 'var(--accent)' }} />
                </div>
              </div>
            )}

            {error && (
              <div className="rounded-lg p-3 text-xs flex gap-2" style={{ backgroundColor: 'rgba(239,68,68,0.10)', color: 'var(--red)', border: '1px solid rgba(239,68,68,0.24)' }}>
                <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {error}
              </div>
            )}
            <label className="block rounded-lg p-3" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
              <span className="block text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Sold / Opened Date</span>
              <input
                type="date"
                value={soldDate}
                onChange={event => setSoldDate(event.target.value)}
                className="w-full rounded-lg px-3 py-2 text-base sm:text-sm outline-none min-h-[42px]"
                style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text)' }}
              />
              <span className="block text-[11px] mt-1" style={{ color: 'var(--text-dim)' }}>Brokerage screenshots do not show the open date, so this date is applied to imported rows.</span>
            </label>
            {diagnostics && (
              <div className="rounded-lg p-3 text-xs" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
                <button
                  type="button"
                  onClick={() => setShowDiagnostics(value => !value)}
                  className="font-medium"
                  style={{ color: 'var(--accent-light)' }}
                >
                  {showDiagnostics ? 'Hide' : 'Show'} OCR diagnostics
                </button>
                <button
                  type="button"
                  onClick={() => void navigator.clipboard?.writeText(JSON.stringify(diagnostics, null, 2))}
                  className="ml-3 inline-flex items-center gap-1 font-medium"
                  style={{ color: 'var(--text-muted)' }}
                >
                  <Copy className="w-3 h-3" /> Copy diagnostics JSON
                </button>
                {showDiagnostics && (
                  <div className="mt-2 space-y-1 font-mono max-h-[260px] overflow-auto pr-1" style={{ color: 'var(--text-muted)' }}>
                    {diagnostics.originalImage && <div>Original: {diagnostics.originalImage.width}x{diagnostics.originalImage.height}</div>}
                    {diagnostics.preprocessedImage && <div>Processed: {diagnostics.preprocessedImage.width}x{diagnostics.preprocessedImage.height}</div>}
                    <div>Tesseract: {diagnostics.tesseractVersion ?? DASH}</div>
                    <div>OCR pass: {diagnostics.ocrPassUsed ?? DASH}</div>
                    <div>Word source: {diagnostics.ocrWordSource ?? DASH}</div>
                    <div>TSV: {diagnostics.tsvPresent ? 'yes' : 'no'} | hOCR: {diagnostics.hocrPresent ? 'yes' : 'no'} | blocks: {diagnostics.blocksPresent ? 'yes' : 'no'}</div>
                    {diagnostics.structuredOcrUnavailable && <div style={{ color: 'var(--red)' }}>Structured OCR output unavailable; using text fallback.</div>}
                    <div>Words: {diagnostics.ocrWordCount}</div>
                    <div>Lines: {diagnostics.ocrLineCount ?? DASH}</div>
                    <div>Headers: {diagnostics.detectedHeaderColumns.join(', ') || DASH}</div>
                    <div>Detected rows: {diagnostics.detectedOptionRowCount}</div>
                    <div>Parsed rows: {diagnostics.parsedRowCount}</div>
                    <div>Importable rows: {diagnostics.importableRowCount}</div>
                    {diagnostics.warnings.map(warning => <div key={warning} style={{ color: 'var(--yellow)' }}>{warning}</div>)}
                    {diagnostics.rowDiagnostics?.map((row, index) => (
                      <details key={`${row.rawSymbolText}-${index}`} className="pt-1">
                        <summary style={{ color: 'var(--accent-light)' }}>{index + 1}. {row.rawSymbolText} {row.rawExpiryText || DASH} ({Math.round(row.validationScore * 100)}%)</summary>
                        <div>Cells: {JSON.stringify(row.rawCells)}</div>
                        <div>Parsed: {JSON.stringify(row.parsedValues)}</div>
                        <div>Validation: {JSON.stringify(row.validation)}</div>
                        {row.warnings.map(warning => <div key={warning} style={{ color: 'var(--yellow)' }}>{warning}</div>)}
                      </details>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="min-w-0 min-h-0 space-y-3 lg:flex lg:flex-col lg:overflow-hidden">
            <ReviewSummary plan={plan} />
            <ParsedRowsTable rows={rows} setRows={setRows} plan={plan} />
            <MissingTradesTable plan={plan} setMissingActions={setMissingActions} expanded={showMissing} onToggle={() => setShowMissing(value => !value)} />
          </div>
        </div>

        <div className="flex flex-col sm:flex-row justify-end gap-2 mt-3 pt-3 flex-shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-xs min-h-[44px]" style={{ backgroundColor: 'var(--surface)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>Cancel</button>
          <button
            onClick={applyImport}
            disabled={selectedImportableCount === 0}
            className="px-4 py-2 rounded-lg text-xs font-medium text-white min-h-[44px] disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ backgroundColor: 'var(--accent)' }}
          >
            Apply Import
          </button>
        </div>
      </div>
    </div>
  );
}

function ReviewSummary({ plan }: { plan: PortfolioImportPlan }) {
  return (
    <div className="space-y-2 flex-shrink-0">
      <div className="grid grid-cols-5 gap-2">
        <MiniCard label="Add" value={plan.adds.length} />
        <MiniCard label="Update" value={plan.updates.length} />
        <MiniCard label="Keep" value={plan.keeps.length} />
        <MiniCard label="Skipped" value={plan.skipped.length} />
        <MiniCard label="Missing" value={plan.missingFromImport.length} />
      </div>
      {plan.warnings.map(warning => (
        <div key={warning} className="rounded-lg px-3 py-2 text-xs" style={{ backgroundColor: 'rgba(250,204,21,0.10)', color: 'var(--yellow)', border: '1px solid rgba(250,204,21,0.22)' }}>{warning}</div>
      ))}
    </div>
  );
}

function MiniCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg px-3 py-2" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>{label}</div>
      <div className="font-mono text-base font-semibold" style={{ color: 'var(--text)' }}>{value}</div>
    </div>
  );
}

function createEditableImportRows(rows: ParsedBrokerageOptionRow[], trades: PortfolioTrade[], globalSoldDate: string): ImportEditableRow[] {
  const existingByKey = new Map(
    trades
      .filter(trade => trade.status === 'open')
      .map(trade => [makePortfolioContractKey(trade), trade])
  );

  return rows.map(row => {
    const importable = isImportableRow(row);
    const existing = importable ? existingByKey.get(makePortfolioContractKey(row)) : undefined;
    const differences = existing && importable ? getImportDifferences(existing, { ...row, selected: true }) : [];
    const selected = importable && (row.confidence ?? 0) >= 0.62 && (!existing || differences.length > 0);
    const importAction: ImportEditableRow['importAction'] = !importable
      ? 'skip'
      : existing
        ? differences.length > 0 ? 'update' : 'keep'
        : 'add';

    return {
      ...row,
      selected: importAction === 'keep' ? true : selected,
      dateAcquired: existing?.soldDate ?? globalSoldDate,
      dateAcquiredEdited: false,
      importAction,
    };
  });
}

function ParsedRowsTable({ rows, setRows, plan }: { rows: ImportEditableRow[]; setRows: (rows: ImportEditableRow[]) => void; plan: PortfolioImportPlan }) {
  const [openWarningIndex, setOpenWarningIndex] = useState<number | null>(null);
  const [openDiffIndex, setOpenDiffIndex] = useState<number | null>(null);
  const actions = [...plan.adds, ...plan.updates, ...plan.keeps, ...plan.skipped];
  const planActionForRow = (row: ImportEditableRow): ParsedImportAction | undefined => actions.find(action => action.row === row);
  const actionLabel = (row: ImportEditableRow, action?: ParsedImportAction): string => {
    if (!row.selected || row.importAction === 'skip' || plan.skipped.some(item => item.row === row)) return 'Skip';
    if (row.importAction === 'keep' || plan.keeps.some(item => item.row === row)) return 'Keep';
    if (row.importAction === 'update' || plan.updates.some(item => item.row === row)) return 'Update';
    if (row.importAction === 'add' || plan.adds.some(item => item.row === row)) return 'Add';
    return action?.existingTrade ? 'Keep' : 'Add';
  };

  const updateRow = (index: number, patch: Partial<ImportEditableRow>) => {
    setRows(rows.map((row, rowIndex) => rowIndex === index ? normalizeEditableRow({ ...row, ...patch }, row.selected) : row));
  };

  const setRowAction = (index: number, nextAction: ImportEditableRow['importAction']) => {
    const selected = nextAction !== 'skip';
    setRows(rows.map((row, rowIndex) => rowIndex === index ? normalizeEditableRow({ ...row, importAction: nextAction, selected }, selected) : row));
  };

  return (
    <section className="rounded-lg min-w-0 lg:flex lg:flex-col lg:min-h-0" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="px-3 py-2" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="text-xs uppercase tracking-wider font-semibold" style={{ color: 'var(--text-muted)' }}>Parsed Positions</div>
        <p className="mt-1 text-[11px]" style={{ color: 'var(--text-dim)' }}>
          Import uses the screenshot for contract details and original cost basis. Current marks and portfolio P/L are refreshed from live option data after import.
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="p-4 text-sm" style={{ color: 'var(--text-dim)' }}>Upload or paste a screenshot to review parsed rows.</p>
      ) : (
        <div className="overflow-auto lg:max-h-none lg:flex-1">
          <table className="min-w-[1180px] w-full text-[10px] table-fixed">
            <thead className="sticky top-0 z-10">
              <tr style={{ backgroundColor: 'var(--surface-alt)', color: 'var(--text-muted)' }}>
                <th className="px-1 py-1.5 text-left w-[34px]">Use</th>
                <th className="px-1 py-1.5 text-left w-[48px]">Status</th>
                <th className="px-1 py-1.5 text-left w-[118px]">Action</th>
                <th className="px-1 py-1.5 text-left w-[70px]">Ticker</th>
                <th className="px-1 py-1.5 text-right w-[118px]">Expiry</th>
                <th className="px-1 py-1.5 text-right w-[64px]">Strike</th>
                <th className="px-1 py-1.5 text-right w-[48px]">Qty</th>
                <th className="px-1 py-1.5 text-right w-[54px]">Ctr</th>
                <th className="px-1 py-1.5 text-right w-[118px]">Date Acq.</th>
                <th className="px-1 py-1.5 text-right w-[76px]">Sold</th>
                <th className="px-1 py-1.5 text-right w-[74px]">Last</th>
                <th className="px-1 py-1.5 text-right w-[96px]">Value</th>
                <th className="px-1 py-1.5 text-right w-[98px]">Cost</th>
                <th className="px-1 py-1.5 text-right w-[96px]">Tot G/L</th>
                <th className="px-1 py-1.5 text-left w-[82px]">Warn</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const planAction = planActionForRow(row);
                const action = actionLabel(row, planAction);
                const differences = planAction?.differences ?? [];
                const hasExisting = !!planAction?.existingTrade;
                const severity = getImportWarningSeverity(row);
                const statusColor = severity === 'critical' ? 'var(--red)' : severity === 'check' ? 'var(--yellow)' : 'var(--green)';
                const statusLabel = severity === 'critical' ? 'Fix' : severity === 'check' ? 'Check' : 'OK';
                return (
                  <tr key={`${row.rawText}-${index}`} style={{ borderTop: '1px solid var(--border)' }}>
                    <td className="px-1 py-0.5">
                      <input
                        type="checkbox"
                        checked={row.selected && row.importAction !== 'skip'}
                        onChange={event => {
                          if (!event.target.checked) {
                            setRowAction(index, 'skip');
                            return;
                          }
                          setRowAction(index, row.importAction === 'skip' ? (hasExisting ? differences.length > 0 ? 'update' : 'keep' : 'add') : row.importAction);
                        }}
                      />
                    </td>
                    <td className="px-1 py-0.5 font-medium truncate" style={{ color: statusColor }}>{statusLabel}</td>
                    <td className="px-1 py-0.5">
                      <div className="flex items-center gap-1 min-w-0">
                        <select
                          value={row.importAction ?? (hasExisting ? differences.length > 0 ? 'update' : 'keep' : 'add')}
                          onChange={event => setRowAction(index, event.target.value as ImportEditableRow['importAction'])}
                          className="min-w-0 flex-1 rounded px-1 py-0.5 text-[10px] outline-none"
                          style={{ backgroundColor: 'var(--input-bg)', color: action === 'Skip' ? 'var(--red)' : 'var(--text)', border: '1px solid var(--border)' }}
                        >
                          {!hasExisting && <option value="add">Add</option>}
                          {hasExisting && <option value="update">Update</option>}
                          {hasExisting && <option value="keep">Keep</option>}
                          <option value="skip">Skip</option>
                        </select>
                        {differences.length > 0 && (
                          <span className="relative">
                            <button
                              type="button"
                              onClick={() => setOpenDiffIndex(openDiffIndex === index ? null : index)}
                              className="rounded px-1 py-0.5 font-medium"
                              style={{ color: 'var(--accent-light)', backgroundColor: 'var(--surface-alt)', border: '1px solid var(--border)' }}
                            >
                              {differences.length}
                            </button>
                            {openDiffIndex === index && (
                              <div className="absolute left-0 top-6 z-50 w-72 rounded-lg p-2 text-[11px] shadow-xl" style={{ backgroundColor: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)' }}>
                                <div className="font-semibold mb-1">Existing vs Screenshot</div>
                                <div className="space-y-1">
                                  {differences.map(diff => (
                                    <div key={`${diff.field}-${diff.existing}-${diff.imported}`} className="grid grid-cols-[88px_1fr] gap-2">
                                      <span style={{ color: 'var(--text-muted)' }}>{diff.field}</span>
                                      <span className="font-mono tabular-nums">{diff.existing} → {diff.imported}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-1 py-0.5"><SmallInput value={row.ticker} onChange={value => updateRow(index, { ticker: value.toUpperCase() })} /></td>
                    <td className="px-1 py-0.5"><SmallInput type="date" value={row.expiration} onChange={value => updateRow(index, { expiration: value })} align="right" wide /></td>
                    <td className="px-1 py-0.5"><SmallInput value={String(row.strike || '')} onChange={value => updateRow(index, { strike: Number(value) })} align="right" /></td>
                    <td className="px-1 py-0.5 text-right font-mono tabular-nums">{row.quantity ?? DASH}</td>
                    <td className="px-1 py-0.5"><SmallInput value={String(row.contracts ?? '')} onChange={value => updateRow(index, { contracts: Number(value), quantity: -Math.abs(Number(value)), side: 'short' })} align="right" /></td>
                    <td className="px-1 py-0.5"><SmallInput type="date" value={row.dateAcquired ?? ''} onChange={value => updateRow(index, { dateAcquired: value, dateAcquiredEdited: true })} align="right" wide /></td>
                    <td className="px-1 py-0.5"><SmallInput value={row.averageCostBasis == null ? '' : String(row.averageCostBasis)} onChange={value => updateRow(index, { averageCostBasis: Number(value) })} align="right" /></td>
                    <td className="px-1 py-0.5 text-right font-mono tabular-nums">{formatOptionPrice(row.lastPrice)}</td>
                    <td className="px-1 py-0.5 text-right font-mono tabular-nums">{formatCurrency(row.currentValue, 0)}</td>
                    <td className="px-1 py-0.5 text-right font-mono tabular-nums">{formatCurrency(row.costBasisTotal, 2)}</td>
                    <td className="px-1 py-0.5 text-right font-mono tabular-nums">{formatCurrency(row.totalGainLossDollar, 2)}</td>
                    <td className="px-1 py-0.5 text-left">
                      {row.warnings.length > 0 ? (
                        <span className="relative inline-block">
                          <button
                            type="button"
                            aria-label="View import warnings"
                            title={row.warnings.join('\n')}
                            onClick={() => setOpenWarningIndex(openWarningIndex === index ? null : index)}
                            className="inline-flex max-w-full items-center gap-1 rounded px-1.5 py-0.5"
                            style={{
                              color: severity === 'critical' ? 'var(--red)' : severity === 'check' ? 'var(--yellow)' : 'var(--text-dim)',
                              backgroundColor: 'var(--surface-alt)',
                              border: '1px solid var(--border)',
                            }}
                          >
                            <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                            <span className="truncate">{row.warnings.length}</span>
                          </button>
                          {openWarningIndex === index && (
                            <div className="absolute right-0 top-6 z-50 w-72 rounded-lg p-2 text-[11px] shadow-xl" style={{ backgroundColor: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)' }}>
                              <div className="font-semibold mb-1">Import Warnings</div>
                              <div className="mb-1 text-[10px] uppercase tracking-wider" style={{ color: severity === 'critical' ? 'var(--red)' : severity === 'check' ? 'var(--yellow)' : 'var(--text-dim)' }}>
                                {severity === 'critical' ? 'Critical issues' : severity === 'check' ? 'Check' : 'Informational notes'}
                              </div>
                              <ul className="space-y-1">
                                {row.warnings.map(warning => <li key={warning}>• {warning}</li>)}
                              </ul>
                            </div>
                          )}
                        </span>
                      ) : DASH}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function MissingTradesTable({ plan, setMissingActions, expanded, onToggle }: { plan: PortfolioImportPlan; setMissingActions: (updater: (prev: Record<string, ExistingTradeAction['action']>) => Record<string, ExistingTradeAction['action']>) => void; expanded: boolean; onToggle: () => void }) {
  if (plan.missingFromImport.length === 0) return null;
  return (
    <section className="rounded-lg min-w-0 flex-shrink-0" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
      <button
        type="button"
        onClick={onToggle}
        className="w-full px-3 py-2 text-left text-xs uppercase tracking-wider font-semibold flex items-center justify-between"
        style={{ color: 'var(--text-muted)', borderBottom: expanded ? '1px solid var(--border)' : '0' }}
      >
        <span>Missing From Screenshot ({plan.missingFromImport.length})</span>
        <span>{expanded ? 'Hide' : 'Show'}</span>
      </button>
      {expanded && <div className="overflow-x-auto max-h-[180px]">
        <p className="px-3 py-2 text-[11px]" style={{ color: 'var(--text-dim)' }}>
          These existing open trades were not found in the imported screenshot. They will remain in your portfolio unless you manually close or mark them.
        </p>
        <table className="min-w-[680px] w-full text-[11px]">
          <thead>
            <tr style={{ backgroundColor: 'var(--surface-alt)', color: 'var(--text-muted)' }}>
              <th className="px-2 py-2 text-left">Position</th>
              <th className="px-2 py-2 text-right">Expiry</th>
              <th className="px-2 py-2 text-right">Contracts</th>
              <th className="px-2 py-2 text-right">Sold</th>
              <th className="px-2 py-2 text-left">Action</th>
            </tr>
          </thead>
          <tbody>
            {plan.missingFromImport.map(item => (
              <tr key={item.key} style={{ borderTop: '1px solid var(--border)' }}>
                <td className="px-2 py-1 font-mono" style={{ color: 'var(--text)' }}>{item.trade.ticker} {item.trade.strike} Put</td>
                <td className="px-2 py-1 text-right font-mono">{formatDate(`${item.trade.expiration}T00:00:00`)}</td>
                <td className="px-2 py-1 text-right font-mono">{item.trade.contracts}</td>
                <td className="px-2 py-1 text-right font-mono">{formatOptionPrice(item.trade.soldPrice)}</td>
                <td className="px-2 py-1">
                  <select
                    value={item.action}
                    onChange={event => setMissingActions(prev => ({ ...prev, [item.key]: event.target.value as ExistingTradeAction['action'] }))}
                    className="rounded px-2 py-1 outline-none"
                    style={{ backgroundColor: 'var(--input-bg)', color: 'var(--text)', border: '1px solid var(--border)' }}
                  >
                    <option value="keep">Keep as-is</option>
                    <option value="closed">Mark Closed</option>
                    <option value="expired">Mark Expired{item.suggestedStatus === 'expired' ? ' (suggested)' : ''}</option>
                    <option value="assigned">Mark Assigned</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>}
    </section>
  );
}

function getImportWarningSeverity(row: ImportEditableRow): 'none' | 'info' | 'check' | 'critical' {
  if (!isImportableRow(row)) return 'critical';
  const nonRoutineWarnings = row.warnings.filter(warning => !warning.startsWith('Entry date'));
  if (nonRoutineWarnings.length === 0) return row.warnings.length > 0 ? 'info' : 'none';
  const hasCoreWarning = nonRoutineWarnings.some(warning =>
    /cost basis total does not match|cost basis total was not read|ticker corrected|expiration parsed/i.test(warning)
  );
  return hasCoreWarning ? 'check' : 'info';
}

function SmallInput({ value, onChange, align = 'left', type = 'text', wide = false }: { value: string; onChange: (value: string) => void; align?: 'left' | 'right'; type?: string; wide?: boolean }) {
  return (
    <input
      type={type}
      value={value}
      onChange={event => onChange(event.target.value)}
      className={`w-full ${wide ? 'min-w-[112px]' : 'min-w-[54px]'} rounded px-1 py-0.5 text-[10px] font-mono outline-none tabular-nums ${align === 'right' ? 'text-right' : 'text-left'}`}
      style={{ backgroundColor: 'var(--input-bg)', color: 'var(--text)', border: '1px solid var(--border)' }}
    />
  );
}

function normalizeEditableRow(row: ImportEditableRow, selected: boolean): ImportEditableRow {
  const validated = validateParsedBrokerageRow({
    ...row,
    ticker: row.ticker.trim().toUpperCase(),
    strike: Number.isFinite(row.strike) ? row.strike : 0,
    contracts: Number.isFinite(row.contracts) ? Math.abs(Number(row.contracts)) : null,
    quantity: Number.isFinite(row.contracts) ? -Math.abs(Number(row.contracts)) : row.quantity,
    side: Number.isFinite(row.contracts) ? 'short' : row.side,
    averageCostBasis: Number.isFinite(row.averageCostBasis) ? row.averageCostBasis : undefined,
    warnings: row.warnings.filter(warning => warning.startsWith('Entry date')),
  });
  return {
    ...validated,
    selected,
    dateAcquired: row.dateAcquired,
    dateAcquiredEdited: row.dateAcquiredEdited,
    importAction: row.importAction,
  };
}

interface TesseractWordLike {
  text: string;
  confidence?: number;
  bbox?: { x0: number; y0: number; x1: number; y1: number };
}

interface TesseractLineLike {
  text?: string;
  confidence?: number;
  bbox?: { x0: number; y0: number; x1: number; y1: number };
  words?: TesseractWordLike[];
}

interface TesseractParagraphLike {
  lines?: TesseractLineLike[];
}

interface TesseractBlockLike {
  paragraphs?: TesseractParagraphLike[];
}

interface TesseractPageLike {
  text?: string;
  version?: string;
  tsv?: string | null;
  hocr?: string | null;
  words?: TesseractWordLike[];
  lines?: TesseractLineLike[];
  blocks?: TesseractBlockLike[] | null;
}

interface ExtractedTesseractWords {
  words: PortfolioImportOcrWord[];
  lineCount: number;
  source: string;
  tsvPresent: boolean;
  hocrPresent: boolean;
  blocksPresent: boolean;
}

interface ProcessedImage {
  blob: Blob;
  dimensions: { width: number; height: number };
  original: { width: number; height: number };
}

function extractTesseractWords(page: TesseractPageLike): ExtractedTesseractWords {
  const tsvPresent = !!page.tsv;
  const hocrPresent = !!page.hocr;
  const blocksPresent = Array.isArray(page.blocks) && page.blocks.length > 0;

  const tsvWords = parseTsvWords(page.tsv);
  if (tsvWords.words.length > 0) {
    return { ...tsvWords, source: 'tsv', tsvPresent, hocrPresent, blocksPresent };
  }

  const hocrWords = parseHocrWords(page.hocr);
  if (hocrWords.words.length > 0) {
    return { ...hocrWords, source: 'hocr', tsvPresent, hocrPresent, blocksPresent };
  }

  const direct = normalizeTesseractWords(page.words ?? []);
  if (direct.length > 0) {
    return { words: direct, lineCount: page.lines?.length ?? 0, source: 'data.words', tsvPresent, hocrPresent, blocksPresent };
  }

  const blockWords = (page.blocks ?? []).flatMap(block => (block.paragraphs ?? []).flatMap(paragraph => (paragraph.lines ?? []).flatMap(line => line.words ?? [])));
  const normalizedBlockWords = normalizeTesseractWords(blockWords);
  if (normalizedBlockWords.length > 0) {
    const lineCount = (page.blocks ?? []).reduce((total, block) => total + (block.paragraphs ?? []).reduce((paragraphTotal, paragraph) => paragraphTotal + (paragraph.lines?.length ?? 0), 0), 0);
    return { words: normalizedBlockWords, lineCount, source: 'blocks.paragraphs.lines.words', tsvPresent, hocrPresent, blocksPresent };
  }

  const lineWords = (page.lines ?? []).flatMap(line => line.words ?? []);
  const normalizedLineWords = normalizeTesseractWords(lineWords);
  if (normalizedLineWords.length > 0) {
    return { words: normalizedLineWords, lineCount: page.lines?.length ?? 0, source: 'data.lines.words', tsvPresent, hocrPresent, blocksPresent };
  }

  return { words: [], lineCount: page.lines?.length ?? 0, source: 'text_fallback', tsvPresent, hocrPresent, blocksPresent };
}

function parseTsvWords(tsv: string | null | undefined): { words: PortfolioImportOcrWord[]; lineCount: number } {
  if (!tsv) return { words: [], lineCount: 0 };
  const rows = tsv.split(/\r?\n/).filter(Boolean);
  const header = rows.shift()?.split('\t') ?? [];
  const index = (name: string) => header.indexOf(name);
  const levelIndex = index('level');
  const leftIndex = index('left');
  const topIndex = index('top');
  const widthIndex = index('width');
  const heightIndex = index('height');
  const confIndex = index('conf');
  const textIndex = index('text');
  const lineIndexes = new Set<string>();
  const words: PortfolioImportOcrWord[] = [];

  rows.forEach(row => {
    const columns = row.split('\t');
    if (columns[levelIndex] !== '5') return;
    const text = (columns[textIndex] ?? '').trim();
    if (!text) return;
    const left = Number(columns[leftIndex]);
    const top = Number(columns[topIndex]);
    const width = Number(columns[widthIndex]);
    const height = Number(columns[heightIndex]);
    const confidence = Number(columns[confIndex]);
    if (!Number.isFinite(left) || !Number.isFinite(top) || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
    if (Number.isFinite(confidence) && confidence < 10 && !/^[-+−–—$.,()%\d]+$/.test(text)) return;
    lineIndexes.add(`${columns[index('block_num')]}:${columns[index('par_num')]}:${columns[index('line_num')]}`);
    words.push({
      text,
      confidence: Number.isFinite(confidence) ? confidence : 60,
      bbox: { x0: left, y0: top, x1: left + width, y1: top + height },
    });
  });

  return { words, lineCount: lineIndexes.size };
}

function parseHocrWords(hocr: string | null | undefined): { words: PortfolioImportOcrWord[]; lineCount: number } {
  if (!hocr || typeof DOMParser === 'undefined') return { words: [], lineCount: 0 };
  const document = new DOMParser().parseFromString(hocr, 'text/html');
  const elements = Array.from(document.querySelectorAll('.ocrx_word'));
  const lineCount = document.querySelectorAll('.ocr_line').length;
  const words = elements.flatMap(element => {
    const text = element.textContent?.trim() ?? '';
    const title = element.getAttribute('title') ?? '';
    const bboxMatch = title.match(/bbox\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/);
    if (!text || !bboxMatch) return [];
    const confidenceMatch = title.match(/x_wconf\s+(\d+(?:\.\d+)?)/);
    return [{
      text,
      confidence: confidenceMatch ? Number(confidenceMatch[1]) : 60,
      bbox: {
        x0: Number(bboxMatch[1]),
        y0: Number(bboxMatch[2]),
        x1: Number(bboxMatch[3]),
        y1: Number(bboxMatch[4]),
      },
    }];
  });
  return { words, lineCount };
}

function normalizeTesseractWords(words: TesseractWordLike[]): PortfolioImportOcrWord[] {
  return words.flatMap(word => {
    if (!word.text || !word.bbox) return [];
    return [{
      text: word.text,
      confidence: typeof word.confidence === 'number' ? word.confidence : 60,
      bbox: word.bbox,
    }];
  });
}

async function runOcrImportPasses(
  file: File,
  recognize: (processed: ProcessedImage, passLabel: 'primary' | 'fallback', dimensions: { original: { width: number; height: number }; processed: { width: number; height: number } }) => Promise<PortfolioImportParseResult>
): Promise<PortfolioImportParseResult> {
  const primary = await preprocessImage(file, 'primary');
  const primaryResult = await recognize(primary, 'primary', { original: primary.original, processed: primary.dimensions });
  const enoughRows = primaryResult.diagnostics.importableRowCount >= 8 ||
    (primaryResult.diagnostics.detectedOptionRowCount > 0 && primaryResult.diagnostics.detectedOptionRowCount < 8 && primaryResult.diagnostics.importableRowCount >= Math.floor(primaryResult.diagnostics.detectedOptionRowCount * 0.85));
  if (primaryResult.diagnostics.ocrWordCount >= 40 && enoughRows) return primaryResult;

  const fallback = await preprocessImage(file, 'fallback');
  const fallbackResult = await recognize(fallback, 'fallback', { original: fallback.original, processed: fallback.dimensions });
  return fallbackResult.diagnostics.importableRowCount >= primaryResult.diagnostics.importableRowCount ? fallbackResult : primaryResult;
}

async function preprocessImage(file: File, variant: 'primary' | 'fallback'): Promise<ProcessedImage> {
  const bitmap = await createImageBitmap(file);
  const targetWidth = variant === 'fallback' ? 3200 : 3000;
  const scale = Math.max(1, targetWidth / bitmap.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return { blob: file, dimensions: { width: bitmap.width, height: bitmap.height }, original: { width: bitmap.width, height: bitmap.height } };
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    const contrastFactor = variant === 'fallback' ? 1.75 : 1.45;
    const bias = variant === 'fallback' ? 6 : 0;
    const contrast = Math.max(0, Math.min(255, (gray - 128) * contrastFactor + 128 - bias));
    data[i] = contrast;
    data[i + 1] = contrast;
    data[i + 2] = contrast;
  }
  context.putImageData(imageData, 0, 0);
  return new Promise(resolve => {
    canvas.toBlob(blob => resolve({
      blob: blob ?? file,
      dimensions: { width: canvas.width, height: canvas.height },
      original: { width: bitmap.width, height: bitmap.height },
    }), 'image/png');
  });
}
