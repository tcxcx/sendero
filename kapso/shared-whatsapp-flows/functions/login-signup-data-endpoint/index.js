function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function bool(value) {
  return value === true || value === 'true' || value === 'on' || value === 'yes';
}

function email(value) {
  const candidate = text(value).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : '';
}

function flowToken(exchange) {
  return typeof exchange.flow_token === 'string' ? exchange.flow_token : null;
}

function senderoOrigin(env) {
  return (env.SENDERO_APP_ORIGIN || env.KAPSO_WEBHOOK_BASE_URL || '').replace(/\/$/, '');
}

async function persistLoginSignup(data, body, env) {
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
      operation: 'create_whatsapp_login_signup',
      input: {
        display_name: text(data.display_name),
        email: email(data.email),
        phone: text(data.phone),
        locale: text(data.locale),
        ticket_delivery_email: email(data.email),
        nationality_iso3: text(data.nationality_iso3),
        passport_expiry: text(data.passport_expiry),
        wallet_consent: bool(data.wallet_consent),
        flow_token: flowToken(exchange),
        flow_id: body.flow?.id || null,
        meta_flow_id: body.flow?.meta_flow_id || null,
      },
      execution_context: {
        context: {
          phone_number_id: env.WHATSAPP_PHONE_NUMBER_ID || null,
          phone_number: text(data.phone) || null,
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

async function handler(request, env) {
  const body = await request.json();
  const exchange = body.data_exchange || {};
  const action = exchange.action || 'INIT';
  const screen = exchange.screen || 'ACCOUNT';
  const data = exchange.data || {};

  if (body.signature_valid === false && env.REQUIRE_FLOW_SIGNATURE === 'true') {
    return json({
      version: '3.0',
      screen: screen || 'ACCOUNT',
      data: { error_message: 'We could not verify this form session. Please reopen the form.' },
    });
  }

  if (action === 'INIT') {
    return json({ version: '3.0', screen: 'ACCOUNT', data: { error_message: '' } });
  }

  if (action === 'BACK') {
    return json({ version: '3.0', screen, data });
  }

  if (screen === 'ACCOUNT') {
    if (!text(data.display_name) || !email(data.email) || !text(data.phone) || !text(data.locale)) {
      return json({
        version: '3.0',
        screen: 'ACCOUNT',
        data: { error_message: 'Name, valid email, phone, and language are required.' },
      });
    }
    return json({
      version: '3.0',
      screen: 'TRAVELER_PROFILE',
      data: {
        display_name: text(data.display_name),
        email: email(data.email),
        phone: text(data.phone),
        locale: text(data.locale),
        error_message: '',
      },
    });
  }

  if (screen === 'TRAVELER_PROFILE' || action === 'complete') {
    if (!bool(data.wallet_consent)) {
      return json({
        version: '3.0',
        screen: 'TRAVELER_PROFILE',
        data: {
          display_name: text(data.display_name),
          email: email(data.email),
          phone: text(data.phone),
          locale: text(data.locale),
          error_message: 'Consent is required to create a persistent travel wallet.',
        },
      });
    }

    const persistence = await persistLoginSignup(data, body, env);
    if (!persistence.ok && !persistence.skipped) {
      return json({
        version: '3.0',
        screen: 'TRAVELER_PROFILE',
        data: {
          display_name: text(data.display_name),
          email: email(data.email),
          phone: text(data.phone),
          locale: text(data.locale),
          error_message:
            'We could not link your Sendero account yet. Please try again or continue in chat.',
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
            account_status:
              persistence.payload?.accountMode || persistence.error || 'verification_required',
            verification_required: 'true',
          },
        },
      },
    });
  }

  return json({ version: '3.0', screen: 'ACCOUNT', data: { error_message: '' } });
}

globalThis.__senderoLoginSignupFlowEndpoint = { handler };
