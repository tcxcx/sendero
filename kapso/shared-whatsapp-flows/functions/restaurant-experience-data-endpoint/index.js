function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
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
  const screen = exchange.screen || 'EXPERIENCE_BASICS';
  const data = exchange.data || {};

  if (body.signature_valid === false && env.REQUIRE_FLOW_SIGNATURE === 'true') {
    return json({ version: '3.0', screen, data: { error_message: 'Please reopen the form.' } });
  }
  if (action === 'INIT') {
    return json({ version: '3.0', screen: 'EXPERIENCE_BASICS', data: { error_message: '' } });
  }
  if (action === 'BACK') return json({ version: '3.0', screen, data });

  if (screen === 'EXPERIENCE_BASICS') {
    if (!text(data.city_or_area) || !text(data.request_type)) {
      return json({
        version: '3.0',
        screen,
        data: { error_message: 'City or area and request type are required.' },
      });
    }
    return json({
      version: '3.0',
      screen: 'EXPERIENCE_DETAILS',
      data: {
        trip_id: text(data.trip_id),
        city_or_area: text(data.city_or_area),
        request_type: text(data.request_type),
        date_time: text(data.date_time),
        error_message: '',
      },
    });
  }

  if (screen === 'EXPERIENCE_DETAILS') {
    const persistence = await persist(
      {
        trip_id: text(data.trip_id),
        title: `Recommendation request: ${text(data.request_type)}`,
        summary: [
          text(data.trip_id) ? `Trip ID: ${text(data.trip_id)}` : null,
          `Area: ${text(data.city_or_area)}`,
          `Request: ${text(data.request_type)}`,
          text(data.date_time) ? `Time window: ${text(data.date_time)}` : null,
          text(data.cuisine_or_theme) ? `Cuisine/theme: ${text(data.cuisine_or_theme)}` : null,
          text(data.budget) ? `Budget: ${text(data.budget)}` : null,
          text(data.constraints) ? `Constraints: ${text(data.constraints)}` : null,
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

  return json({ version: '3.0', screen: 'EXPERIENCE_BASICS', data: { error_message: '' } });
}

globalThis.__senderoRestaurantExperienceFlowEndpoint = { handler };
