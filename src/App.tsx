import { useState } from 'react';
import type { ETFInfo } from './lib/types';
import HomePage from './pages/HomePage';
import OptionsPage from './pages/OptionsPage';

export default function App() {
  const [selectedETF, setSelectedETF] = useState<ETFInfo | null>(null);

  if (selectedETF) {
    return <OptionsPage etf={selectedETF} onBack={() => setSelectedETF(null)} />;
  }

  return <HomePage onSelectETF={setSelectedETF} />;
}
