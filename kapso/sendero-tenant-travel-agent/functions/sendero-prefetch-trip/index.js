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
      // Concierge-magic — traveler profile vars (empty when no profile
      // row exists yet). Spec: docs/architecture/concierge-magic.md §3.2.
      traveler_profile_total_trips: '0',
      traveler_profile_last_trip_at: '',
      traveler_profile_visited_cities: '',
      traveler_profile_dietary: '',
      traveler_profile_allergies: '',
      traveler_profile_pace: '',
      traveler_profile_voice_preferred: 'false',
      traveler_profile_preferred_cabin: '',
      traveler_profile_preferred_lang: '',
      // Recurring-traveler hints — agent reads these for greeting + skip-passport.
      recurring_traveler_display_name: '',
      recurring_traveler_has_saved_passport: 'false',
      recurring_traveler_prior_trip_count: '0',
      recurring_traveler_returning_to_destination: 'false',
      ...(note ? { active_trip_note: note } : {}),
    },
  };
}

function mergeProfileVars(result) {
  const profile = result?.profile ?? {};
  const recurring = result?.recurringTraveler ?? {};
  return {
    traveler_profile_total_trips: String(profile.totalTrips ?? 0),
    traveler_profile_last_trip_at: profile.lastTripAt ?? '',
    traveler_profile_visited_cities: profile.visitedCities ?? '',
    traveler_profile_dietary: profile.dietary ?? '',
    traveler_profile_allergies: profile.allergies ?? '',
    traveler_profile_pace: profile.pace ?? '',
    traveler_profile_voice_preferred: profile.voicePreferred ? 'true' : 'false',
    traveler_profile_preferred_cabin: profile.preferredCabin ?? '',
    traveler_profile_preferred_lang: profile.preferredLang ?? '',
    recurring_traveler_display_name: recurring.displayName ?? '',
    recurring_traveler_has_saved_passport: recurring.hasSavedPassport ? 'true' : 'false',
    recurring_traveler_prior_trip_count: String(recurring.priorTripCount ?? 0),
    recurring_traveler_returning_to_destination: recurring.returningToDestination
      ? 'true'
      : 'false',
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
    // Profile vars are still populated even on no-trip — the recurring-
    // traveler greeting reads them on first-touch. Spec §3.2.
    const base = emptyVars('no_active_trip');
    return jsonResponse({ vars: { ...base.vars, ...mergeProfileVars(result) } });
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
      // Concierge-magic — profile + recurring-traveler vars.
      ...mergeProfileVars(result),
    },
  });
}
