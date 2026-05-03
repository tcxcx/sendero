/**
 * Resolve (or auto-provision) the full traveler record for a given
 * `(tenantId, phone)` pair when an external agent runtime — Kapso
 * WhatsApp workflow today, possibly Slack-on-Kapso tomorrow — calls
 * Sendero's `/api/tools/<name>` endpoint with `travelerPhone`.
 *
 * Sendero's pre-Path-B inbound webhook had ChannelIdentity + User
 * auto-provisioning baked in. After moving the conversation runtime
 * into Kapso, the Sendero webhook is no longer subscribed; the same
 * provisioning has to happen on the first tool call instead.
 *
 * What this does on first call for a phone:
 *   1. Upsert `ChannelIdentity { kind: 'whatsapp', externalUserId: phone }`
 *      so Trip ledger writes + handoff anchoring work.
 *   2. Auto-provision a Sendero `User` row keyed on a placeholder email
 *      (mirrors the webhook's prior behavior). Globally-@unique email
 *      makes the upsert race-safe.
 *   3. Fire `ensureTravelerWallet({ userId })` — mints a Circle DCW on
 *      Arc + Solana so subsequent `gateway_balance`, `book_flight`,
 *      `prefund_trip` calls have a wallet to settle through.
 *
 * Idempotent end-to-end. The wallet ensure is fire-and-forget against
 * the route response — Circle errors must not block the agent's turn.
 */

import { type Prisma, prisma } from '@sendero/database';
import { ensureTravelerWallet } from '@sendero/tools/ensure-traveler-wallet';
import { detectLocale, localeForPhone } from '@sendero/locale';
import { env } from '@sendero/env';

export interface ResolvedTraveler {
  /** Sendero `User.id`. Stamped on `ToolContext.traveler.userId`. */
  userId: string;
  /** ChannelIdentity row id. Stamped on `ToolContext.channelIdentityId`. */
  channelIdentityId: string;
  /** Inferred BCP-47 from the phone country code. */
  locale: string;
  /** True when this call provisioned a new User row (first touch). */
  isNew: boolean;
  /**
   * True when the resolved User has no `clerkUserId` yet — i.e. they
   * exist only as the placeholder row created on first WhatsApp
   * inbound. The Kapso agent persona uses this to gate booking actions
   * and prompt the traveler to complete sign-in first.
   */
  isPlaceholder: boolean;
}

export async function resolveTravelerByPhone(args: {
  tenantId: string;
  phoneE164: string;
}): Promise<ResolvedTraveler> {
  const phone = args.phoneE164.startsWith('+') ? args.phoneE164 : `+${args.phoneE164}`;
  const locale =
    localeForPhone(phone) ?? detectLocale({ country: env.whatsappDefaultCountry() });

  // 1. ChannelIdentity — keyed by (tenantId, kind, externalUserId).
  const identity = await prisma.channelIdentity.upsert({
    where: {
      tenantId_kind_externalUserId: {
        tenantId: args.tenantId,
        kind: 'whatsapp',
        externalUserId: phone,
      },
    },
    create: {
      tenantId: args.tenantId,
      kind: 'whatsapp',
      externalUserId: phone,
      metadata: { locale, localeSource: localeForPhone(phone) ? 'phone_prefix' : 'tenant_default_country' } as Prisma.InputJsonObject,
    },
    update: {},
    select: { id: true, userId: true },
  });

  // 2. User — placeholder email so the @unique constraint makes
  //    concurrent provisions race-safe. Stamp `primaryTenantId` so the
  //    "who invited this traveler first" link survives without burning
  //    a Clerk org membership / paid custom role.
  let userId = identity.userId;
  let isNew = false;
  if (!userId) {
    const handle = phone.toLowerCase().replace(/[^a-z0-9]/g, '');
    const placeholderEmail = `wa-${handle}@whatsapp-provisional.sendero.travel`;
    try {
      const created = await prisma.user.create({
        data: {
          email: placeholderEmail,
          source: 'whatsapp',
          metadata: {
            primaryTenantId: args.tenantId,
            firstSeenChannel: 'whatsapp',
          } as Prisma.InputJsonObject,
        },
        select: { id: true },
      });
      userId = created.id;
      isNew = true;
    } catch {
      // Race: another concurrent tool call provisioned this user.
      const existing = await prisma.user.findUnique({
        where: { email: placeholderEmail },
        select: { id: true },
      });
      if (!existing) throw new Error('agent_traveler_provision_failed');
      userId = existing.id;
    }
    await prisma.channelIdentity.update({
      where: { id: identity.id },
      data: { userId },
    });
  }

  // 3. Wallet — fire-and-forget. Circle errors are logged inside
  //    `ensureTravelerWallet` and surfaced as `null` so the tool path
  //    never blocks waiting for an Arc DCW.
  void ensureTravelerWallet({ userId }).catch(err => {
    console.warn('[agent-traveler-resolver] wallet ensure failed (non-fatal)', {
      userId,
      phone,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  // 4. Placeholder discriminator + primaryTenantId stamp. The placeholder
  //    flag tells the agent persona to gate booking on sign-in first.
  //    The primaryTenantId stamp captures the "invited by" relationship
  //    without burning a Clerk org seat — backfilled here for existing
  //    User rows that pre-date the resolver's metadata write.
  const userRow = await prisma.user.findUnique({
    where: { id: userId },
    select: { clerkUserId: true, metadata: true },
  });
  const isPlaceholder = !userRow?.clerkUserId;

  const existingMeta = (userRow?.metadata ?? {}) as Record<string, unknown>;
  if (!existingMeta.primaryTenantId) {
    void prisma.user
      .update({
        where: { id: userId },
        data: {
          metadata: {
            ...existingMeta,
            primaryTenantId: args.tenantId,
            firstSeenChannel: existingMeta.firstSeenChannel ?? 'whatsapp',
          } as Prisma.InputJsonObject,
        },
      })
      .catch(err => {
        console.warn('[agent-traveler-resolver] primaryTenantId stamp failed', {
          userId,
          tenantId: args.tenantId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
  }

  return {
    userId,
    channelIdentityId: identity.id,
    locale,
    isNew,
    isPlaceholder,
  };
}
