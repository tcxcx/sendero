/**
 * Agent-driven pay-link dispatch.
 *
 * Issues a single-use BookingPayToken and fans the magic link out to
 * the traveler over WhatsApp + email. Reuses the same internal
 * pipeline the operator's "Pre-fund + send link" UI uses, so any
 * channel-render improvements (e.g. WhatsApp `cta_url` button)
 * benefit both surfaces.
 *
 * Auth: the tool calls into `/api/pay-link/send`, an internal route
 * gated by `AGENT_DISPATCH_SECRET`. Tenant context comes from the
 * caller (the agent dispatcher binds it to the API key's tenant
 * before invoking the tool).
 *
 * Use after a successful operator pre-fund (or when the traveler is
 * already pre-funded and the operator wants to re-issue the link).
 * Single-use semantics — the previous link is invalidated only by
 * consumption or expiry, not by issuing a new one.
 */

import { z } from 'zod';

import type { ToolDef } from './types';

const inputSchema = z.object({
  bookingId: z.string().min(1).describe('Booking the link should authorize.'),
  ttlMinutes: z
    .number()
    .int()
    .min(1)
    .max(24 * 60)
    .optional()
    .describe('Override the default 30-minute TTL (max 24h).'),
});

export const sendPayLinkTool: ToolDef = {
  name: 'send_pay_link',
  description:
    "Issue a single-use magic-link payment URL for a pending booking and dispatch it to the traveler over WhatsApp + email. Use AFTER pre-funding the traveler's unified balance (so the link can clear without further funding). Returns per-channel delivery outcomes; failures are reported in-band but do not roll back token issuance.",
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['bookingId'],
    properties: {
      bookingId: { type: 'string', description: 'Booking the link should authorize.' },
      ttlMinutes: {
        type: 'integer',
        minimum: 1,
        maximum: 1440,
        description: 'Override the default 30-minute TTL (max 24h).',
      },
    },
  },
  async handler(input, ctx) {
    const parsed = inputSchema.parse(input);
    const tenantId = ctx?.traveler?.tenantId;
    if (!tenantId) {
      return { error: 'no_tenant_context', message: 'Agent dispatcher must bind tenantId.' };
    }

    const base = (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3010').replace(/\/$/, '');
    const secret = process.env.AGENT_DISPATCH_SECRET ?? process.env.CRON_SECRET;
    if (!secret) {
      return {
        error: 'no_dispatch_secret',
        message: 'AGENT_DISPATCH_SECRET / CRON_SECRET not configured.',
      };
    }

    const res = await fetch(`${base}/api/pay-link/send`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({
        tenantId,
        bookingId: parsed.bookingId,
        ttlMinutes: parsed.ttlMinutes,
      }),
      // Delivery touches WA + email — give it a generous ceiling but cap
      // so a stalled provider can't hold up the agent turn indefinitely.
      signal: AbortSignal.timeout(15_000),
    });

    let payload: unknown = null;
    try {
      payload = await res.json();
    } catch {
      // Non-JSON response — fall through; surface raw status.
    }
    if (!res.ok) {
      return {
        error: 'delivery_failed',
        status: res.status,
        body: payload ?? null,
      };
    }
    return payload;
  },
};
