/**
 * channel-dispatch — Phase G traveler channel dispatcher.
 *
 * Single entry point for every server-side outbound to a traveler.
 * Replaces the six WhatsApp-locked fanout helpers (boarding pass /
 * NFT card / eSIM offer / e-ticket / wrap-up / BOOKING_CONFIRMED) so
 * a corporate-Slack traveler gets parity with a WhatsApp traveler
 * without per-helper rewrites.
 *
 * Decision: ONE channel per traveler, not fanout. Sending the same
 * card on whatsapp + slack double-pings the user. The primary
 * channel is resolved in this order:
 *
 *   1. `Trip.channelBindings.primary` if explicitly pinned.
 *   2. The traveler's WhatsApp `ChannelIdentity` if present.
 *   3. The traveler's `SlackUserBinding` if present.
 *   4. None — `dispatchToTraveler` returns `{ sent: false, reason }`.
 *
 * Web is intentionally NOT a target. The web surface is operator-side
 * (`/dashboard/console`) reading `Trip.events`. Travelers don't get
 * web pushes.
 *
 * The dispatcher's compose model:
 *   - Caller passes a canonical `ChannelMessage` (the same shape the
 *     operator console renders).
 *   - Dispatcher resolves the channel + the install/identity rows.
 *   - Hands off to `sendChannelMessageWhatsApp` /
 *     `sendChannelMessageSlack` which composes
 *     `renderForWhatsApp` / `renderForSlack` with the package send
 *     primitive.
 *
 * Fail-soft: any branch returning an error becomes
 * `{ sent: false, reason }` so the caller can log and proceed.
 */

import type { ChannelMessage } from '@/lib/channel-render';
import { sendChannelMessageSlack } from '@/lib/channel-send/slack';
import { sendChannelMessageWhatsApp } from '@/lib/channel-send/whatsapp';
import { resolveSandboxOutboundInstall } from '@/lib/whatsapp-sandbox-routing';
import {
  buildSendableTravelerChannels,
  selectSendableTravelerChannel,
} from '@/lib/sendable-traveler-channels';
import { env } from '@sendero/env';
import { prisma } from '@sendero/database';

export type TravelerChannelKind = 'whatsapp' | 'slack';

export interface DispatchToTravelerArgs {
  tripId?: string;
  tenantId: string;
  travelerUserId: string;
  message: ChannelMessage;
  /**
   * Override the resolved primary channel. Useful when the caller
   * already knows which channel the traveler is on (e.g. resuming a
   * Slack thread). When unset, `resolvePrimaryTravelerChannel` runs.
   */
  forceChannel?: TravelerChannelKind;
}

export type DispatchToTravelerResult =
  | {
      sent: false;
      reason:
        | 'no_traveler_channel'
        | 'whatsapp_install_missing'
        | 'whatsapp_send_error'
        | 'slack_install_missing'
        | 'slack_send_error'
        | 'unsupported_kind'
        | 'unknown_channel';
      channel?: TravelerChannelKind;
      detail?: string;
    }
  | {
      sent: true;
      channel: TravelerChannelKind;
      tripId?: string;
      detail?: unknown;
    };

/**
 * Pick the traveler's primary delivery channel. Reads
 * `Trip.channelBindings.primary` first when a tripId is supplied,
 * otherwise walks `ChannelIdentity` → `SlackUserBinding`.
 */
export async function resolvePrimaryTravelerChannel(args: {
  tenantId: string;
  travelerUserId: string;
  tripId?: string;
}): Promise<TravelerChannelKind | null> {
  let preferred: TravelerChannelKind | null = null;
  if (args.tripId) {
    const trip = await prisma.trip.findUnique({
      where: { id: args.tripId },
      select: { channelBindings: true, tenantId: true },
    });
    if (trip?.tenantId === args.tenantId) {
      const bindings = (trip.channelBindings ?? null) as { primary?: TravelerChannelKind } | null;
      if (bindings?.primary === 'whatsapp' || bindings?.primary === 'slack') {
        preferred = bindings.primary;
      }
    }
  }

  const traveler = await prisma.user.findUnique({
    where: { id: args.travelerUserId },
    select: {
      channelIdentities: {
        where: { tenantId: args.tenantId },
        select: {
          kind: true,
          externalUserId: true,
          businessScopedUserId: true,
          username: true,
        },
      },
      slackUserBindings: {
        where: { tenantId: args.tenantId },
        select: { slackTeamId: true, slackUserId: true },
      },
    },
  });
  if (!traveler) return null;

  let activeSlackTeamIds = new Set<string>();
  if (traveler.slackUserBindings.length > 0) {
    const installs = await prisma.slackInstall.findMany({
      where: {
        tenantId: args.tenantId,
        revokedAt: null,
        teamId: { in: traveler.slackUserBindings.map(binding => binding.slackTeamId) },
      },
      select: { teamId: true },
    });
    activeSlackTeamIds = new Set(installs.map(install => install.teamId));
  }

  const selected = selectSendableTravelerChannel(
    buildSendableTravelerChannels({
      channelIdentities: traveler.channelIdentities,
      slackUserBindings: traveler.slackUserBindings,
      activeSlackTeamIds,
    }),
    preferred
  );
  if (selected === 'whatsapp' || selected === 'slack') return selected;

  return null;
}

export async function dispatchToTraveler(
  args: DispatchToTravelerArgs
): Promise<DispatchToTravelerResult> {
  const channel =
    args.forceChannel ??
    (await resolvePrimaryTravelerChannel({
      tenantId: args.tenantId,
      travelerUserId: args.travelerUserId,
      tripId: args.tripId,
    }));

  if (!channel) {
    return { sent: false, reason: 'no_traveler_channel' };
  }

  if (channel === 'whatsapp') {
    return dispatchWhatsApp({ ...args, message: args.message });
  }
  if (channel === 'slack') {
    return dispatchSlack({ ...args, message: args.message });
  }
  return { sent: false, reason: 'unknown_channel' };
}

async function dispatchWhatsApp(args: DispatchToTravelerArgs): Promise<DispatchToTravelerResult> {
  const identity = await prisma.channelIdentity.findFirst({
    where: { tenantId: args.tenantId, userId: args.travelerUserId, kind: 'whatsapp' },
    select: { externalUserId: true },
  });
  if (!identity?.externalUserId) {
    return { sent: false, reason: 'no_traveler_channel', channel: 'whatsapp' };
  }

  // Real install wins. In dev mode, if the operator tenant has none,
  // fall back to the Sendero sandbox install — same wire path, the
  // sandbox phone number stamps the `from` field. Production posture
  // is unchanged: missing install → `whatsapp_install_missing`.
  const resolved = await resolveSandboxOutboundInstall(args.tenantId);
  if (!resolved) {
    return { sent: false, reason: 'whatsapp_install_missing', channel: 'whatsapp' };
  }
  const install = resolved.install;

  const accessToken = env.whatsappAccessToken() ?? env.kapsoApiKey();
  const apiBaseUrl =
    env.whatsappApiBaseUrl() ??
    (env.kapsoApiKey() ? `${env.kapsoApiBaseUrl()}/meta/whatsapp/v24.0` : undefined);

  try {
    const result = await sendChannelMessageWhatsApp({
      install,
      recipient: identity.externalUserId,
      message: args.message,
      accessToken: accessToken ?? undefined,
      apiBaseUrl,
    });
    if (result.sent === false) {
      const reason = result.reason;
      return {
        sent: false,
        reason:
          reason === 'access-token-unavailable' ? 'whatsapp_install_missing' : 'unsupported_kind',
        channel: 'whatsapp',
        detail: reason,
      };
    }
    return {
      sent: true,
      channel: 'whatsapp',
      tripId: args.tripId,
      detail: result.response,
    };
  } catch (err) {
    return {
      sent: false,
      reason: 'whatsapp_send_error',
      channel: 'whatsapp',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function dispatchSlack(args: DispatchToTravelerArgs): Promise<DispatchToTravelerResult> {
  // Resolve the traveler's Slack DM target via SlackUserBinding
  // (tenantId + senderoUserId → slackTeamId + slackUserId). The bot
  // token comes from the matching SlackInstall row.
  const binding = await prisma.slackUserBinding.findFirst({
    where: { tenantId: args.tenantId, senderoUserId: args.travelerUserId },
    select: { slackTeamId: true, slackUserId: true },
  });
  if (!binding) {
    return { sent: false, reason: 'no_traveler_channel', channel: 'slack' };
  }

  const install = await prisma.slackInstall.findFirst({
    where: { tenantId: args.tenantId, teamId: binding.slackTeamId, revokedAt: null },
    select: { botToken: true },
  });
  if (!install?.botToken) {
    return { sent: false, reason: 'slack_install_missing', channel: 'slack' };
  }

  try {
    const result = await sendChannelMessageSlack({
      install: { botToken: install.botToken },
      // DMs are addressable by Slack user id — chat.postMessage opens
      // the IM channel implicitly. For thread-anchored sends, callers
      // should pass through the dispatcher's Phase G.5 thread layer
      // when it lands; today every dispatch is a fresh DM.
      channel: binding.slackUserId,
      message: args.message,
    });
    if (result.sent === false) {
      return {
        sent: false,
        reason: 'unsupported_kind',
        channel: 'slack',
        detail: result.reason,
      };
    }
    return {
      sent: true,
      channel: 'slack',
      tripId: args.tripId,
      detail: { channel: result.channel, ts: result.ts },
    };
  } catch (err) {
    return {
      sent: false,
      reason: 'slack_send_error',
      channel: 'slack',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}
