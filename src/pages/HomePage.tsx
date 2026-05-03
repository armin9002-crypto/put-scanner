import { useState, useMemo } from 'react';
import { ETF_LIST } from '../lib/etfs';
import type { ETFInfo } from '../lib/types';
import ETFCard from '../components/ETFCard';
import { Search, ShieldCheck } from 'lucide-react';

interface HomePageProps {
  onSelectETF: (etf: ETFInfo) => void;
}

export default function HomePage({ onSelectETF }: HomePageProps) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return ETF_LIST;
    return ETF_LIST.filter(
      e => e.ticker.toLowerCase().includes(q) || e.underlying.toLowerCase().includes(q) || e.name.toLowerCase().includes(q)
    );
  }, [search]);

  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <header className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-[#6366f1]/15 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-[#6366f1]" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-[#e2e8f0] tracking-tight">Put Premium Scanner</h1>
              <p className="text-sm text-[#64748b]">Leveraged ETF Options Screener</p>
            </div>
          </div>
        </header>

        <div className="relative mb-6">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[#64748b]" />
          <input
            type="text"
            placeholder="Filter by ticker or underlying index..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-11 pr-4 py-3 bg-[#12121a] border border-[#1e1e2e] rounded-xl text-sm text-[#e2e8f0] placeholder-[#475569] focus:outline-none focus:ring-2 focus:ring-[#6366f1]/40 focus:border-[#6366f1]/40 transition-all"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map(etf => (
            <ETFCard key={etf.ticker} etf={etf} onClick={() => onSelectETF(etf)} />
          ))}
        </div>

        {filtered.length === 0 && (
          <div className="text-center py-16">
            <p className="text-[#64748b]">No ETFs match your search.</p>
          </div>
        )}

        <footer className="mt-12 pb-6 text-center">
          <p className="text-xs text-[#475569]">Data delayed up to 15 minutes. Not financial advice.</p>
        </footer>
      </div>
    </div>
  );
}
