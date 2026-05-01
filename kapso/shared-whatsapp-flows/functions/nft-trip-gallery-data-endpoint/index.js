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
  const screen = exchange.screen || 'GALLERY_REQUEST';
  const data = exchange.data || {};

  if (body.signature_valid === false && env.REQUIRE_FLOW_SIGNATURE === 'true') {
    return json({ version: '3.0', screen, data: { error_message: 'Please reopen the form.' } });
  }
  if (action === 'INIT')
    return json({ version: '3.0', screen: 'GALLERY_REQUEST', data: { error_message: '' } });
  if (action === 'BACK') return json({ version: '3.0', screen, data });

  if (screen === 'GALLERY_REQUEST') {
    if (!text(data.trip_id) || !text(data.request_type)) {
      return json({
        version: '3.0',
        screen,
        data: { error_message: 'Trip ID and request type are required.' },
      });
    }
    return json({
      version: '3.0',
      screen: 'GALLERY_DETAILS',
      data: {
        trip_id: text(data.trip_id),
        request_type: text(data.request_type),
        error_message: '',
      },
    });
  }

  if (screen === 'GALLERY_DETAILS') {
    const requestType = text(data.request_type);
    const persistence = await persist(
      {
        trip_id: text(data.trip_id),
        title: `Trip gallery: ${requestType || 'request'}`,
        summary: [
          `Trip ID: ${text(data.trip_id)}`,
          `Request: ${requestType}`,
          text(data.stamp_id) ? `Stamp ID: ${text(data.stamp_id)}` : null,
          text(data.notes) ? `Notes: ${text(data.notes)}` : null,
          requestType === 'request_unlock'
            ? 'Note: NFT unlocks require verified identity or secure approval.'
            : null,
        ]
          .filter(Boolean)
          .join('\n'),
        priority: requestType === 'request_unlock' ? 'urgent' : 'normal',
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

  return json({ version: '3.0', screen: 'GALLERY_REQUEST', data: { error_message: '' } });
}

globalThis.__senderoNftTripGalleryFlowEndpoint = { handler };
