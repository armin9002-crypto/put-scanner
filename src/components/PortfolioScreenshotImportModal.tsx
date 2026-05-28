import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Clipboard, FileImage, Upload, X } from 'lucide-react';
import { formatCurrency, formatDate, formatOptionPrice } from '../lib/format';
import type { PortfolioTrade } from '../lib/portfolioStorage';
import {
  applyPortfolioImportPlan,
  buildPortfolioImportPlan,
  isImportableRow,
  parseBrokerageScreenshotOcr,
  validateParsedBrokerageRow,
  type ExistingTradeAction,
  type ImportEditableRow,
  type PortfolioImportDiagnostics,
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
      const processed = await preprocessImage(file);
      const tesseract = await import('tesseract.js');
      setStatus('reading');
      const result = await tesseract.recognize(processed, 'eng', {
        logger: message => {
          if (message.status === 'recognizing text' && typeof message.progress === 'number') {
            setProgress(Math.round(message.progress * 100));
          }
        },
      });
      const parsed = parseBrokerageScreenshotOcr({
        text: result.data.text,
        words: extractTesseractWords(result.data),
      });
      const parsedRows = parsed.rows.map(row => ({
        ...row,
        selected: isImportableRow(row) && (row.confidence ?? 0) >= 0.72,
      }));
      setRows(parsedRows);
      setDiagnostics(parsed.diagnostics);
      setStatus('done');
      if (parsedRows.length === 0) {
        setError('No sold put rows were detected. You can cancel and add trades manually.');
      } else if (parsed.diagnostics.warnings.length > 0) {
        setError(parsed.diagnostics.warnings.join(' '));
      }
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'OCR failed. The screenshot was not imported.');
    }
  }, [imageUrl]);

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
      <div className="absolute inset-x-2 top-3 bottom-3 lg:inset-x-1/2 lg:top-[4vh] lg:bottom-auto lg:w-[min(96vw,1500px)] lg:h-[min(92vh,1000px)] lg:-translate-x-1/2 rounded-lg overflow-hidden p-4 sm:p-5 shadow-2xl flex flex-col" style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)' }}>
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

        <div className="grid grid-cols-1 lg:grid-cols-[420px_minmax(0,1fr)] gap-4 min-h-0 flex-1 overflow-y-auto lg:overflow-hidden">
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
              className="w-full rounded-lg p-5 text-center min-h-[180px] flex flex-col items-center justify-center gap-3"
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
                <img src={imageUrl} alt="Brokerage screenshot preview" className="w-full max-h-[360px] object-contain rounded" />
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
                {showDiagnostics && (
                  <div className="mt-2 space-y-1 font-mono" style={{ color: 'var(--text-muted)' }}>
                    <div>Words: {diagnostics.ocrWordCount}</div>
                    <div>Headers: {diagnostics.detectedHeaderColumns.join(', ') || DASH}</div>
                    <div>Detected rows: {diagnostics.detectedOptionRowCount}</div>
                    <div>Parsed rows: {diagnostics.parsedRowCount}</div>
                    <div>Importable rows: {diagnostics.importableRowCount}</div>
                    {diagnostics.warnings.map(warning => <div key={warning} style={{ color: 'var(--yellow)' }}>{warning}</div>)}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="min-w-0 min-h-0 space-y-3 lg:flex lg:flex-col lg:overflow-hidden">
            <ReviewSummary plan={plan} />
            <ParsedRowsTable rows={rows} setRows={setRows} plan={plan} />
            <MissingTradesTable plan={plan} setMissingActions={setMissingActions} />
          </div>
        </div>

        <div className="flex flex-col sm:flex-row justify-end gap-2 mt-3 pt-3 flex-shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-xs min-h-[44px]" style={{ backgroundColor: 'var(--surface)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>Cancel</button>
          <button
            onClick={applyImport}
            disabled={selectedImportableCount === 0 && plan.missingFromImport.every(item => item.action === 'keep')}
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
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
      <MiniCard label="Add" value={plan.adds.length} />
      <MiniCard label="Update" value={plan.updates.length} />
      <MiniCard label="Skipped" value={plan.skipped.length} />
      <MiniCard label="Missing" value={plan.missingFromImport.length} />
    </div>
  );
}

function MiniCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>{label}</div>
      <div className="font-mono text-lg font-semibold" style={{ color: 'var(--text)' }}>{value}</div>
    </div>
  );
}

function ParsedRowsTable({ rows, setRows, plan }: { rows: ImportEditableRow[]; setRows: (rows: ImportEditableRow[]) => void; plan: PortfolioImportPlan }) {
  const actionForRow = (row: ImportEditableRow): string => {
    if (plan.adds.some(action => action.row === row)) return 'Add';
    if (plan.updates.some(action => action.row === row)) return 'Update';
    if (plan.skipped.some(action => action.row === row)) return 'Skipped';
    return 'Review';
  };

  const updateRow = (index: number, patch: Partial<ImportEditableRow>) => {
    setRows(rows.map((row, rowIndex) => rowIndex === index ? normalizeEditableRow({ ...row, ...patch }, row.selected) : row));
  };

  return (
    <section className="rounded-lg min-w-0 lg:flex lg:flex-col lg:min-h-0" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="px-3 py-2 text-xs uppercase tracking-wider font-semibold" style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>Parsed Positions</div>
      {rows.length === 0 ? (
        <p className="p-4 text-sm" style={{ color: 'var(--text-dim)' }}>Upload or paste a screenshot to review parsed rows.</p>
      ) : (
        <div className="overflow-auto lg:max-h-none lg:flex-1">
          <table className="min-w-[1260px] w-full text-[10px]">
            <thead className="sticky top-0 z-10">
              <tr style={{ backgroundColor: 'var(--surface-alt)', color: 'var(--text-muted)' }}>
                <th className="px-1.5 py-1.5 text-left">Use</th>
                <th className="px-1.5 py-1.5 text-left">Status</th>
                <th className="px-1.5 py-1.5 text-left">Action</th>
                <th className="px-1.5 py-1.5 text-left">Ticker</th>
                <th className="px-1.5 py-1.5 text-right">Expiry</th>
                <th className="px-1.5 py-1.5 text-right">Strike</th>
                <th className="px-1.5 py-1.5 text-right">Qty</th>
                <th className="px-1.5 py-1.5 text-right">Contracts</th>
                <th className="px-1.5 py-1.5 text-left">Side</th>
                <th className="px-1.5 py-1.5 text-right">Avg Cost</th>
                <th className="px-1.5 py-1.5 text-right">Cost Total</th>
                <th className="px-1.5 py-1.5 text-right">Last</th>
                <th className="px-1.5 py-1.5 text-right">Total G/L</th>
                <th className="px-1.5 py-1.5 text-right">Current Value</th>
                <th className="px-1.5 py-1.5 text-left">Warnings</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const action = actionForRow(row);
                const criticalOk = isImportableRow(row);
                const hasOnlyDateWarning = row.warnings.every(warning => warning.startsWith('Entry date'));
                const statusColor = criticalOk ? hasOnlyDateWarning ? 'var(--green)' : 'var(--yellow)' : 'var(--red)';
                return (
                  <tr key={`${row.rawText}-${index}`} style={{ borderTop: '1px solid var(--border)' }}>
                    <td className="px-1.5 py-1">
                      <input type="checkbox" checked={row.selected} onChange={event => updateRow(index, { selected: event.target.checked })} />
                    </td>
                    <td className="px-1.5 py-1 font-medium" style={{ color: statusColor }}>{criticalOk ? hasOnlyDateWarning ? 'OK' : 'Check' : 'Fix'}</td>
                    <td className="px-1.5 py-1 font-medium" style={{ color: action === 'Skipped' ? 'var(--red)' : 'var(--accent-light)' }}>{action}</td>
                    <td className="px-1.5 py-1"><SmallInput value={row.ticker} onChange={value => updateRow(index, { ticker: value.toUpperCase() })} /></td>
                    <td className="px-1.5 py-1"><SmallInput type="date" value={row.expiration} onChange={value => updateRow(index, { expiration: value })} align="right" wide /></td>
                    <td className="px-1.5 py-1"><SmallInput value={String(row.strike || '')} onChange={value => updateRow(index, { strike: Number(value) })} align="right" /></td>
                    <td className="px-1.5 py-1 text-right font-mono">{row.quantity ?? DASH}</td>
                    <td className="px-1.5 py-1"><SmallInput value={String(row.contracts ?? '')} onChange={value => updateRow(index, { contracts: Number(value), quantity: -Math.abs(Number(value)), side: 'short' })} align="right" /></td>
                    <td className="px-1.5 py-1 font-mono" style={{ color: row.side === 'short' ? 'var(--green)' : 'var(--text-muted)' }}>{row.side}</td>
                    <td className="px-1.5 py-1"><SmallInput value={row.averageCostBasis == null ? '' : String(row.averageCostBasis)} onChange={value => updateRow(index, { averageCostBasis: Number(value) })} align="right" /></td>
                    <td className="px-1.5 py-1 text-right font-mono">{formatCurrency(row.costBasisTotal, 0)}</td>
                    <td className="px-1.5 py-1 text-right font-mono">{formatOptionPrice(row.lastPrice)}</td>
                    <td className="px-1.5 py-1 text-right font-mono">{formatCurrency(row.totalGainLossDollar, 0)}</td>
                    <td className="px-1.5 py-1 text-right font-mono">{formatCurrency(row.currentValue, 0)}</td>
                    <td className="px-1.5 py-1 text-left max-w-[300px] truncate" title={row.warnings.join(' ')} style={{ color: row.warnings.length && !hasOnlyDateWarning ? 'var(--yellow)' : 'var(--text-dim)' }}>{row.warnings.join(' ') || DASH}</td>
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

function MissingTradesTable({ plan, setMissingActions }: { plan: PortfolioImportPlan; setMissingActions: (updater: (prev: Record<string, ExistingTradeAction['action']>) => Record<string, ExistingTradeAction['action']>) => void }) {
  if (plan.missingFromImport.length === 0) return null;
  return (
    <section className="rounded-lg min-w-0" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="px-3 py-2 text-xs uppercase tracking-wider font-semibold" style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>Missing From Screenshot</div>
      <div className="overflow-x-auto">
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
      </div>
    </section>
  );
}

function SmallInput({ value, onChange, align = 'left', type = 'text', wide = false }: { value: string; onChange: (value: string) => void; align?: 'left' | 'right'; type?: string; wide?: boolean }) {
  return (
    <input
      type={type}
      value={value}
      onChange={event => onChange(event.target.value)}
      className={`w-full ${wide ? 'min-w-[118px]' : 'min-w-[70px]'} rounded px-1.5 py-1 text-[11px] font-mono outline-none ${align === 'right' ? 'text-right' : 'text-left'}`}
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
  return { ...validated, selected };
}

interface TesseractWordLike {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

interface TesseractLineLike {
  words?: TesseractWordLike[];
}

interface TesseractParagraphLike {
  lines?: TesseractLineLike[];
}

interface TesseractBlockLike {
  paragraphs?: TesseractParagraphLike[];
}

interface TesseractPageLike {
  blocks?: TesseractBlockLike[] | null;
}

function extractTesseractWords(page: TesseractPageLike): PortfolioImportOcrWord[] {
  return (page.blocks ?? []).flatMap(block => (block.paragraphs ?? []).flatMap(paragraph => (paragraph.lines ?? []).flatMap(line => (line.words ?? []).map(word => ({
    text: word.text,
    confidence: word.confidence,
    bbox: word.bbox,
  })))));
}

async function preprocessImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = bitmap.width < 1600 ? Math.min(2.5, 1600 / bitmap.width) : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return file;
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    const contrast = Math.max(0, Math.min(255, (gray - 128) * 1.35 + 128));
    data[i] = contrast;
    data[i + 1] = contrast;
    data[i + 2] = contrast;
  }
  context.putImageData(imageData, 0, 0);
  return new Promise(resolve => {
    canvas.toBlob(blob => resolve(blob ?? file), 'image/png');
  });
}
