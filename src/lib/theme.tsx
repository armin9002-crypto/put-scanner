import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import {
  LEGACY_THEME_STORAGE_KEY,
  normalizeSavedTheme,
  THEME_MIGRATION_KEY,
  THEME_MIGRATION_VERSION,
  THEME_STORAGE_KEY,
  type Theme,
} from './themePreference';
import { emitDurableMutation } from './cloudState/syncEvents';
import { notifyLocalStorageFailure } from './storageFeedback';

export type { Theme } from './themePreference';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
  cycleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'dark',
  setTheme: () => {},
  cycleTheme: () => {},
});

function readInitialTheme(): Theme {
  try {
    const migrated = localStorage.getItem(THEME_MIGRATION_KEY) === THEME_MIGRATION_VERSION;
    const saved = normalizeSavedTheme(localStorage.getItem(THEME_STORAGE_KEY), true);
    if (saved) return saved;

    const legacy = normalizeSavedTheme(localStorage.getItem(LEGACY_THEME_STORAGE_KEY), migrated);
    if (legacy) return legacy;
  } catch {
    // Fall through to the new neutral dark default.
  }
  return 'dark';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(readInitialTheme);

  useEffect(() => {
    const cssTheme = theme === 'dark-blue' ? 'dark-blue' : theme;
    document.documentElement.setAttribute('data-theme', cssTheme);
    try {
      const previousTheme = localStorage.getItem(THEME_STORAGE_KEY);
      localStorage.setItem(THEME_STORAGE_KEY, theme);
      localStorage.setItem(LEGACY_THEME_STORAGE_KEY, theme);
      localStorage.setItem(THEME_MIGRATION_KEY, THEME_MIGRATION_VERSION);
      if (previousTheme !== theme) emitDurableMutation('preferences');
    } catch {
      notifyLocalStorageFailure();
    }
  }, [theme]);

  const cycleTheme = () => {
    setTheme(prev => {
      if (prev === 'dark') return 'dark-blue';
      if (prev === 'dark-blue') return 'light';
      if (prev === 'light') return 'sepia';
      return 'dark';
    });
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, cycleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
