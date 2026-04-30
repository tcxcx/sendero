'use client';

/**
 * Sidebar search button + Radix Popover containing the cmdk command
 * palette. Opens on hover (trigger OR panel), click, or ⌘K / Ctrl+K.
 *
 * Hover state is tracked via useHover (pointer events, not mouse
 * events) on BOTH the trigger and the portaled panel. Open is derived
 * as `triggerHover || contentHover || manualOpen`, so moving the
 * cursor from trigger → panel never dips below the "something is
 * hovered" line even across portal boundaries — no more flicker-close
 * races against timer-based grace windows. Close lands on a short
 * 150ms delay after both hovers clear, so a mis-swipe doesn't slam
 * the panel shut.
 */

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { Search } from 'lucide-react';

import {
  SearchBackdrop,
  SearchPaletteBody,
  SearchShortcutHint,
  useSearchHotkey,
} from '@/components/search-palette';
import { useHover } from '@/components/hooks/use-hover';
import { SidebarGroup, SidebarGroupContent, useSidebar } from '@/components/ui/sidebar';
import { useSearchPaletteStore } from '@/components/use-search-palette-store';

const HOVER_CLOSE_DELAY_MS = 150;

export function SearchForm({
  placeholder = 'Search…',
  className,
}: {
  placeholder?: string;
  className?: string;
}) {
  const { isMobile } = useSidebar();
  const open = useSearchPaletteStore(s => s.open);
  const setOpen = useSearchPaletteStore(s => s.setOpen);

  // Two hover trackers: the trigger button and the portaled panel.
  // Derived hover intent is the OR of the two — cursor transit from
  // one to the other never dips both false simultaneously.
  const [triggerRef, triggerHovered] = useHover<HTMLButtonElement>();
  const [contentRef, contentHovered] = useHover<HTMLDivElement>();
  const rawHoverIntent = triggerHovered || contentHovered;

  // Only count hover as intent AFTER an explicit enter event on the
  // trigger (or the panel) since the last pathname change. Without this
  // gate, navigating between pages can leave a stale-positive hover
  // state that auto-opens the palette over the new page — a UI ghost.
  //
  // Implementation: track previous values of triggerHovered/contentHovered
  // and flip `hasIntent` true only on a `false → true` transition.
  // Pure-mount renders (where useHover starts at false) never flip the
  // gate; only an actual pointer-enter does. Pathname change resets the
  // gate AND the previous-value refs so each new page starts fresh.
  const prevTriggerRef = useRef(false);
  const prevContentRef = useRef(false);
  const [hasIntent, setHasIntent] = useState(false);
  useEffect(() => {
    const triggerEntered = !prevTriggerRef.current && triggerHovered;
    const contentEntered = !prevContentRef.current && contentHovered;
    prevTriggerRef.current = triggerHovered;
    prevContentRef.current = contentHovered;
    if (triggerEntered || contentEntered) setHasIntent(true);
  }, [triggerHovered, contentHovered]);
  const hoverIntent = hasIntent && rawHoverIntent;

  // `manualOpen` is sticky state for ⌘K / click / focus. `hoverIntent`
  // is transient. The Radix open is `manualOpen || hoverIntent`, but
  // we let Radix's onOpenChange drive `manualOpen` so Escape + outside
  // click still work.
  const [manualOpen, setManualOpen] = useState(false);

  useSearchHotkey(() => setManualOpen(true));

  // Close the palette on route change AND require a fresh hover-leave
  // before hover-intent counts again. Without this gate, navigating
  // between pages while the cursor happens to be over the trigger
  // auto-opens the palette on the new page — a UI ghost. Resetting
  // `hasLeftSinceMount` on every pathname change forces an explicit
  // leave→enter cycle per page.
  const pathname = usePathname();
  useEffect(() => {
    setManualOpen(false);
    setOpen(false);
    setHasIntent(false);
    prevTriggerRef.current = false;
    prevContentRef.current = false;
  }, [pathname, setOpen]);

  // Drive the global store from local derived state. A single effect
  // so we don't get stuck with open=true after the user moves away.
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (manualOpen || hoverIntent) {
      setOpen(true);
      return;
    }
    closeTimerRef.current = setTimeout(() => {
      setOpen(false);
      closeTimerRef.current = null;
    }, HOVER_CLOSE_DELAY_MS);
    return () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, [manualOpen, hoverIntent, setOpen]);

  return (
    <SidebarGroup className={className ? `py-0 ${className}` : 'py-0'}>
      <SidebarGroupContent className="relative">
        <PopoverPrimitive.Root
          open={open}
          onOpenChange={next => {
            // Radix fires this on outside-click / Escape → we want to
            // drop manualOpen so derived state doesn't snap back open.
            if (!next) setManualOpen(false);
            else setManualOpen(true);
          }}
        >
          <PopoverPrimitive.Trigger asChild>
            <button
              ref={triggerRef}
              type="button"
              onClick={() => setManualOpen(v => !v)}
              onFocus={() => setManualOpen(true)}
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

          <SearchBackdrop open={open && !isMobile} />

          {isMobile ? (
            <PopoverPrimitive.Content
              ref={contentRef}
              side="bottom"
              align="start"
              sideOffset={8}
              collisionPadding={12}
              className="z-[95] w-[var(--radix-popover-trigger-width)] overflow-hidden rounded-[12px] border outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[side=bottom]:slide-in-from-top-1"
              style={{
                backgroundColor: 'var(--surface-raised)',
                borderColor: 'color-mix(in oklab, var(--ink) 28%, transparent)',
                boxShadow:
                  '0 18px 38px -24px color-mix(in oklab, var(--ink) 45%, transparent), inset 0 1px 0 rgba(255, 255, 255, 0.45)',
              }}
            >
              <SearchPaletteBody
                onClose={() => {
                  setManualOpen(false);
                }}
              />
            </PopoverPrimitive.Content>
          ) : (
            <PopoverPrimitive.Portal>
              <PopoverPrimitive.Content
                ref={contentRef}
                side="right"
                align="start"
                sideOffset={12}
                collisionPadding={16}
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
                <SearchPaletteBody
                  onClose={() => {
                    setManualOpen(false);
                  }}
                />
              </PopoverPrimitive.Content>
            </PopoverPrimitive.Portal>
          )}
        </PopoverPrimitive.Root>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
