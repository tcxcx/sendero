function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function list(value) {
  return Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];
}

function flowToken(exchange) {
  return typeof exchange.flow_token === 'string' ? exchange.flow_token : null;
}

function senderoOrigin(env) {
  return (env.SENDERO_APP_ORIGIN || env.KAPSO_WEBHOOK_BASE_URL || '').replace(/\/$/, '');
}

async function persistTripIntake(data, body, env) {
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
  const response = await fetch(`${origin}/api/internal/support/tools`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-sendero-support-secret': secret,
    },
    body: JSON.stringify({
      operation: 'create_trip_intake',
      input: {
        title: `WhatsApp trip intake: ${text(data.destination) || 'new trip'}`,
        destination: text(data.destination),
        origin: text(data.origin),
        start_date: text(data.start_date),
        end_date: text(data.end_date),
        trip_type: text(data.trip_type),
        budget: text(data.budget),
        notes: text(data.notes),
        traveler_name: text(data.traveler_name),
        traveler_email: text(data.traveler_email),
        traveler_phone: text(data.traveler_phone),
        traveler_count: text(data.traveler_count),
        needed_products: list(data.needed_products),
        flow_token: flowToken(exchange),
        flow_id: body.flow?.id || null,
        meta_flow_id: body.flow?.meta_flow_id || null,
      },
      execution_context: {
        context: {
          phone_number_id: env.WHATSAPP_PHONE_NUMBER_ID || null,
          phone_number: text(data.traveler_phone) || null,
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

function tripBasicsData(data, errorMessage) {
  return {
    error_message: errorMessage || '',
    destination: text(data.destination),
    origin: text(data.origin),
    start_date: text(data.start_date),
    end_date: text(data.end_date),
    trip_type: text(data.trip_type),
    budget: text(data.budget),
    notes: text(data.notes),
  };
}

function travelerData(data, errorMessage) {
  return {
    ...tripBasicsData(data, errorMessage),
    traveler_name: text(data.traveler_name),
    traveler_email: text(data.traveler_email),
    traveler_phone: text(data.traveler_phone),
    traveler_count: text(data.traveler_count),
    needed_products: list(data.needed_products),
  };
}

function summary(data) {
  const parts = [
    text(data.destination) ? `Destination: ${text(data.destination)}` : null,
    text(data.origin) ? `Origin: ${text(data.origin)}` : null,
    text(data.start_date)
      ? `Dates: ${text(data.start_date)}${text(data.end_date) ? ` to ${text(data.end_date)}` : ''}`
      : null,
    text(data.traveler_name) ? `Traveler: ${text(data.traveler_name)}` : null,
    text(data.traveler_count) ? `Travelers: ${text(data.traveler_count)}` : null,
    list(data.needed_products).length ? `Needed: ${list(data.needed_products).join(', ')}` : null,
    text(data.budget) ? `Budget: ${text(data.budget)}` : null,
  ].filter(Boolean);
  return parts.join('\n');
}

async function handler(request, env) {
  const body = await request.json();
  const exchange = body.data_exchange || {};
  const action = exchange.action || 'INIT';
  const screen = exchange.screen || 'TRIP_BASICS';
  const data = exchange.data || {};

  if (body.signature_valid === false && env.REQUIRE_FLOW_SIGNATURE === 'true') {
    return json({
      version: '3.0',
      screen: screen || 'TRIP_BASICS',
      data: { error_message: 'We could not verify this form session. Please reopen the form.' },
    });
  }

  if (action === 'INIT' || screen === 'TRIP_BASICS') {
    if (action !== 'INIT') {
      if (!text(data.destination) || !text(data.start_date) || !text(data.trip_type)) {
        return json({
          version: '3.0',
          screen: 'TRIP_BASICS',
          data: { error_message: 'Destination, start date, and trip type are required.' },
        });
      }
      return json({
        version: '3.0',
        screen: 'TRAVELERS',
        data: tripBasicsData(data),
      });
    }
    return json({ version: '3.0', screen: 'TRIP_BASICS', data: { error_message: '' } });
  }

  if (action === 'BACK') {
    return json({ version: '3.0', screen, data });
  }

  if (screen === 'TRAVELERS') {
    if (
      !text(data.traveler_name) ||
      !text(data.traveler_count) ||
      !list(data.needed_products).length
    ) {
      return json({
        version: '3.0',
        screen: 'TRAVELERS',
        data: travelerData(
          data,
          'Primary traveler, traveler count, and at least one needed product are required.'
        ),
      });
    }
    return json({
      version: '3.0',
      screen: 'APPROVAL',
      data: {
        ...travelerData(data),
        summary: summary(data),
      },
    });
  }

  if (screen === 'APPROVAL' || action === 'complete') {
    const persistence = await persistTripIntake(data, body, env);
    if (!persistence.ok && !persistence.skipped) {
      return json({
        version: '3.0',
        screen: 'APPROVAL',
        data: {
          ...travelerData(data),
          summary: summary(data),
          error_message:
            'We could not save this request in Sendero yet. Please try again or continue in chat.',
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
            trip_id: persistence.payload?.trip?.id || '',
          },
        },
      },
    });
  }

  return json({
    version: '3.0',
    screen: 'TRIP_BASICS',
    data: { error_message: '' },
  });
}

globalThis.__senderoTripIntakeFlowEndpoint = { handler };
