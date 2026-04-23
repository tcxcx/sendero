'use client';

import {
  TripInboxDualSidebar,
  type InboxTripRow,
} from '@/components/inbox/trip-inbox-dual-sidebar';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';

export function InboxWithSidebars({
  trips,
  children,
}: {
  trips: InboxTripRow[];
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider
      className="flex min-h-[min(28rem,70vh)] w-full flex-1 !flex-row rounded-md border border-border bg-muted/20"
      style={
        {
          '--sidebar-width': '22rem',
        } as React.CSSProperties
      }
    >
      <TripInboxDualSidebar trips={trips} />
      <SidebarInset className="min-h-0 min-w-0 flex-1 overflow-auto bg-background">
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}
