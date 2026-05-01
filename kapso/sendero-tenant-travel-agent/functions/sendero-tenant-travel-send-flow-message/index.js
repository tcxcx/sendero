const KAPSO_META_BASE_URL = 'https://api.kapso.ai/meta/whatsapp';

const FLOW_CATALOG = {
  login_signup: {
    header: 'Sendero account',
    body: 'Create or link your traveler profile, WhatsApp identity, travel wallet, and trip gallery.',
    footer: 'Wallets and galleries persist across future trips.',
    cta: 'Set up account',
  },
  trip_intake: {
    header: 'Trip intake',
    body: 'Share your trip details in WhatsApp. The travel team will turn this into a Sendero draft.',
    footer: 'No booking or payment is committed from this form.',
    cta: 'Plan trip',
  },
  support_intake: {
    header: 'Travel support',
    body: 'Classify your request and capture the details the travel team needs.',
    footer: 'Financial, escrow, and refund actions still require human approval.',
    cta: 'Open form',
  },
  quote_approval: {
    header: 'Quote review',
    body: 'Review a travel quote and send your decision to the travel team.',
    footer: 'No payment or ticketing happens inside WhatsApp.',
    cta: 'Review quote',
  },
  ancillaries: {
    header: 'Trip extras',
    body: 'Request bags, seats, insurance, lounge, meals, priority boarding, or other extras.',
    footer: 'Paid extras still require secure approval.',
    cta: 'Add extras',
  },
  disruption_help: {
    header: 'Travel disruption',
    body: 'Tell the travel team what changed so they can help with rebooking, refunds, hotels, or transport.',
    footer: 'Urgent disruptions are routed to the operator channel.',
    cta: 'Get help',
  },
  prefund_claim: {
    header: 'Prefunded trip',
    body: 'Get help claiming a prefunded trip.',
    footer: 'Never paste your email claim code into WhatsApp.',
    cta: 'Claim help',
  },
  booking_change: {
    header: 'Booking change',
    body: 'Request a date, route, rebook, or cancellation change.',
    footer: 'No cancellation or ticketing happens inside WhatsApp.',
    cta: 'Change booking',
  },
  accommodation: {
    header: 'Accommodation',
    body: 'Share stay dates, rooms, budget, amenities, and loyalty details.',
    footer: 'Paid booking still requires approval.',
    cta: 'Find stay',
  },
  car_transfer: {
    header: 'Ground transport',
    body: 'Request airport transfers, point-to-point rides, or car rentals.',
    footer: 'Payment or confirmation still uses secure approval.',
    cta: 'Book transport',
  },
  restaurant_experience: {
    header: 'Local recommendations',
    body: 'Capture cuisine, area, budget, timing, dietary needs, or experience preferences.',
    footer: 'Paid reservations need approval.',
    cta: 'Get ideas',
  },
  nft_trip_gallery: {
    header: 'Trip gallery',
    body: 'View or request help with trip stamps, gallery links, and unlock status.',
    footer: 'Unlocks require verification or secure approval.',
    cta: 'Open gallery',
  },
  refund_escrow: {
    header: 'Refund or escrow',
    body: 'Capture refund, escrow, settlement, or validation issues for review.',
    footer: 'Refunds and settlements never execute inside WhatsApp.',
    cta: 'Open request',
  },
};

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function asText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function requireEnv(value, name) {
  const text = asText(value);
  if (!text) throw new Error(`Missing required runtime env: ${name}`);
  return text;
}

function resolveAppOrigin(env) {
  return requireEnv(env.SENDERO_APP_ORIGIN || env.KAPSO_WEBHOOK_BASE_URL, 'SENDERO_APP_ORIGIN');
}

function resolvePhoneNumberId(body, env) {
  const input = body.input || {};
  const conversation = body.whatsapp_context?.conversation || {};
  const context = body.execution_context?.context || {};
  const candidates = [
    input.phone_number_id,
    input.phoneNumberId,
    conversation.phone_number_id,
    conversation.phoneNumberId,
    conversation.whatsapp_phone_number_id,
    context.phone_number_id,
    context.phoneNumberId,
    env.WHATSAPP_PHONE_NUMBER_ID,
  ];
  for (const candidate of candidates) {
    const text = asText(candidate);
    if (text) return text;
  }
  return null;
}

function resolveRecipient(body) {
  const input = body.input || {};
  const conversation = body.whatsapp_context?.conversation || {};
  const context = body.execution_context?.context || {};
  const messages = body.whatsapp_context?.messages || [];
  const lastInbound =
    [...messages].reverse().find(message => message?.direction === 'inbound') || {};
  const candidates = [
    input.to,
    input.recipient,
    input.recipient_phone_number,
    conversation.phone_number,
    conversation.phoneNumber,
    conversation.wa_id,
    conversation.waId,
    context.phone_number,
    context.phoneNumber,
    lastInbound.phone_number,
    lastInbound.phoneNumber,
    lastInbound.wa_id,
    lastInbound.waId,
  ];
  for (const candidate of candidates) {
    const text = asText(candidate);
    if (text) return text;
  }
  return null;
}

function flowToken(body, flowKey) {
  const system = body.execution_context?.system || {};
  const conversationId = asText(body.whatsapp_context?.conversation?.id) || 'conversation';
  const executionId =
    asText(system.workflow_execution_id) || asText(system.flow_execution_id) || 'execution';
  return `sendero:${flowKey}:${conversationId}:${executionId}`;
}

async function resolveTenantFlow(body, env, flowKey, phoneNumberId) {
  const response = await fetch(
    `${resolveAppOrigin(env).replace(/\/$/, '')}/api/internal/support/tools`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-sendero-support-secret': requireEnv(
          env.SUPPORT_TOOLS_SECRET || env.KAPSO_WEBHOOK_SECRET,
          'SUPPORT_TOOLS_SECRET'
        ),
      },
      body: JSON.stringify({
        operation: 'get_tenant_whatsapp_flow',
        input: {
          flow_key: flowKey,
          phone_number_id: phoneNumberId,
        },
        execution_context: body.execution_context || {},
        whatsapp_context: body.whatsapp_context || null,
      }),
    }
  );
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    return { ok: false, error: 'flow_registry_request_failed', status: response.status, data };
  }
  return data;
}

async function handler(request, env) {
  const body = await request.json();
  const input = body.input || {};
  const flowKey = asText(input.flow_key) || 'trip_intake';
  const catalogItem = FLOW_CATALOG[flowKey];
  if (!catalogItem) {
    return json({ ok: false, error: 'unknown_flow_key', flow_key: flowKey }, 400);
  }

  const phoneNumberId = resolvePhoneNumberId(body, env);
  const to = resolveRecipient(body);
  if (!phoneNumberId || !to) {
    return json({
      ok: false,
      error: 'missing_whatsapp_context',
      has_phone_number_id: Boolean(phoneNumberId),
      has_recipient: Boolean(to),
    });
  }

  const registry = await resolveTenantFlow(body, env, flowKey, phoneNumberId);
  if (!registry?.ok || !registry.configured || !registry.flow?.kapsoFlowId) {
    return json({
      ok: false,
      configured: false,
      error: registry?.error || registry?.reason || 'tenant_flow_not_configured',
      flow_key: flowKey,
      phone_number_id: phoneNumberId,
      registry,
    });
  }

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'flow',
      header: {
        type: 'text',
        text: asText(input.header_text) || catalogItem.header,
      },
      body: {
        text: asText(input.body_text) || catalogItem.body,
      },
      footer: {
        text: asText(input.footer_text) || catalogItem.footer,
      },
      action: {
        name: 'flow',
        parameters: {
          flow_message_version: '3',
          flow_id: registry.flow.kapsoFlowId,
          flow_cta: asText(input.cta) || catalogItem.cta,
          flow_token: flowToken(body, flowKey),
        },
      },
    },
  };

  const mode = asText(input.mode) || asText(registry.flow.mode);
  if (mode) {
    payload.interactive.action.parameters.mode = mode;
  }

  const response = await fetch(
    `${(env.KAPSO_META_BASE_URL || KAPSO_META_BASE_URL).replace(/\/$/, '')}/${phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': requireEnv(env.KAPSO_API_KEY, 'KAPSO_API_KEY'),
      },
      body: JSON.stringify(payload),
    }
  );

  const responseText = await response.text();
  let responseJson = null;
  try {
    responseJson = responseText ? JSON.parse(responseText) : null;
  } catch {
    responseJson = { raw: responseText };
  }

  return json(
    {
      ok: response.ok,
      configured: true,
      flow_key: flowKey,
      flow_id: registry.flow.kapsoFlowId,
      phone_number_id: phoneNumberId,
      recipient: to,
      response: responseJson,
    },
    response.ok ? 200 : response.status
  );
}

globalThis.__senderoTenantSendFlowMessage = {
  handler,
  resolvePhoneNumberId,
  resolveRecipient,
};
