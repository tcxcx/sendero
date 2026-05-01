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

function origin(env) {
  return (env.SENDERO_APP_ORIGIN || env.KAPSO_WEBHOOK_BASE_URL || '').replace(/\/$/, '');
}

function flowToken(exchange) {
  return typeof exchange.flow_token === 'string' ? exchange.flow_token : null;
}

async function persist(input, body, env) {
  const appOrigin = origin(env);
  const secret = env.SUPPORT_TOOLS_SECRET || env.KAPSO_WEBHOOK_SECRET;
  if (!appOrigin || !secret) return { ok: false, skipped: true };
  const exchange = body.data_exchange || {};
  const response = await fetch(`${appOrigin}/api/internal/support/tools`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-sendero-support-secret': secret },
    body: JSON.stringify({
      operation: 'create_tenant_handoff',
      input: { ...input, flow_token: flowToken(exchange), flow_id: body.flow?.id || null },
      execution_context: {
        context: { phone_number_id: env.WHATSAPP_PHONE_NUMBER_ID || null },
        system: { flow_execution_id: flowToken(exchange) },
      },
      whatsapp_context: null,
    }),
  });
  const payload = await response.json().catch(() => null);
  return { ok: response.ok, payload };
}

async function handler(request, env) {
  const body = await request.json();
  const exchange = body.data_exchange || {};
  const action = exchange.action || 'INIT';
  const screen = exchange.screen || 'STAY_BASICS';
  const data = exchange.data || {};

  if (body.signature_valid === false && env.REQUIRE_FLOW_SIGNATURE === 'true') {
    return json({ version: '3.0', screen, data: { error_message: 'Please reopen the form.' } });
  }
  if (action === 'INIT')
    return json({ version: '3.0', screen: 'STAY_BASICS', data: { error_message: '' } });
  if (action === 'BACK') return json({ version: '3.0', screen, data });

  if (screen === 'STAY_BASICS') {
    if (!text(data.city) || !text(data.check_in) || !text(data.check_out) || !text(data.rooms)) {
      return json({
        version: '3.0',
        screen,
        data: { error_message: 'City, dates, and rooms are required.' },
      });
    }
    return json({
      version: '3.0',
      screen: 'STAY_DETAILS',
      data: {
        trip_id: text(data.trip_id),
        city: text(data.city),
        check_in: text(data.check_in),
        check_out: text(data.check_out),
        rooms: text(data.rooms),
        error_message: '',
      },
    });
  }

  if (screen === 'STAY_DETAILS') {
    const persistence = await persist(
      {
        trip_id: text(data.trip_id),
        title: `Accommodation request: ${text(data.city)}`,
        summary: [
          text(data.trip_id) ? `Trip ID: ${text(data.trip_id)}` : null,
          `City/area: ${text(data.city)}`,
          `Dates: ${text(data.check_in)} to ${text(data.check_out)}`,
          `Rooms: ${text(data.rooms)}`,
          text(data.budget) ? `Budget: ${text(data.budget)}` : null,
          text(data.loyalty_number) ? `Loyalty: ${text(data.loyalty_number)}` : null,
          list(data.amenities).length ? `Amenities: ${list(data.amenities).join(', ')}` : null,
          text(data.notes) ? `Notes: ${text(data.notes)}` : null,
        ]
          .filter(Boolean)
          .join('\n'),
        priority: 'normal',
      },
      body,
      env
    );
    if (!persistence.ok && !persistence.skipped) {
      return json({ version: '3.0', screen, data: { ...data, error_message: 'Could not save.' } });
    }
    return json({
      version: '3.0',
      screen: 'SUCCESS',
      data: {
        extension_message_response: {
          params: {
            flow_token: flowToken(exchange),
            handoff_id: persistence.payload?.handoff?.id || '',
          },
        },
      },
    });
  }

  return json({ version: '3.0', screen: 'STAY_BASICS', data: { error_message: '' } });
}

globalThis.__senderoAccommodationFlowEndpoint = { handler };
