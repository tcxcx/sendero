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

/**
 * Tiny in-process cache so a fresh tenant's first burst of parallel
 * requests (`/api/passport/self` + `/api/passport/active-trips` + chat
 * dispatch all firing on `/dashboard` mount) doesn't hammer Clerk and
 * doesn't race the same upsert N times. Per-process; cold starts reset
 * it, which is fine — the DB is the source of truth.
 */
const PROVISION_CACHE_TTL_MS = 5 * 60 * 1000;
const provisionCache = new Map<string, { id: string; at: number }>();

function cacheGet(clerkUserId: string): string | null {
  const hit = provisionCache.get(clerkUserId);
  if (!hit) return null;
  if (Date.now() - hit.at > PROVISION_CACHE_TTL_MS) {
    provisionCache.delete(clerkUserId);
    return null;
  }
  return hit.id;
}

function cacheSet(clerkUserId: string, id: string): void {
  provisionCache.set(clerkUserId, { id, at: Date.now() });
}

/**
 * Coalesce concurrent `ensureUserRow(sameId)` calls so a single first
 * dispatch on a brand-new tenant doesn't trigger N parallel reads +
 * orphan-claims + upserts that race the unique index.
 */
const inflight = new Map<string, Promise<{ id: string }>>();

export async function ensureUserRow(clerkUserId: string): Promise<{ id: string }> {
  const cached = cacheGet(clerkUserId);
  if (cached) return { id: cached };

  const existing = await prisma.user.findUnique({
    where: { clerkUserId },
    select: { id: true },
  });
  if (existing) {
    cacheSet(clerkUserId, existing.id);
    return existing;
  }

  // Coalesce concurrent provisions for the same id.
  const existingPromise = inflight.get(clerkUserId);
  if (existingPromise) return existingPromise;

  const promise = provisionUserRow(clerkUserId).finally(() => {
    inflight.delete(clerkUserId);
  });
  inflight.set(clerkUserId, promise);
  return promise;
}

async function provisionUserRow(clerkUserId: string): Promise<{ id: string }> {
  console.log('[ensure-user] User row missing for', clerkUserId, '— provisioning from Clerk');
  let clerkUser;
  try {
    const client = await clerkClient();
    clerkUser = await client.users.getUser(clerkUserId);
  } catch (err) {
    // Clerk rate-limit / 5xx: re-check the DB once before bailing — the
    // webhook may have caught up since our initial read.
    console.warn('[ensure-user] Clerk getUser failed, retrying DB lookup once', {
      error: err instanceof Error ? err.message : String(err),
    });
    const second = await prisma.user.findUnique({
      where: { clerkUserId },
      select: { id: true },
    });
    if (second) {
      cacheSet(clerkUserId, second.id);
      return second;
    }
    throw err;
  }
  const email = clerkUser.emailAddresses[0]?.emailAddress ?? '';
  const phone = clerkUser.phoneNumbers[0]?.phoneNumber ?? '';
  const displayName =
    `${clerkUser.firstName ?? ''} ${clerkUser.lastName ?? ''}`.trim() ||
    clerkUser.username ||
    email;

  // Single-transaction orphan-claim-or-create. Wrapping the find +
  // update + upsert in `$transaction` means concurrent first-turn
  // requests serialize at the row level — second one sees the orphan
  // claim already happened and finds the now-canonical row.
  try {
    const result = await prisma.$transaction(async tx => {
      if (email) {
        const orphan = await tx.user.findFirst({
          where: { email, clerkUserId: null },
          select: { id: true },
        });
        if (orphan) {
          console.log('[ensure-user] claiming orphan row by email', {
            orphanId: orphan.id,
            email,
          });
          await tx.user.update({
            where: { id: orphan.id },
            data: { clerkUserId, source: 'native' },
          });
          return orphan;
        }
      }
      const created = await tx.user.upsert({
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
      return created;
    });
    cacheSet(clerkUserId, result.id);
    console.log('[ensure-user] provisioned User row', { id: result.id, clerkUserId });
    return result;
  } catch (err) {
    // Catch the P2002 unique violation that fires when two concurrent
    // requests slip through despite the inflight map (e.g. across cold
    // starts on Vercel). Re-read — winner already wrote the row.
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('P2002') || message.toLowerCase().includes('unique')) {
      console.warn('[ensure-user] unique-constraint race, re-reading', { clerkUserId });
      const settled = await prisma.user.findUnique({
        where: { clerkUserId },
        select: { id: true },
      });
      if (settled) {
        cacheSet(clerkUserId, settled.id);
        return settled;
      }
    }
    throw err;
  }
}
