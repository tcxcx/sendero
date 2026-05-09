/**
 * Phase B-γ — `@conversation` parallel-routes slot.
 *
 * Server-fetches the focused-trip's events log + traveler display info
 * + earliest pending booking. Mounts `<ConsoleConversation />` which
 * owns the conversation column's client state (composer mode,
 * optimistic posts, demo trip, presence focus) and renders either the
 * AI Elements stream (internal mode, reads chat from Zustand mirror)
 * or the unified channel render (channel mode).
 *
 * The layout-level `ConsoleChatHost` owns useChat — this slot reads
 * the host's messages/status/error via Zustand and dispatches submits
 * back through the chat-bridge. See docs/phase-b-conversation-plan.md.
 */

import { ConsoleConversation } from '@/components/console/console-conversation';
import { currentOrgPlanTier } from '@/lib/billing-plan';
import { loadFocusedTrip } from '@/lib/console-trip-focused';
import { requireCurrentTenant } from '@/lib/tenant-context';

interface ConversationSlotProps {
  searchParams: Promise<{ tripId?: string }>;
}

export const dynamic = 'force-dynamic';

export default async function ConversationSlot({ searchParams }: ConversationSlotProps) {
  const params = await searchParams;
  const scopedTripId = params.tripId ?? null;
  const { tenant } = await requireCurrentTenant();

  const [focused, planTier] = await Promise.all([
    loadFocusedTrip(tenant.id, scopedTripId),
    currentOrgPlanTier(),
  ]);
  const { conversation, traveler, holdExpires, channelKind } = focused;

  return (
    <ConsoleConversation
      scopedTripId={scopedTripId}
      initialConversation={conversation}
      traveler={traveler}
      holdExpires={holdExpires}
      focusedChannelKind={channelKind}
      planTier={planTier}
    />
  );
}
