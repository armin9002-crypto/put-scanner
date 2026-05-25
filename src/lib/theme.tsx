import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

export type Theme = 'dark' | 'dark-blue' | 'light' | 'sepia';

const THEME_MIGRATION_VERSION = '2';

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
    const saved = localStorage.getItem('theme');
    const migrated = localStorage.getItem('theme_migration_version') === THEME_MIGRATION_VERSION;

    if (saved === 'grey') return 'dark';
    if (saved === 'dark-blue') return 'dark-blue';
    if (saved === 'dark') return migrated ? 'dark' : 'dark-blue';
    if (saved === 'light' || saved === 'sepia') return saved;
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
      localStorage.setItem('theme', theme);
      localStorage.setItem('theme_migration_version', THEME_MIGRATION_VERSION);
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
