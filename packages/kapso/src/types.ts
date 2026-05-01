/**
 * Kapso Platform API types.
 *
 * Zod schemas for the subset Sendero uses: customers, setup links,
 * WhatsApp connections, and phone-number webhook events.
 *
 * Spec source: kapso.ai /platform/v1 OpenAPI. We intentionally stay
 * close to the wire shape; callers map to domain types at the edge.
 *
 * Ported from desk-v1, adapted for Sendero.
 */

import { z } from 'zod';

// ── Customers ────────────────────────────────────────────────────────
export const KapsoCustomer = z.object({
  id: z.string(),
  name: z.string(),
  external_customer_id: z.string().nullable().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});
export type KapsoCustomer = z.infer<typeof KapsoCustomer>;

// ── Setup links ──────────────────────────────────────────────────────
export const KapsoSetupLink = z.object({
  id: z.string(),
  url: z.string().url(),
  /** Stitched in client-side — Kapso's POST /customers/:id/setup_links
   *  response doesn't echo the customer_id back since it's already in
   *  the URL. We inject it before parsing so callers always see it. */
  customer_id: z.string().optional(),
  /** ISO-8601. */
  expires_at: z.string(),
  status: z.enum(['pending', 'active', 'completed', 'expired']).optional(),
  allowed_connection_types: z.array(z.string()).optional(),
  provision_phone_number: z.boolean().optional(),
  provisioned_phone_number: z.string().nullable().optional(),
  success_redirect_url: z.string().url().nullable().optional(),
  failure_redirect_url: z.string().url().nullable().optional(),
  whatsapp_setup_status: z.string().nullable().optional(),
  whatsapp_setup_error: z.string().nullable().optional(),
});
export type KapsoSetupLink = z.infer<typeof KapsoSetupLink>;

export const CreateSetupLinkRequest = z.object({
  /** "dedicated" is the recommended default in the integrate-whatsapp skill. */
  allowed_connection_types: z
    .array(z.enum(['coexistence', 'dedicated', 'shared']))
    .default(['coexistence', 'dedicated']),
  provision_phone_number: z.boolean().default(false),
  phone_number_country_isos: z.array(z.string().length(2)).optional(),
  phone_number_area_code: z.string().optional(),
  language: z.string().optional(),
  /** Legacy alias kept for old callers; converted to success/failure URLs by setup-link.ts. */
  redirect_url: z.string().url().optional(),
  /** Where the tenant admin lands after successful Meta signup. */
  success_redirect_url: z.string().url().optional(),
  /** Where the tenant admin lands after failed Meta signup. */
  failure_redirect_url: z.string().url().optional(),
});
export type CreateSetupLinkRequest = z.infer<typeof CreateSetupLinkRequest>;

// ── WhatsApp phone numbers / connections ─────────────────────────────
export const KapsoWhatsAppPhoneNumber = z.object({
  id: z.string(),
  phone_number_id: z.string(),
  business_account_id: z.string().nullable().optional(),
  display_phone_number: z.string().nullable().optional(),
  verified_name: z.string().nullable().optional(),
  customer_id: z.string().nullable().optional(),
  status: z.string().optional(),
  connected_at: z.string().nullable().optional(),
});
export type KapsoWhatsAppPhoneNumber = z.infer<typeof KapsoWhatsAppPhoneNumber>;

// ── Webhook registration ─────────────────────────────────────────────
export const WebhookScope = z.enum(['project', 'phone_number']);
export type WebhookScope = z.infer<typeof WebhookScope>;

export const KapsoWebhookRegistration = z.object({
  id: z.string(),
  scope: WebhookScope,
  url: z.string().url(),
  events: z.array(z.string()),
  active: z.boolean().default(true),
  kind: z.enum(['kapso', 'meta']).default('kapso'),
  payload_version: z.enum(['v1', 'v2']).default('v2'),
  /** Kapso-issued secret used to sign deliveries (HMAC-SHA256 hex). */
  secret: z.string().optional(),
  phone_number_id: z.string().nullable().optional(),
});
export type KapsoWebhookRegistration = z.infer<typeof KapsoWebhookRegistration>;

// ── Workflow triggers ────────────────────────────────────────────────
export const KapsoWorkflowTrigger = z.object({
  id: z.string(),
  workflow_id: z.string().optional(),
  trigger_type: z.string(),
  active: z.boolean().optional(),
  display_name: z.string().nullable().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  triggerable: z
    .object({
      phone_number_id: z.string().optional(),
    })
    .nullable()
    .optional(),
});
export type KapsoWorkflowTrigger = z.infer<typeof KapsoWorkflowTrigger>;

export const CreateWorkflowTriggerRequest = z.object({
  trigger_type: z.enum(['inbound_message', 'api_call']),
  active: z.boolean().default(true),
  display_name: z.string().optional(),
  phone_number_id: z.string().optional(),
});
export type CreateWorkflowTriggerRequest = z.infer<typeof CreateWorkflowTriggerRequest>;

export const KapsoPhoneHealth = z.object({
  ok: z.boolean().optional(),
  status: z.string().optional(),
  health_status: z.string().optional(),
  checks: z.unknown().optional(),
});
export type KapsoPhoneHealth = z.infer<typeof KapsoPhoneHealth>;

// ── WhatsApp Flows ──────────────────────────────────────────────────
export const KapsoWhatsAppFlow = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    flow_id: z.string().optional(),
    meta_flow_id: z.string().nullable().optional(),
    metaFlowId: z.string().nullable().optional(),
    phone_number_id: z.string().nullable().optional(),
    phoneNumberId: z.string().nullable().optional(),
    business_account_id: z.string().nullable().optional(),
    businessAccountId: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    json_version: z.string().nullable().optional(),
    jsonVersion: z.string().nullable().optional(),
    data_api_version: z.string().nullable().optional(),
    dataApiVersion: z.string().nullable().optional(),
    has_data_endpoint: z.boolean().nullable().optional(),
    hasDataEndpoint: z.boolean().nullable().optional(),
  })
  .passthrough();
export type KapsoWhatsAppFlow = z.infer<typeof KapsoWhatsAppFlow>;

export const CreateWhatsAppFlowRequest = z.object({
  name: z.string().min(1),
  business_account_id: z.string().min(1),
  phone_number_id: z.string().min(1),
  json_version: z.string().default('7.3'),
  data_api_version: z.string().default('3.0'),
  flow_json: z.record(z.unknown()),
});
export type CreateWhatsAppFlowRequest = z.infer<typeof CreateWhatsAppFlowRequest>;

export const CreateWebhookRequest = z.object({
  scope: WebhookScope,
  url: z.string().url(),
  events: z.array(z.string()),
  kind: z.enum(['kapso', 'meta']).default('kapso'),
  payload_version: z.enum(['v1', 'v2']).default('v2'),
  active: z.boolean().default(true),
  buffer_enabled: z.boolean().optional(),
  buffer_window_seconds: z.number().int().min(1).max(60).optional(),
  max_buffer_size: z.number().int().min(1).max(100).optional(),
  /** Required when scope === 'phone_number'. */
  phone_number_id: z.string().optional(),
});
export type CreateWebhookRequest = z.infer<typeof CreateWebhookRequest>;

// ── Outbound send payloads ───────────────────────────────────────────
export const SendTextRequest = z.object({
  phone_number_id: z.string(),
  to: z.string(),
  text: z.string().min(1),
});
export type SendTextRequest = z.infer<typeof SendTextRequest>;

export const SendTemplateRequest = z.object({
  phone_number_id: z.string(),
  to: z.string(),
  template_name: z.string(),
  language_code: z.string(),
  components: z
    .array(
      z.object({
        type: z.enum(['header', 'body', 'button']),
        parameters: z.array(
          z.object({
            type: z.enum(['text', 'currency', 'date_time', 'image', 'document']),
            text: z.string().optional(),
          })
        ),
        sub_type: z.enum(['quick_reply', 'url']).optional(),
        index: z.number().int().min(0).max(2).optional(),
      })
    )
    .optional(),
});
export type SendTemplateRequest = z.infer<typeof SendTemplateRequest>;

// ── Connection lifecycle webhook event ───────────────────────────────
/**
 * `whatsapp.phone_number.created` — fired when a customer finishes the
 * embedded signup. Sendero listens for this on project-scope webhooks.
 */
export const PhoneNumberCreatedEvent = z.object({
  type: z.literal('whatsapp.phone_number.created'),
  data: z.object({
    customer_id: z.string(),
    phone_number_id: z.string(),
    business_account_id: z.string().optional(),
    display_phone_number: z.string().optional(),
    verified_name: z.string().optional(),
  }),
});
export type PhoneNumberCreatedEvent = z.infer<typeof PhoneNumberCreatedEvent>;
