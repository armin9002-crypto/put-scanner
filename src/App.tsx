import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import { ShieldCheck, ScanLine, BarChart3, Moon, Sun, BookOpen, Star } from 'lucide-react';
import { ThemeProvider, useTheme } from './lib/theme';
import HomePage from './pages/HomePage';
import OptionsPage from './pages/OptionsPage';
import ScreenerPage from './pages/ScreenerPage';
import WatchlistPage from './pages/WatchlistPage';

function ThemeToggle() {
  const { theme, cycleTheme } = useTheme();

  const icon = theme === 'dark' ? <Moon className="w-4 h-4" /> : theme === 'light' ? <Sun className="w-4 h-4" /> : <BookOpen className="w-4 h-4" />;
  const label = theme.charAt(0).toUpperCase() + theme.slice(1);

  return (
    <button
      onClick={cycleTheme}
      className="flex items-center justify-center gap-1.5 px-2 py-2 sm:py-1.5 rounded-lg text-xs font-medium transition-all min-h-[40px] min-w-[40px]"
      style={{ color: 'var(--text-muted)' }}
      title={`Switch theme (current: ${label})`}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function NavBar() {
  return (
    <nav className="sticky top-0 z-50" style={{ backgroundColor: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
      <div className="max-w-7xl mx-auto px-2 sm:px-6 lg:px-8 flex items-center gap-1 min-h-11 overflow-x-auto">
        <div className="flex items-center gap-2 mr-1 sm:mr-5 flex-shrink-0">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--accent-bg)' }}>
            <ShieldCheck className="w-4 h-4" style={{ color: 'var(--accent)' }} />
          </div>
          <span className="text-sm font-bold tracking-tight hidden sm:inline" style={{ color: 'var(--text)' }}>Put Premium</span>
        </div>
        <div className="flex items-center gap-1 min-w-0 flex-1 sm:flex-none">
          <NavLink
            to="/"
            end
            className={() =>
              `flex items-center justify-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-2 sm:py-1.5 rounded-lg text-[11px] sm:text-xs font-medium transition-all min-h-[40px] sm:min-h-0 flex-1 sm:flex-none whitespace-nowrap`
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
              `flex items-center justify-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-2 sm:py-1.5 rounded-lg text-[11px] sm:text-xs font-medium transition-all min-h-[40px] sm:min-h-0 flex-1 sm:flex-none whitespace-nowrap`
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
              `flex items-center justify-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-2 sm:py-1.5 rounded-lg text-[11px] sm:text-xs font-medium transition-all min-h-[40px] sm:min-h-0 flex-1 sm:flex-none whitespace-nowrap`
            }
            style={({ isActive }) => ({
              backgroundColor: isActive ? 'var(--accent-bg)' : 'transparent',
              color: isActive ? 'var(--accent-light)' : 'var(--text-muted)',
            })}
          >
            <Star className="w-3.5 h-3.5" />
            <span className="sm:inline">Watchlist</span>
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
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/screener" element={<ScreenerPage />} />
        <Route path="/watchlist" element={<WatchlistPage />} />
        <Route path="/options/:ticker" element={<OptionsPage />} />
      </Routes>
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
