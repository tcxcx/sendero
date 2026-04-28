/**
 * Layout for `/dashboard/channels/slack/*`.
 *
 * Mounts the section-level pill-tab nav (Workspace + Inbox) once so
 * every sub-route inherits it without re-rendering its own nav.
 * Mirrors the WhatsApp channel layout pattern.
 */

import { SlackChannelNav } from '@/components/channels/slack-channel-nav';

export default function SlackChannelLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <SlackChannelNav />
      {children}
    </div>
  );
}
