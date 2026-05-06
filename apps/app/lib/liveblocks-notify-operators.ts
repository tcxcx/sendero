/**
 * liveblocks-notify-operators — fan-out helper.
 *
 * Liveblocks `triggerInboxNotification` accepts a single `userId`. Our
 * operator surface (`apps/app/components/collaboration/liveblocks-inbox.tsx`)
 * issues a Liveblocks session with the Clerk `userId` (see
 * `apps/app/app/api/liveblocks-auth/route.ts`), so the right way to wake
 * a tenant's operators is to call `triggerInboxNotification` once per
 * operator user with their `clerkUserId`.
 *
 * Scope of "operator": Membership rows for the tenant with `role !=
 * traveler` and an active status, intersected with `User.clerkUserId
 * IS NOT NULL` (a real signed-in identity, not a provisional channel
 * placeholder).
 *
 * Fail-soft: missing `LIVEBLOCKS_SECRET_KEY`, an empty operator list,
 * or any per-call error becomes a `console.warn`. The agent path that
 * called this never blocks on a notification.
 */

import { Liveblocks } from '@liveblocks/node';

import { prisma } from '@sendero/database';

/**
 * The per-kind activity payload shapes are typed in
 * `apps/app/liveblocks.config.ts` (ActivitiesData). To keep this helper
 * KISS we always emit `$handoffRequired` — the operator inbox renders
 * every custom kind through the same `CustomNotification` component,
 * so the difference is only in the dedup `subjectId` semantics.
 */
export interface NotifyOperatorsArgs {
  tenantId: string;
  /** Stable id for dedup — e.g. `inbound:<wamid>` or `handoff:<id>`. */
  subjectId: string;
  roomId: string;
  title: string;
  message: string;
  url: string;
}

export async function notifyTenantOperators(args: NotifyOperatorsArgs): Promise<void> {
  const secret = process.env.LIVEBLOCKS_SECRET_KEY;
  if (!secret) return;

  let operatorClerkIds: string[];
  try {
    const memberships = await prisma.membership.findMany({
      where: {
        tenantId: args.tenantId,
        status: 'active',
        role: { in: ['agency_admin', 'finance'] },
        user: { clerkUserId: { not: null } },
      },
      select: { user: { select: { clerkUserId: true } } },
      take: 50,
    });
    operatorClerkIds = memberships
      .map(m => m.user?.clerkUserId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
  } catch (err) {
    console.warn('[liveblocks/notify-operators] membership lookup failed', {
      tenantId: args.tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  if (operatorClerkIds.length === 0) return;

  const liveblocks = new Liveblocks({ secret });
  await Promise.allSettled(
    operatorClerkIds.map(userId =>
      liveblocks
        .triggerInboxNotification({
          userId,
          kind: '$handoffRequired',
          subjectId: args.subjectId,
          roomId: args.roomId,
          activityData: {
            title: args.title,
            message: args.message,
            provider: 'sendero',
            url: args.url,
          },
        })
        .catch(err => {
          console.warn('[liveblocks/notify-operators] trigger failed', {
            userId,
            tenantId: args.tenantId,
            error: err instanceof Error ? err.message : String(err),
          });
        })
    )
  );
}
