'use client';

/**
 * WhatsappChannelNav — pill-tab nav at /dashboard/channels/whatsapp/*.
 *
 *   Workspace  → /dashboard/channels/whatsapp           (install state, setup, health)
 *   Inbox      → /dashboard/channels/whatsapp/inbox     (webhook + outbound + API audit)
 *
 * Native page-nav (router.push, full segment swap) so the URL is
 * always shareable with support tickets. Active tab derives from
 * `usePathname()` so back/forward works without flicker.
 *
 * Mounted at the layout level (`whatsapp/layout.tsx`) — every WhatsApp
 * sub-route inherits the nav once.
 */

import { useRouter, usePathname } from 'next/navigation';

import { PillTabs, type PillTab } from '@sendero/ui/pill-tabs';

type WhatsappTabValue = 'workspace' | 'inbox';

const TABS: ReadonlyArray<PillTab<WhatsappTabValue> & { href: string }> = [
  { value: 'workspace', label: 'Workspace', href: '/dashboard/channels/whatsapp' },
  { value: 'inbox', label: 'Inbox', href: '/dashboard/channels/whatsapp/inbox' },
];

export function WhatsappChannelNav() {
  const router = useRouter();
  const pathname = usePathname() ?? '';
  // /inbox is the only nested route today; everything else falls back
  // to "workspace" (the default channel page handles connect / setup
  // / disconnect / status). Add new tabs here as new routes land.
  const active: WhatsappTabValue = pathname.includes('/whatsapp/inbox') ? 'inbox' : 'workspace';

  return (
    <nav aria-label="WhatsApp channel sections" style={{ padding: '12px 20px 4px' }}>
      <PillTabs<WhatsappTabValue>
        id="wa-channel-tabs"
        ariaLabel="WhatsApp section"
        tabs={TABS}
        value={active}
        onChange={next => {
          const target = TABS.find(t => t.value === next);
          if (target && target.href !== pathname) router.push(target.href);
        }}
      />
    </nav>
  );
}
