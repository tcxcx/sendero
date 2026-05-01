function requireEnv(value, name) {
  if (!value) throw new Error(`Missing required runtime env: ${name}`);
  return value;
}

function resolveAppOrigin(env) {
  return requireEnv(env.SENDERO_APP_ORIGIN || env.KAPSO_WEBHOOK_BASE_URL, 'SENDERO_APP_ORIGIN');
}

function asText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

// biome-ignore lint/correctness/noUnusedVariables: Kapso invokes this entrypoint by name.
async function handler(request, env) {
  const body = await request.json();
  const input = body.input || {};
  const operation = asText(input.operation);
  if (!operation) {
    return new Response(JSON.stringify({ ok: false, error: 'operation_required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
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
        operation,
        input: input.payload || input,
        execution_context: body.execution_context || {},
        whatsapp_context: body.whatsapp_context || null,
      }),
    }
  );
  return new Response(await response.text(), {
    status: response.status,
    headers: { 'Content-Type': response.headers.get('Content-Type') || 'application/json' },
  });
}
