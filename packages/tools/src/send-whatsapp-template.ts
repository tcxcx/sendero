/**
 * `send_whatsapp_template` — agent-callable HSM template send.
 *
 * Used when:
 *   - The traveler is outside Meta's 24-hour customer service window
 *     (free-form would be rejected with `(#131047)`).
 *   - The agent wants a deterministic, branded touch-point: quote
 *     ready, booking confirmed, check-in reminder, action required.
 *
 * Behavior:
 *   - Looks up the registered template by semantic key (`QUOTE_READY`,
 *     `ACTION_REQUIRED`, etc.).
 *   - Resolves the locale from the traveler's identity, falling back
 *     to the template's defaults.
 *   - Builds positional `components` from a `vars` map and dispatches
 *     via the WhatsAppClient (Meta proxy through Kapso when configured).
 *
 * Internal-scope: never exposed to external API keys. The agent calls
 * it on its own when the conversation state demands it.
 */

import { prisma } from '@sendero/database';
import { env } from '@sendero/env';
import {
  buildTemplateComponents,
  resolveTemplateLocale,
  SENDERO_TEMPLATES,
  type SenderoTemplateKey,
  WhatsAppClient,
} from '@sendero/whatsapp';
import { z } from 'zod';

import type { ToolDef } from './types';

const TEMPLATE_KEYS = Object.keys(SENDERO_TEMPLATES) as SenderoTemplateKey[];

const sendWhatsAppTemplateInput = z.object({
  template: z
    .enum(TEMPLATE_KEYS as [SenderoTemplateKey, ...SenderoTemplateKey[]])
    .describe(
      'Semantic template key (TRIP_INVITE, QUOTE_READY, BOOKING_CONFIRMED, ACTION_REQUIRED, CHECKIN_REMINDER, etc.) — see SENDERO_TEMPLATES for the full registry.'
    ),
  vars: z
    .record(z.string())
    .describe(
      "Body/header variables, keyed by name (e.g. { tripSummary: '...', approvalLink: '...' }). Required keys come from the template's bodyVars + headerVars."
    ),
  /** Override traveler locale (BCP-47 e.g. `es-AR`). Defaults to identity locale. */
  locale: z.string().optional(),
  /** Override recipient phone (E.164). Defaults to the active channel identity. */
  toE164: z.string().optional(),
});

interface SendWhatsAppTemplateOutput {
  ok: true;
  templateName: string;
  locale: string;
  recipient: string;
  wamid?: string;
}

export const sendWhatsAppTemplateTool: ToolDef<
  z.infer<typeof sendWhatsAppTemplateInput>,
  SendWhatsAppTemplateOutput
> = {
  name: 'send_whatsapp_template',
  internal: true,
  description:
    "Send a Meta-registered HSM template to the traveler on WhatsApp. Use when the conversation is outside the 24-hour customer service window or when a deterministic, branded touch-point is needed (quote ready, booking confirmed, check-in reminder, action required, etc.). The template is selected by semantic key from Sendero's registry; the agent supplies the body variables.",
  inputSchema: sendWhatsAppTemplateInput,
  jsonSchema: {
    type: 'object',
    required: ['template', 'vars'],
    properties: {
      template: { type: 'string', enum: TEMPLATE_KEYS },
      vars: { type: 'object', additionalProperties: { type: 'string' } },
      locale: { type: 'string' },
      toE164: { type: 'string' },
    },
  },
  async handler(input, ctx) {
    const tenantId = ctx?.traveler?.tenantId;
    if (!tenantId) throw new Error('template_missing_tenant_context');
    const def = SENDERO_TEMPLATES[input.template];
    if (!def) throw new Error(`unknown_template:${input.template}`);

    const accessToken = env.whatsappAccessToken() ?? env.kapsoApiKey();
    if (!accessToken) throw new Error('whatsapp_outbound_not_configured');

    const install = await prisma.whatsAppInstall.findUnique({
      where: { tenantId },
      select: { phoneNumberId: true, status: true },
    });
    if (!install?.phoneNumberId || install.status === 'disabled') {
      throw new Error('whatsapp_install_unavailable');
    }

    const recipient = await resolveRecipient(tenantId, ctx, input.toE164);
    if (!recipient) throw new Error('template_missing_recipient');

    const locale = resolveTemplateLocale(def, input.locale ?? ctx?.traveler?.phone);
    const components = buildTemplateComponents(def, input.vars);

    const baseUrl =
      env.whatsappApiBaseUrl() ??
      (env.kapsoApiKey() ? `${env.kapsoApiBaseUrl()}/meta/whatsapp/v24.0` : undefined);
    const client = new WhatsAppClient({
      phoneNumberId: install.phoneNumberId,
      accessToken,
      apiBaseUrl: baseUrl,
    });

    const result = (await client.sendTemplate({
      to: recipient,
      templateName: def.name,
      languageCode: locale,
      components,
    })) as { messages?: Array<{ id?: string }> };
    const wamid = result?.messages?.[0]?.id;

    return {
      ok: true as const,
      templateName: def.name,
      locale,
      recipient,
      ...(wamid ? { wamid } : {}),
    };
  },
};

async function resolveRecipient(
  tenantId: string,
  ctx: { traveler?: { phone?: string }; channelIdentityId?: string } | undefined,
  override: string | undefined
): Promise<string | null> {
  if (override) return override;
  if (ctx?.traveler?.phone) return ctx.traveler.phone;
  if (ctx?.channelIdentityId) {
    const identity = await prisma.channelIdentity.findUnique({
      where: { id: ctx.channelIdentityId },
      select: { externalUserId: true, tenantId: true },
    });
    if (identity?.tenantId === tenantId && identity.externalUserId) {
      return identity.externalUserId;
    }
  }
  return null;
}
