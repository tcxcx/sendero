'use client';

import type { ReactNode } from 'react';
import { create } from 'zustand';

/**
 * Shared slot for the pathname-driven DashboardPageHeader in
 * `components/app-shell/dashboard-page-header.tsx`. Pages that want
 * to hang action buttons off the global title row mount a
 * `<PageActions>` client component (see `./page-actions.tsx`); it
 * publishes its children here and the shared header renders them on
 * the right side of the title row.
 *
 * Kept deliberately small — actions are transient ReactNode state,
 * cleared on navigation by the PageActions unmount effect.
 */

type Store = {
  actions: ReactNode | null;
  setActions: (n: ReactNode | null) => void;
};

export const usePageHeaderStore = create<Store>(set => ({
  actions: null,
  setActions: actions => set({ actions }),
}));
