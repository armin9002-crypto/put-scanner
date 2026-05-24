import { Loader2 } from 'lucide-react';

export interface ExpirationOption {
  value: string;
  label: string;
}

export interface ExpirationInfo {
  date: number;
  label: string;
  dte: number;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatExpirationDropdownLabel(ts: number): string {
  const d = new Date(ts * 1000);
  const month = MONTHS[d.getUTCMonth()];
  const day = d.getUTCDate();
  const yr = `'${String(d.getUTCFullYear() % 100).padStart(2, '0')}`;
  return `${month} ${day}, ${yr}`;
}

export function buildExpirationOptions(availableExps: ExpirationInfo[]): ExpirationOption[] {
  const opts: ExpirationOption[] = [{ value: 'all', label: 'All dates' }];
  const hasShortDated = availableExps.some(e => e.dte <= 30);
  if (hasShortDated) {
    opts.push({ value: 'lte_30dte', label: '\u226430 DTE' });
  }
  for (const exp of availableExps) {
    if (exp.dte > 30) {
      opts.push({
        value: `date_${exp.date}`,
        label: `${formatExpirationDropdownLabel(exp.date)} (${exp.dte} DTE)`,
      });
    }
  }
  return opts;
}

export default function ExpirationFilter({
  value,
  onChange,
  options,
  loadingDates,
  datesLoaded,
}: {
  value: string;
  onChange: (value: string) => void;
  options: ExpirationOption[];
  loadingDates: boolean;
  datesLoaded: boolean;
}) {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
        Expiration
        {loadingDates && <Loader2 className="w-3 h-3 inline ml-1 animate-spin" />}
      </label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="rounded-lg px-2 py-1.5 text-xs outline-none cursor-pointer"
        style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text)' }}
      >
        {loadingDates && !datesLoaded && <option value={value} disabled>Loading...</option>}
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}
