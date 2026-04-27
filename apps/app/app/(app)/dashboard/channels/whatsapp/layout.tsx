/**
 * Layout for `/dashboard/channels/whatsapp/*`.
 *
 * Mounts the pill-tab nav once so every sub-route (workspace + inbox
 * + future siblings like /flows when WhatsApp Flows lands) inherits
 * it without each page re-rendering its own nav. Active tab derives
 * from the URL via `usePathname()` inside the client nav component.
 */

import { WhatsappChannelNav } from '@/components/channels/whatsapp-channel-nav';

export default function WhatsappChannelLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <WhatsappChannelNav />
      {children}
    </div>
  );
}
