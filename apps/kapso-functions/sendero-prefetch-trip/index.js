/**
 * sendero-prefetch-trip — Kapso graph FUNCTION node.
 *
 * Runs at the top of every workflow execution (between `start` and the
 * agent node) so the active-trip context is loaded into `vars.*`
 * BEFORE the agent reasons. Without this, the agent has to remember
 * to call `get_active_trip` itself — which is unreliable across the
 * 3+ turn dogfood flows that pushed earlier interactive cards out of
 * conversation history. With this, the system_prompt template
 * substitutes `{{vars.active_trip_iso2}}` etc. into the prompt as
 * plain text BEFORE the agent runs, so the model can't "forget".
 *
 * Required env (set via POST /platform/v1/functions/<id>/secrets):
 *   - SENDERO_API_BASE_URL   e.g. https://app.travel.sendero or ngrok host in dev
 *   - SENDERO_API_KEY        Clerk-issued ak_… for the tenant. Production model.
 *   - SENDERO_DISPATCH_SECRET (optional fallback) — paired with SENDERO_TENANT_ID for sandbox.
 *   - SENDERO_TENANT_ID       (optional fallback) — required when API_KEY is absent.
 *
 * Input shape (graph function node payload):
 *   { execution_context: { context: { phone_number } }, ... }
 *
 * Output shape (graph function node response — Kapso auto-merges into vars):
 *   { vars: {
 *       active_trip_id: string | '',
 *       active_trip_iso2: string,        // 'PE' or 'PE,CL' or ''
 *       active_trip_dates: string,        // '2026-05-11 → 2026-05-18' or ''
 *       active_trip_pnr: string,
 *       active_trip_origin: string,
 *       active_trip_destination: string,
 *       active_trip_status: 'ok' | 'no_active_trip' | 'no_traveler' | 'sendero_error',
 *     }
 *   }
 *
 * Fail-soft: any error returns vars with empty strings + status='sendero_error'
 * so the agent can still proceed and ask the user for the destination.
 */

const DEFAULT_TIMEOUT_MS = 8000;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function emptyVars(status, note) {
  return {
    vars: {
      active_trip_id: '',
      active_trip_iso2: '',
      active_trip_dates: '',
      active_trip_pnr: '',
      active_trip_origin: '',
      active_trip_destination: '',
      // Phase B.2 — open-journey state.
      active_trip_kind: '',
      active_trip_current_location: '',
      active_trip_home_iata: '',
      active_trip_status: status,
      ...(note ? { active_trip_note: note } : {}),
    },
  };
}

async function handler(request, env) {
  if (request.method !== 'POST') {
    return jsonResponse(emptyVars('sendero_error', 'method_not_allowed'), 405);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(emptyVars('sendero_error', 'invalid_json'));
  }

  const ctx = body?.execution_context?.context || {};
  const phone =
    typeof ctx.phone_number === 'string' && ctx.phone_number.trim().length > 0
      ? ctx.phone_number.trim()
      : null;

  if (!phone) {
    return jsonResponse(emptyVars('no_traveler', 'phone_number_missing'));
  }

  const baseUrl =
    typeof env.SENDERO_API_BASE_URL === 'string' && env.SENDERO_API_BASE_URL.length > 0
      ? env.SENDERO_API_BASE_URL.replace(/\/$/, '')
      : null;
  if (!baseUrl) {
    return jsonResponse(emptyVars('sendero_error', 'env_SENDERO_API_BASE_URL_missing'));
  }

  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  const forwardBody = {
    travelerPhone: phone,
    input: {},
  };
  if (env.SENDERO_API_KEY) {
    headers['X-API-Key'] = env.SENDERO_API_KEY;
  } else if (env.SENDERO_DISPATCH_SECRET && env.SENDERO_TENANT_ID) {
    headers['x-sendero-dispatch-secret'] = env.SENDERO_DISPATCH_SECRET;
    forwardBody.tenantId = env.SENDERO_TENANT_ID;
  } else {
    return jsonResponse(emptyVars('sendero_error', 'auth_env_missing'));
  }

  const url = `${baseUrl}/api/tools/get_active_trip`;

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
  } catch (e) {
    clearTimeout(timer);
    return jsonResponse(emptyVars('sendero_error', `fetch_failed:${String(e?.message || e)}`));
  } finally {
    clearTimeout(timer);
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    return jsonResponse(emptyVars('sendero_error', `invalid_json_status_${response.status}`));
  }

  if (!response.ok) {
    return jsonResponse(emptyVars('sendero_error', `upstream_status_${response.status}`));
  }

  // Sendero shape: `{ result: { status, trip?, message? } }`.
  const result = payload?.result;
  if (!result || typeof result !== 'object') {
    return jsonResponse(emptyVars('sendero_error', 'malformed_result'));
  }

  if (result.status === 'no_active_trip') {
    return jsonResponse(emptyVars('no_active_trip'));
  }
  if (result.status === 'no_traveler') {
    return jsonResponse(emptyVars('no_traveler'));
  }
  if (result.status !== 'ok' || !result.trip) {
    return jsonResponse(emptyVars('sendero_error', 'unexpected_status'));
  }

  const trip = result.trip;
  const iso2 = Array.isArray(trip.destinationCountriesIso2)
    ? trip.destinationCountriesIso2.join(',')
    : '';
  const dates = [trip.startDate, trip.endDate].filter(Boolean).join(' → ');
  const pnr = trip.latestBooking?.pnr ?? '';

  return jsonResponse({
    vars: {
      active_trip_id: trip.tripId ?? '',
      active_trip_iso2: iso2,
      active_trip_dates: dates,
      active_trip_pnr: pnr,
      active_trip_origin: trip.origin ?? '',
      active_trip_destination: trip.destination ?? '',
      // Phase B.2 — open-journey awareness.
      active_trip_kind: trip.kind ?? '',
      active_trip_current_location: trip.currentLocation ?? '',
      active_trip_home_iata: trip.homeIata ?? '',
      active_trip_status: 'ok',
    },
  });
}
