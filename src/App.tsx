import { Suspense, lazy, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import { ShieldCheck, ScanLine, BarChart3, Moon, Sun, BookOpen, Star, Square, Briefcase, Activity, Gauge } from 'lucide-react';
import { ThemeProvider, useTheme } from './lib/theme';
import ErrorBoundary from './components/ErrorBoundary';
import { getRequestDiagnosticsSnapshot, isRequestDiagnosticsEnabled, type RequestDiagnosticsSnapshot } from './lib/requestDiagnostics';

const HomePage = lazy(() => import('./pages/HomePage'));
const OptionsPage = lazy(() => import('./pages/OptionsPage'));
const ScreenerPage = lazy(() => import('./pages/ScreenerPage'));
const WatchlistPage = lazy(() => import('./pages/WatchlistPage'));
const PortfolioPage = lazy(() => import('./pages/PortfolioPage'));
const EtfPulsePage = lazy(() => import('./pages/EtfPulsePage'));
const TradeCockpitPage = lazy(() => import('./pages/TradeCockpitPage'));

function ThemeToggle() {
  const { theme, cycleTheme } = useTheme();

  const icon = theme === 'dark'
      ? <Square className="w-4 h-4" />
    : theme === 'dark-blue'
      ? <Moon className="w-4 h-4" />
      : theme === 'light'
        ? <Sun className="w-4 h-4" />
        : <BookOpen className="w-4 h-4" />;
  const label = theme === 'dark-blue'
    ? 'Dark Blue'
    : theme.charAt(0).toUpperCase() + theme.slice(1);

  return (
    <button
      onClick={cycleTheme}
      className="flex items-center justify-center gap-1.5 px-2 py-2 md:py-1.5 rounded-lg text-xs font-medium transition-all min-h-[40px] min-w-[40px]"
      style={{ color: 'var(--text-muted)' }}
      title={`Switch theme (current: ${label})`}
    >
      {icon}
      <span className="hidden md:inline">{label}</span>
    </button>
  );
}

function NavBar() {
  return (
    <nav className="sticky top-0 z-50" style={{ backgroundColor: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
      <div className="max-w-7xl mx-auto px-2 sm:px-4 lg:px-8 flex items-center gap-1 md:gap-2 min-h-11 overflow-x-auto">
        <div className="flex items-center gap-2 mr-1 md:mr-4 flex-shrink-0">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--accent-bg)' }}>
            <ShieldCheck className="w-4 h-4" style={{ color: 'var(--accent)' }} />
          </div>
          <span className="hidden md:flex flex-col leading-tight" style={{ color: 'var(--text)' }}>
            <span className="text-sm font-bold tracking-tight">Put Scanner</span>
            <span className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>Leveraged ETFs</span>
          </span>
        </div>
        <div className="flex items-center gap-1 min-w-0 flex-1 md:flex-none">
          <NavLink
            to="/"
            end
            className={() =>
              `flex items-center justify-center gap-1 md:gap-1.5 px-2 md:px-3 py-2 md:py-1.5 rounded-lg text-[11px] md:text-xs font-medium transition-all min-h-[40px] md:min-h-0 flex-1 md:flex-none whitespace-nowrap`
            }
            style={({ isActive }) => ({
              backgroundColor: isActive ? 'var(--accent-bg)' : 'transparent',
              color: isActive ? 'var(--accent-light)' : 'var(--text-muted)',
            })}
          >
            <ScanLine className="w-3.5 h-3.5" />
            <span className="sm:inline">Scanner</span>
          </NavLink>
          <NavLink
            to="/screener"
            className={() =>
              `flex items-center justify-center gap-1 md:gap-1.5 px-2 md:px-3 py-2 md:py-1.5 rounded-lg text-[11px] md:text-xs font-medium transition-all min-h-[40px] md:min-h-0 flex-1 md:flex-none whitespace-nowrap`
            }
            style={({ isActive }) => ({
              backgroundColor: isActive ? 'var(--accent-bg)' : 'transparent',
              color: isActive ? 'var(--accent-light)' : 'var(--text-muted)',
            })}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            <span className="sm:inline">Screener</span>
          </NavLink>
          <NavLink
            to="/watchlist"
            className={() =>
              `flex items-center justify-center gap-1 md:gap-1.5 px-2 md:px-3 py-2 md:py-1.5 rounded-lg text-[11px] md:text-xs font-medium transition-all min-h-[40px] md:min-h-0 flex-1 md:flex-none whitespace-nowrap`
            }
            style={({ isActive }) => ({
              backgroundColor: isActive ? 'var(--accent-bg)' : 'transparent',
              color: isActive ? 'var(--accent-light)' : 'var(--text-muted)',
            })}
          >
            <Star className="w-3.5 h-3.5" />
            <span className="sm:inline">Watchlist</span>
          </NavLink>
          <NavLink
            to="/portfolio"
            className={() =>
              `flex items-center justify-center gap-1 md:gap-1.5 px-2 md:px-3 py-2 md:py-1.5 rounded-lg text-[11px] md:text-xs font-medium transition-all min-h-[40px] md:min-h-0 flex-1 md:flex-none whitespace-nowrap`
            }
            style={({ isActive }) => ({
              backgroundColor: isActive ? 'var(--accent-bg)' : 'transparent',
              color: isActive ? 'var(--accent-light)' : 'var(--text-muted)',
            })}
          >
            <Briefcase className="w-3.5 h-3.5" />
            <span className="sm:inline">Portfolio</span>
          </NavLink>
          <NavLink
            to="/pulse"
            className={() =>
              `flex items-center justify-center gap-1 md:gap-1.5 px-2 md:px-3 py-2 md:py-1.5 rounded-lg text-[11px] md:text-xs font-medium transition-all min-h-[40px] md:min-h-0 flex-1 md:flex-none whitespace-nowrap`
            }
            style={({ isActive }) => ({
              backgroundColor: isActive ? 'var(--accent-bg)' : 'transparent',
              color: isActive ? 'var(--accent-light)' : 'var(--text-muted)',
            })}
          >
            <Activity className="w-3.5 h-3.5" />
            <span className="sm:inline">ETF Pulse</span>
          </NavLink>
          <NavLink
            to="/cockpit"
            className={() =>
              `flex items-center justify-center gap-1 md:gap-1.5 px-2 md:px-3 py-2 md:py-1.5 rounded-lg text-[11px] md:text-xs font-medium transition-all min-h-[40px] md:min-h-0 flex-1 md:flex-none whitespace-nowrap`
            }
            style={({ isActive }) => ({
              backgroundColor: isActive ? 'var(--accent-bg)' : 'transparent',
              color: isActive ? 'var(--accent-light)' : 'var(--text-muted)',
            })}
          >
            <Gauge className="w-3.5 h-3.5" />
            <span className="sm:inline">Cockpit</span>
          </NavLink>
        </div>
        <div className="ml-1 flex-shrink-0">
          <ThemeToggle />
        </div>
      </div>
    </nav>
  );
}

function AppContent() {
  return (
    <BrowserRouter>
      <NavBar />
      <ErrorBoundary title="Page unavailable" message="This page could not render. Refresh and try again.">
        <Suspense fallback={<RouteLoadingFallback />}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/screener" element={<ScreenerPage />} />
            <Route path="/watchlist" element={<WatchlistPage />} />
            <Route path="/portfolio" element={<PortfolioPage />} />
            <Route path="/pulse" element={<EtfPulsePage />} />
            <Route path="/cockpit" element={<TradeCockpitPage />} />
            <Route path="/options/:ticker" element={<OptionsPage />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
      <NetworkDiagnosticsPanel />
    </BrowserRouter>
  );
}

function RouteLoadingFallback() {
  return (
    <div className="min-h-[calc(100vh-44px)] flex items-center justify-center px-4" style={{ backgroundColor: 'var(--bg)', color: 'var(--text-muted)' }}>
      <div className="rounded-lg border px-4 py-3 text-sm font-medium" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
        Loading...
      </div>
    </div>
  );
}

function NetworkDiagnosticsPanel() {
  const [enabled, setEnabled] = useState(false);
  const [snapshot, setSnapshot] = useState<RequestDiagnosticsSnapshot | null>(null);

  useEffect(() => {
    const active = isRequestDiagnosticsEnabled();
    setEnabled(active);
    if (!active) return undefined;

    const update = () => setSnapshot(getRequestDiagnosticsSnapshot());
    update();
    const id = window.setInterval(update, 1000);
    return () => window.clearInterval(id);
  }, []);

  if (!enabled || !snapshot) return null;

  const endpoints = Object.entries(snapshot);
  return (
    <details
      className="fixed bottom-3 right-3 z-[80] max-w-[calc(100vw-1.5rem)] rounded-lg border px-3 py-2 text-[11px] shadow-lg"
      style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text-muted)' }}
    >
      <summary className="cursor-pointer select-none font-semibold" style={{ color: 'var(--text)' }}>
        Network diagnostics
      </summary>
      <div className="mt-2 grid gap-1 font-mono tabular-nums">
        {endpoints.map(([endpoint, entry]) => (
          <div key={endpoint} className="grid grid-cols-[78px_1fr] gap-2">
            <span style={{ color: 'var(--text)' }}>{endpoint}</span>
            <span>
              a:{entry.attempted} c:{entry.cacheHits} n:{entry.networkRequests}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-1 max-w-64 text-[10px]">
        Enable in production with localStorage key put_scanner_debug_network=true.
      </div>
    </details>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
}
