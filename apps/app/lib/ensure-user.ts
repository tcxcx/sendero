/**
 * ensureUserRow — lazily provisions the local `User` row for a Clerk user.
 *
 * The canonical provisioning path is the Clerk `user.created` webhook
 * (see `apps/app/app/api/webhooks/clerk/route.ts::onUserUpsert`). In dev
 * (no public webhook URL) and on race conditions (the user hits a route
 * before the webhook lands), the row is missing and every API gate that
 * requires `prisma.user.findUnique({ clerkUserId })` returns 401.
 *
 * This helper closes the gap: if the row exists, return it; if not, look
 * the user up via Clerk's server SDK and upsert. Mirrors the webhook's
 * merge-by-email guard so guest rows (Slack/WhatsApp provisioned with
 * `clerkUserId=null`) are claimed instead of orphaned.
 */

import { clerkClient } from '@clerk/nextjs/server';
import { prisma } from '@sendero/database';

export async function ensureUserRow(clerkUserId: string): Promise<{ id: string }> {
  const existing = await prisma.user.findUnique({
    where: { clerkUserId },
    select: { id: true },
  });
  if (existing) return existing;

  console.log('[ensure-user] User row missing for', clerkUserId, '— provisioning from Clerk');
  const client = await clerkClient();
  const clerkUser = await client.users.getUser(clerkUserId);
  const email = clerkUser.emailAddresses[0]?.emailAddress ?? '';
  const phone = clerkUser.phoneNumbers[0]?.phoneNumber ?? '';
  const displayName =
    `${clerkUser.firstName ?? ''} ${clerkUser.lastName ?? ''}`.trim() ||
    clerkUser.username ||
    email;

  // Merge-by-email guard — same as the webhook handler. A WhatsApp/Slack
  // guest may already exist with `clerkUserId=null`; claim it first so we
  // don't orphan their wallet, trips, etc.
  if (email) {
    const orphan = await prisma.user.findFirst({
      where: { email, clerkUserId: null },
      select: { id: true },
    });
    if (orphan) {
      console.log('[ensure-user] claiming orphan row by email', { orphanId: orphan.id, email });
      await prisma.user.update({
        where: { id: orphan.id },
        data: { clerkUserId, source: 'native' },
      });
      return orphan;
    }
  }

  const created = await prisma.user.upsert({
    where: { clerkUserId },
    create: {
      clerkUserId,
      email,
      displayName,
      phone: phone || undefined,
    },
    update: {},
    select: { id: true },
  });
  console.log('[ensure-user] provisioned User row', { id: created.id, clerkUserId });
  return created;
}
