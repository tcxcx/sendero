'use client';

import { create } from 'zustand';

/**
 * Shared open/close state for the command palette. The sidebar
 * SearchForm and global ⌘K hotkey both toggle it; AppChrome renders
 * the palette at the layout root.
 */
type Store = {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
};

export const useSearchPaletteStore = create<Store>(set => ({
  open: false,
  setOpen: open => set({ open }),
  toggle: () => set(s => ({ open: !s.open })),
}));
