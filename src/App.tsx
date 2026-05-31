import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import { ShieldCheck, ScanLine, BarChart3, Moon, Sun, BookOpen, Star, Square, Briefcase, Activity } from 'lucide-react';
import { ThemeProvider, useTheme } from './lib/theme';
import HomePage from './pages/HomePage';
import OptionsPage from './pages/OptionsPage';
import ScreenerPage from './pages/ScreenerPage';
import WatchlistPage from './pages/WatchlistPage';
import PortfolioPage from './pages/PortfolioPage';
import EtfPulsePage from './pages/EtfPulsePage';
import ErrorBoundary from './components/ErrorBoundary';

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
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/screener" element={<ScreenerPage />} />
          <Route path="/watchlist" element={<WatchlistPage />} />
          <Route path="/portfolio" element={<PortfolioPage />} />
          <Route path="/pulse" element={<EtfPulsePage />} />
          <Route path="/options/:ticker" element={<OptionsPage />} />
        </Routes>
      </ErrorBoundary>
    </BrowserRouter>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
}
