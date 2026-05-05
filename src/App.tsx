import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import { ShieldCheck, ScanLine, BarChart3 } from 'lucide-react';
import HomePage from './pages/HomePage';
import OptionsPage from './pages/OptionsPage';
import ScreenerPage from './pages/ScreenerPage';

function NavBar() {
  return (
    <nav className="bg-[#12121a] border-b border-[#1e1e2e] sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center h-11">
        <div className="flex items-center gap-2 mr-6">
          <div className="w-7 h-7 rounded-lg bg-[#6366f1]/15 flex items-center justify-center">
            <ShieldCheck className="w-4 h-4 text-[#6366f1]" />
          </div>
          <span className="text-sm font-bold text-[#e2e8f0] tracking-tight">Put Premium</span>
        </div>
        <div className="flex items-center gap-1">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                isActive
                  ? 'bg-[#6366f1]/15 text-[#818cf8]'
                  : 'text-[#64748b] hover:text-[#e2e8f0] hover:bg-white/[0.03]'
              }`
            }
          >
            <ScanLine className="w-3.5 h-3.5" />
            Scanner
          </NavLink>
          <NavLink
            to="/screener"
            className={({ isActive }) =>
              `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                isActive
                  ? 'bg-[#6366f1]/15 text-[#818cf8]'
                  : 'text-[#64748b] hover:text-[#e2e8f0] hover:bg-white/[0.03]'
              }`
            }
          >
            <BarChart3 className="w-3.5 h-3.5" />
            Screener
          </NavLink>
        </div>
      </div>
    </nav>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <NavBar />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/screener" element={<ScreenerPage />} />
        <Route path="/options/:ticker" element={<OptionsPage />} />
      </Routes>
    </BrowserRouter>
  );
}
