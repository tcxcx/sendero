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
  status: z.string().nullable().optional(),
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
  secret_key: z.string().optional(),
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
  /** Optional caller-supplied signing secret for Kapso deliveries. */
  secret_key: z.string().optional(),
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

// ── Broadcasts ───────────────────────────────────────────────────────
// Kapso WhatsApp broadcasts are 3-step: create draft → add recipients
// → send. Recipients map 1:1 to template parameter variations (each
// recipient can supply its own components array). Sendero composes all
// three calls inside `broadcastTemplate` so callers don't carry the
// state machine themselves.

export const KapsoTemplateComponent = z.object({
  type: z.enum(['header', 'body', 'button']),
  /** Default `body` for header/body. `quick_reply` / `url` for button. */
  sub_type: z.enum(['quick_reply', 'url']).optional(),
  /** Button index 0..2 — only used when `type === 'button'`. */
  index: z.number().int().min(0).max(2).optional(),
  parameters: z.array(
    z.object({
      type: z.enum(['text', 'currency', 'date_time', 'image', 'document']),
      text: z.string().optional(),
    })
  ),
});
export type KapsoTemplateComponent = z.infer<typeof KapsoTemplateComponent>;

export const KapsoBroadcastRecipient = z.object({
  /** E.164. Required unless `whatsapp_contact_id` is provided. */
  phone_number: z.string().optional(),
  whatsapp_contact_id: z.string().optional(),
  components: z.array(KapsoTemplateComponent).optional(),
});
export type KapsoBroadcastRecipient = z.infer<typeof KapsoBroadcastRecipient>;

export const KapsoBroadcast = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(['draft', 'scheduled', 'sending', 'completed', 'failed']),
  scheduled_at: z.string().nullable().optional(),
  started_at: z.string().nullable().optional(),
  completed_at: z.string().nullable().optional(),
  sent_count: z.number().int().optional(),
  failed_count: z.number().int().optional(),
  delivered_count: z.number().int().optional(),
  read_count: z.number().int().optional(),
});
export type KapsoBroadcast = z.infer<typeof KapsoBroadcast>;

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

/**
 * `workflow.execution.handoff` — fired when an agent calls Kapso's
 * built-in `handoff_to_human` default tool (NOT Sendero's
 * `request_human_handoff`, which fires Liveblocks + Slack directly
 * from the tool handler). This webhook is the only signal Sendero
 * gets that the agent escalated via Kapso's path. We catch it here
 * to mirror the same operator notifications a Sendero-tool handoff
 * triggers — so the operator dashboard and Slack channel always see
 * an escalation regardless of which path the agent took.
 *
 * Payload shape per Kapso docs (subset Sendero needs):
 *   - data.workflow_id
 *   - data.execution_id
 *   - data.phone_number_id (when triggered by inbound_message)
 *   - data.customer_phone (the traveler's E.164)
 *   - data.context_summary / data.reason / data.summary (free-form)
 */
export const WorkflowHandoffEvent = z.object({
  type: z.literal('workflow.execution.handoff'),
  data: z
    .object({
      workflow_id: z.string().optional(),
      workflow_execution_id: z.string().optional(),
      execution_id: z.string().optional(),
      phone_number_id: z.string().optional(),
      customer_phone: z.string().optional(),
      customer_phone_number: z.string().optional(),
      conversation_id: z.string().optional(),
      reason: z.string().optional(),
      context_summary: z.string().optional(),
      summary: z.string().optional(),
    })
    .passthrough(),
});
export type WorkflowHandoffEvent = z.infer<typeof WorkflowHandoffEvent>;

/**
 * `workflow.execution.failed` — fired when a workflow execution
 * terminates in error (uncaught exception, tool failure that
 * propagates, schema validation, etc). Sendero records these for ops
 * visibility but doesn't auto-escalate (they're internal failures,
 * not customer-facing); operator dashboard surfaces a digest.
 */
export const WorkflowFailedEvent = z.object({
  type: z.literal('workflow.execution.failed'),
  data: z
    .object({
      workflow_id: z.string().optional(),
      workflow_execution_id: z.string().optional(),
      execution_id: z.string().optional(),
      phone_number_id: z.string().optional(),
      customer_phone: z.string().optional(),
      customer_phone_number: z.string().optional(),
      conversation_id: z.string().optional(),
      error_message: z.string().optional(),
      error_code: z.string().optional(),
    })
    .passthrough(),
});
export type WorkflowFailedEvent = z.infer<typeof WorkflowFailedEvent>;
