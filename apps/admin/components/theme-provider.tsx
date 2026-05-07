'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import type { ThemeProviderProps } from 'next-themes';

/**
 * Wraps `next-themes` so the rest of the app gets dark/light support
 * via a `<ThemeProvider>` mount in `app/layout.tsx` and a
 * `useTheme()` hook anywhere else. `next-themes` toggles the
 * `class="dark"` attribute on <html> — globals.css picks that up.
 */
export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
