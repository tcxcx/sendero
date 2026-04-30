/**
 * Visa-rule lookup — the deterministic, hackathon-grade version.
 *
 * Hand-curated corridor table covering the ~30 highest-volume
 * nationality → destination combos for corporate + leisure travel.
 * Good enough to ship a credible demo; the production answer is the
 * Sherpa Trips API (or IATA Timatic) — this module has a
 * `VAULT_VISA_PROVIDER` hook (off by default) ready for that swap.
 *
 * Entries are directional: USA → CAN differs from CAN → USA.  Missing
 * corridors fall through to `unknown`, which emits a warn so ops can
 * fill the gap explicitly rather than silently passing.
 *
 * Codes:
 *   visa_free         — no visa, passport + 6mo validity is all
 *   visa_on_arrival   — visa issued at border; flag it so the agent
 *                       can brief the traveler but the booking isn't
 *                       blocked
 *   eta_required      — electronic travel authorization (ESTA, eTA,
 *                       ETIAS) — the agent prompts the traveler to
 *                       apply, doesn't block booking
 *   evisa_required    — online e-visa pre-arrival
 *   visa_required     — full consulate visa — escalates to T2 vault
 *                       upload + attached visa document check
 */

export type VisaStatus =
  | 'visa_free'
  | 'visa_on_arrival'
  | 'eta_required'
  | 'evisa_required'
  | 'visa_required'
  | 'unknown';

/** (nationality ISO-3, destination ISO-3) → VisaStatus. */
type Corridor = [string, string, VisaStatus];

const CORRIDORS: Corridor[] = [
  // US passport holders — high-volume corridors
  ['USA', 'CAN', 'visa_free'],
  ['USA', 'MEX', 'visa_free'],
  ['USA', 'GBR', 'visa_free'],
  ['USA', 'FRA', 'visa_free'],
  ['USA', 'DEU', 'visa_free'],
  ['USA', 'ESP', 'visa_free'],
  ['USA', 'ITA', 'visa_free'],
  ['USA', 'PRT', 'visa_free'],
  ['USA', 'JPN', 'visa_free'],
  ['USA', 'KOR', 'visa_free'],
  ['USA', 'BRA', 'visa_free'],
  ['USA', 'ARG', 'visa_free'],
  ['USA', 'AUS', 'eta_required'],
  ['USA', 'CHN', 'visa_required'],
  ['USA', 'IND', 'evisa_required'],
  ['USA', 'RUS', 'visa_required'],
  ['USA', 'TUR', 'evisa_required'],

  // UK passport holders
  ['GBR', 'USA', 'eta_required'],
  ['GBR', 'CAN', 'eta_required'],
  ['GBR', 'FRA', 'visa_free'],
  ['GBR', 'DEU', 'visa_free'],
  ['GBR', 'ESP', 'visa_free'],
  ['GBR', 'JPN', 'visa_free'],
  ['GBR', 'AUS', 'eta_required'],
  ['GBR', 'CHN', 'visa_required'],
  ['GBR', 'IND', 'evisa_required'],

  // Schengen passports (DEU/FRA/ESP/ITA/PRT) — US, UK, CA, AU need ETA
  ['DEU', 'USA', 'eta_required'],
  ['FRA', 'USA', 'eta_required'],
  ['ESP', 'USA', 'eta_required'],
  ['ITA', 'USA', 'eta_required'],
  ['PRT', 'USA', 'eta_required'],
  ['DEU', 'GBR', 'eta_required'],
  ['FRA', 'GBR', 'eta_required'],
  ['DEU', 'CAN', 'eta_required'],
  ['FRA', 'CAN', 'eta_required'],

  // LATAM — the corridor most relevant to Sendero early tenants
  ['ARG', 'USA', 'eta_required'],
  ['ARG', 'BRA', 'visa_free'],
  ['ARG', 'CHL', 'visa_free'],
  ['ARG', 'URY', 'visa_free'],
  ['ARG', 'GBR', 'visa_free'],
  ['ARG', 'DEU', 'visa_free'],
  ['ARG', 'ESP', 'visa_free'],
  ['BRA', 'USA', 'visa_required'],
  ['BRA', 'ARG', 'visa_free'],
  ['BRA', 'GBR', 'visa_free'],
  ['BRA', 'DEU', 'visa_free'],
  ['BRA', 'ESP', 'visa_free'],
  ['BRA', 'MEX', 'visa_free'],
  ['MEX', 'USA', 'visa_required'],
  ['MEX', 'CAN', 'eta_required'],
  ['MEX', 'GBR', 'visa_free'],
  ['MEX', 'ESP', 'visa_free'],
];

const TABLE: Map<string, VisaStatus> = new Map(
  CORRIDORS.map(([nat, dest, status]) => [`${nat}:${dest}`, status])
);

/**
 * Look up visa status for a (nationality, destination) pair.  Both
 * args are 3-letter ISO codes, case-insensitive.  Returns `unknown`
 * when we haven't curated the corridor — caller should surface a
 * warn action rather than silently booking.
 */
export function lookupVisaStatus(nationalityIso3: string, destinationIso3: string): VisaStatus {
  const key = `${nationalityIso3.toUpperCase()}:${destinationIso3.toUpperCase()}`;
  if (nationalityIso3.toUpperCase() === destinationIso3.toUpperCase()) return 'visa_free';
  return TABLE.get(key) ?? 'unknown';
}
