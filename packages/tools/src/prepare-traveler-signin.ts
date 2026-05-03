/**
 * `prepare_traveler_signin` — mint a one-shot link token + return the
 * sign-in deep link the agent surfaces to the traveler.
 *
 * Lifecycle:
 *   1. Agent detects `ctx.traveler.isPlaceholder === true` for a
 *      traveler attempting a booking action.
 *   2. Calls this tool. It generates a fresh `WhatsAppLinkToken`
 *      keyed on the placeholder User, returns the URL to send.
 *   3. Agent relays the URL via free-text (sandbox) or HSM template
 *      (production) and pauses with `enter_waiting`.
 *   4. Traveler signs in at `/sign-in/traveler?token=<x>`. After
 *      Clerk OTP, `/api/whatsapp/link-clerk` runs the merge and the
 *      Clerk identity now owns the persistent profile.
 *   5. The next inbound resumes the workflow with `isPlaceholder`
 *      flipped to false; the agent retries the original booking.
 *
 * Idempotent: returns the existing un-consumed un-expired token if one
 * exists for this `(tenantId, userId)` pair, otherwise mints a new one.
 */

import { z } from 'zod';

import { prisma } from '@sendero/database';
import { generateLinkToken, getTokenExpiry } from '@sendero/whatsapp';

import type { ToolContext, ToolDef } from './types';

export const prepareTravelerSigninTool: ToolDef = {
  name: 'prepare_traveler_signin',
  description:
    "Mint a one-shot sign-in link for the traveler when they need to authenticate before booking. Use this when `ctx.traveler.isPlaceholder` is true and the traveler is trying to book / settle / mint. Returns `{ url, token, expiresAt }`. Send the URL to the traveler verbatim (it's short-lived, 15 minutes).",
  inputSchema: z.object({
    /** Optional override; defaults to NEXT_PUBLIC_APP_URL. */
    linkOrigin: z.string().url().optional(),
  }),
  jsonSchema: {
    type: 'object',
    properties: {
      linkOrigin: { type: 'string', description: 'Optional sign-in origin override.' },
    },
  },
  async handler(input: { linkOrigin?: string }, ctx?: ToolContext) {
    const userId = ctx?.traveler?.userId;
    const tenantId = ctx?.traveler?.tenantId;
    if (!userId || userId.startsWith('svc:')) {
      return {
        status: 'no_traveler',
        message:
          'No resolved traveler on this turn. Pass `travelerPhone` on `call_sendero` so the resolver can stamp a real user id.',
      };
    }
    if (!tenantId) {
      return {
        status: 'no_tenant',
        message: 'No tenantId in context — cannot scope the link token.',
      };
    }

    const baseUrl =
      input.linkOrigin ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3010';

    // Reuse an existing un-consumed token if one is still valid. Saves
    // generating a fresh token on every retry of the same booking.
    const existing = await prisma.whatsAppLinkToken.findFirst({
      where: {
        tenantId,
        userId,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
      select: { token: true, expiresAt: true },
    });
    if (existing) {
      return {
        status: 'ready',
        url: buildSignInUrl(baseUrl, existing.token),
        token: existing.token,
        expiresAt: existing.expiresAt.toISOString(),
        reused: true,
      };
    }

    const token = generateLinkToken();
    const expiresAt = getTokenExpiry();
    await prisma.whatsAppLinkToken.create({
      data: { tenantId, userId, token, expiresAt },
    });

    return {
      status: 'ready',
      url: buildSignInUrl(baseUrl, token),
      token,
      expiresAt: expiresAt.toISOString(),
      reused: false,
    };
  },
};

function buildSignInUrl(baseUrl: string, token: string): string {
  const trimmed = baseUrl.replace(/\/$/, '');
  return `${trimmed}/sign-in/traveler?token=${encodeURIComponent(token)}`;
}
