import { Suspense, lazy, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom';
import { ShieldCheck, ScanLine, BarChart3, Moon, MoonStar, Sun, BookOpen, Star, Briefcase, Activity } from 'lucide-react';
import { ThemeProvider, useTheme } from './lib/theme';
import { AuthProvider } from './lib/auth';
import { useResponsiveMode } from './lib/responsive';
import AccountControl from './components/AccountControl';
import ErrorBoundary from './components/ErrorBoundary';
import MobilePageHeader from './components/mobile/MobilePageHeader';
import { getDevelopmentRequestSummary, getRequestDiagnosticsSnapshot, getScreenerScanDiagnostics, isRequestDiagnosticsEnabled, type DevelopmentRequestSummary, type RequestDiagnosticsSnapshot, type ScreenerScanDiagnostics } from './lib/requestDiagnostics';
import { LOCAL_STORAGE_FAILURE_MESSAGE, subscribeToLocalStorageFailures } from './lib/storageFeedback';

const HomePage = lazy(() => import('./pages/HomePage'));
const OptionsPage = lazy(() => import('./pages/OptionsPage'));
const ScreenerPage = lazy(() => import('./pages/ScreenerPage'));
const WatchlistPage = lazy(() => import('./pages/WatchlistPage'));
const PortfolioPage = lazy(() => import('./pages/PortfolioPage'));
const EtfPulsePage = lazy(() => import('./pages/EtfPulsePage'));
const ProductionCloudSyncProvider = import.meta.env.VITE_CLOUD_SYNC_ENABLED === 'true'
  ? lazy(() => import('./components/CloudSyncProvider'))
  : null;
const visualFixturesEnabled = import.meta.env.DEV || import.meta.env.VITE_UI_VISUAL_FIXTURES === 'true';
const DevAccountUiTestFixture = visualFixturesEnabled
  ? lazy(() => import('./components/AccountUiTestFixture'))
  : null;

function ThemeToggle() {
  const { theme, cycleTheme } = useTheme();

  const icon = theme === 'dark'
      ? <Moon className="w-4 h-4" />
    : theme === 'dark-blue'
      ? <MoonStar className="w-4 h-4" />
      : theme === 'light'
        ? <Sun className="w-4 h-4" />
        : <BookOpen className="w-4 h-4" />;
  const label = theme === 'dark-blue'
    ? 'Dark Blue'
    : theme.charAt(0).toUpperCase() + theme.slice(1);

  return (
    <button
      onClick={cycleTheme}
      className="app-utility-button button-ghost flex items-center justify-center gap-1.5 px-2 py-2 md:py-1.5 rounded-lg text-xs font-medium min-h-[40px] min-w-[40px]"
      style={{ color: 'var(--text-muted)' }}
      title={`Switch theme (current: ${label})`}
    >
      {icon}
      <span className="hidden md:inline">{label}</span>
    </button>
  );
}

function NavBar() {
  const { isPhone, isPhoneLandscape } = useResponsiveMode();
  const location = useLocation();
  const pulseLabel = isPhoneLandscape ? 'Pulse' : 'ETF Pulse';

  if (isPhone) {
    if (location.pathname.startsWith('/options/')) return null;

    const title = location.pathname === '/screener'
      ? 'Screener'
      : location.pathname === '/watchlist'
        ? 'Watchlist'
        : location.pathname === '/portfolio'
          ? 'Portfolio'
          : location.pathname === '/pulse' || location.pathname === '/cockpit'
            ? 'ETF Pulse'
            : 'Scanner';

    return (
      <MobilePageHeader title={title} action={<div className="flex items-center"><ThemeToggle /><AccountControl /></div>} />
    );
  }

  return (
    <nav className="app-desktop-nav sticky top-0 z-50" style={{ backgroundColor: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
      <div className="app-desktop-nav__inner app-nav-scroll mx-auto px-2 sm:px-4 lg:px-7 flex items-center gap-1 md:gap-2 max-w-full overflow-x-auto touch-scroll" style={{ paddingLeft: 'max(0.5rem, env(safe-area-inset-left))', paddingRight: 'max(0.5rem, env(safe-area-inset-right))' }}>
        <div className="app-brand flex items-center gap-2 mr-1 md:mr-5 flex-shrink-0">
          <div className="app-brand__mark w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--accent-bg)' }}>
            <ShieldCheck className="w-4 h-4" style={{ color: 'var(--accent)' }} />
          </div>
          <span className="hidden md:flex flex-col leading-tight" style={{ color: 'var(--text)' }}>
            <span className="text-sm font-bold tracking-tight">Put Scanner</span>
            <span className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>Leveraged ETFs</span>
          </span>
        </div>
        <div className="flex items-center gap-1 min-w-max md:min-w-0 flex-1 md:flex-none">
          <NavLink
            to="/"
            end
            className={() =>
              `app-nav-item flex items-center justify-center gap-1 md:gap-1.5 px-2 md:px-3 py-2 rounded-lg text-[11px] md:text-xs font-medium min-h-[40px] flex-none whitespace-nowrap`
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
              `app-nav-item flex items-center justify-center gap-1 md:gap-1.5 px-2 md:px-3 py-2 rounded-lg text-[11px] md:text-xs font-medium min-h-[40px] flex-none whitespace-nowrap`
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
              `app-nav-item flex items-center justify-center gap-1 md:gap-1.5 px-2 md:px-3 py-2 rounded-lg text-[11px] md:text-xs font-medium min-h-[40px] flex-none whitespace-nowrap`
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
              `app-nav-item flex items-center justify-center gap-1 md:gap-1.5 px-2 md:px-3 py-2 rounded-lg text-[11px] md:text-xs font-medium min-h-[40px] flex-none whitespace-nowrap`
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
              `app-nav-item flex items-center justify-center gap-1 md:gap-1.5 px-2 md:px-3 py-2 rounded-lg text-[11px] md:text-xs font-medium min-h-[40px] flex-none whitespace-nowrap`
            }
            style={({ isActive }) => ({
              backgroundColor: isActive ? 'var(--accent-bg)' : 'transparent',
              color: isActive ? 'var(--accent-light)' : 'var(--text-muted)',
            })}
          >
            <Activity className="w-3.5 h-3.5" />
            <span className="sm:inline">{pulseLabel}</span>
          </NavLink>
        </div>
        <div className="app-nav-utilities ml-auto flex flex-shrink-0 items-center">
          <ThemeToggle />
          <AccountControl />
        </div>
      </div>
    </nav>
  );
}

const mobileTabs = [
  { to: '/', label: 'Scanner', icon: ScanLine, end: true },
  { to: '/screener', label: 'Screener', icon: BarChart3, end: false },
  { to: '/watchlist', label: 'Watchlist', icon: Star, end: false },
  { to: '/portfolio', label: 'Portfolio', icon: Briefcase, end: false },
  { to: '/pulse', label: 'Pulse', icon: Activity, end: false },
] as const;

function MobileBottomNav() {
  const location = useLocation();
  const { isPhone, isPhoneLandscape } = useResponsiveMode();
  if (!isPhone || location.pathname.startsWith('/options/')) return null;

  return (
    <nav className={`mobile-bottom-nav ${isPhoneLandscape ? 'is-phone-landscape' : ''}`} aria-label="Primary navigation">
      {mobileTabs.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          aria-label={label}
          className={({ isActive }) => `mobile-bottom-nav__item${isActive ? ' is-active' : ''}`}
        >
          <Icon aria-hidden="true" className="h-5 w-5" strokeWidth={2} />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

function AppContent() {
  const { isPhone, isPhoneLandscape } = useResponsiveMode();
  return (
    <BrowserRouter>
      <NavBar />
      <ErrorBoundary title="Page unavailable" message="This page could not render. Refresh and try again.">
        <main className={`app-content-shell ${isPhone ? 'is-phone' : ''} ${isPhoneLandscape ? 'is-phone-landscape' : ''}`}>
          <Suspense fallback={<RouteLoadingFallback />}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/screener" element={<ScreenerPage />} />
            <Route path="/watchlist" element={<WatchlistPage />} />
            <Route path="/portfolio" element={<PortfolioPage />} />
            <Route path="/pulse" element={<EtfPulsePage />} />
            <Route path="/cockpit" element={<Navigate to="/pulse" replace />} />
            <Route path="/options/:ticker" element={<OptionsPage />} />
          </Routes>
          </Suspense>
        </main>
      </ErrorBoundary>
      <MobileBottomNav />
      {import.meta.env.DEV && <NetworkDiagnosticsPanel />}
      <LayoutDiagnosticsPanel />
      <StorageFailureNotice />
    </BrowserRouter>
  );
}

function RouteLoadingFallback() {
  return (
    <div className="min-h-[calc(100dvh-44px)] flex items-center justify-center px-4" style={{ backgroundColor: 'var(--bg)', color: 'var(--text-muted)' }}>
      <div className="rounded-lg border px-4 py-3 text-sm font-medium" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
        Loading...
      </div>
    </div>
  );
}

function NetworkDiagnosticsPanel() {
  const [enabled, setEnabled] = useState(false);
  const [snapshot, setSnapshot] = useState<RequestDiagnosticsSnapshot | null>(null);
  const [screenerScan, setScreenerScan] = useState<ScreenerScanDiagnostics | null>(null);
  const [requestSummary, setRequestSummary] = useState<DevelopmentRequestSummary | null>(null);

  useEffect(() => {
    const active = isRequestDiagnosticsEnabled();
    setEnabled(active);
    if (!active) return undefined;

    const update = () => {
      setSnapshot(getRequestDiagnosticsSnapshot());
      setScreenerScan(getScreenerScanDiagnostics());
      setRequestSummary(getDevelopmentRequestSummary());
    };
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
        {requestSummary && <div className="mb-1 border-b pb-1" style={{ borderColor: 'var(--border)' }}>browser:{requestSummary.browserRequests} function:{requestSummary.functionInvocations} provider-http:{requestSummary.providerHttpAttempts} cache:{requestSummary.cacheHits} retry:{requestSummary.retries} fallback:{requestSummary.fallbacks} fail:{requestSummary.failures} abort:{requestSummary.aborted}</div>}
        {endpoints.map(([endpoint, entry]) => (
          <div key={endpoint} className="grid grid-cols-[78px_1fr] gap-2">
            <span style={{ color: 'var(--text)' }}>{endpoint}</span>
            <span>
              a:{entry.attempted} n:{entry.networkRequests} v:{entry.serverEndpointResponses} y:{entry.yahooUpstreamAttempts} r:{entry.retries} m:{entry.memoryHits} p:{entry.persistentCacheHits} d:{entry.inFlightDedupes} c:{entry.chainsDeduplicated} pc:{entry.plannedChains} rb:{entry.responseBytes} x:{entry.maxObservedConcurrency} s:{entry.staleFallbacks} cb:{entry.circuitBreakerRejections} f:{entry.failures} ab:{entry.aborted} ver:{entry.lastDatasetVersion ?? '-'} k:{Object.keys(entry.cacheStrategies).join(',') || '-'}
            </span>
          </div>
        ))}
      </div>
      {screenerScan?.scanId && (
        <div className="mt-2 max-w-[36rem] border-t pt-2 font-mono tabular-nums" style={{ borderColor: 'var(--border)' }}>
          screener etf:{screenerScan.plannedEtfs} b:{screenerScan.browserBatchRequests}/{screenerScan.plannedBatches} v:{screenerScan.vercelBatchResponses} y:{screenerScan.reportedYahooUpstreamAttempts} chains:{screenerScan.uniqueChains}/{screenerScan.plannedOptionChains} cx:{screenerScan.maxClientBatchConcurrency} sx:{screenerScan.maxServerYahooConcurrency} cb:{screenerScan.circuitBreakerRejections} f:{screenerScan.failures} ms:{screenerScan.elapsedMs ?? '…'}
        </div>
      )}
      <div className="mt-1 max-w-64 text-[10px]">Development-only, memory-only request inspector.</div>
    </details>
  );
}

function StorageFailureNotice() {
  const [visible, setVisible] = useState(false);
  useEffect(() => subscribeToLocalStorageFailures(() => setVisible(true)), []);
  if (!visible) return null;
  return (
    <div role="alert" className="fixed bottom-3 left-3 z-[90] flex max-w-[calc(100vw-1.5rem)] items-center gap-3 rounded-lg border px-3 py-2 text-xs shadow-lg" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--red)', color: 'var(--text)' }}>
      <span>{LOCAL_STORAGE_FAILURE_MESSAGE}</span>
      <button type="button" onClick={() => setVisible(false)} className="min-h-9 rounded px-2 font-semibold" aria-label="Dismiss local save warning">Dismiss</button>
    </div>
  );
}

function isLayoutDiagnosticsEnabled(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('put_scanner_debug_layout') === 'true';
  } catch {
    return false;
  }
}

function LayoutDiagnosticsPanel() {
  const mode = useResponsiveMode();
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    setEnabled(isLayoutDiagnosticsEnabled());
  }, []);

  if (!enabled) return null;

  const orientation = mode.viewportWidth >= mode.viewportHeight ? 'landscape' : 'portrait';
  const label = mode.isDesktop
    ? 'desktop'
    : mode.isTabletLandscape
      ? 'tablet-landscape'
      : mode.isTablet
        ? 'tablet'
        : mode.isPhoneLandscape
          ? 'phone-landscape'
          : 'phone';

  return (
    <div
      className="fixed bottom-3 left-3 z-[80] max-w-[calc(100vw-1.5rem)] rounded-lg border px-2.5 py-2 text-[10px] shadow-lg font-mono tabular-nums"
      style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text-muted)' }}
    >
      <div style={{ color: 'var(--text)' }}>{label}</div>
      <div>{mode.viewportWidth} x {mode.viewportHeight} · {orientation}</div>
      <div>phoneLandscape: {String(mode.isPhoneLandscape)}</div>
    </div>
  );
}

function AppBody() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
}

export default function App() {
  const accountUiFixture = visualFixturesEnabled
    ? new URLSearchParams(window.location.search).get('account-ui-fixture')
    : null;
  if (DevAccountUiTestFixture && accountUiFixture) {
    return (
      <ThemeProvider>
        <Suspense fallback={null}>
          <DevAccountUiTestFixture requestedState={accountUiFixture} />
        </Suspense>
      </ThemeProvider>
    );
  }

  return (
    <AuthProvider>
      {ProductionCloudSyncProvider
        ? (
          <Suspense fallback={null}>
            <ProductionCloudSyncProvider>
              <AppBody />
            </ProductionCloudSyncProvider>
          </Suspense>
        )
        : <AppBody />}
    </AuthProvider>
  );
}
