/**
 * `create_passenger` — minimum-viable passenger (User row) creation
 * for inbox testing.
 *
 * Why this exists: the operator needs to seed traveler rows from chat
 * without leaving the console. Bookings, prefund flows, and the
 * MetaInbox trip rail all key off `User`, so a one-shot creator
 * unblocks everything downstream.
 *
 * Channel binding is OPTIONAL. The agent may know the email and the
 * traveler name but not yet the WhatsApp / Slack handle — that's
 * fine, the row gets created with no `ChannelIdentity`. A subsequent
 * durable workflow turn can ask the user for their phone (WhatsApp)
 * or Slack member id and call this tool again with the same email
 * to attach the channel — the upsert is keyed on email, so re-runs
 * never duplicate users.
 *
 * Public, tenant-scoped. Creates rows under the operator's tenant
 * (resolved server-side via `ctx.traveler.tenantId`); the LLM never
 * passes tenantId.
 */

import { z } from 'zod';

import { prisma } from '@sendero/database';

import type { ToolDef } from './types';

const channelEnum = z.enum(['whatsapp', 'slack', 'unassigned']);

const inputSchema = z.object({
  email: z.string().email().describe('Required. Primary identity for the passenger row.'),
  displayName: z
    .string()
    .min(1)
    .max(120)
    .optional()
    .describe('Full name as it should appear on bookings.'),
  phone: z
    .string()
    .min(4)
    .max(32)
    .optional()
    .describe(
      'E.164 phone (e.g. +14155550100). Optional — the agent can ask later in a follow-up turn.'
    ),
  channel: channelEnum
    .default('unassigned')
    .describe(
      "Initial channel binding. 'whatsapp' or 'slack' attaches a ChannelIdentity row using the supplied externalUserId. 'unassigned' (default) creates the User with no channel — the agent can attach one later via a follow-up call."
    ),
  externalUserId: z
    .string()
    .min(1)
    .max(120)
    .optional()
    .describe(
      'Channel-side identifier. WhatsApp: E.164 phone. Slack: workspace member id (Uxxx…). Required when channel is whatsapp or slack; ignored when unassigned.'
    ),
  metadata: z
    .record(z.string(), z.any())
    .optional()
    .describe('Free-form metadata (preferred language, timezone hints, etc.).'),
});

type Input = z.infer<typeof inputSchema>;

interface CreatePassengerResult {
  ok: true;
  /** Sendero `User.id` — primary key. */
  userId: string;
  email: string;
  displayName: string | null;
  phone: string | null;
  /** True when this call inserted a new row, false on email-match cache hit. */
  isNew: boolean;
  channel: 'whatsapp' | 'slack' | 'unassigned';
  channelIdentityId: string | null;
  /**
   * Suggested next-turn prompt for the agent. Reminds it to ask for
   * the missing channel binding so the inbox can route messages.
   */
  followUp: string | null;
}

export const createPassengerTool: ToolDef<Input, CreatePassengerResult> = {
  name: 'create_passenger',
  description:
    'Create a passenger (traveler User row) for inbox testing. Email is required; phone and channel binding are optional — the agent can ask for them in a follow-up turn. Idempotent on email: re-running with the same email updates name/phone and (re-)attaches the channel identity.',
  internal: false,
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['email'],
    properties: {
      email: { type: 'string', format: 'email' },
      displayName: { type: 'string', minLength: 1, maxLength: 120 },
      phone: { type: 'string', minLength: 4, maxLength: 32 },
      channel: {
        type: 'string',
        description:
          'Initial channel binding. whatsapp/slack attaches a ChannelIdentity using externalUserId; unassigned (default) skips the binding so the agent can attach one later.',
        enum: ['whatsapp', 'slack', 'unassigned'],
      },
      externalUserId: {
        type: 'string',
        description:
          'WhatsApp E.164 phone or Slack member id. Required when channel is whatsapp or slack.',
        minLength: 1,
        maxLength: 120,
      },
      metadata: { type: 'object' },
    },
  },
  async handler(input, ctx) {
    const tenantId = ctx?.traveler?.tenantId;
    if (!tenantId) {
      throw new Error(
        'create_passenger requires a tenant context. Sign in as an operator (Clerk org) or set ctx.traveler.tenantId.'
      );
    }

    const channel = input.channel ?? 'unassigned';
    if (channel !== 'unassigned' && !input.externalUserId) {
      throw new Error(
        `create_passenger: channel='${channel}' requires externalUserId (WhatsApp E.164 phone or Slack member id).`
      );
    }
    const slackInstall =
      channel === 'slack'
        ? await prisma.slackInstall.findFirst({
            where: { tenantId, revokedAt: null },
            orderBy: { installedAt: 'desc' },
            select: { teamId: true },
          })
        : null;
    if (channel === 'slack' && !slackInstall) {
      throw new Error(
        'create_passenger: cannot attach Slack because this tenant has no active Slack install.'
      );
    }

    // Idempotent on email — User.email is UNIQUE. Update the optional
    // fields if a row already exists; otherwise insert.
    const existing = await prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true, displayName: true, phone: true },
    });

    let userId: string;
    let isNew = false;
    if (existing) {
      userId = existing.id;
      const patch: { displayName?: string; phone?: string } = {};
      if (input.displayName && input.displayName !== existing.displayName)
        patch.displayName = input.displayName;
      if (input.phone && input.phone !== existing.phone) patch.phone = input.phone;
      if (Object.keys(patch).length > 0) {
        await prisma.user.update({ where: { id: userId }, data: patch });
      }
    } else {
      const created = await prisma.user.create({
        data: {
          email: input.email,
          displayName: input.displayName ?? null,
          phone: input.phone ?? null,
          // 'guest' is the closest provenance match for an
          // operator-seeded row that hasn't claimed via Clerk yet.
          source: 'guest',
          metadata: input.metadata ?? undefined,
        },
        select: { id: true },
      });
      userId = created.id;
      isNew = true;
    }

    // Attach channel identity when the operator supplied one. Upsert
    // on (tenantId, kind, externalUserId) — re-runs reattach to the
    // same User instead of duplicating.
    let channelIdentityId: string | null = null;
    if (channel !== 'unassigned' && input.externalUserId) {
      const ci = await prisma.channelIdentity.upsert({
        where: {
          tenantId_kind_externalUserId: {
            tenantId,
            kind: channel,
            externalUserId: input.externalUserId,
          },
        },
        create: {
          tenantId,
          kind: channel,
          externalUserId: input.externalUserId,
          userId,
        },
        update: { userId },
        select: { id: true },
      });
      channelIdentityId = ci.id;
      if (channel === 'slack' && slackInstall) {
        await prisma.slackUserBinding.upsert({
          where: {
            tenantId_slackTeamId_slackUserId: {
              tenantId,
              slackTeamId: slackInstall.teamId,
              slackUserId: input.externalUserId,
            },
          },
          create: {
            tenantId,
            slackTeamId: slackInstall.teamId,
            slackUserId: input.externalUserId,
            senderoUserId: userId,
            email: input.email,
          },
          update: {
            senderoUserId: userId,
            email: input.email,
          },
        });
      }
    }

    const followUp =
      channel === 'unassigned'
        ? `Ask ${input.displayName ?? input.email} which channel they'd like to use (WhatsApp or Slack), then call create_passenger again with the same email and the channel + externalUserId.`
        : !input.phone && channel === 'whatsapp'
          ? `Confirm the WhatsApp E.164 phone number with the traveler before sending the first message.`
          : null;

    return {
      ok: true,
      userId,
      email: input.email,
      displayName: input.displayName ?? existing?.displayName ?? null,
      phone: input.phone ?? existing?.phone ?? null,
      isNew,
      channel,
      channelIdentityId,
      followUp,
    };
  },
};
