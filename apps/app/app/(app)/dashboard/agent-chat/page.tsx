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
      {/* Dev-only banner: this route is the AI Elements test bench, not
          the production operator console. Operators landing here by
          bookmark or direct URL need the redirect signal. */}
      <div
        className="flex items-center justify-between gap-3 border-b border-[color:var(--vermillion)] bg-[color:color-mix(in_oklab,var(--vermillion)_10%,transparent)] px-6 py-2"
        role="alert"
      >
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-[color:var(--vermillion)]">
          <span aria-hidden>⚠</span>
          <span>Test bench · for operator workflows use Console</span>
        </div>
        <a
          href="/dashboard/console"
          className="rounded-sm bg-[color:var(--vermillion)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-white no-underline transition-colors hover:bg-[color:color-mix(in_oklab,var(--vermillion)_88%,black)]"
        >
          Go to Console →
        </a>
      </div>
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
