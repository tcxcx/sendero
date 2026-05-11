/**
 * `request_booking_approval` — agent-callable approval gate for trips
 * that breach the corporate travel policy threshold.
 *
 * Triggered when `check_policy` returns `requiresApprovalAboveUsd <
 * offer.priceUsd` and the agent is about to confirm a booking. Creates
 * a ChannelHandoff with `kind='approval_request'`, stashes the booking
 * context in `metadata`, fires a Liveblocks notification, and returns a
 * pending status the agent can poll.
 *
 * Resolution path:
 *   - Operator opens /dashboard/handoffs → kind=approval_request rows
 *     surface Approve / Reject buttons.
 *   - Approve → handoff.status='approved'. Agent (via /api/handoffs/
 *     [id]/status poll) sees the flip and proceeds with confirm_booking.
 *   - Reject → handoff.status='rejected'. Agent reports back to the
 *     traveler and stops the booking.
 *
 * Distinct from `request_human_handoff` because the operator UX is
 * binary (approve/reject) rather than free-text answer. Same table
 * (ChannelHandoff) — the `kind` discriminator routes the UI render.
 */

import { notifyOperatorHandoff, roomIdForSupportCase } from '@sendero/collaboration/server';
import { prisma } from '@sendero/database';
import { z } from 'zod';

import type { ToolContext, ToolDef } from './types';

const inputSchema = z.object({
  tripId: z.string().optional().describe('Trip the approval is for. Optional — falls back to active trip resolution.'),
  bookingId: z.string().optional().describe('Booking id when the approval is for a specific reservation already created.'),
  priceUsd: z.number().nonnegative().describe('Total price the agent is about to confirm.'),
  thresholdUsd: z.number().nonnegative().describe('Policy threshold the price breached. Comes from check_policy → requiresApprovalAboveUsd.'),
  route: z
    .string()
    .optional()
    .describe('Human summary of what is being approved. e.g. "SFO→LHR business class, 2026-06-15".'),
  customerAccountId: z
    .string()
    .optional()
    .describe('CustomerAccount that scopes the policy. Carried through so the dashboard shows the corporate context.'),
  reason: z
    .string()
    .max(2000)
    .optional()
    .describe('Optional traveler-justification text the agent collected ("client meeting", etc.).'),
});

export const requestBookingApprovalTool: ToolDef = {
  name: 'request_booking_approval',
  description:
    'Request human approval for a booking that breaches the policy approval threshold. Returns a handoffId the agent polls until approved or rejected. Use when check_policy returns `requires_approver_above` warning and you have a concrete offer ready to confirm.',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['priceUsd', 'thresholdUsd'],
    properties: {
      tripId: { type: 'string' },
      bookingId: { type: 'string' },
      priceUsd: { type: 'number' },
      thresholdUsd: { type: 'number' },
      route: { type: 'string' },
      customerAccountId: { type: 'string' },
      reason: { type: 'string' },
    },
  },
  async handler(input: any, ctx?: ToolContext) {
    const tenantId = ctx?.traveler?.tenantId;
    if (!tenantId) throw new Error('booking_approval_missing_tenant_context');

    const question = input.route
      ? `Approve ${formatUsd(input.priceUsd)} booking (${input.route}) — exceeds ${formatUsd(input.thresholdUsd)} threshold`
      : `Approve ${formatUsd(input.priceUsd)} booking — exceeds ${formatUsd(input.thresholdUsd)} threshold`;

    // Resolve channel identity for the originating channel so the
    // resolve flow can fan an acknowledgement back. Approval-request
    // handoffs without a channel identity are still valid (operator-
    // initiated agent runs from the web console); fall through with a
    // synthetic 'web' channel in that case.
    const channelIdentityId = ctx?.channelIdentityId ?? null;
    const channelKind = channelIdentityId ? 'channel' : 'web';

    let handoff;
    if (channelIdentityId) {
      handoff = await prisma.channelHandoff.create({
        data: {
          tenantId,
          tripId: input.tripId ?? null,
          channelIdentityId,
          channel: channelKind,
          question,
          summary: input.reason ?? null,
          kind: 'approval_request',
          metadata: {
            priceUsd: input.priceUsd,
            thresholdUsd: input.thresholdUsd,
            route: input.route ?? null,
            customerAccountId: input.customerAccountId ?? null,
            bookingId: input.bookingId ?? null,
            requestedBy: ctx?.traveler?.userId ?? null,
            requestedAt: new Date().toISOString(),
          },
          liveblocksRoomId: 'pending',
        },
        select: { id: true },
      });
    } else {
      // No channel identity — operator-initiated. ChannelHandoff
      // requires channelIdentityId (FK not-null), so for now we fall
      // back to a no-channel-required path by creating the row through
      // raw SQL. Cleaner long-term fix: make channelIdentityId
      // nullable for approval-request kind. Tracked in TODO.md.
      throw new Error(
        'booking_approval_requires_channel_identity: call this tool from a channel-initiated turn (Slack / WhatsApp). Web-console approval flow lands in Tier 4.'
      );
    }

    const liveblocksRoomId = roomIdForSupportCase(tenantId, handoff.id);

    await prisma.channelHandoff.update({
      where: { id: handoff.id },
      data: { liveblocksRoomId },
    });

    // Fire-and-forget Liveblocks notification so the operator dashboard
    // pings without blocking the agent's reply path. Falls back to the
    // dashboard's DB-backed list when notify fails.
    void notifyOperatorHandoff({
      tenantId,
      handoffId: handoff.id,
      liveblocksRoomId,
      title: 'Booking approval required',
      message: input.reason ? `${question} — ${input.reason}` : question,
      url: '/dashboard/handoffs',
    });

    return {
      handoffId: handoff.id,
      status: 'pending' as const,
      kind: 'approval_request' as const,
      liveblocksRoomId,
      pollUrl: `/api/handoffs/${handoff.id}/status`,
      acknowledgement: `Approval requested — your TMC operator will review and respond in a moment.`,
    };
  },
};

function formatUsd(n: number): string {
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}
