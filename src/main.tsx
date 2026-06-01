import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Clear stale price cache on app load to prevent skeleton loader stuck state
try {
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && (key.startsWith('price_cache') || key.startsWith('batch_prices'))) {
      try {
        const raw = localStorage.getItem(key);
        if (raw) {
          const parsed = JSON.parse(raw);
          const data = parsed.data;
          if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
            keysToRemove.push(key);
          } else {
            const values = Object.values(data as Record<string, { price?: number | null }>);
            const hasValidPrice = values.some(
              value => value && value.price != null && value.price > 0
            );
            if (!hasValidPrice) keysToRemove.push(key);
          }
        }
      } catch {
        keysToRemove.push(key);
      }
    }
  }
  keysToRemove.forEach(k => localStorage.removeItem(k));
} catch { /* localStorage unavailable */ }

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
