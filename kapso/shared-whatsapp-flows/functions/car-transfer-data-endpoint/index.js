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
  const screen = exchange.screen || 'GROUND_BASICS';
  const data = exchange.data || {};

  if (body.signature_valid === false && env.REQUIRE_FLOW_SIGNATURE === 'true') {
    return json({ version: '3.0', screen, data: { error_message: 'Please reopen the form.' } });
  }
  if (action === 'INIT')
    return json({ version: '3.0', screen: 'GROUND_BASICS', data: { error_message: '' } });
  if (action === 'BACK') return json({ version: '3.0', screen, data });

  if (screen === 'GROUND_BASICS') {
    if (
      !text(data.service_type) ||
      !text(data.pickup) ||
      !text(data.dropoff) ||
      !text(data.pickup_time)
    ) {
      return json({
        version: '3.0',
        screen,
        data: { error_message: 'Service, pickup, dropoff, and time are required.' },
      });
    }
    return json({
      version: '3.0',
      screen: 'GROUND_DETAILS',
      data: {
        trip_id: text(data.trip_id),
        service_type: text(data.service_type),
        pickup: text(data.pickup),
        dropoff: text(data.dropoff),
        pickup_time: text(data.pickup_time),
        error_message: '',
      },
    });
  }

  if (screen === 'GROUND_DETAILS') {
    const persistence = await persist(
      {
        trip_id: text(data.trip_id),
        title: `Ground transport: ${text(data.service_type)}`,
        summary: [
          text(data.trip_id) ? `Trip ID: ${text(data.trip_id)}` : null,
          `Service: ${text(data.service_type)}`,
          `Pickup: ${text(data.pickup)}`,
          `Dropoff: ${text(data.dropoff)}`,
          `Time: ${text(data.pickup_time)}`,
          text(data.flight_number) ? `Flight: ${text(data.flight_number)}` : null,
          text(data.passengers) ? `Passengers: ${text(data.passengers)}` : null,
          text(data.vehicle_class) ? `Vehicle: ${text(data.vehicle_class)}` : null,
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

  return json({ version: '3.0', screen: 'GROUND_BASICS', data: { error_message: '' } });
}

globalThis.__senderoCarTransferFlowEndpoint = { handler };
