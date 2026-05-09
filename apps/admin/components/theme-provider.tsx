'use client';

import * as React from 'react';

type Theme = 'light' | 'dark' | 'system';
type PlatformTheme = 'sendero' | 'zen';

type ThemeProviderProps = {
  children: React.ReactNode;
  attribute?: 'class';
  defaultTheme?: Theme;
  defaultPlatformTheme?: PlatformTheme;
  enableSystem?: boolean;
  disableTransitionOnChange?: boolean;
};

type ThemeContextValue = {
  theme: Theme;
  resolvedTheme: 'light' | 'dark';
  platformTheme: PlatformTheme;
  setTheme: (theme: Theme) => void;
  setPlatformTheme: (theme: PlatformTheme) => void;
};

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme: 'light' | 'dark') {
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.style.colorScheme = theme;
}

function applyPlatformTheme(theme: PlatformTheme) {
  const root = document.documentElement;
  root.dataset.platformTheme = theme;
}

/**
 * Minimal theme provider for the admin shell. It keeps the existing
 * `class="dark"` contract without rendering the inline script that
 * next-themes emits during render under React 19 / Next 16.
 */
export function ThemeProvider({
  children,
  defaultTheme = 'system',
  defaultPlatformTheme = 'sendero',
  enableSystem = true,
}: ThemeProviderProps) {
  const [theme, setThemeState] = React.useState<Theme>(defaultTheme);
  const [platformTheme, setPlatformThemeState] =
    React.useState<PlatformTheme>(defaultPlatformTheme);
  const [systemTheme, setSystemTheme] = React.useState<'light' | 'dark'>('light');

  React.useEffect(() => {
    const stored = window.localStorage.getItem('theme') as Theme | null;
    const storedPlatformTheme = window.localStorage.getItem(
      'platformTheme'
    ) as PlatformTheme | null;
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      setThemeState(stored);
    }
    if (storedPlatformTheme === 'sendero' || storedPlatformTheme === 'zen') {
      setPlatformThemeState(storedPlatformTheme);
    }
    setSystemTheme(getSystemTheme());
  }, []);

  React.useEffect(() => {
    if (!enableSystem) return;

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystemTheme(media.matches ? 'dark' : 'light');
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [enableSystem]);

  const resolvedTheme =
    theme === 'system' && enableSystem ? systemTheme : theme === 'dark' ? 'dark' : 'light';

  React.useEffect(() => {
    applyTheme(resolvedTheme);
  }, [resolvedTheme]);

  React.useEffect(() => {
    applyPlatformTheme(platformTheme);
  }, [platformTheme]);

  const setTheme = React.useCallback((nextTheme: Theme) => {
    window.localStorage.setItem('theme', nextTheme);
    setThemeState(nextTheme);
  }, []);

  const setPlatformTheme = React.useCallback((nextTheme: PlatformTheme) => {
    window.localStorage.setItem('platformTheme', nextTheme);
    setPlatformThemeState(nextTheme);
  }, []);

  const value = React.useMemo(
    () => ({ theme, resolvedTheme, platformTheme, setTheme, setPlatformTheme }),
    [theme, resolvedTheme, platformTheme, setTheme, setPlatformTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = React.useContext(ThemeContext);
  if (!value) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return value;
}
