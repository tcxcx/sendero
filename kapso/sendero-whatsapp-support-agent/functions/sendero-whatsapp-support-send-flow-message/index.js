const KAPSO_META_BASE_URL = 'https://api.kapso.ai/meta/whatsapp';
const DEFAULT_SUPPORT_PHONE_NUMBER_ID = '1125870723936815';

const FLOW_CATALOG = {
  login_signup: {
    envVar: 'SENDERO_SUPPORT_LOGIN_SIGNUP_FLOW_ID',
    defaultFlowId: '5e22e48e-e4fb-4ef2-a2a0-dd0b4620c99e',
    header: 'Sendero account',
    body: 'Create or link your Sendero traveler profile, WhatsApp identity, travel wallet, and trip gallery.',
    footer: 'Wallets and galleries persist across future trips.',
    cta: 'Set up account',
  },
  trip_intake: {
    envVar: 'SENDERO_SUPPORT_TRIP_INTAKE_FLOW_ID',
    defaultFlowId: 'f5f06bd5-3b8e-4a61-8141-155321f29881',
    header: 'Sendero trip intake',
    body: 'Share the core trip details in WhatsApp. I will turn it into a Sendero draft for your travel team.',
    footer: 'No booking or payment is committed from this form.',
    cta: 'Plan trip',
  },
  support_intake: {
    envVar: 'SENDERO_SUPPORT_REQUEST_FLOW_ID',
    defaultFlowId: '2167e5fa-263a-420b-803a-f64482c4376c',
    header: 'Sendero support',
    body: 'Use this WhatsApp form to classify the support request and capture the details we need.',
    footer: 'Financial, escrow, and refund actions still require human approval.',
    cta: 'Open form',
  },
  quote_approval: {
    envVar: 'SENDERO_SUPPORT_QUOTE_APPROVAL_FLOW_ID',
    defaultFlowId: '6640f849-cb20-4948-b06c-25096396ebf0',
    header: 'Sendero quote',
    body: 'Review a travel quote and send your decision to the travel team. Payment and ticketing still use a secure approval link.',
    footer: 'No payment or ticketing happens inside WhatsApp.',
    cta: 'Review quote',
  },
  ancillaries: {
    envVar: 'SENDERO_SUPPORT_ANCILLARIES_FLOW_ID',
    defaultFlowId: 'a300e63e-b96c-4771-983e-29dcf6dfd4dc',
    header: 'Trip extras',
    body: 'Request bags, seats, insurance, lounge, meals, or priority boarding for an existing trip.',
    footer: 'Paid extras still require secure approval.',
    cta: 'Add extras',
  },
  disruption_help: {
    envVar: 'SENDERO_SUPPORT_DISRUPTION_HELP_FLOW_ID',
    defaultFlowId: '950c6a79-0acc-4227-8f6c-252c3da473a9',
    header: 'Travel disruption',
    body: 'Tell Sendero what changed so the travel team can help with rebooking, refunds, hotels, or transport.',
    footer: 'Urgent disruptions are routed to the operator channel.',
    cta: 'Get help',
  },
  prefund_claim: {
    envVar: 'SENDERO_SUPPORT_PREFUND_CLAIM_FLOW_ID',
    defaultFlowId: '7b139aea-9f8c-4585-a7f2-b66b0ba0a4a4',
    header: 'Prefunded trip',
    body: 'Get help claiming a prefunded trip. The secure claim code is sent to ticket email, not WhatsApp.',
    footer: 'Never paste your email claim code into WhatsApp.',
    cta: 'Claim help',
  },
  booking_change: {
    envVar: 'SENDERO_SUPPORT_BOOKING_CHANGE_FLOW_ID',
    defaultFlowId: '5b6d17a2-6c60-475f-81ff-271c859d8cc1',
    header: 'Booking change',
    body: 'Request a date, route, rebook, or cancellation change. Fare and refund actions still require secure approval.',
    footer: 'No cancellation or ticketing happens inside WhatsApp.',
    cta: 'Change booking',
  },
  accommodation: {
    envVar: 'SENDERO_SUPPORT_ACCOMMODATION_FLOW_ID',
    defaultFlowId: 'ca4f3d3c-98d2-4a7a-bba1-9f3c63aaec4f',
    header: 'Accommodation',
    body: 'Share stay dates, rooms, budget, amenities, and loyalty details for your travel team.',
    footer: 'Paid booking still requires approval.',
    cta: 'Find stay',
  },
  car_transfer: {
    envVar: 'SENDERO_SUPPORT_CAR_TRANSFER_FLOW_ID',
    defaultFlowId: 'd97cc078-1b61-47b1-b1bc-36871a634d5d',
    header: 'Ground transport',
    body: 'Request airport transfers, point-to-point rides, or car rentals with pickup, dropoff, and passenger details.',
    footer: 'Payment or confirmation still uses secure approval.',
    cta: 'Book transport',
  },
  restaurant_experience: {
    envVar: 'SENDERO_SUPPORT_RESTAURANT_EXPERIENCE_FLOW_ID',
    defaultFlowId: '715c0ab5-5132-4b99-8625-9952f9e68e64',
    header: 'Local recommendations',
    body: 'Capture cuisine, area, budget, time window, dietary needs, or experience preferences.',
    footer: 'Paid reservations need approval.',
    cta: 'Get ideas',
  },
  nft_trip_gallery: {
    envVar: 'SENDERO_SUPPORT_NFT_TRIP_GALLERY_FLOW_ID',
    defaultFlowId: '47dea4e1-e81f-485b-a1cf-479e638fe3a1',
    header: 'Trip gallery',
    body: 'View or request help with trip stamps, gallery links, and NFT unlock status.',
    footer: 'Unlocks require verification or secure approval.',
    cta: 'Open gallery',
  },
  refund_escrow: {
    envVar: 'SENDERO_SUPPORT_REFUND_ESCROW_FLOW_ID',
    defaultFlowId: '56f6605c-e6ba-4da1-b4ad-d7e8185591c2',
    header: 'Refund or escrow',
    body: 'Capture refund, escrow, settlement, or validation issues for secure human review.',
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
    DEFAULT_SUPPORT_PHONE_NUMBER_ID,
  ];
  for (const candidate of candidates) {
    const text = asText(candidate);
    if (text) return text;
  }
  return null;
}

function resolveRecipient(body) {
  const conversation = body.whatsapp_context?.conversation || {};
  const context = body.execution_context?.context || {};
  const messages = body.whatsapp_context?.messages || [];
  const lastInbound =
    [...messages].reverse().find(message => message?.direction === 'inbound') || {};
  const candidates = [
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

async function handler(request, env) {
  const body = await request.json();
  const input = body.input || {};
  const flowKey = asText(input.flow_key) || 'trip_intake';
  const catalogItem = FLOW_CATALOG[flowKey];
  if (!catalogItem) {
    return json({ ok: false, error: 'unknown_flow_key', flow_key: flowKey }, 400);
  }

  const flowId = asText(env[catalogItem.envVar]) || catalogItem.defaultFlowId;
  if (!flowId) {
    return json({
      ok: false,
      configured: false,
      error: 'whatsapp_flow_not_configured',
      flow_key: flowKey,
      missing_env: catalogItem.envVar,
    });
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
          flow_id: flowId,
          flow_cta: asText(input.cta) || catalogItem.cta,
          flow_token: flowToken(body, flowKey),
        },
      },
    },
  };

  const mode = asText(input.mode) || asText(env.SENDERO_WHATSAPP_FLOW_MODE);
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
      flow_id: flowId,
      phone_number_id: phoneNumberId,
      recipient: to,
      response: responseJson,
    },
    response.ok ? 200 : response.status
  );
}

globalThis.__senderoSupportSendFlowMessage = {
  handler,
  resolvePhoneNumberId,
  resolveRecipient,
};
