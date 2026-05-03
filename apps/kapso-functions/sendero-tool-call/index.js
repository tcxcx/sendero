/**
 * sendero-tool-call — Kapso Cloudflare function.
 *
 * Single proxy that forwards an agent's tool call to Sendero's
 * /api/tools/<name> endpoint with the per-tenant Sendero API key.
 * Lives in Kapso's runtime; called by `function_tools` on the
 * agent node in `Sendero Tenant Travel Agent`.
 *
 * Why ONE proxy (not one function per tool):
 *   - Sendero's tool catalog is 85+ tools and changes weekly. One
 *     proxy lets us add new tools to the agent's reach by editing
 *     ONE workflow node, not deploying N functions.
 *   - Each function deploy is a Kapso CLI round-trip. Eliminating
 *     that for every new tool keeps the iteration fast.
 *
 * Required env (set via POST /platform/v1/functions/<id>/secrets):
 *   - SENDERO_API_BASE_URL   e.g. https://app.travel.sendero or ngrok host in dev
 *   - SENDERO_API_KEY        Clerk-issued ak_… for the tenant. PRODUCTION model.
 *   - SENDERO_TENANT_ID      Sendero tenant cuid. Used in fallback shared-secret
 *                             auth path (sandbox / dev). Optional when API_KEY is set.
 *   - SENDERO_DISPATCH_SECRET  Shared secret for the fallback auth path. Same value
 *                              as Sendero's AGENT_DISPATCH_SECRET. Optional when
 *                              API_KEY is set.
 *
 * Input shape (from the agent node):
 *   { toolName: string,
 *     input?: Record<string, unknown>,
 *     channelIdentityId?: string,
 *     travelerPhone?: string,
 *     tripId?: string }
 *
 * Output shape (returned to the agent verbatim — passthrough mode):
 *   { result }    on success — `result` is the tool's return value
 *   { error, message, tool? }   on failure — agent surfaces to user
 */

const DEFAULT_TIMEOUT_MS = 25000;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function requireEnv(value, name) {
  if (!value || typeof value !== 'string') {
    throw new Error(`Missing required runtime env: ${name}`);
  }
  return value;
}

async function handler(request, env) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

  let raw;
  try {
    raw = await request.json();
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }

  // Kapso wraps every agent tool call under `body.input` and adds a
  // `flow_info` block (see: agent_tool_called event payload). The
  // agent's own input lives one level down. Tolerate both shapes so
  // a direct invoke (testing) and a real Kapso call both work.
  const body =
    raw && typeof raw === 'object' && raw.input && typeof raw.input === 'object' ? raw.input : raw;

  const toolName = typeof body?.toolName === 'string' ? body.toolName.trim() : '';
  if (!toolName) {
    return jsonResponse({ error: 'tool_name_required' }, 400);
  }

  let baseUrl;
  try {
    baseUrl = requireEnv(env.SENDERO_API_BASE_URL, 'SENDERO_API_BASE_URL').replace(/\/$/, '');
  } catch (err) {
    return jsonResponse({ error: 'env_missing', message: err.message }, 500);
  }

  // Two auth paths. Prefer Clerk-minted API key (production); fall
  // back to shared dispatch secret + explicit tenantId (sandbox/dev,
  // mirrors Sendero's existing /api/agent/dispatch internal path).
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  const forwardBody = {
    input: body.input ?? {},
    ...(body.channelIdentityId ? { channelIdentityId: body.channelIdentityId } : {}),
    ...(body.travelerPhone ? { travelerPhone: body.travelerPhone } : {}),
    ...(body.tripId ? { tripId: body.tripId } : {}),
  };
  if (env.SENDERO_API_KEY) {
    headers['X-API-Key'] = env.SENDERO_API_KEY;
  } else if (env.SENDERO_DISPATCH_SECRET && env.SENDERO_TENANT_ID) {
    headers['x-sendero-dispatch-secret'] = env.SENDERO_DISPATCH_SECRET;
    forwardBody.tenantId = env.SENDERO_TENANT_ID;
  } else {
    return jsonResponse(
      {
        error: 'env_missing',
        message:
          'Set SENDERO_API_KEY (production) or SENDERO_DISPATCH_SECRET + SENDERO_TENANT_ID (sandbox).',
      },
      500
    );
  }

  const url = `${baseUrl}/api/tools/${encodeURIComponent(toolName)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(forwardBody),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    return jsonResponse(
      { error: 'sendero_unreachable', tool: toolName, message: String(err?.message ?? err) },
      502
    );
  } finally {
    clearTimeout(timer);
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = { error: 'sendero_invalid_response' };
  }

  // Pass the upstream status through so the agent sees a tool error
  // when Sendero rejected the call (404 unknown_tool, 403 scope_denied,
  // 500 tool_failed). Otherwise the agent treats every call as
  // successful and conditions on a misleading "ok" signal.
  return jsonResponse(payload, response.status);
}
