/**
 * Travel-eligibility verifier — deterministic rules only.
 *
 * Takes the sanitized vault signals + trip context (origin, destination,
 * departure date, duration, purpose) and emits a TravelEligibilityVerdict.
 * Reasons and actions are ENUM CODES — never free-form prose that could
 * reveal PII. Humanization happens client-side.
 *
 * Two layers:
 *   - Deterministic rules (this file): passport-missing, passport-expired,
 *     6-month-validity, revoked document.
 *   - Visa rules (./visa-rules.ts): lookup against the curated corridor
 *     JSON; upgraded to Sherpa API when VAULT_VISA_PROVIDER=sherpa.
 *
 * No LLM involvement. No network egress from THIS file (visa lookup is
 * separate). Fully unit-testable with a signals blob + trip fixture.
 */

import type { PassportVaultSignals } from './passport';

export type VerdictStatus = 'ok' | 'warn' | 'block';

/** Reason codes — add sparingly; each becomes a translation key client-side. */
export type VerdictReasonCode =
  | 'passport_missing'
  | 'passport_revoked'
  | 'passport_expired'
  | 'passport_expires_within_6_months_of_return'
  | 'passport_mrz_checksum_failed'
  | 'nationality_unknown'
  | 'visa_required_not_on_file'
  | 'visa_on_arrival_destination'
  | 'electronic_travel_authorization_required';

export interface VerdictReason {
  code: VerdictReasonCode;
  /**
   * Severity this specific reason contributes.  The overall verdict
   * takes the max of all reason severities.
   */
  severity: VerdictStatus;
}

export type VerdictActionId =
  | 'upload_passport'
  | 'renew_passport'
  | 'upload_visa'
  | 'apply_for_eta'
  | 'confirm_purpose_of_visit';

export interface VerdictAction {
  id: VerdictActionId;
  /** ISO 8601 date by which the action must complete, if known. */
  deadline: string | null;
}

export interface TravelEligibilityVerdict {
  status: VerdictStatus;
  reasons: VerdictReason[];
  actions: VerdictAction[];
  /** Opaque audit id the frontend can use to pull the full humanized verdict. */
  verdictId: string;
}

export interface VerifyTripInput {
  /** The sanitized vault row for the traveler. Null when no passport on file. */
  passport: PassportVaultSignals | null;
  /** Origin ISO-3 (country code, not airport). */
  originIso3: string;
  /** Destination ISO-3. */
  destinationIso3: string;
  /** Departure date (ISO 8601, date only). */
  departureDate: string;
  /** Return date (ISO 8601, date only). Null for one-way. */
  returnDate: string | null;
  /** Trip purpose — drives visa category when applicable. */
  purpose: 'business' | 'leisure' | 'transit' | 'study' | 'medical';
  /** Optional: visa doc variants already on file. */
  visaOnFile?: Array<{ destinationIso3: string; expiresOn: string | null }>;
}

/**
 * Run the deterministic rules.  Does NOT call visa APIs — those come
 * from `applyVisaRules()` in `./visa-rules.ts`, composed by the
 * workflow step.
 */
export function verifyTravelDocuments(input: VerifyTripInput): TravelEligibilityVerdict {
  const reasons: VerdictReason[] = [];
  const actions: VerdictAction[] = [];

  if (!input.passport) {
    reasons.push({ code: 'passport_missing', severity: 'block' });
    actions.push({ id: 'upload_passport', deadline: input.departureDate });
  } else {
    if (input.passport.revokedAt) {
      reasons.push({ code: 'passport_revoked', severity: 'block' });
      actions.push({ id: 'upload_passport', deadline: input.departureDate });
    }
    if (!input.passport.mrzChecksumValid) {
      reasons.push({ code: 'passport_mrz_checksum_failed', severity: 'warn' });
    }
    if (input.passport.expiresOn) {
      const departureMs = Date.parse(input.departureDate);
      const returnMs = input.returnDate ? Date.parse(input.returnDate) : departureMs;
      const expiresMs = input.passport.expiresOn.getTime();
      if (expiresMs <= departureMs) {
        reasons.push({ code: 'passport_expired', severity: 'block' });
        actions.push({ id: 'renew_passport', deadline: input.departureDate });
      } else {
        const sixMonthsAfterReturn = returnMs + 183 * 24 * 60 * 60 * 1000;
        if (expiresMs < sixMonthsAfterReturn) {
          reasons.push({
            code: 'passport_expires_within_6_months_of_return',
            severity: 'warn',
          });
          actions.push({ id: 'renew_passport', deadline: null });
        }
      }
    }
    if (!input.passport.nationalityIso3) {
      reasons.push({ code: 'nationality_unknown', severity: 'warn' });
    }
  }

  // Severity max: block > warn > ok.
  const status = collapseStatus(reasons);

  return {
    status,
    reasons,
    actions,
    verdictId: `vdct_${Math.random().toString(36).slice(2, 10)}`,
  };
}

function collapseStatus(reasons: VerdictReason[]): VerdictStatus {
  if (reasons.some(r => r.severity === 'block')) return 'block';
  if (reasons.some(r => r.severity === 'warn')) return 'warn';
  return 'ok';
}
