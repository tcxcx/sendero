/**
 * Slack channel-provisioning tools.
 *
 * Six tools driving the Slack setup wizard end-to-end. Like Kapso's set,
 * they are callable from chat (`run_workflow slack_install`) AND from
 * `/dashboard/channels/slack/connect`.
 *
 *   1. slack_start_oauth_install     — emit the OAuth URL the operator opens
 *   2. slack_check_install           — poll for the SlackInstall row written by the OAuth callback
 *   3. slack_list_workspace_channels — list public + private channels the bot can post to
 *   4. slack_persist_channel_routes  — save defaultChannel + per-event-class routes onto SlackInstall.routing
 *   5. slack_invite_bot_to_channels  — call conversations.invite for the chosen routes
 *   6. slack_send_test_message       — postMessage to the default channel as proof-of-life
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import { prisma } from '@sendero/database';
import { env } from '@sendero/env';
import { buildInstallUrl, createSlackClient, DEFAULT_BOT_SCOPES } from '@sendero/slack';

import type { ToolDef } from './types';

const STATE_TTL_MS = 10 * 60 * 1000;
const SLACK_OAUTH_REDIRECT_PATH = '/api/webhooks/slack/oauth-callback';

function slackStateSecret(): string {
  return (
    env.slackStateSecret() ?? process.env.CLERK_SECRET_KEY ?? 'sendero-slack-state-local-dev-secret'
  );
}

/**
 * Mirror of apps/app/lib/slack-oauth-state.ts so this tool stays in
 * @sendero/tools (no apps/ imports) but the signature format matches —
 * the OAuth callback verifier reads the same secret + payload shape.
 */
function signState(tenantId: string): string {
  const payload = { tenantId, exp: Date.now() + STATE_TTL_MS };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', slackStateSecret()).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function appBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ?? env.kapsoWebhookBaseUrl() ?? 'https://app.sendero.travel'
  );
}

// ─── slack_start_oauth_install ───────────────────────────────────────

const startInstallInput = z.object({
  tenantId: z.string().min(1),
  /** Set true for Enterprise Grid org-level installs. */
  orgInstall: z.boolean().optional(),
});

export const slackStartOauthInstallTool: ToolDef<
  z.infer<typeof startInstallInput>,
  { installUrl: string; expiresAt: string; configured: boolean }
> = {
  name: 'slack_start_oauth_install',
  internal: true,
  description:
    "Generate the Slack OAuth URL the operator opens to install Sendero into their workspace. State is HMAC-signed with a 10-minute TTL bound to the tenantId so the install can't be CSRF'd to the wrong tenant. Returns `configured: false` if SLACK_CLIENT_ID is missing — the wizard surfaces a setup hint in that case.",
  inputSchema: startInstallInput,
  jsonSchema: {
    type: 'object',
    required: ['tenantId'],
    properties: {
      tenantId: { type: 'string' },
      orgInstall: { type: 'boolean' },
    },
  },
  async handler(input) {
    const clientId = env.slackClientId();
    if (!clientId) {
      return {
        installUrl: '',
        expiresAt: new Date().toISOString(),
        configured: false,
      };
    }
    const url = buildInstallUrl({
      clientId,
      scopes: DEFAULT_BOT_SCOPES,
      redirectUri: `${appBaseUrl()}${SLACK_OAUTH_REDIRECT_PATH}`,
      state: signState(input.tenantId),
      orgInstall: input.orgInstall ?? false,
    });
    return {
      installUrl: url,
      expiresAt: new Date(Date.now() + STATE_TTL_MS).toISOString(),
      configured: true,
    };
  },
};

// ─── slack_check_install ─────────────────────────────────────────────

const checkInstallInput = z.object({
  tenantId: z.string().min(1),
});

interface SlackInstallSummary {
  installId: string;
  teamId: string;
  teamName: string;
  enterpriseId: string | null;
  enterpriseName: string | null;
  isEnterpriseInstall: boolean;
  installedAt: string;
  scopeCount: number;
}

export const slackCheckInstallTool: ToolDef<
  z.infer<typeof checkInstallInput>,
  { installed: boolean; installs: SlackInstallSummary[] }
> = {
  name: 'slack_check_install',
  internal: true,
  description:
    'Check whether the OAuth callback has persisted a SlackInstall row for the tenant. The wizard polls this between rendering the OAuth link and the next step. Returns one entry per install (Grid customers can have many).',
  inputSchema: checkInstallInput,
  jsonSchema: {
    type: 'object',
    required: ['tenantId'],
    properties: { tenantId: { type: 'string' } },
  },
  async handler(input) {
    const rows = await prisma.slackInstall.findMany({
      where: { tenantId: input.tenantId },
      orderBy: { installedAt: 'desc' },
      select: {
        id: true,
        teamId: true,
        teamName: true,
        enterpriseId: true,
        enterpriseName: true,
        isEnterpriseInstall: true,
        installedAt: true,
        scope: true,
      },
    });
    return {
      installed: rows.length > 0,
      installs: rows.map(r => ({
        installId: r.id,
        teamId: r.teamId,
        teamName: r.teamName,
        enterpriseId: r.enterpriseId,
        enterpriseName: r.enterpriseName,
        isEnterpriseInstall: r.isEnterpriseInstall,
        installedAt: r.installedAt.toISOString(),
        scopeCount: r.scope ? r.scope.split(',').filter(Boolean).length : 0,
      })),
    };
  },
};

// ─── slack_list_workspace_channels ───────────────────────────────────

const listChannelsInput = z.object({
  installId: z.string().min(1),
  /** When `false`, omit private (group) channels — bot needs the right scope to see them. */
  includePrivate: z.boolean().optional(),
  cursor: z.string().optional(),
});

interface SlackChannelSummary {
  id: string;
  name: string;
  isPrivate: boolean;
  isMember: boolean;
  numMembers: number | null;
  topic: string | null;
}

export const slackListWorkspaceChannelsTool: ToolDef<
  z.infer<typeof listChannelsInput>,
  { channels: SlackChannelSummary[]; nextCursor: string | null }
> = {
  name: 'slack_list_workspace_channels',
  internal: true,
  description:
    'List public (and optionally private) channels in the installed Slack workspace. The wizard renders this as the source list when the operator picks a default channel and per-event-class routes.',
  inputSchema: listChannelsInput,
  jsonSchema: {
    type: 'object',
    required: ['installId'],
    properties: {
      installId: { type: 'string' },
      includePrivate: { type: 'boolean' },
      cursor: { type: 'string' },
    },
  },
  async handler(input) {
    const install = await prisma.slackInstall.findUnique({
      where: { id: input.installId },
      select: { botToken: true },
    });
    if (!install) throw new Error('slack_install_not_found');

    const client = createSlackClient(install.botToken);
    const types = input.includePrivate ? 'public_channel,private_channel' : 'public_channel';
    const res = await client.conversations.list({
      exclude_archived: true,
      limit: 200,
      types,
      cursor: input.cursor,
    });
    const channels = (res.channels ?? []).map(c => ({
      id: c.id ?? '',
      name: c.name ?? '',
      isPrivate: Boolean(c.is_private),
      isMember: Boolean(c.is_member),
      numMembers: typeof c.num_members === 'number' ? c.num_members : null,
      topic: c.topic?.value ?? null,
    }));
    return {
      channels,
      nextCursor: res.response_metadata?.next_cursor || null,
    };
  },
};

// ─── slack_persist_channel_routes ────────────────────────────────────

export const SLACK_EVENT_CLASSES = [
  'trip_events',
  'settlements',
  'cap_warnings',
  'escalations',
  'silent',
] as const;

const routeShape = z.object({
  eventClass: z.enum(SLACK_EVENT_CLASSES),
  channelId: z.string(),
  /** 'route' = relay, 'filter' = relay only matching events, 'silent' = no posts. */
  mode: z.enum(['route', 'filter', 'silent']),
});

const persistRoutesInput = z.object({
  installId: z.string().min(1),
  defaultChannelId: z.string().min(1),
  routes: z.array(routeShape).min(1),
});

export const slackPersistChannelRoutesTool: ToolDef<
  z.infer<typeof persistRoutesInput>,
  { ok: true; routeCount: number }
> = {
  name: 'slack_persist_channel_routes',
  internal: true,
  description:
    "Save the wizard's channel routing decisions onto SlackInstall.routing — the channel-event dispatcher reads this column at runtime to decide where to post each event class (trip_events, settlements, cap_warnings, escalations, silent). Idempotent: re-saving overwrites prior routes.",
  inputSchema: persistRoutesInput,
  jsonSchema: {
    type: 'object',
    required: ['installId', 'defaultChannelId', 'routes'],
    properties: {
      installId: { type: 'string' },
      defaultChannelId: { type: 'string' },
      routes: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          required: ['eventClass', 'channelId', 'mode'],
          properties: {
            eventClass: { type: 'string', enum: [...SLACK_EVENT_CLASSES] },
            channelId: { type: 'string' },
            mode: { type: 'string', enum: ['route', 'filter', 'silent'] },
          },
        },
      },
    },
  },
  async handler(input) {
    await prisma.slackInstall.update({
      where: { id: input.installId },
      data: {
        routing: {
          defaultChannel: input.defaultChannelId,
          routes: input.routes,
          updatedAt: new Date().toISOString(),
        },
      },
    });
    return { ok: true, routeCount: input.routes.length };
  },
};

// ─── slack_invite_bot_to_channels ────────────────────────────────────

const inviteInput = z.object({
  installId: z.string().min(1),
  channelIds: z.array(z.string()).min(1),
});

export const slackInviteBotToChannelsTool: ToolDef<
  z.infer<typeof inviteInput>,
  { invited: string[]; alreadyIn: string[]; failed: Array<{ channelId: string; reason: string }> }
> = {
  name: 'slack_invite_bot_to_channels',
  internal: true,
  description:
    "Add the Sendero bot to each channel it needs to post into. The wizard runs this for every channel referenced in `slack_persist_channel_routes` so the bot doesn't hit not_in_channel on first event. Errors are returned per-channel so the wizard can surface them without aborting the rest.",
  inputSchema: inviteInput,
  jsonSchema: {
    type: 'object',
    required: ['installId', 'channelIds'],
    properties: {
      installId: { type: 'string' },
      channelIds: { type: 'array', items: { type: 'string' }, minItems: 1 },
    },
  },
  async handler(input) {
    const install = await prisma.slackInstall.findUnique({
      where: { id: input.installId },
      select: { botToken: true, botUserId: true },
    });
    if (!install) throw new Error('slack_install_not_found');

    const client = createSlackClient(install.botToken);
    const invited: string[] = [];
    const alreadyIn: string[] = [];
    const failed: Array<{ channelId: string; reason: string }> = [];

    for (const channelId of input.channelIds) {
      try {
        await client.conversations.invite({
          channel: channelId,
          users: install.botUserId,
        });
        invited.push(channelId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('already_in_channel')) {
          alreadyIn.push(channelId);
        } else {
          failed.push({ channelId, reason: message });
        }
      }
    }
    return { invited, alreadyIn, failed };
  },
};

// ─── slack_send_test_message ─────────────────────────────────────────

const sendTestInput = z.object({
  installId: z.string().min(1),
  channelId: z.string().min(1),
  text: z
    .string()
    .min(1)
    .max(2000)
    .default(
      "🌅 Sendero is connected. I'll post trip events, settlements, and cap warnings here per your routing rules."
    ),
});

export const slackSendTestMessageTool: ToolDef<
  z.infer<typeof sendTestInput>,
  { ok: true; ts: string }
> = {
  name: 'slack_send_test_message',
  internal: true,
  description:
    "Send a one-off proof-of-life message to a Slack channel. The wizard's last step uses this to confirm the bot can actually post and the operator sees it land.",
  inputSchema: sendTestInput,
  jsonSchema: {
    type: 'object',
    required: ['installId', 'channelId'],
    properties: {
      installId: { type: 'string' },
      channelId: { type: 'string' },
      text: { type: 'string', minLength: 1, maxLength: 2000 },
    },
  },
  async handler(input) {
    const install = await prisma.slackInstall.findUnique({
      where: { id: input.installId },
      select: { botToken: true },
    });
    if (!install) throw new Error('slack_install_not_found');
    const client = createSlackClient(install.botToken);
    const res = await client.chat.postMessage({
      channel: input.channelId,
      text: input.text,
    });
    if (!res.ok || !res.ts) {
      throw new Error(`slack_post_failed: ${res.error ?? 'unknown'}`);
    }
    return { ok: true, ts: res.ts };
  },
};

/** Exported for completeness — the OAuth callback verifier in apps/lib uses the same algorithm. */
export const _slackOauthInternals = { signState, constantTimeEqual };
