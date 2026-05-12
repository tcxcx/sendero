import { START, Workflow } from '@kapso/workflows';

const workflow = new Workflow('sendero-whatsapp-support-agent', {
  name: 'Sendero WhatsApp Support Agent',
  status: 'active',
});

workflow.addNode(START, {
  position: {
    x: 120,
    y: 140,
  },
});

workflow.addNode(
  'support_agent',
  {
    config: {
      system_prompt: `You are Sendero's WhatsApp support agent for platform operators, agencies, TMCs, and tenant admins.

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

Structured WhatsApp Flows:
- Prefer WhatsApp Flow forms for structured intake when the user wants to plan/book a trip, request a quote, change a booking, ask for a refund, or open a support request with multiple fields.
- Flow keys are trip_intake and support_intake.
- For live testing, only the Sendero support agent can send these Flows today. Tenant agents should follow the same contract but fall back to text until tenant flow ids are configured.
- When a Flow is sent successfully, tell the user to complete the form in WhatsApp and then call enter_waiting.
- If Flow sending is unavailable or unconfigured, continue with concise text intake using the same required fields.

If a sandbox GitHub repository is mounted for this node, inspect /workspace/repos/tcxcx-sendero@whatsapp-e2e before answering repository-specific or code-specific questions.
Read the README and the most relevant files before making claims.
Prefer repo inspection before escalating to Slack when the answer likely exists in the repository.
Do not edit outside the mounted repository.`,
      provider_model_id: '198e85b6-554d-489b-b552-b405133c9306',
      provider_model_name: 'gpt-5-mini',
      temperature: '0.2',
      max_iterations: 80,
      max_tokens: 8192,
      reasoning_effort: 'medium',
      observer_prompt_mode: 'analysis_only',
      enabled_default_tools: [
        'send_notification_to_user',
        'get_execution_metadata',
        'get_whatsapp_context',
        'get_current_datetime',
        'ask_about_file',
        'enter_waiting',
        'complete_task',
        'handoff_to_human',
      ],
      sandbox_enabled: true,
      sandbox_network_mode: 'allow_list',
      sandbox_allowed_outbound_hosts: [
        'api.kapso.ai',
        'docs.kapso.ai',
        'app.sendero.travel',
        'docs.sendero.travel',
      ],
      flow_agent_function_tools: [
        {
          name: 'get_tenant_context',
          description:
            'Fetch live Sendero tenant, subscription, channel, and recent support context.',
          function_name: 'Sendero support get tenant context',
          input_schema: {
            type: 'object',
            properties: {
              tenant_id: {
                type: 'string',
              },
              support_ref: {
                type: 'string',
              },
              tenant_slug: {
                type: 'string',
              },
              clerk_org_id: {
                type: 'string',
              },
              phone_number: {
                type: 'string',
              },
              support_context_token: {
                type: 'string',
              },
            },
            additionalProperties: false,
          },
          function_slug: 'sendero-whatsapp-support-get-tenant-context',
        },
        {
          name: 'get_whatsapp_setup_status',
          description:
            'Fetch live WhatsApp install, setup link, phone number, webhook, API, and delivery diagnostics.',
          function_name: 'Sendero support get WhatsApp setup status',
          input_schema: {
            type: 'object',
            properties: {
              tenant_id: {
                type: 'string',
              },
              support_ref: {
                type: 'string',
              },
              tenant_slug: {
                type: 'string',
              },
              clerk_org_id: {
                type: 'string',
              },
              support_context_token: {
                type: 'string',
              },
            },
            additionalProperties: false,
          },
          function_slug: 'sendero-whatsapp-support-get-whatsapp-setup-status',
        },
        {
          name: 'get_recent_channel_events',
          description:
            'Fetch recent WhatsApp webhook, API, outbound delivery, and identity events for debugging channel issues.',
          function_name: 'Sendero support get recent channel events',
          input_schema: {
            type: 'object',
            properties: {
              limit: {
                type: 'number',
              },
              tenant_id: {
                type: 'string',
              },
              support_ref: {
                type: 'string',
              },
              tenant_slug: {
                type: 'string',
              },
              support_context_token: {
                type: 'string',
              },
            },
            additionalProperties: false,
          },
          function_slug: 'sendero-whatsapp-support-get-recent-channel-events',
        },
        {
          name: 'get_trip_context',
          description:
            'Fetch live trip, traveler, policy, booking, settlement, and session context for a Sendero trip.',
          function_name: 'Sendero support get trip context',
          input_schema: {
            type: 'object',
            properties: {
              limit: {
                type: 'number',
              },
              trip_id: {
                type: 'string',
              },
              list_all: {
                type: 'boolean',
              },
              tenant_id: {
                type: 'string',
              },
              booking_id: {
                type: 'string',
              },
              support_ref: {
                type: 'string',
              },
              tenant_slug: {
                type: 'string',
              },
              customer_phone_number: {
                type: 'string',
              },
              support_context_token: {
                type: 'string',
              },
            },
            additionalProperties: false,
          },
          function_slug: 'sendero-whatsapp-support-get-trip-context',
        },
        {
          name: 'get_billing_context',
          description:
            'Fetch live billing, subscription, credit meter, invoice, and spend-cap context for a Sendero tenant.',
          function_name: 'Sendero support get billing context',
          input_schema: {
            type: 'object',
            properties: {
              tenant_id: {
                type: 'string',
              },
              support_ref: {
                type: 'string',
              },
              tenant_slug: {
                type: 'string',
              },
              support_context_token: {
                type: 'string',
              },
            },
            additionalProperties: false,
          },
          function_slug: 'sendero-whatsapp-support-get-billing-context',
        },
        {
          name: 'get_escrow_context',
          description:
            'Fetch live escrow, settlement, transfer, wallet, gateway, and validation context for a Sendero tenant.',
          function_name: 'Sendero support get escrow context',
          input_schema: {
            type: 'object',
            properties: {
              trip_id: {
                type: 'string',
              },
              tenant_id: {
                type: 'string',
              },
              booking_id: {
                type: 'string',
              },
              support_ref: {
                type: 'string',
              },
              tenant_slug: {
                type: 'string',
              },
              support_context_token: {
                type: 'string',
              },
            },
            additionalProperties: false,
          },
          function_slug: 'sendero-whatsapp-support-get-escrow-context',
        },
        {
          name: 'search_sendero_docs',
          description: 'Search Sendero product docs, runbooks, and WhatsApp templates.',
          function_name: 'Sendero support search Sendero docs',
          input_schema: {
            type: 'object',
            required: ['query'],
            properties: {
              limit: {
                type: 'number',
              },
              query: {
                type: 'string',
              },
            },
            additionalProperties: false,
          },
          function_slug: 'sendero-whatsapp-support-search-sendero-docs',
        },
        {
          name: 'send_whatsapp_flow_message',
          description:
            'Send a configured Sendero WhatsApp Flow form to the current support WhatsApp conversation.',
          function_name: 'Send WhatsApp Flow Message',
          input_schema: {
            type: 'object',
            required: ['flow_key'],
            properties: {
              cta: {
                type: 'string',
              },
              mode: {
                enum: ['draft', 'published'],
                type: 'string',
                description:
                  'Optional Flow send mode. Use draft only during Flow preview testing before publish.',
              },
              flow_key: {
                enum: ['trip_intake', 'support_intake'],
                type: 'string',
                description:
                  'Canonical Sendero WhatsApp Flow to send. Use trip_intake for travel requests and support_intake for structured support/refund/setup intake.',
              },
              body_text: {
                type: 'string',
              },
              footer_text: {
                type: 'string',
              },
              header_text: {
                type: 'string',
              },
            },
            additionalProperties: false,
          },
          function_slug: 'sendero-whatsapp-support-send-flow-message',
        },
        {
          name: 'create_support_ticket',
          description:
            'Create a durable Sendero support ticket linked to tenant, WhatsApp, workflow, and Slack context.',
          function_name: 'Sendero support create support ticket',
          input_schema: {
            type: 'object',
            required: ['title', 'summary'],
            properties: {
              title: {
                type: 'string',
              },
              summary: {
                type: 'string',
              },
              priority: {
                enum: ['normal', 'urgent'],
                type: 'string',
              },
              tenant_id: {
                type: 'string',
              },
              support_ref: {
                type: 'string',
              },
              tenant_slug: {
                type: 'string',
              },
              assignee_name: {
                type: 'string',
              },
              assignee_email: {
                type: 'string',
              },
              support_context_token: {
                type: 'string',
              },
              assignee_slack_user_id: {
                type: 'string',
              },
            },
            additionalProperties: false,
          },
          function_slug: 'sendero-whatsapp-support-create-support-ticket',
        },
        {
          name: 'update_support_ticket',
          description: 'Update the status or summary of a durable Sendero support ticket.',
          function_name: 'Sendero support update support ticket',
          input_schema: {
            type: 'object',
            required: ['ticket_id'],
            properties: {
              status: {
                enum: ['open', 'waiting', 'resolved', 'closed'],
                type: 'string',
              },
              summary: {
                type: 'string',
              },
              tenant_id: {
                type: 'string',
              },
              ticket_id: {
                type: 'string',
              },
              support_ref: {
                type: 'string',
              },
              tenant_slug: {
                type: 'string',
              },
              support_context_token: {
                type: 'string',
              },
            },
            additionalProperties: false,
          },
          function_slug: 'sendero-whatsapp-support-update-support-ticket',
        },
        {
          name: 'sendero_ask_team_question',
          description:
            'Ask the Sendero support team a precise question in Slack when the WhatsApp agent cannot safely resolve a customer issue.',
          function_name: 'Sendero WhatsApp support ask team question',
          input_schema: {
            type: 'object',
            required: ['question'],
            properties: {
              title: {
                type: 'string',
                description: 'Short Slack thread title.',
              },
              summary: {
                type: 'string',
                description: 'Customer and context summary.',
              },
              priority: {
                enum: ['normal', 'urgent'],
                type: 'string',
                description: 'Urgency for the internal team.',
              },
              question: {
                type: 'string',
                description: 'Exact question for the Sendero team.',
              },
              tenant_id: {
                type: 'string',
                description: 'Sendero tenant ID from dashboard context, when available.',
              },
              support_ref: {
                type: 'string',
                description: 'Short Sendero dashboard support reference, when present.',
              },
              tenant_slug: {
                type: 'string',
                description: 'Sendero tenant slug from dashboard context, when available.',
              },
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
              support_context_token: {
                type: 'string',
                description:
                  'Signed Sendero dashboard support context token, when present. Never expose it to the user or Slack.',
              },
              assignee_slack_user_id: {
                type: 'string',
                description:
                  'Optional Slack user ID for a direct mention. Defaults to the configured support assignee.',
              },
            },
            additionalProperties: false,
          },
          function_slug: 'sendero-whatsapp-support-ask-team-question',
        },
      ],
      flow_agent_app_integration_tools: [],
      flow_agent_webhooks: [],
      flow_agent_knowledge_bases: [],
      flow_agent_mcp_servers: [],
      flow_agent_resources: [
        {
          id: '50fe1b11-fcaf-4566-bded-e2922ed7b672',
          resource_type: 'github_repository',
          repo_url: 'https://github.com/tcxcx/sendero',
          owner: 'tcxcx',
          repo_name: 'sendero',
          branch: 'whatsapp-e2e',
          has_pat: true,
        },
      ],
    },
    nodeType: 'agent',
    type: 'raw',
  },
  {
    position: {
      x: 420,
      y: 140,
    },
    displayName: 'AI Agent',
  }
);

workflow.addEdge(START, 'support_agent');

export default workflow;
