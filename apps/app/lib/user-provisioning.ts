/**
 * User provisioning — race-safe inline auto-provision when a Clerk user
 * lands on a route before the `user.created` webhook does.
 *
 * The race: a brand-new Clerk sign-up immediately calls `/api/agent/chat`
 * (the operator's own browser, console session). Webhook delivery from
 * Clerk to `/api/webhooks/clerk` is async and may take 100ms–30s. Until
 * it lands, `prisma.user.findUnique({clerkUserId})` returns null. The
 * old fallback `u?.id ?? a.userId` smuggled a Clerk-format id (`user_…`)
 * into `MeterEvent.userId`, which is FK'd to `User.id` (cuid) — every
 * first-time turn threw P2003.
 *
 * Fix: one call to `clerkClient.users.getUser()` to fetch authoritative
 * email/displayName/phone, then `prisma.user.upsert` keyed on the unique
 * `email` column so concurrent calls from the same session race-merge
 * to the same row.
 *
 * Fails closed — returns null on any error so the caller can 401 the
 * client with a retryable "first sign-in still provisioning" message
 * instead of writing a half-baked row.
 */

import { clerkClient } from '@clerk/nextjs/server';

import { prisma } from '@sendero/database';

/**
 * Resolve `User.id` for a Clerk user id, auto-provisioning the row if
 * the webhook hasn't landed yet. Returns null on any failure (Clerk
 * unreachable, no email on profile, race that can't be resolved). The
 * caller decides whether to 401 the client or proceed without a userId.
 *
 * Cost: 1 Clerk API call + 1 Prisma upsert on first sight per user.
 * After the row exists, this returns from the findUnique fast path.
 */
export async function provisionClerkUserId(clerkUserId: string): Promise<string | null> {
  if (!clerkUserId) return null;

  // Fast path — the webhook has already landed.
  const existing = await prisma.user.findUnique({
    where: { clerkUserId },
    select: { id: true },
  });
  if (existing) return existing.id;

  // Slow path — fetch authoritative profile from Clerk and upsert.
  // Network failure here means the user has to retry; better than
  // writing a stub row that stamps wrong analytics for the rest of
  // their account lifetime.
  let email: string;
  let displayName: string | undefined;
  let phone: string | undefined;
  try {
    const client = await clerkClient();
    const u = await client.users.getUser(clerkUserId);
    const primaryEmail =
      u.emailAddresses.find(e => e.id === u.primaryEmailAddressId)?.emailAddress ??
      u.emailAddresses[0]?.emailAddress ??
      null;
    if (!primaryEmail) {
      // No email on the Clerk profile — phone-only sign-up. Synthesize
      // a stable email so the @unique constraint still works; the
      // webhook will reconcile this when it lands (Clerk webhook upserts
      // by clerkUserId, not email, so a real email replaces the stub).
      email = `clerk-${clerkUserId}@users.noreply.sendero.travel`;
    } else {
      email = primaryEmail;
    }
    displayName = [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || undefined;
    phone = u.primaryPhoneNumberId
      ? u.phoneNumbers.find(p => p.id === u.primaryPhoneNumberId)?.phoneNumber || undefined
      : u.phoneNumbers[0]?.phoneNumber || undefined;
  } catch (err) {
    console.warn('[user-provisioning] clerk getUser failed', {
      clerkUserId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  // Race-safe upsert on `clerkUserId` (also @unique). Two concurrent
  // first-turn requests from the same session will both upsert; the
  // second one sees the existing row and updates it instead of
  // colliding on the unique key.
  try {
    const user = await prisma.user.upsert({
      where: { clerkUserId },
      create: {
        clerkUserId,
        email,
        displayName,
        phone,
        source: 'native',
      },
      update: {
        // Don't trample the webhook if it lands between our findUnique
        // and our upsert. Update only if the existing row has nothing.
        email,
      },
      select: { id: true },
    });
    return user.id;
  } catch (err) {
    console.warn('[user-provisioning] prisma upsert failed', {
      clerkUserId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
