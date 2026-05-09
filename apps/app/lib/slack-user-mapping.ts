/**
 * Slack member → Sendero User resolver.
 *
 * Every Slack-driven agent turn used to stamp `meter_events.userId`
 * with the install's `authedUserId` (the workspace admin who installed
 * the bot), regardless of which Slack member actually triggered the
 * turn. That broke per-user spend caps, analytics, and audit trails.
 *
 * `resolveSenderoUser()` is the single entrypoint:
 *   1. Cache hit on `slack_user_bindings` -> return.
 *   2. Live lookup via `slack.users.info` (requires the `users:read.email`
 *      bot scope — see `DEFAULT_BOT_SCOPES` in `@sendero/slack/oauth`).
 *   3. Find an existing Sendero User by email (global @unique on
 *      User.email; multi-tenant collisions are not possible at the DB
 *      level today). If found, write the binding and return.
 *   4. Auto-provision a User row (source='slack') with the Slack email
 *      OR a deterministic placeholder if the email is null. The
 *      placeholder pattern is `slack-{userId}@{teamId}.slack-provisional.sendero.travel`
 *      so a future Clerk sign-up with the real email can be detected
 *      and merged out-of-band.
 *   5. Write the binding. Idempotent — duplicate-key collisions from
 *      a parallel resolver call re-read instead of crashing.
 *
 * The resolver is wrapped in a top-level try/catch. ANY failure falls
 * back to the install's `authedUserId` so the Slack webhook can keep
 * the agent turn alive. Failures are `console.warn`-ed with enough
 * context for ops triage; they are NOT thrown.
 */

import { type Prisma, prisma } from '@sendero/database';
import { createSlackClient } from '@sendero/slack';
import { ensureTravelerWallet } from '@sendero/tools/ensure-traveler-wallet';

export interface ResolvedSlackUser {
  /** Sendero User.id whose row should appear on `meter_events.userId`. */
  senderoUserId: string;
  /** Last-seen Slack email if the bot has `users:read.email` and the user has one. */
  email: string | null;
  /** True iff this resolver call auto-created the User row (step 4). */
  provisional: boolean;
  /** ChannelIdentity row that anchors this Slack member in Sendero. */
  channelIdentityId: string | null;
}

export interface ResolveSenderoUserArgs {
  tenantId: string;
  slackTeamId: string;
  slackUserId: string;
  /** Slack bot token from the matching SlackInstall row. */
  botToken: string;
  /**
   * Workspace-admin User.id — used as the fallback subject if the
   * resolver fails for any reason (network, DB, missing scope).
   * Passing the original buggy value here means a single try/catch
   * keeps the agent turn alive without changing call sites elsewhere.
   */
  fallbackUserId: string;
}

/**
 * Slack `users.info` shape, narrowed to what we actually read. Kept
 * loose so we don't crash on Slack adding new fields.
 */
interface SlackUsersInfoLike {
  ok?: boolean;
  user?: {
    id?: string;
    profile?: {
      email?: string | null;
    } | null;
  } | null;
}

export async function resolveSenderoUser(args: ResolveSenderoUserArgs): Promise<ResolvedSlackUser> {
  const { tenantId, slackTeamId, slackUserId, botToken, fallbackUserId } = args;

  try {
    // 1. Cache hit — no Slack call, no provisioning.
    const existing = await prisma.slackUserBinding.findUnique({
      where: {
        tenantId_slackTeamId_slackUserId: { tenantId, slackTeamId, slackUserId },
      },
      select: { senderoUserId: true, email: true },
    });
    if (existing) {
      const originalUserId = existing.senderoUserId;
      const senderoUserId = await resolveCanonicalChannelUser({
        tenantId,
        currentUserId: originalUserId,
        email: existing.email,
      });
      if (senderoUserId !== originalUserId) {
        await prisma.slackUserBinding.update({
          where: { tenantId_slackTeamId_slackUserId: { tenantId, slackTeamId, slackUserId } },
          data: { senderoUserId },
        });
      }
      const channelIdentityId = await ensureSlackTravelerContext({
        tenantId,
        slackTeamId,
        slackUserId,
        senderoUserId,
        email: existing.email,
        canonicalizedFromUserId: senderoUserId !== originalUserId ? originalUserId : undefined,
      });
      return {
        senderoUserId,
        email: existing.email,
        provisional: false,
        channelIdentityId,
      };
    }

    // 2. Live lookup. `users.info` returns email only when the bot
    //    has `users:read.email` — silently null otherwise.
    const slack = createSlackClient(botToken);
    const info = (await slack.users.info({ user: slackUserId })) as SlackUsersInfoLike;
    const email = info?.user?.profile?.email ?? null;

    // 3. Find an existing Sendero User — User.email is globally
    //    @unique today, so this is a `findUnique`-equivalent.
    let senderoUserId: string | null = null;
    let provisional = false;
    if (email) {
      const found = await prisma.user.findUnique({
        where: { email },
        select: { id: true },
      });
      if (found) senderoUserId = found.id;
    }

    // 4. Auto-provision when no User exists (or no email at all).
    //    The placeholder email pattern means we always have a deterministic
    //    address and can detect a real-email sign-up to merge later.
    if (!senderoUserId) {
      const provisionalEmail =
        email ??
        `slack-${slackUserId.toLowerCase()}@${slackTeamId.toLowerCase()}.slack-provisional.sendero.travel`;

      try {
        const created = await prisma.user.create({
          data: {
            email: provisionalEmail,
            source: 'slack',
            // clerkUserId stays null — set if/when the human signs up
            // via Clerk and the webhook upserts onto this row.
          },
          select: { id: true },
        });
        senderoUserId = created.id;
        provisional = true;
        console.info(
          `[slack-user-mapping] auto-provisioned tenant=${tenantId} slackTeam=${slackTeamId} slackUser=${slackUserId} senderoUser=${senderoUserId} email=${email ? 'real' : 'placeholder'}`
        );
      } catch (err) {
        // Race: another resolver call (or another tenant sharing the
        // same Slack workspace) created a User with this email. Re-read
        // by email — User.email is globally @unique.
        const existingByEmail = await prisma.user.findUnique({
          where: { email: provisionalEmail },
          select: { id: true },
        });
        if (!existingByEmail) throw err;
        senderoUserId = existingByEmail.id;
        provisional = false;
      }
    }

    // 5. Write the binding. Race: a parallel resolver call may have
    //    inserted the same row between step 1 and now. Catch the
    //    unique violation and re-read.
    try {
      await prisma.slackUserBinding.create({
        data: {
          tenantId,
          slackTeamId,
          slackUserId,
          senderoUserId,
          email,
        },
      });
    } catch (err) {
      // Prisma raises P2002 on unique-constraint violation. Any other
      // error here is unexpected — log it and try to re-read; if the
      // re-read fails too, fall through to the outer catch.
      const reread = await prisma.slackUserBinding.findUnique({
        where: {
          tenantId_slackTeamId_slackUserId: { tenantId, slackTeamId, slackUserId },
        },
        select: { senderoUserId: true, email: true },
      });
      if (reread) {
        const originalUserId = reread.senderoUserId;
        const senderoUserId = await resolveCanonicalChannelUser({
          tenantId,
          currentUserId: originalUserId,
          email: reread.email,
        });
        if (senderoUserId !== originalUserId) {
          await prisma.slackUserBinding.update({
            where: { tenantId_slackTeamId_slackUserId: { tenantId, slackTeamId, slackUserId } },
            data: { senderoUserId },
          });
        }
        const channelIdentityId = await ensureSlackTravelerContext({
          tenantId,
          slackTeamId,
          slackUserId,
          senderoUserId,
          email: reread.email,
          canonicalizedFromUserId: senderoUserId !== originalUserId ? originalUserId : undefined,
        });
        return {
          senderoUserId,
          email: reread.email,
          provisional: false,
          channelIdentityId,
        };
      }
      // Re-read failed — propagate to outer catch.
      throw err;
    }

    const originalUserId = senderoUserId;
    const canonicalUserId = await resolveCanonicalChannelUser({
      tenantId,
      currentUserId: originalUserId,
      email,
    });
    if (canonicalUserId !== originalUserId) {
      await prisma.slackUserBinding.update({
        where: { tenantId_slackTeamId_slackUserId: { tenantId, slackTeamId, slackUserId } },
        data: { senderoUserId: canonicalUserId },
      });
    }
    const channelIdentityId = await ensureSlackTravelerContext({
      tenantId,
      slackTeamId,
      slackUserId,
      senderoUserId: canonicalUserId,
      email,
      canonicalizedFromUserId: canonicalUserId !== originalUserId ? originalUserId : undefined,
    });

    return { senderoUserId: canonicalUserId, email, provisional, channelIdentityId };
  } catch (err) {
    console.warn(
      `[slack-user-mapping] resolver failed; falling back to install authedUser tenant=${tenantId} slackTeam=${slackTeamId} slackUser=${slackUserId}`,
      err
    );
    const channelIdentityId = await ensureSlackTravelerContext({
      tenantId,
      slackTeamId,
      slackUserId,
      senderoUserId: fallbackUserId,
      email: null,
      fallback: true,
    }).catch(contextErr => {
      console.warn('[slack-user-mapping] fallback channel identity failed', {
        tenantId,
        slackTeamId,
        slackUserId,
        error: contextErr instanceof Error ? contextErr.message : String(contextErr),
      });
      return null;
    });
    return { senderoUserId: fallbackUserId, email: null, provisional: false, channelIdentityId };
  }
}

async function ensureSlackTravelerContext(args: {
  tenantId: string;
  slackTeamId: string;
  slackUserId: string;
  senderoUserId: string;
  email: string | null;
  fallback?: boolean;
  canonicalizedFromUserId?: string;
}): Promise<string | null> {
  const metadata = {
    slackTeamId: args.slackTeamId,
    email: args.email,
    source: 'slack_user_binding',
    ...(args.fallback ? { fallback: true } : {}),
    ...(args.canonicalizedFromUserId
      ? {
          canonicalizedFromUserId: args.canonicalizedFromUserId,
          canonicalizationReason: 'tenant_whatsapp_wallet_identity',
        }
      : {}),
  } satisfies Prisma.InputJsonObject;

  const identity = await prisma.channelIdentity.upsert({
    where: {
      tenantId_kind_externalUserId: {
        tenantId: args.tenantId,
        kind: 'slack',
        externalUserId: args.slackUserId,
      },
    },
    create: {
      tenantId: args.tenantId,
      kind: 'slack',
      externalUserId: args.slackUserId,
      userId: args.senderoUserId,
      metadata,
    },
    update: {
      userId: args.senderoUserId,
      metadata,
    },
    select: { id: true },
  });

  await ensureTravelerWallet({ userId: args.senderoUserId }).catch(err => {
    console.warn('[slack-user-mapping] wallet ensure failed (non-fatal)', {
      tenantId: args.tenantId,
      slackTeamId: args.slackTeamId,
      slackUserId: args.slackUserId,
      senderoUserId: args.senderoUserId,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  return identity.id;
}

async function resolveCanonicalChannelUser(args: {
  tenantId: string;
  currentUserId: string;
  email: string | null;
}): Promise<string> {
  const current = await prisma.user.findUnique({
    where: { id: args.currentUserId },
    select: {
      id: true,
      wallets: { select: { id: true }, take: 1 },
      gatewaySigner: { select: { userId: true } },
    },
  });
  if (!current) return args.currentUserId;
  if ((current.wallets?.length ?? 0) > 0 || current.gatewaySigner) return args.currentUserId;

  const identities = await prisma.channelIdentity.findMany({
    where: {
      tenantId: args.tenantId,
      kind: 'whatsapp',
      userId: { not: null },
      user: {
        memberships: { some: { tenantId: args.tenantId, status: 'active' } },
        OR: [{ wallets: { some: { provisioner: 'dcw' } } }, { gatewaySigner: { isNot: null } }],
      },
    },
    select: {
      userId: true,
      user: {
        select: {
          id: true,
          email: true,
          wallets: { select: { id: true }, take: 1 },
          gatewaySigner: { select: { userId: true } },
        },
      },
    },
  });

  const candidates = new Map<string, NonNullable<(typeof identities)[number]['user']>>();
  for (const identity of identities) {
    if (identity.userId && identity.user) candidates.set(identity.userId, identity.user);
  }
  if (candidates.size !== 1) return args.currentUserId;
  const [candidate] = [...candidates.values()];
  if (!candidate || candidate.id === args.currentUserId) return args.currentUserId;

  console.info('[slack-user-mapping] canonicalized Slack user to tenant WhatsApp wallet identity', {
    tenantId: args.tenantId,
    fromUserId: args.currentUserId,
    toUserId: candidate.id,
    slackEmail: args.email,
    canonicalEmail: candidate.email,
  });
  return candidate.id;
}
