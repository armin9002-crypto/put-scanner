import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, RefreshCw, X } from 'lucide-react';
import type { UnderlyingHoldingsProxy } from '../lib/underlyingHoldingsProxies';
import { fetchUnderlyingHoldings, getCachedUnderlyingHoldings } from '../lib/underlyingHoldings';
import type { UnderlyingHoldingsData } from '../lib/underlyingHoldings';

interface UnderlyingHoldingsModalProps {
  proxy: UnderlyingHoldingsProxy;
  onClose: () => void;
}

function formatWeight(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return `${value.toFixed(1)}%`;
}

function formatTimestamp(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return new Date(value).toLocaleString();
}

export default function UnderlyingHoldingsModal({ proxy, onClose }: UnderlyingHoldingsModalProps) {
  const [data, setData] = useState<UnderlyingHoldingsData | null>(() => (
    proxy.meaningful && proxy.proxyTicker ? getCachedUnderlyingHoldings(proxy.proxyTicker) : null
  ));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visibleHoldings = useMemo(() => data?.holdings.slice(0, 20) ?? [], [data]);

  const loadHoldings = async (bypassCache = false) => {
    if (!proxy.meaningful || !proxy.proxyTicker) return;
    setLoading(true);
    setError(null);
    try {
      const next = await fetchUnderlyingHoldings(proxy.proxyTicker, { bypassCache });
      setData(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load holdings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (!proxy.meaningful || !proxy.proxyTicker || data) return;
    void loadHoldings(false);
    // data is intentionally excluded so opening with a cache hit does not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proxy.meaningful, proxy.proxyTicker]);

  const unavailableReason = !proxy.meaningful
    ? proxy.reason
    : data?.unavailableReason ?? error;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center px-3 py-4 sm:px-6">
      <button
        type="button"
        aria-label="Close underlying holdings modal"
        onClick={onClose}
        className="absolute inset-0 bg-black/60"
      />
      <section
        className="relative flex max-h-[86vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl shadow-2xl"
        style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)' }}
      >
        <div className="flex items-start justify-between gap-3 border-b p-4 sm:p-5" style={{ borderColor: 'var(--border)' }}>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold" style={{ color: 'var(--text)' }}>Underlying Holdings</h2>
            <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
              {proxy.meaningful && proxy.proxyTicker
                ? `${proxy.proxyTicker} holdings used as the underlying exposure proxy for ${proxy.sourceTicker}.`
                : `Underlying holdings are not meaningful for ${proxy.sourceTicker}.`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close underlying holdings"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg"
            style={{ color: 'var(--text-muted)' }}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          {!proxy.meaningful ? (
            <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
              <div className="flex items-start gap-3">
                <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0" style={{ color: 'var(--text-dim)' }} />
                <div>
                  <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Holdings unavailable</h3>
                  <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>{proxy.reason}</p>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="mb-4 grid gap-2 sm:grid-cols-4">
                <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
                  <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>Proxy</div>
                  <div className="mt-1 font-mono text-sm font-semibold" style={{ color: 'var(--text)' }}>{proxy.proxyTicker}</div>
                </div>
                <div className="rounded-lg p-3 sm:col-span-2" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
                  <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>Proxy Name</div>
                  <div className="mt-1 truncate text-sm" title={data?.name ?? proxy.proxyName} style={{ color: 'var(--text)' }}>
                    {data?.name ?? proxy.proxyName ?? proxy.proxyTicker}
                  </div>
                </div>
                <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
                  <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>Top Weight</div>
                  <div className="mt-1 font-mono text-sm font-semibold" style={{ color: 'var(--text)' }}>
                    {formatWeight(data?.topHoldingsWeight)}
                  </div>
                </div>
              </div>

              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                <span>
                  {data
                    ? `${data.topHoldingsCount} holdings from ${data.source} - ${formatTimestamp(data.fetchedAt)}`
                    : loading ? 'Loading holdings...' : proxy.reason}
                </span>
                <button
                  type="button"
                  onClick={() => void loadHoldings(true)}
                  disabled={loading || !proxy.proxyTicker}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium disabled:opacity-50"
                  style={{ backgroundColor: 'var(--surface-alt)', color: 'var(--text)', border: '1px solid var(--border)' }}
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                  Refresh holdings
                </button>
              </div>

              {unavailableReason && visibleHoldings.length === 0 && !loading ? (
                <div className="rounded-xl p-4 text-sm" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                  {unavailableReason}
                </div>
              ) : null}

              {visibleHoldings.length > 0 ? (
                <div className="overflow-x-auto rounded-xl" style={{ border: '1px solid var(--border)' }}>
                  <table className="w-full min-w-[520px] border-collapse text-sm">
                    <thead className="sticky top-0 z-10" style={{ backgroundColor: 'var(--surface)' }}>
                      <tr style={{ borderBottom: '1px solid var(--border)' }}>
                        <th className="w-10 px-3 py-2 text-left text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>#</th>
                        <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>Symbol</th>
                        <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>Name</th>
                        <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>Weight</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleHoldings.map((holding, index) => (
                        <tr key={`${holding.symbol}-${index}`} style={{ borderBottom: index === visibleHoldings.length - 1 ? 'none' : '1px solid var(--border)' }}>
                          <td className="px-3 py-2 font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{index + 1}</td>
                          <td className="px-3 py-2 font-mono font-semibold" style={{ color: 'var(--text)' }}>{holding.symbol || '-'}</td>
                          <td className="max-w-[260px] truncate px-3 py-2" title={holding.name} style={{ color: 'var(--text-muted)' }}>{holding.name}</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums" style={{ color: 'var(--text)' }}>{formatWeight(holding.weight)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : loading ? (
                <div className="space-y-2">
                  {Array.from({ length: 6 }).map((_, index) => (
                    <div key={index} className="h-9 animate-pulse rounded-lg" style={{ backgroundColor: 'var(--surface)' }} />
                  ))}
                </div>
              ) : null}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
