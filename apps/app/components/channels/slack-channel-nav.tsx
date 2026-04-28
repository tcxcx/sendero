'use client';

/**
 * SlackChannelNav — pill-tab nav at /dashboard/channels/slack/*.
 *
 *   Workspace  → /dashboard/channels/slack            (install state, routing, share URL)
 *   Inbox      → /dashboard/channels/slack/inbox      (agent-turn + install audit)
 *
 * Layout-level nav so every Slack sub-route shares it, mirroring the
 * WhatsappChannelNav pattern. The page-internal Workspace + Share-URL
 * tabs (`SlackChannelTabs`) keep working — they're scoped to the
 * Workspace route only.
 */

import { useRouter, usePathname } from 'next/navigation';

import { PillTabs, type PillTab } from '@sendero/ui/pill-tabs';

type SlackTabValue = 'workspace' | 'inbox';

const TABS: ReadonlyArray<PillTab<SlackTabValue> & { href: string }> = [
  { value: 'workspace', label: 'Workspace', href: '/dashboard/channels/slack' },
  { value: 'inbox', label: 'Inbox', href: '/dashboard/channels/slack/inbox' },
];

export function SlackChannelNav() {
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const active: SlackTabValue = pathname.includes('/slack/inbox') ? 'inbox' : 'workspace';

  return (
    <nav aria-label="Slack channel sections" style={{ padding: '12px 20px 4px' }}>
      <PillTabs<SlackTabValue>
        id="slack-channel-section-tabs"
        ariaLabel="Slack section"
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
