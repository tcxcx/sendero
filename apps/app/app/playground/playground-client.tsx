'use client';

/**
 * PlaygroundClient — thin wrapper around AgentChatClient with the
 * playground flag set. Reuses the operator chat UI verbatim so the
 * canonical channel-render layer keeps surfacing the same way (tool
 * calls, reasoning, sources, persona). The only behavioral
 * difference is the `playground: true` body field — see
 * /api/agent/chat for what that does (forces sandbox + rate limits).
 */

import { AgentChatClient } from '@/app/(app)/dashboard/agent-chat/agent-chat-client';

interface Props {
  tenantId: string;
}

export function PlaygroundClient({ tenantId }: Props) {
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <AgentChatClient tenantId={tenantId} playground />
    </div>
  );
}
