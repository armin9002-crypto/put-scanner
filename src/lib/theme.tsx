import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

export type Theme = 'dark' | 'dark-blue' | 'light' | 'sepia';

const THEME_STORAGE_KEY = 'put_scanner_theme';
const LEGACY_THEME_STORAGE_KEY = 'theme';
const THEME_MIGRATION_VERSION = '2';
const THEME_MIGRATION_KEY = 'theme_migration_version';

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

function normalizeSavedTheme(value: string | null, migrated: boolean): Theme | null {
  if (value === 'grey') return 'dark';
  if (value === 'darkBlue' || value === 'dark-blue') return 'dark-blue';
  if (value === 'dark') return migrated ? 'dark' : 'dark-blue';
  if (value === 'light' || value === 'sepia') return value;
  return null;
}

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
      localStorage.setItem(THEME_STORAGE_KEY, theme);
      localStorage.setItem(LEGACY_THEME_STORAGE_KEY, theme);
      localStorage.setItem(THEME_MIGRATION_KEY, THEME_MIGRATION_VERSION);
    } catch {
      // Ignore unavailable storage.
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
