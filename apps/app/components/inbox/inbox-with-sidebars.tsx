'use client';

/**
 * InboxWithSidebars — tenant inbox layout with a fixed-width trip list
 * column on the left and the selected trip thread on the right.
 *
 * Design note: the previous shadcn Sidebar pattern nested a second
 * SidebarProvider inside the app shell's SidebarProvider, which collapsed
 * the trip list column to 0 × 0 px in production (QA pass-2 P0 #1).
 * This version avoids that by rendering a plain flex layout with a
 * dedicated TripListColumn — the global app sidebar keeps its
 * SidebarProvider / SidebarInset chrome, and this layout lives entirely
 * inside the `<main>` content area without its own provider.
 */

import type { ReactNode } from 'react';

import { TripListColumn, type InboxTripRow } from '@/components/inbox/trip-list-column';

export type { InboxTripRow } from '@/components/inbox/trip-list-column';

export function InboxWithSidebars({
  trips,
  children,
}: {
  trips: InboxTripRow[];
  children: ReactNode;
}) {
  return (
    // Fill the parent <main> box rather than claiming `100dvh - header`
    // — the app shell now has a global footer below the main, so any
    // viewport-relative min-height overflows beneath the footer rail.
    <div className="flex h-full min-h-0 w-full flex-1 flex-row overflow-hidden">
      <TripListColumn trips={trips} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">{children}</div>
    </div>
  );
}
