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

async function persist(operation, input, body, env) {
  const appOrigin = origin(env);
  const secret = env.SUPPORT_TOOLS_SECRET || env.KAPSO_WEBHOOK_SECRET;
  if (!appOrigin || !secret) return { ok: false, skipped: true };
  const exchange = body.data_exchange || {};
  const response = await fetch(`${appOrigin}/api/internal/support/tools`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-sendero-support-secret': secret },
    body: JSON.stringify({
      operation,
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
  const screen = exchange.screen || 'QUOTE_REVIEW';
  const data = exchange.data || {};

  if (body.signature_valid === false && env.REQUIRE_FLOW_SIGNATURE === 'true') {
    return json({ version: '3.0', screen, data: { error_message: 'Please reopen the form.' } });
  }
  if (action === 'INIT') {
    return json({ version: '3.0', screen: 'QUOTE_REVIEW', data: { error_message: '' } });
  }
  if (action === 'BACK') return json({ version: '3.0', screen, data });

  if (screen === 'QUOTE_REVIEW') {
    if (!text(data.trip_id) || !text(data.quote_id) || !text(data.decision)) {
      return json({
        version: '3.0',
        screen: 'QUOTE_REVIEW',
        data: { error_message: 'Trip ID, quote ID, and decision are required.' },
      });
    }
    return json({
      version: '3.0',
      screen: 'QUOTE_DETAILS',
      data: {
        trip_id: text(data.trip_id),
        quote_id: text(data.quote_id),
        selected_option: text(data.selected_option),
        decision: text(data.decision),
        error_message: '',
      },
    });
  }

  if (screen === 'QUOTE_DETAILS') {
    const persistence = await persist(
      'create_tenant_handoff',
      {
        trip_id: text(data.trip_id),
        title: `Quote ${text(data.decision) || 'review'}: ${text(data.quote_id)}`,
        summary: [
          `Quote ID: ${text(data.quote_id)}`,
          text(data.selected_option) ? `Selected option: ${text(data.selected_option)}` : null,
          `Decision: ${text(data.decision)}`,
          text(data.notes) ? `Notes: ${text(data.notes)}` : null,
        ]
          .filter(Boolean)
          .join('\n'),
        priority: text(data.decision) === 'ask_changes' ? 'urgent' : 'normal',
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

  return json({ version: '3.0', screen: 'QUOTE_REVIEW', data: { error_message: '' } });
}

globalThis.__senderoQuoteApprovalFlowEndpoint = { handler };
