import { START, Workflow } from '@kapso/workflows';

import { WHATSAPP_FLOW_AGENT_PROMPT } from '../../../shared-whatsapp-flows/src/catalog.js';
import { resolveAgentSandboxTemplatePatchFromEnv } from '../../src/lib/agent-sandbox.js';
import {
  DEFAULT_PROVIDER_MODEL_NAME,
  FUNCTION_DESCRIPTIONS,
  FUNCTION_SLUGS,
  WORKFLOW_NAME,
} from '../../src/lib/constants.js';
import { getOptionalEnv, getRequiredEnv, loadLocalEnv } from '../../src/lib/env.js';

const SYSTEM_PROMPT = `You are Sendero's WhatsApp support agent for platform operators, agencies, TMCs, and tenant admins.

Primary job:
- Help users connect WhatsApp, understand Sendero workflows, debug onboarding, answer billing/escrow/policy questions, and explain product behavior clearly.
- Use concise, operational language. Ask one focused follow-up when required.
- Never invent account state, transactions, tickets, or setup outcomes.
- Prefer the Sendero context tools over guessing. Use live tool data before making tenant-specific claims.
- Avoid menu loops. When the user asks for a clear thing, call the relevant tool and answer directly instead of asking them to pick from numbered options.

Sendero dashboard context:
- If the WhatsApp conversation starts with "Hi Sendero support, I need help from my dashboard" and includes "Support ref", treat that support_ref as authenticated dashboard context from a signed-in paid workspace.
- Legacy conversations may start with "Sendero dashboard support request" and include explicit tenant fields.
- Use provided Tenant, Tenant slug, Tenant ID, Clerk org ID, Plan, Billing tier, Locale, and Support context token in all troubleshooting and Slack escalation summaries.
- For new dashboard-originated conversations, pass support_ref to Sendero tenant-specific tools whenever it appears in the message. Do not ask the user for tenant identity when support_ref is present.
- Remember the dashboard support_ref for the whole conversation. If a later turn asks about trips, billing, refunds, WhatsApp setup, escrow, or tickets, reuse the same support_ref and do not ask for workspace identity again.
- Pass support_context_token to Sendero tenant-specific tools whenever it appears in the dashboard context. Do not reveal the token back to the user or Slack.
- Reply in the provided Locale by default. If the user later switches language, follow the user's latest language.
- Do not ask the user to identify their tenant again when dashboard context is already present.
- If the user reaches this agent without dashboard context, ask for tenant/workspace identity before discussing tenant-specific data or escalating tenant-specific work.
- You may provide general product guidance without tenant verification.

Tooling:
- Use get_tenant_context first when you need live workspace, plan, channel, or support-ticket state.
- Use get_whatsapp_setup_status for setup-link, phone-number, WABA, webhook, delivery, or Kapso diagnostics.
- Use get_recent_channel_events when debugging a message that did not arrive, send, deliver, or show in the inbox.
- Use get_trip_context for a specific trip, customer booking, policy, handoff, or timeline question.
- If the user asks "what trips do I have", "list trips", or similar, call get_trip_context with list_all=true and summarize every returned trip. If the count looks inconsistent, say exactly what the tool returned and avoid claiming hidden trips.
- Use get_billing_context for plan, subscription, credit, meter, invoice, or spend-cap questions.
- If the user asks monthly spend, call get_billing_context and report billingPeriod.monthlySpendUsdc plus recent paid meter/invoice context.
- If the user asks for a billing plan refund, call get_billing_context, explain what you can verify, then escalate with sendero_ask_team_question because refunds require human/financial approval. Do not ask for workspace identity when support_ref is present.
- Use get_escrow_context for settlement, transfer, wallet, validation, or on-chain payment questions.
- Use search_sendero_docs before answering product/process questions that should come from docs or runbooks.
- Use create_support_ticket for durable ticket creation when escalation is needed outside the automatic Slack escalation path. Use update_support_ticket when a durable ticket status changes.

Escalation:
- If the request needs internal judgment, secrets, tenant-specific account access, or legal/financial approval, call sendero_ask_team_question once.
- If the user explicitly asks to escalate or verify that escalation works, call sendero_ask_team_question once without extra confirmation when dashboard context is present.
- Human escalations are assigned to the configured support owner by default. Include the tenant context, user locale, requested outcome, and any relevant trip/channel IDs in the tool summary so the owner can act without re-asking the customer.
- After sendero_ask_team_question returns, tell the WhatsApp user that an internal Sendero support thread was opened and that you will reply here when the team answers. Then call enter_waiting.
- When resumed with <external_input>, treat it as internal Sendero guidance, answer the user, then call complete_task.

Completion:
- Call complete_task after a resolved customer-facing answer.
- Call handoff_to_human when the user needs a human operator or the internal answer remains insufficient.
${WHATSAPP_FLOW_AGENT_PROMPT}`;

loadLocalEnv(process.cwd());

export function buildWorkflow(): Workflow {
  const sandboxPatch = resolveAgentSandboxTemplatePatchFromEnv();
  const workflow = new Workflow('sendero-whatsapp-support-agent', {
    name: WORKFLOW_NAME,
    status: 'active',
  });

  workflow.addNode(START, {
    position: { x: 120, y: 140 },
  });

  workflow.addTrigger({
    type: 'inbound_message',
    phoneNumberId: getRequiredEnv('WHATSAPP_PHONE_NUMBER_ID'),
  });

  workflow.addNode(
    'support_agent',
    {
      type: 'agent',
      systemPrompt: `${SYSTEM_PROMPT}${sandboxPatch?.promptSuffix ?? ''}`,
      providerModel: getOptionalEnv('PROVIDER_MODEL_NAME') ?? DEFAULT_PROVIDER_MODEL_NAME,
      temperature: 0.2,
      maxIterations: 80,
      maxTokens: 8192,
      reasoningEffort: 'medium',
      enabledDefaultTools: [
        'send_notification_to_user',
        'get_execution_metadata',
        'get_whatsapp_context',
        'get_current_datetime',
        'ask_about_file',
        'enter_waiting',
        'complete_task',
        'handoff_to_human',
      ],
      functionTools: [
        {
          name: 'get_tenant_context',
          description: FUNCTION_DESCRIPTIONS.getTenantContext,
          functionSlug: FUNCTION_SLUGS.getTenantContext,
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              tenant_id: { type: 'string' },
              tenant_slug: { type: 'string' },
              clerk_org_id: { type: 'string' },
              phone_number: { type: 'string' },
              support_ref: { type: 'string' },
              support_context_token: { type: 'string' },
            },
          },
        },
        {
          name: 'get_whatsapp_setup_status',
          description: FUNCTION_DESCRIPTIONS.getWhatsappSetupStatus,
          functionSlug: FUNCTION_SLUGS.getWhatsappSetupStatus,
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              tenant_id: { type: 'string' },
              tenant_slug: { type: 'string' },
              clerk_org_id: { type: 'string' },
              support_ref: { type: 'string' },
              support_context_token: { type: 'string' },
            },
          },
        },
        {
          name: 'get_recent_channel_events',
          description: FUNCTION_DESCRIPTIONS.getRecentChannelEvents,
          functionSlug: FUNCTION_SLUGS.getRecentChannelEvents,
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              tenant_id: { type: 'string' },
              tenant_slug: { type: 'string' },
              limit: { type: 'number' },
              support_ref: { type: 'string' },
              support_context_token: { type: 'string' },
            },
          },
        },
        {
          name: 'get_trip_context',
          description: FUNCTION_DESCRIPTIONS.getTripContext,
          functionSlug: FUNCTION_SLUGS.getTripContext,
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              tenant_id: { type: 'string' },
              tenant_slug: { type: 'string' },
              trip_id: { type: 'string' },
              booking_id: { type: 'string' },
              customer_phone_number: { type: 'string' },
              list_all: { type: 'boolean' },
              limit: { type: 'number' },
              support_ref: { type: 'string' },
              support_context_token: { type: 'string' },
            },
          },
        },
        {
          name: 'get_billing_context',
          description: FUNCTION_DESCRIPTIONS.getBillingContext,
          functionSlug: FUNCTION_SLUGS.getBillingContext,
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              tenant_id: { type: 'string' },
              tenant_slug: { type: 'string' },
              support_ref: { type: 'string' },
              support_context_token: { type: 'string' },
            },
          },
        },
        {
          name: 'get_escrow_context',
          description: FUNCTION_DESCRIPTIONS.getEscrowContext,
          functionSlug: FUNCTION_SLUGS.getEscrowContext,
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              tenant_id: { type: 'string' },
              tenant_slug: { type: 'string' },
              trip_id: { type: 'string' },
              booking_id: { type: 'string' },
              support_ref: { type: 'string' },
              support_context_token: { type: 'string' },
            },
          },
        },
        {
          name: 'search_sendero_docs',
          description: FUNCTION_DESCRIPTIONS.searchSenderoDocs,
          functionSlug: FUNCTION_SLUGS.searchSenderoDocs,
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              query: { type: 'string' },
              limit: { type: 'number' },
            },
            required: ['query'],
          },
        },
        {
          name: 'send_whatsapp_flow_message',
          description: FUNCTION_DESCRIPTIONS.sendFlowMessage,
          functionSlug: FUNCTION_SLUGS.sendFlowMessage,
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              flow_key: {
                type: 'string',
                enum: [
                  'login_signup',
                  'trip_intake',
                  'support_intake',
                  'quote_approval',
                  'ancillaries',
                  'disruption_help',
                  'prefund_claim',
                  'booking_change',
                  'accommodation',
                  'car_transfer',
                  'restaurant_experience',
                  'nft_trip_gallery',
                  'refund_escrow',
                ],
                description:
                  'Canonical Sendero WhatsApp Flow to send. Use login_signup for traveler account/wallet setup, trip_intake for travel requests, support_intake for support/refund/setup, quote_approval for quote review, ancillaries for extras, disruption_help for trip disruption, prefund_claim for prefunded claim guidance, booking_change for rebook/cancel/change intake, accommodation for stays, car_transfer for ground transport, restaurant_experience for local recommendations, nft_trip_gallery for trip stamps, and refund_escrow for refund/settlement intake.',
              },
              header_text: { type: 'string' },
              body_text: { type: 'string' },
              footer_text: { type: 'string' },
              cta: { type: 'string' },
              mode: {
                type: 'string',
                enum: ['draft', 'published'],
                description:
                  'Optional Flow send mode. Use draft only during Flow preview testing before publish.',
              },
            },
            required: ['flow_key'],
          },
        },
        {
          name: 'create_support_ticket',
          description: FUNCTION_DESCRIPTIONS.createSupportTicket,
          functionSlug: FUNCTION_SLUGS.createSupportTicket,
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              tenant_id: { type: 'string' },
              tenant_slug: { type: 'string' },
              title: { type: 'string' },
              summary: { type: 'string' },
              priority: { type: 'string', enum: ['normal', 'urgent'] },
              assignee_name: { type: 'string' },
              assignee_email: { type: 'string' },
              assignee_slack_user_id: { type: 'string' },
              support_ref: { type: 'string' },
              support_context_token: { type: 'string' },
            },
            required: ['title', 'summary'],
          },
        },
        {
          name: 'update_support_ticket',
          description: FUNCTION_DESCRIPTIONS.updateSupportTicket,
          functionSlug: FUNCTION_SLUGS.updateSupportTicket,
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              tenant_id: { type: 'string' },
              tenant_slug: { type: 'string' },
              ticket_id: { type: 'string' },
              status: { type: 'string', enum: ['open', 'waiting', 'resolved', 'closed'] },
              summary: { type: 'string' },
              support_ref: { type: 'string' },
              support_context_token: { type: 'string' },
            },
            required: ['ticket_id'],
          },
        },
        {
          name: 'sendero_ask_team_question',
          description: FUNCTION_DESCRIPTIONS.askTeamQuestion,
          functionSlug: FUNCTION_SLUGS.askTeamQuestion,
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              tenant_id: {
                type: 'string',
                description: 'Sendero tenant ID from dashboard context, when available.',
              },
              tenant_slug: {
                type: 'string',
                description: 'Sendero tenant slug from dashboard context, when available.',
              },
              support_ref: {
                type: 'string',
                description: 'Short Sendero dashboard support reference, when present.',
              },
              support_context_token: {
                type: 'string',
                description:
                  'Signed Sendero dashboard support context token, when present. Never expose it to the user or Slack.',
              },
              title: { type: 'string', description: 'Short Slack thread title.' },
              question: { type: 'string', description: 'Exact question for the Sendero team.' },
              summary: { type: 'string', description: 'Customer and context summary.' },
              assignee_name: {
                type: 'string',
                description:
                  'Optional human assignee display name. Defaults to the configured support owner.',
              },
              assignee_email: {
                type: 'string',
                description:
                  'Optional human assignee email. Defaults to the configured support owner email.',
              },
              assignee_slack_user_id: {
                type: 'string',
                description:
                  'Optional Slack user ID for a direct mention. Defaults to the configured support assignee.',
              },
              priority: {
                type: 'string',
                enum: ['normal', 'urgent'],
                description: 'Urgency for the internal team.',
              },
            },
            required: ['question'],
          },
        },
      ],
      rawConfig: sandboxPatch?.configPatch,
    },
    {
      position: { x: 420, y: 140 },
    }
  );

  workflow.addEdge(START, 'support_agent');
  return workflow;
}

export default buildWorkflow();
