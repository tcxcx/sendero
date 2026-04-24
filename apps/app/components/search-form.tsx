'use client';

/**
 * Sidebar search button + Radix Popover containing the cmdk command
 * palette. Opens on hover (150ms grace on leave), click, or ⌘K /
 * Ctrl+K anywhere in the dashboard. The popover is anchored directly
 * to the button so it reads as a combobox dropdown, not a modal.
 */

import { useCallback, useEffect, useRef } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { Search } from 'lucide-react';

import {
  SearchBackdrop,
  SearchPaletteBody,
  SearchShortcutHint,
  useSearchHotkey,
} from '@/components/search-palette';
import { SidebarGroup, SidebarGroupContent } from '@/components/ui/sidebar';
import { useSearchPaletteStore } from '@/components/use-search-palette-store';

export function SearchForm({
  placeholder = 'Search…',
  className,
}: {
  placeholder?: string;
  className?: string;
}) {
  const open = useSearchPaletteStore(s => s.open);
  const setOpen = useSearchPaletteStore(s => s.setOpen);
  const hoverCloseRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useSearchHotkey(setOpen);

  const clearClose = useCallback(() => {
    if (hoverCloseRef.current) {
      clearTimeout(hoverCloseRef.current);
      hoverCloseRef.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    clearClose();
    hoverCloseRef.current = setTimeout(() => setOpen(false), 180);
  }, [clearClose, setOpen]);

  useEffect(() => clearClose, [clearClose]);

  return (
    <SidebarGroup className={className ? `py-0 ${className}` : 'py-0'}>
      <SidebarGroupContent className="relative">
        <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
          <PopoverPrimitive.Trigger asChild>
            <button
              type="button"
              onMouseEnter={() => {
                clearClose();
                setOpen(true);
              }}
              onMouseLeave={scheduleClose}
              onFocus={() => {
                clearClose();
                setOpen(true);
              }}
              className="flex h-9 w-full items-center gap-2 rounded-md border border-[color:var(--border)] bg-[color:var(--surface-base)] pl-8 pr-2 text-left text-sm text-muted-foreground transition-colors hover:border-[color:var(--ink)] hover:text-foreground"
            >
              <Search
                className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 select-none opacity-50"
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate">{placeholder}</span>
              <SearchShortcutHint />
            </button>
          </PopoverPrimitive.Trigger>

          {/* Vermillion wash over the dashboard while the combobox is open. */}
          <SearchBackdrop open={open} />

          <PopoverPrimitive.Portal>
            <PopoverPrimitive.Content
              side="right"
              align="start"
              sideOffset={12}
              collisionPadding={16}
              onMouseEnter={clearClose}
              onMouseLeave={scheduleClose}
              className="z-50 w-[480px] overflow-hidden rounded-[18px] border outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=right]:slide-in-from-left-2 data-[side=left]:slide-in-from-right-2 data-[side=bottom]:slide-in-from-top-2"
              style={{
                backgroundColor:
                  'color-mix(in oklab, var(--surface-floating, #FDFBF7) 94%, transparent)',
                borderColor: 'color-mix(in oklab, var(--ink) 32%, transparent)',
                boxShadow:
                  '0 24px 60px -20px color-mix(in oklab, var(--ink) 25%, transparent), 0 2px 4px rgba(31, 42, 68, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.6)',
                backdropFilter: 'blur(18px) saturate(1.2)',
                WebkitBackdropFilter: 'blur(18px) saturate(1.2)',
              }}
            >
              <SearchPaletteBody onClose={() => setOpen(false)} />
            </PopoverPrimitive.Content>
          </PopoverPrimitive.Portal>
        </PopoverPrimitive.Root>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
