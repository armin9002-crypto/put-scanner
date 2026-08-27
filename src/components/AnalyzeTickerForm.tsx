import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Search } from 'lucide-react';
import { normalizeAnalyzeTicker } from '../lib/tickerDetail';

export default function AnalyzeTickerForm({ compact = false }: { compact?: boolean }) {
  const navigate = useNavigate();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className={compact ? 'min-w-0' : 'rounded-xl p-3 sm:p-4'}
      style={compact ? undefined : { backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
      onSubmit={event => {
        event.preventDefault();
        const normalized = normalizeAnalyzeTicker(value);
        if (!normalized.ticker) {
          setError(normalized.error);
          return;
        }
        setError(null);
        navigate(`/options/${encodeURIComponent(normalized.ticker)}`);
      }}
      aria-label="Analyze ticker"
    >
      {!compact && (
        <div className="mb-2">
          <div className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Analyze Ticker</div>
          <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Open one stock or ETF on demand. Nothing is saved until you take an explicit save action.</div>
        </div>
      )}
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2">
        <label className="relative min-w-0">
          <span className="sr-only">Ticker symbol</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: 'var(--text-dim)' }} />
          <input
            type="text"
            value={value}
            onChange={event => { setValue(event.target.value); if (error) setError(null); }}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            inputMode="text"
            placeholder="NVDA"
            className="min-h-11 w-full rounded-lg pl-9 pr-3 text-base font-mono uppercase outline-none"
            style={{ backgroundColor: 'var(--input-bg)', border: `1px solid ${error ? 'var(--red)' : 'var(--border)'}`, color: 'var(--text)' }}
            aria-invalid={error ? 'true' : 'false'}
            aria-describedby={error ? 'analyze-ticker-error' : undefined}
          />
        </label>
        <button type="submit" className="pressable inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-white" style={{ backgroundColor: 'var(--accent)' }}>
          Analyze <ArrowRight className="h-4 w-4" />
        </button>
      </div>
      {error && <p id="analyze-ticker-error" className="mt-1.5 text-[11px]" style={{ color: 'var(--red)' }}>{error}</p>}
    </form>
  );
}
