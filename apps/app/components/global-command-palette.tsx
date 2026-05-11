'use client';

/**
 * Phase C — global Cmd+K command palette.
 *
 * The existing SearchPalette anchors to the sidebar search button via
 * Radix Popover — fine when the sidebar is expanded but invisible
 * when collapsed. This wrapper mounts the same palette body inside a
 * `<CommandDialog>` so a global Cmd+K binding (or Ctrl+K on Windows)
 * opens it as a centered modal regardless of sidebar state.
 *
 * Mounted once at AppChrome root. Uses the same
 * `useSearchPaletteStore` Zustand store the sidebar's SearchForm
 * uses — both surfaces share the same open/close state, so closing
 * one closes the other.
 *
 * Pattern lifted from next-shadcn-dashboard-starter's KBar wrapper:
 * keyboard-first global navigation that doesn't depend on layout.
 * We use cmdk's CommandDialog instead of kbar so we don't add
 * another dependency — cmdk is already in the bundle for the
 * sidebar palette.
 */

import { useEffect } from 'react';

import { CommandDialog } from '@/components/ui/command';
import { SearchPaletteBody } from '@/components/search-palette';
import { useSearchPaletteStore } from '@/components/use-search-palette-store';

export function GlobalCommandPalette() {
  const open = useSearchPaletteStore(s => s.open);
  const setOpen = useSearchPaletteStore(s => s.setOpen);
  const toggle = useSearchPaletteStore(s => s.toggle);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // Cmd+K on macOS, Ctrl+K elsewhere. Ignore when typing in any
      // input — Cmd+K is otherwise common as a "clear field" binding
      // in macOS textareas, so we let the native behavior win there.
      const target = event.target as HTMLElement | null;
      const isEditable =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable;
      if (isEditable) return;

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        toggle();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggle]);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <SearchPaletteBody onClose={() => setOpen(false)} />
    </CommandDialog>
  );
}
