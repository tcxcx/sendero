import { START, Workflow } from '@kapso/workflows';

import { WHATSAPP_FLOW_AGENT_PROMPT } from '../../../shared-whatsapp-flows/src/catalog.js';
import {
  DEFAULT_PROVIDER_MODEL_NAME,
  FUNCTION_DESCRIPTIONS,
  FUNCTION_SLUGS,
  WORKFLOW_NAME,
} from '../../src/lib/constants.js';
import { getOptionalEnv, loadLocalEnv } from '../../src/lib/env.js';

const SYSTEM_PROMPT = `You are Sendero's tenant travel operations agent on WhatsApp.

Primary job:
- Help a travel agency, TMC, or corporate travel team run customer conversations over WhatsApp.
- Turn messy customer messages into durable Sendero trip intake, booking workflow context, policy checks, validation needs, wallet/payment readiness, and operator handoffs.
- Keep the customer's WhatsApp experience concise, warm, and action-oriented.
- Prefer Sendero canonical tools and workflows over improvising. Never invent tenant, trip, wallet, payment, escrow, or booking state.

Tenant context:
- First call get_tenant_operating_context unless you already have fresh context from this turn.
- Conversations resolve from the tenant's dedicated WhatsApp phone_number_id.
- Free workspaces cannot run live tenant WhatsApp operations. If context reports sandbox/readiness mode, explain that a paid plan and dedicated WhatsApp Business number are required.
- Never ask for tenant identity if get_tenant_operating_context succeeds.
- If context cannot be resolved, tell the user to start from the Sendero dashboard or ask the tenant admin to finish WhatsApp channel setup.

WhatsApp UX:
- Keep replies short. Use one focused question at a time.
- Offer clear choices when useful, but do not trap users in menu loops.
- For structured trip intake, ask for destination, dates, travelers, budget, constraints, and urgency only as needed.
- When enough intake exists, call create_trip_intake and summarize the draft trip ID.

Tooling:
- Use create_trip_intake for new trip requests, quote requests, itinerary planning, or booking leads.
- Use get_trip_context when the user asks about an existing trip, booking, customer, timeline, policy, or settlement.
- Use get_wallet_context only to read wallet/payment readiness. It never moves funds.
- Use get_whatsapp_session_context before exposing booking details, wallet addresses, traveler profile data, or anything tenant/customer-specific that depends on identity confidence.
- Use request_whatsapp_otp when a remembered WhatsApp session needs verified status. Ask the user to reply with the 6-digit code, then call verify_whatsapp_otp.
- Use get_recent_channel_events for delivery, webhook, or "message did not arrive" debugging.
- Use search_sendero_docs for product/process questions.
- Use create_tenant_handoff when a human operator must approve, decide, refund, override policy, handle a supplier exception, or answer a question that requires internal judgment.

Handoff:
- Web internal handoff is the mandatory primary handoff channel.
- Slack handoff only exists when the tenant configured Slack.
- WhatsApp operator handoff only exists when configured by the tenant.
- After create_tenant_handoff succeeds, tell the WhatsApp user that the request is with the travel team and that updates will continue in this thread. Then call enter_waiting.
- When resumed with <external_input>, treat it as operator guidance, answer the WhatsApp user, then call complete_task.

Safety:
- Remembered WhatsApp sessions are enough for itinerary questions, trip gallery, support status, quote intake, and non-sensitive preferences.
- Verified WhatsApp sessions are required before confirming ticket email changes, showing booking details, showing wallet addresses, or updating traveler profile fields.
- Privileged actions are not completed inside WhatsApp login. Payments, refunds, escrow settlement, wallet transfers, passport vault access, and policy overrides require an action-scoped Sendero web/passkey approval link or human handoff.
- In sandbox mode, never commit bookings, broadcast to customers, move money, create refunds, transfer wallets, or settle escrow. You may create draft intake and web handoffs.
- In production mode, booking commits, payment movement, escrow settlement, wallet transfers, refunds, and policy overrides require Sendero approval/signing flows or a human handoff.
- Never reveal internal secrets, support refs, test tokens, tool raw payloads, private keys, or credentials.

Completion:
- Call complete_task after a resolved customer-facing answer.
- Call enter_waiting after opening a handoff or when you need the user to provide missing trip details.
${WHATSAPP_FLOW_AGENT_PROMPT}`;

loadLocalEnv(process.cwd());

export function buildWorkflow(): Workflow {
  const workflow = new Workflow('sendero-tenant-travel-agent', {
    name: WORKFLOW_NAME,
    status: 'active',
  });

  workflow.addNode(START, {
    position: { x: 120, y: 140 },
  });

  workflow.addNode(
    'tenant_travel_agent',
    {
      type: 'agent',
      systemPrompt: SYSTEM_PROMPT,
      providerModel: getOptionalEnv('PROVIDER_MODEL_NAME') ?? DEFAULT_PROVIDER_MODEL_NAME,
      temperature: 0.2,
      maxIterations: 80,
      maxTokens: 8192,
      reasoningEffort: 'medium',
      enabledDefaultTools: [
        'send_notification_to_user',
        'send_media',
        'get_execution_metadata',
        'get_whatsapp_context',
        'get_current_datetime',
        'ask_about_file',
        'enter_waiting',
        'complete_task',
      ],
      functionTools: [
        {
          name: 'get_tenant_operating_context',
          description: FUNCTION_DESCRIPTIONS.getContext,
          functionSlug: FUNCTION_SLUGS.getContext,
          inputSchema: phoneContextSchema(),
        },
        {
          name: 'create_trip_intake',
          description: FUNCTION_DESCRIPTIONS.createTripIntake,
          functionSlug: FUNCTION_SLUGS.createTripIntake,
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              phone_number_id: { type: 'string' },
              title: { type: 'string' },
              summary: { type: 'string' },
              traveler_name: { type: 'string' },
              traveler_phone: { type: 'string' },
              origin: { type: 'string' },
              destination: { type: 'string' },
              dates: { type: 'string' },
              budget: { type: 'string' },
              purpose: { type: 'string' },
              notes: { type: 'string' },
            },
            required: ['summary'],
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
              phone_number_id: { type: 'string' },
              trip_id: { type: 'string' },
              booking_id: { type: 'string' },
              customer_phone_number: { type: 'string' },
              list_all: { type: 'boolean' },
              limit: { type: 'number' },
            },
          },
        },
        {
          name: 'get_wallet_context',
          description: FUNCTION_DESCRIPTIONS.getWalletContext,
          functionSlug: FUNCTION_SLUGS.getWalletContext,
          inputSchema: phoneContextSchema(),
        },
        {
          name: 'get_whatsapp_session_context',
          description: FUNCTION_DESCRIPTIONS.getWhatsappSessionContext,
          functionSlug: FUNCTION_SLUGS.getWhatsappSessionContext,
          inputSchema: phoneContextSchema(),
        },
        {
          name: 'request_whatsapp_otp',
          description: FUNCTION_DESCRIPTIONS.requestWhatsappOtp,
          functionSlug: FUNCTION_SLUGS.requestWhatsappOtp,
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              phone_number_id: { type: 'string' },
              purpose: { type: 'string' },
            },
          },
        },
        {
          name: 'verify_whatsapp_otp',
          description: FUNCTION_DESCRIPTIONS.verifyWhatsappOtp,
          functionSlug: FUNCTION_SLUGS.verifyWhatsappOtp,
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              phone_number_id: { type: 'string' },
              verification_id: { type: 'string' },
              code: { type: 'string' },
              purpose: { type: 'string' },
            },
            required: ['code'],
          },
        },
        {
          name: 'get_recent_channel_events',
          description: FUNCTION_DESCRIPTIONS.getChannelEvents,
          functionSlug: FUNCTION_SLUGS.getChannelEvents,
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              phone_number_id: { type: 'string' },
              limit: { type: 'number' },
            },
          },
        },
        {
          name: 'search_sendero_docs',
          description: FUNCTION_DESCRIPTIONS.searchDocs,
          functionSlug: FUNCTION_SLUGS.searchDocs,
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
              },
              phone_number_id: { type: 'string' },
              header_text: { type: 'string' },
              body_text: { type: 'string' },
              footer_text: { type: 'string' },
              cta: { type: 'string' },
              mode: { type: 'string', enum: ['draft', 'published'] },
            },
            required: ['flow_key'],
          },
        },
        {
          name: 'run_travel_lifecycle_tool',
          description: FUNCTION_DESCRIPTIONS.lifecycleTool,
          functionSlug: FUNCTION_SLUGS.lifecycleTool,
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              operation: {
                type: 'string',
                enum: [
                  'create_quote_request',
                  'list_quote_options',
                  'request_quote_approval',
                  'create_prefunded_trip_link',
                  'get_prefund_claim_status',
                  'request_payment_link',
                  'get_booking_context',
                  'request_booking_change',
                  'search_accommodation',
                  'create_accommodation_request',
                  'search_car_rentals',
                  'create_transfer_request',
                  'search_restaurants',
                  'create_ancillary_request',
                  'get_trip_gallery',
                  'get_nft_stamp_status',
                  'request_nft_unlock',
                  'get_disruption_context',
                  'create_disruption_handoff',
                ],
              },
              payload: {
                type: 'object',
                additionalProperties: true,
                properties: {
                  phone_number_id: { type: 'string' },
                  trip_id: { type: 'string' },
                  booking_id: { type: 'string' },
                  quote_id: { type: 'string' },
                  reference: { type: 'string' },
                  destination: { type: 'string' },
                  summary: { type: 'string' },
                  details: { type: 'string' },
                  priority: { type: 'string', enum: ['normal', 'urgent'] },
                },
              },
            },
            required: ['operation'],
          },
        },
        {
          name: 'create_tenant_handoff',
          description: FUNCTION_DESCRIPTIONS.createHandoff,
          functionSlug: FUNCTION_SLUGS.createHandoff,
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              phone_number_id: { type: 'string' },
              trip_id: { type: 'string' },
              title: { type: 'string' },
              summary: { type: 'string' },
              question: { type: 'string' },
              priority: { type: 'string', enum: ['normal', 'urgent'] },
              operator_whatsapp_phone: { type: 'string' },
            },
            required: ['summary'],
          },
        },
      ],
    },
    {
      position: { x: 420, y: 140 },
    }
  );

  workflow.addEdge(START, 'tenant_travel_agent');
  return workflow;
}

function phoneContextSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      phone_number_id: { type: 'string' },
    },
  };
}

export default buildWorkflow();
