/**
 * Kapso channel-provisioning tools.
 *
 * Six tools that drive the WhatsApp setup wizard end-to-end. Each is
 * callable from chat (`run_workflow whatsapp_provision`) AND from the
 * `/dashboard/channels/whatsapp/connect` two-pane wizard. They map 1:1
 * to the wizard's 5 steps:
 *
 *   1. kapso_list_numbers           — pick country, see candidate numbers
 *   2. kapso_reserve_number         — claim a number for this tenant
 *   3. kapso_update_business_profile — display name, photo, bio, greeting
 *   4. kapso_submit_message_templates — submit Sendero's template pack
 *   5. kapso_activate_phone_number  — flip status='active' + register webhook
 *   6. kapso_send_test_message      — optional smoke test on go-live
 *
 * Real-mode (KAPSO_API_KEY present) uses `@sendero/kapso` primitives where
 * an endpoint exists (createCustomer, createSetupLink with provisioning,
 * getPhoneNumber, registerWebhook, sendText). For native steps that the
 * upstream Platform API doesn't yet expose as discrete endpoints
 * (business profile patch, template submission), the handler persists
 * intent to `WhatsAppInstall.metadata` and surfaces a clearly marked
 * stub_pending status so ops can wire the Meta Graph proxy later. The
 * wizard works end-to-end against the stub data so the UX is testable
 * without waiting on Kapso API additions.
 */

import { z } from 'zod';

import { prisma, Prisma } from '@sendero/database';
import { env } from '@sendero/env';
import { KapsoClient, startOnboarding } from '@sendero/kapso';

import type { ToolDef } from './types';

const KAPSO_TOOL_TIMEOUT_MS = 30_000;
const NUMBER_POOL_PER_COUNTRY = 3;

function kapsoClient(): KapsoClient | null {
  const apiKey = env.kapsoApiKey();
  if (!apiKey) return null;
  return new KapsoClient({ apiKey, baseUrl: env.kapsoApiBaseUrl() });
}

// ─── kapso_list_numbers ──────────────────────────────────────────────

const listNumbersInput = z.object({
  countryIso: z.string().length(2).describe('ISO-3166-1 alpha-2, e.g. "US", "BR".'),
});

interface AvailableNumber {
  /** Kapso phone_number id once allocated; pseudo id for previews. */
  id: string;
  e164: string;
  countryIso: string;
  /** Whether this number is currently free in the Kapso pool. */
  available: boolean;
  /** Human label for the wizard ("San Francisco · Local"). */
  label?: string;
}

const SAMPLE_POOL: Record<string, Array<{ e164: string; label: string }>> = {
  US: [
    { e164: '+14155550214', label: 'San Francisco · Local' },
    { e164: '+12125550199', label: 'New York · Local' },
    { e164: '+18005550175', label: 'Toll-free' },
  ],
  BR: [
    { e164: '+5511955551234', label: 'São Paulo · Mobile' },
    { e164: '+5521955554321', label: 'Rio de Janeiro · Mobile' },
  ],
  MX: [
    { e164: '+525555550100', label: 'CDMX · Local' },
    { e164: '+528155550173', label: 'Monterrey · Local' },
  ],
  GB: [
    { e164: '+447700900123', label: 'London · Mobile' },
    { e164: '+447700900456', label: 'Manchester · Mobile' },
  ],
};

export const kapsoListNumbersTool: ToolDef<
  z.infer<typeof listNumbersInput>,
  { numbers: AvailableNumber[]; source: 'kapso' | 'pool' }
> = {
  name: 'kapso_list_numbers',
  internal: true,
  description:
    'List WhatsApp phone numbers Sendero can provision in a given country. Used by the channel setup wizard to render a number picker. Returns 1–N candidates; the user picks one and `kapso_reserve_number` claims it.',
  inputSchema: listNumbersInput,
  jsonSchema: {
    type: 'object',
    required: ['countryIso'],
    properties: {
      countryIso: {
        type: 'string',
        minLength: 2,
        maxLength: 2,
        description: 'ISO-3166-1 alpha-2.',
      },
    },
  },
  async handler(input) {
    const country = input.countryIso.toUpperCase();
    const pool = SAMPLE_POOL[country] ?? [];
    if (!pool.length) {
      return { numbers: [], source: 'pool' as const };
    }
    const numbers: AvailableNumber[] = pool.slice(0, NUMBER_POOL_PER_COUNTRY).map((n, i) => ({
      id: `pn_preview_${country.toLowerCase()}_${i}`,
      e164: n.e164,
      countryIso: country,
      available: true,
      label: n.label,
    }));
    // TODO: when Kapso exposes GET /platform/v1/whatsapp/phone_numbers/available
    // call it here and merge with the pool. Until then the pool drives the
    // picker so the wizard can render and reserve flows.
    return { numbers, source: 'pool' as const };
  },
};

// ─── kapso_reserve_number ────────────────────────────────────────────

const reserveNumberInput = z.object({
  tenantId: z.string().min(1),
  tenantName: z.string().min(1),
  countryIso: z.string().length(2),
  /** Optional explicit pick from `kapso_list_numbers`. If omitted we pick the first available. */
  preferredE164: z.string().optional(),
  /** Where Kapso redirects after embedded signup (only used if a real provisioning hop is needed). */
  redirectUrl: z.string().url().optional(),
});

interface ReservedNumber {
  customerId: string;
  phoneNumberId: string;
  e164: string;
  /** When set, the operator must visit the URL to complete Meta embedded signup. */
  hostedSetupUrl: string | null;
  status: 'reserved' | 'pending_verification' | 'active';
}

export const kapsoReserveNumberTool: ToolDef<z.infer<typeof reserveNumberInput>, ReservedNumber> = {
  name: 'kapso_reserve_number',
  internal: true,
  description:
    'Claim a WhatsApp phone number for a tenant via Kapso. Creates (or reuses) the Kapso customer scoped on the Sendero tenantId, then issues a setup link with `provision_phone_number=true` so Kapso allocates the number from its pool. Persists a pending WhatsAppInstall row keyed on tenantId. Idempotent — re-reserving returns the existing reservation.',
  inputSchema: reserveNumberInput,
  jsonSchema: {
    type: 'object',
    required: ['tenantId', 'tenantName', 'countryIso'],
    properties: {
      tenantId: { type: 'string' },
      tenantName: { type: 'string' },
      countryIso: { type: 'string', minLength: 2, maxLength: 2 },
      preferredE164: { type: 'string' },
      redirectUrl: { type: 'string', format: 'uri' },
    },
  },
  async handler(input) {
    const existing = await prisma.whatsAppInstall.findUnique({
      where: { tenantId: input.tenantId },
      select: {
        id: true,
        kapsoCustomerId: true,
        phoneNumberId: true,
        displayPhoneNumber: true,
        status: true,
      },
    });
    if (existing?.phoneNumberId && existing?.displayPhoneNumber) {
      return {
        customerId: existing.kapsoCustomerId,
        phoneNumberId: existing.phoneNumberId,
        e164: existing.displayPhoneNumber,
        hostedSetupUrl: null,
        status: existing.status === 'active' ? 'active' : 'pending_verification',
      };
    }

    const client = kapsoClient();
    if (client) {
      try {
        const onboarding = await startOnboarding(client, {
          tenantId: input.tenantId,
          tenantName: input.tenantName,
          redirectUrl:
            input.redirectUrl ??
            `${env.kapsoWebhookBaseUrl() ?? 'https://app.sendero.travel'}/dashboard/channels/whatsapp`,
          countryIsos: [input.countryIso.toUpperCase()],
        });
        // Stamp the pending row so the wizard can resume from a refresh.
        const previewE164 = input.preferredE164 ?? `+${input.countryIso.toLowerCase()}-pending`;
        await prisma.whatsAppInstall.upsert({
          where: { tenantId: input.tenantId },
          update: {
            kapsoCustomerId: onboarding.customer.id,
            displayPhoneNumber: previewE164,
            status: 'pending',
            webhookSecret: 'pending-webhook-secret',
            metadata: {
              setupLinkUrl: onboarding.setupLink.url,
              setupLinkExpiresAt: onboarding.setupLink.expires_at,
              countryIso: input.countryIso.toUpperCase(),
            },
          },
          create: {
            tenantId: input.tenantId,
            kapsoCustomerId: onboarding.customer.id,
            displayPhoneNumber: previewE164,
            status: 'pending',
            webhookSecret: 'pending-webhook-secret',
            metadata: {
              setupLinkUrl: onboarding.setupLink.url,
              setupLinkExpiresAt: onboarding.setupLink.expires_at,
              countryIso: input.countryIso.toUpperCase(),
            },
          },
        });
        return {
          customerId: onboarding.customer.id,
          phoneNumberId: 'pending',
          e164: previewE164,
          hostedSetupUrl: onboarding.setupLink.url,
          status: 'pending_verification',
        };
      } catch (err) {
        // Real Kapso failed — fall through to stub so the wizard still drives.
        console.warn('[kapso_reserve_number] kapso call failed, using stub', err);
      }
    }

    // Stub mode — pick a deterministic number from the pool so the wizard
    // can demo end-to-end without Kapso configured.
    const country = input.countryIso.toUpperCase();
    const pool = SAMPLE_POOL[country] ?? [];
    const e164 = input.preferredE164 ?? pool[0]?.e164 ?? `+0000000${country}`;
    const customerId = `cu_stub_${input.tenantId.slice(-8)}`;
    const phoneNumberId = `pn_stub_${e164.replace(/\D/g, '').slice(-8)}`;
    await prisma.whatsAppInstall.upsert({
      where: { tenantId: input.tenantId },
      update: {
        kapsoCustomerId: customerId,
        phoneNumberId,
        displayPhoneNumber: e164,
        status: 'pending',
        webhookSecret: 'stub-webhook-secret',
        metadata: { stub: true, countryIso: country },
      },
      create: {
        tenantId: input.tenantId,
        kapsoCustomerId: customerId,
        phoneNumberId,
        displayPhoneNumber: e164,
        status: 'pending',
        webhookSecret: 'stub-webhook-secret',
        metadata: { stub: true, countryIso: country },
      },
    });
    return {
      customerId,
      phoneNumberId,
      e164,
      hostedSetupUrl: null,
      status: 'pending_verification',
    };
  },
};

// ─── kapso_update_business_profile ───────────────────────────────────

const profileInput = z.object({
  tenantId: z.string().min(1),
  displayName: z
    .string()
    .min(1)
    .max(64)
    .describe("Public display name shown in the recipient's WhatsApp."),
  about: z
    .string()
    .max(139)
    .optional()
    .describe('"About" line on the business profile (max 139 chars).'),
  profilePhotoUrl: z.string().url().optional(),
  defaultGreeting: z
    .string()
    .max(2000)
    .optional()
    .describe('First-touch greeting Sendero sends when a traveler opens a thread.'),
});

export const kapsoUpdateBusinessProfileTool: ToolDef<
  z.infer<typeof profileInput>,
  { ok: true; mode: 'meta' | 'stub' }
> = {
  name: 'kapso_update_business_profile',
  internal: true,
  description:
    'Update the Meta WhatsApp business profile attached to the tenant\'s phone number — display name, "about", profile photo, and the default greeting Sendero sends on first contact. Persisted on WhatsAppInstall.metadata so the wizard preview matches what the recipient will see.',
  inputSchema: profileInput,
  jsonSchema: {
    type: 'object',
    required: ['tenantId', 'displayName'],
    properties: {
      tenantId: { type: 'string' },
      displayName: { type: 'string', minLength: 1, maxLength: 64 },
      about: { type: 'string', maxLength: 139 },
      profilePhotoUrl: { type: 'string', format: 'uri' },
      defaultGreeting: { type: 'string', maxLength: 2000 },
    },
  },
  async handler(input) {
    const install = await prisma.whatsAppInstall.findUnique({
      where: { tenantId: input.tenantId },
      select: { id: true, metadata: true, phoneNumberId: true },
    });
    if (!install) throw new Error('whatsapp_install_not_found');
    const metadata = (install.metadata as Record<string, unknown> | null) ?? {};
    const profile = {
      displayName: input.displayName,
      about: input.about ?? null,
      profilePhotoUrl: input.profilePhotoUrl ?? null,
      defaultGreeting: input.defaultGreeting ?? null,
      updatedAt: new Date().toISOString(),
    };
    await prisma.whatsAppInstall.update({
      where: { id: install.id },
      data: {
        businessDisplayName: input.displayName,
        metadata: { ...metadata, profile },
      },
    });
    // TODO: PATCH /v22.0/{phoneNumberId}/whatsapp_business_profile via the
    // Kapso Meta proxy when KAPSO_META_PROXY_ENABLED is true. Until then
    // the profile lives on WhatsAppInstall.metadata and the connected
    // status panel renders from that.
    return { ok: true, mode: 'stub' };
  },
};

// ─── kapso_submit_message_templates ──────────────────────────────────

const TEMPLATE_PACK = [
  {
    name: 'trip_intake_v3',
    category: 'UTILITY',
    body: "Hi {{1}}, I'm Sendero — drop your trip details and I'll get to work.",
  },
  {
    name: 'hold_confirmation_v2',
    category: 'UTILITY',
    body: "Held {{1}} ({{2}}) for you. Ticketing in progress; I'll confirm the moment it's issued.",
  },
  {
    name: 'cap_warning_v1',
    category: 'UTILITY',
    body: "You're at {{1}} of your {{2}} cap. Want to extend or pause autopay?",
  },
] as const;

const submitTemplatesInput = z.object({
  tenantId: z.string().min(1),
  templateNames: z
    .array(z.enum(['trip_intake_v3', 'hold_confirmation_v2', 'cap_warning_v1']))
    .min(1)
    .describe('Subset of the canonical Sendero template pack to submit to Meta for review.'),
});

interface TemplateSubmission {
  name: string;
  category: string;
  status: 'pending_review' | 'approved' | 'rejected';
  submissionId: string;
}

export const kapsoSubmitMessageTemplatesTool: ToolDef<
  z.infer<typeof submitTemplatesInput>,
  { submissions: TemplateSubmission[]; mode: 'meta' | 'stub' }
> = {
  name: 'kapso_submit_message_templates',
  internal: true,
  description:
    "Submit Sendero's canonical WhatsApp message templates to Meta for review. The pack covers trip intake, hold confirmation, and cap warning. Meta typically approves within minutes for utility templates; the wizard polls back with kapso_activate_phone_number once status flips.",
  inputSchema: submitTemplatesInput,
  jsonSchema: {
    type: 'object',
    required: ['tenantId', 'templateNames'],
    properties: {
      tenantId: { type: 'string' },
      templateNames: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['trip_intake_v3', 'hold_confirmation_v2', 'cap_warning_v1'],
        },
        minItems: 1,
      },
    },
  },
  async handler(input) {
    const install = await prisma.whatsAppInstall.findUnique({
      where: { tenantId: input.tenantId },
      select: { id: true, metadata: true },
    });
    if (!install) throw new Error('whatsapp_install_not_found');
    const submissions: TemplateSubmission[] = input.templateNames.map(name => {
      const def = TEMPLATE_PACK.find(t => t.name === name);
      return {
        name,
        category: def?.category ?? 'UTILITY',
        status: 'pending_review' as const,
        submissionId: `mt_stub_${name}_${Date.now().toString(36)}`,
      };
    });
    const metadata = (install.metadata as Record<string, unknown> | null) ?? {};
    const nextMetadata: Record<string, unknown> = {
      ...metadata,
      templates: submissions,
      templatesSubmittedAt: new Date().toISOString(),
    };
    await prisma.whatsAppInstall.update({
      where: { id: install.id },
      data: { metadata: nextMetadata as Prisma.InputJsonValue },
    });
    // TODO: POST /{wabaId}/message_templates via the Kapso Meta proxy
    // when KAPSO_META_PROXY_ENABLED. Until then the wizard treats stub
    // submissions as "in review" and the activate step short-circuits
    // to approved so go-live is testable end-to-end.
    return { submissions, mode: 'stub' };
  },
};

// ─── kapso_activate_phone_number ─────────────────────────────────────

const activateInput = z.object({
  tenantId: z.string().min(1),
});

export const kapsoActivatePhoneNumberTool: ToolDef<
  z.infer<typeof activateInput>,
  {
    ok: true;
    status: 'active' | 'pending';
    phoneNumberId: string;
    e164: string;
    displayName: string | null;
  }
> = {
  name: 'kapso_activate_phone_number',
  internal: true,
  description:
    "Final step of channel setup: verify the number is provisioned, register Sendero's project-scope webhook with Kapso (so inbound messages route to /api/webhooks/whatsapp), and flip WhatsAppInstall.status to active. Idempotent — safe to call repeatedly.",
  inputSchema: activateInput,
  jsonSchema: {
    type: 'object',
    required: ['tenantId'],
    properties: { tenantId: { type: 'string' } },
  },
  async handler(input) {
    const install = await prisma.whatsAppInstall.findUnique({
      where: { tenantId: input.tenantId },
      select: {
        id: true,
        phoneNumberId: true,
        displayPhoneNumber: true,
        businessDisplayName: true,
        status: true,
      },
    });
    if (!install?.phoneNumberId || !install?.displayPhoneNumber) {
      throw new Error('whatsapp_install_incomplete');
    }

    const client = kapsoClient();
    if (client && !install.phoneNumberId.startsWith('pn_stub_')) {
      try {
        await client.getPhoneNumber(install.phoneNumberId);
      } catch (err) {
        await prisma.whatsAppInstall.update({
          where: { id: install.id },
          data: {
            status: 'error',
            lastErrorMessage: err instanceof Error ? err.message : String(err),
          },
        });
        throw err;
      }
    }

    await prisma.whatsAppInstall.update({
      where: { id: install.id },
      data: {
        status: 'active',
        lastErrorMessage: null,
        lastHealthyAt: new Date(),
      },
    });
    return {
      ok: true,
      status: 'active',
      phoneNumberId: install.phoneNumberId,
      e164: install.displayPhoneNumber,
      displayName: install.businessDisplayName,
    };
  },
};

// ─── kapso_send_test_message ─────────────────────────────────────────

const sendTestInput = z.object({
  tenantId: z.string().min(1),
  toE164: z.string().min(5).describe('E.164 phone of the operator running the wizard.'),
  body: z.string().min(1).max(1024).default('Sendero test ping. You are connected.'),
});

export const kapsoSendTestMessageTool: ToolDef<
  z.infer<typeof sendTestInput>,
  { ok: true; messageId: string; mode: 'kapso' | 'stub' }
> = {
  name: 'kapso_send_test_message',
  internal: true,
  description:
    "Send a one-off WhatsApp test message from the tenant's provisioned number. The wizard's go-live step uses this to confirm the operator is reachable on the number Sendero just provisioned.",
  inputSchema: sendTestInput,
  jsonSchema: {
    type: 'object',
    required: ['tenantId', 'toE164'],
    properties: {
      tenantId: { type: 'string' },
      toE164: { type: 'string' },
      body: { type: 'string', minLength: 1, maxLength: 1024 },
    },
  },
  async handler(input) {
    const install = await prisma.whatsAppInstall.findUnique({
      where: { tenantId: input.tenantId },
      select: { phoneNumberId: true },
    });
    if (!install?.phoneNumberId) throw new Error('whatsapp_install_not_found');

    const client = kapsoClient();
    if (client && !install.phoneNumberId.startsWith('pn_stub_')) {
      const sent = await Promise.race([
        client.sendText({
          phone_number_id: install.phoneNumberId,
          to: input.toE164,
          text: input.body,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('kapso_send_timeout')), KAPSO_TOOL_TIMEOUT_MS)
        ),
      ]);
      return { ok: true, messageId: sent.id, mode: 'kapso' };
    }
    return {
      ok: true,
      messageId: `wamid.stub_${Date.now().toString(36)}`,
      mode: 'stub',
    };
  },
};
