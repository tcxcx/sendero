/**
 * /dashboard/agent-chat — operator-facing AI Elements test bench.
 *
 * Parallel to `/dashboard/console`. Renders operator ↔ Sendero AI
 * exclusively in canonical-message mode: every agent reply, tool
 * call, reasoning step, and approval request flows through the
 * `ChannelMessage` discriminated union before hitting the AI Elements
 * primitives. The same canonical messages are what other channels
 * (WhatsApp / Slack / web traveler) will receive in their native UI
 * once the channel renderers in `lib/channel-render/channels/` are
 * filled in.
 *
 * No tripId scoping in this route — pure operator workspace. For
 * scoped trip-channel previews keep using /dashboard/console.
 */

import { requireCurrentTenant } from '@/lib/tenant-context';

import { AgentChatClient } from './agent-chat-client';

export const dynamic = 'force-dynamic';

export default async function AgentChatPage() {
  const { tenant } = await requireCurrentTenant();

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-border px-6 py-3">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            Sendero AI · Agent Chat
          </div>
          <h1 className="mt-1 text-lg font-semibold tracking-normal text-foreground">
            Operator ↔ AI test bench
          </h1>
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Tenant {tenant.id.slice(0, 12)}…
        </div>
      </header>
      <AgentChatClient tenantId={tenant.id} />
    </div>
  );
}
