function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function flowToken(exchange) {
  return typeof exchange.flow_token === 'string' ? exchange.flow_token : null;
}

function senderoOrigin(env) {
  return (env.SENDERO_APP_ORIGIN || env.KAPSO_WEBHOOK_BASE_URL || '').replace(/\/$/, '');
}

async function persistSupportIntake(data, body, env) {
  const origin = senderoOrigin(env);
  const secret = env.SUPPORT_TOOLS_SECRET || env.KAPSO_WEBHOOK_SECRET;
  if (!origin || !secret) {
    return {
      ok: false,
      skipped: true,
      error: 'sendero_persistence_not_configured',
    };
  }

  const exchange = body.data_exchange || {};
  const areaTitle = AREA_TITLES[text(data.support_area)] || AREA_TITLES.other;
  const response = await fetch(`${origin}/api/internal/support/tools`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-sendero-support-secret': secret,
    },
    body: JSON.stringify({
      operation: 'create_support_ticket',
      input: {
        title: `WhatsApp support intake: ${areaTitle}`,
        summary: text(data.details) || areaTitle,
        priority: text(data.urgency) === 'urgent' ? 'urgent' : 'normal',
        source: 'whatsapp_flow',
        support_area: text(data.support_area),
        urgency: text(data.urgency),
        reference: text(data.reference),
        preferred_contact: text(data.preferred_contact),
        flow_token: flowToken(exchange),
        flow_id: body.flow?.id || null,
        meta_flow_id: body.flow?.meta_flow_id || null,
      },
      execution_context: {
        context: {
          phone_number_id: env.WHATSAPP_PHONE_NUMBER_ID || null,
        },
        system: {
          flow_execution_id: flowToken(exchange),
        },
      },
      whatsapp_context: null,
    }),
  });

  const textBody = await response.text();
  let payload = null;
  try {
    payload = textBody ? JSON.parse(textBody) : null;
  } catch {
    payload = { raw: textBody };
  }
  return {
    ok: response.ok,
    status: response.status,
    payload,
  };
}

const AREA_TITLES = {
  whatsapp_setup: 'WhatsApp setup',
  trip_booking: 'Trip or booking',
  billing_refund: 'Billing or refund',
  escrow_payment: 'Escrow or payment',
  other: 'Other request',
};

async function handler(request, env) {
  const body = await request.json();
  const exchange = body.data_exchange || {};
  const action = exchange.action || 'INIT';
  const screen = exchange.screen || 'SUPPORT_TYPE';
  const data = exchange.data || {};

  if (body.signature_valid === false && env.REQUIRE_FLOW_SIGNATURE === 'true') {
    return json({
      version: '3.0',
      screen: screen || 'SUPPORT_TYPE',
      data: { error_message: 'We could not verify this form session. Please reopen the form.' },
    });
  }

  if (action === 'INIT') {
    return json({ version: '3.0', screen: 'SUPPORT_TYPE', data: { error_message: '' } });
  }

  if (action === 'BACK') {
    return json({ version: '3.0', screen, data });
  }

  if (screen === 'SUPPORT_TYPE') {
    const supportArea = text(data.support_area);
    const urgency = text(data.urgency);
    if (!supportArea || !urgency) {
      return json({
        version: '3.0',
        screen: 'SUPPORT_TYPE',
        data: { error_message: 'Choose an area and urgency.' },
      });
    }
    return json({
      version: '3.0',
      screen: 'SUPPORT_DETAILS',
      data: {
        support_area: supportArea,
        urgency,
        area_title: AREA_TITLES[supportArea] || AREA_TITLES.other,
      },
    });
  }

  if (screen === 'SUPPORT_DETAILS' || action === 'complete') {
    if (!text(data.details)) {
      return json({
        version: '3.0',
        screen: 'SUPPORT_DETAILS',
        data: {
          support_area: text(data.support_area),
          urgency: text(data.urgency),
          area_title: AREA_TITLES[text(data.support_area)] || AREA_TITLES.other,
          error_message: 'Add a few details so Sendero support can act on this.',
        },
      });
    }

    const persistence = await persistSupportIntake(data, body, env);
    if (!persistence.ok && !persistence.skipped) {
      return json({
        version: '3.0',
        screen: 'SUPPORT_DETAILS',
        data: {
          support_area: text(data.support_area),
          urgency: text(data.urgency),
          area_title: AREA_TITLES[text(data.support_area)] || AREA_TITLES.other,
          error_message:
            'We could not save this ticket in Sendero yet. Please try again or continue in chat.',
        },
      });
    }

    return json({
      version: '3.0',
      screen: 'SUCCESS',
      data: {
        extension_message_response: {
          params: {
            flow_token: flowToken(exchange),
            sendero_saved: persistence.ok ? 'true' : 'pending',
            ticket_id: persistence.payload?.ticket?.id || '',
          },
        },
      },
    });
  }

  return json({ version: '3.0', screen: 'SUPPORT_TYPE', data: { error_message: '' } });
}

globalThis.__senderoSupportIntakeFlowEndpoint = { handler };
