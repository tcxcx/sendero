/**
 * Travel-eligibility verifier — three tiers, deterministic rules only.
 *
 * Picks the highest-confidence signal source it has:
 *
 *   T2 vault (PassportVaultSignals)        — MRZ checksum-validated, encrypted
 *   T1 declared (DeclaredTravelerSignals)  — traveler self-declared in onboarding
 *   T0 tenant default (string)             — admin-set tenant-wide fallback
 *
 * If *any* of the three is present we can produce a real verdict;
 * quotes and searches ship without friction.  The upload gate fires
 * only when the trip trips an escalation rule:
 *
 *   1. Destination requires a visa for the declared nationality
 *   2. Expiry within 12 months of return (declared) or 6 months (vault)
 *   3. Trip total over the tenant ceiling
 *   4. Tenant policy `requirePassportVault: true`
 *
 * Reasons are ENUM codes.  The frontend translates them into human
 * copy.  The agent never sees passport numbers, names, or exact dates.
 *
 * No LLM involvement.  No network egress.  Fully unit-testable.
 */

import type { PassportVaultSignals } from './passport';
import type { DeclaredTravelerSignals } from './declared';
import { type VisaStatus, lookupVisaStatus } from './visa-rules';

export type VerdictStatus = 'ok' | 'warn' | 'block';

export type VerdictReasonCode =
  // Document presence / integrity
  | 'passport_missing'
  | 'passport_revoked'
  | 'passport_expired'
  | 'passport_expires_within_6_months_of_return'
  | 'passport_mrz_checksum_failed'
  // Tier signals — the UI decorates these into "based on self-declared info" banners
  | 'passport_self_declared'
  | 'passport_tenant_default'
  | 'nationality_unknown'
  // Visa outcomes
  | 'visa_free'
  | 'visa_on_arrival_destination'
  | 'eta_required'
  | 'evisa_required'
  | 'visa_required_not_on_file'
  | 'visa_corridor_uncurated'
  // Policy escalation
  | 'tenant_requires_vault_upload'
  | 'high_value_trip_requires_vault'
  | 'declaration_stale_requires_reverify';

export interface VerdictReason {
  code: VerdictReasonCode;
  severity: VerdictStatus;
}

export type VerdictActionId =
  | 'upload_passport'
  | 'renew_passport'
  | 'upload_visa'
  | 'apply_for_eta'
  | 'apply_for_evisa'
  | 'confirm_purpose_of_visit'
  | 'declare_traveler_profile'
  | 'upload_passport_to_proceed';

export interface VerdictAction {
  id: VerdictActionId;
  /** ISO 8601 deadline, if known. */
  deadline: string | null;
}

export interface TravelEligibilityVerdict {
  status: VerdictStatus;
  reasons: VerdictReason[];
  actions: VerdictAction[];
  /**
   * Which tier produced this verdict.  UI uses it to show trust badges
   * ("verified" vs "self-declared" vs "tenant default").
   */
  source: 'vault' | 'declared' | 'tenant_default' | 'none';
  /** Looked-up visa status for the corridor.  null when nationality unknown. */
  visaStatus: VisaStatus | null;
  /** Opaque audit id. */
  verdictId: string;
}

export interface VerifyTripInput {
  /** T2 — MRZ-validated vault entry.  Null when not uploaded. */
  passport: PassportVaultSignals | null;
  /** T1 — user-declared profile.  Null when onboarding skipped. */
  declared?: DeclaredTravelerSignals | null;
  /** T0 — tenant-wide default nationality (ISO-3).  Null when unset. */
  tenantDefaultNationalityIso3?: string | null;
  /** Origin ISO-3 country code. */
  originIso3: string;
  /** Destination ISO-3 country code. */
  destinationIso3: string;
  /** Departure date (YYYY-MM-DD). */
  departureDate: string;
  /** Return date (YYYY-MM-DD). Null for one-way. */
  returnDate: string | null;
  /** Trip purpose. */
  purpose: 'business' | 'leisure' | 'transit' | 'study' | 'medical';
  /** Trip total in USDC (micro-USDC or decimal string). Null when unknown. */
  tripTotalUsdc?: string | null;
  /** Tenant policy flags. */
  policy?: {
    requirePassportVault?: boolean;
    vaultRequiredAboveUsdc?: number;
  };
  /** Visa documents already on file for the destination (future T3 upload). */
  visaOnFile?: Array<{ destinationIso3: string; expiresOn: string | null }>;
}

/**
 * Pick the highest-confidence tier we have and run the rules.
 */
export function verifyTravelDocuments(input: VerifyTripInput): TravelEligibilityVerdict {
  const reasons: VerdictReason[] = [];
  const actions: VerdictAction[] = [];

  const tier = pickTier(input);

  // ── 1. Document presence + integrity (per tier) ────────────────────
  if (tier.source === 'none') {
    reasons.push({ code: 'passport_missing', severity: 'warn' });
    reasons.push({ code: 'nationality_unknown', severity: 'warn' });
    actions.push({ id: 'declare_traveler_profile', deadline: null });
  } else if (tier.source === 'vault') {
    applyVaultIntegrityRules(input, reasons, actions);
  } else if (tier.source === 'declared') {
    applyDeclaredIntegrityRules(input, reasons, actions);
    reasons.push({ code: 'passport_self_declared', severity: 'ok' });
  } else if (tier.source === 'tenant_default') {
    reasons.push({ code: 'passport_tenant_default', severity: 'warn' });
    actions.push({ id: 'declare_traveler_profile', deadline: null });
  }

  // ── 2. Visa lookup (when we have a nationality) ────────────────────
  let visaStatus: VisaStatus | null = null;
  if (tier.nationalityIso3) {
    visaStatus = lookupVisaStatus(tier.nationalityIso3, input.destinationIso3);
    applyVisaStatusRules(visaStatus, input, reasons, actions);
  }

  // ── 3. Policy escalation — upload required above the line ──────────
  const mustUpgradeToVault = shouldEscalateToVault(tier.source, input, visaStatus);
  if (mustUpgradeToVault && tier.source !== 'vault') {
    reasons.push({
      code:
        input.policy?.requirePassportVault === true
          ? 'tenant_requires_vault_upload'
          : 'high_value_trip_requires_vault',
      severity: 'warn',
    });
    actions.push({
      id: 'upload_passport_to_proceed',
      deadline: input.departureDate,
    });
  }

  const status = collapseStatus(reasons);

  return {
    status,
    reasons,
    actions,
    source: tier.source,
    visaStatus,
    verdictId: `vdct_${Math.random().toString(36).slice(2, 10)}`,
  };
}

interface PickedTier {
  source: TravelEligibilityVerdict['source'];
  nationalityIso3: string | null;
  expiresOn: Date | null;
}

function pickTier(input: VerifyTripInput): PickedTier {
  if (input.passport && !input.passport.revokedAt) {
    return {
      source: 'vault',
      nationalityIso3: input.passport.nationalityIso3 ?? null,
      expiresOn: input.passport.expiresOn,
    };
  }
  if (input.declared) {
    return {
      source: 'declared',
      nationalityIso3: input.declared.declaredNationalityIso3,
      expiresOn: input.declared.declaredPassportExpiry,
    };
  }
  if (input.tenantDefaultNationalityIso3) {
    return {
      source: 'tenant_default',
      nationalityIso3: input.tenantDefaultNationalityIso3.toUpperCase(),
      expiresOn: null,
    };
  }
  return { source: 'none', nationalityIso3: null, expiresOn: null };
}

function applyVaultIntegrityRules(
  input: VerifyTripInput,
  reasons: VerdictReason[],
  actions: VerdictAction[]
): void {
  const p = input.passport;
  if (!p) return;
  if (!p.mrzChecksumValid) {
    reasons.push({ code: 'passport_mrz_checksum_failed', severity: 'warn' });
  }
  if (p.expiresOn) {
    const departureMs = Date.parse(input.departureDate);
    const returnMs = input.returnDate ? Date.parse(input.returnDate) : departureMs;
    const expiresMs = p.expiresOn.getTime();
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
  if (!p.nationalityIso3) {
    reasons.push({ code: 'nationality_unknown', severity: 'warn' });
  }
}

function applyDeclaredIntegrityRules(
  input: VerifyTripInput,
  reasons: VerdictReason[],
  actions: VerdictAction[]
): void {
  const d = input.declared;
  if (!d) return;
  const departureMs = Date.parse(input.departureDate);
  const returnMs = input.returnDate ? Date.parse(input.returnDate) : departureMs;
  const expiresMs = d.declaredPassportExpiry.getTime();
  if (expiresMs <= departureMs) {
    reasons.push({ code: 'passport_expired', severity: 'block' });
    actions.push({ id: 'renew_passport', deadline: input.departureDate });
    return;
  }
  // Declared tier uses a 12-month window — wider than vault's 6-month
  // because self-declared expiries are imprecise (month granularity)
  // and we'd rather escalate early than surprise a traveler at checkin.
  const twelveMonthsAfterReturn = returnMs + 365 * 24 * 60 * 60 * 1000;
  if (expiresMs < twelveMonthsAfterReturn) {
    reasons.push({
      code: 'passport_expires_within_6_months_of_return',
      severity: 'warn',
    });
    actions.push({ id: 'upload_passport_to_proceed', deadline: input.departureDate });
  }

  // Stale-declaration nudge: if the user self-declared > 18 months
  // ago, ask them to re-confirm so we don't ship on outdated data.
  const eighteenMonthsMs = 548 * 24 * 60 * 60 * 1000;
  if (Date.now() - d.declaredAt.getTime() > eighteenMonthsMs) {
    reasons.push({ code: 'declaration_stale_requires_reverify', severity: 'warn' });
    actions.push({ id: 'declare_traveler_profile', deadline: null });
  }
}

function applyVisaStatusRules(
  visaStatus: VisaStatus,
  input: VerifyTripInput,
  reasons: VerdictReason[],
  actions: VerdictAction[]
): void {
  const hasVisaOnFile = Boolean(
    input.visaOnFile?.some(
      v => v.destinationIso3.toUpperCase() === input.destinationIso3.toUpperCase()
    )
  );
  switch (visaStatus) {
    case 'visa_free':
      reasons.push({ code: 'visa_free', severity: 'ok' });
      break;
    case 'visa_on_arrival':
      reasons.push({ code: 'visa_on_arrival_destination', severity: 'ok' });
      break;
    case 'eta_required':
      reasons.push({ code: 'eta_required', severity: 'warn' });
      actions.push({ id: 'apply_for_eta', deadline: input.departureDate });
      break;
    case 'evisa_required':
      reasons.push({ code: 'evisa_required', severity: 'warn' });
      actions.push({ id: 'apply_for_evisa', deadline: input.departureDate });
      break;
    case 'visa_required':
      if (hasVisaOnFile) {
        reasons.push({ code: 'visa_free', severity: 'ok' });
      } else {
        reasons.push({ code: 'visa_required_not_on_file', severity: 'block' });
        actions.push({ id: 'upload_visa', deadline: input.departureDate });
      }
      break;
    case 'unknown':
      reasons.push({ code: 'visa_corridor_uncurated', severity: 'warn' });
      break;
  }
}

function shouldEscalateToVault(
  source: TravelEligibilityVerdict['source'],
  input: VerifyTripInput,
  visaStatus: VisaStatus | null
): boolean {
  if (source === 'vault') return false;
  if (input.policy?.requirePassportVault === true) return true;
  if (visaStatus === 'visa_required') return true;
  const ceiling = input.policy?.vaultRequiredAboveUsdc ?? 1500;
  if (input.tripTotalUsdc) {
    const total = Number.parseFloat(input.tripTotalUsdc);
    if (Number.isFinite(total) && total >= ceiling) return true;
  }
  return false;
}

function collapseStatus(reasons: VerdictReason[]): VerdictStatus {
  if (reasons.some(r => r.severity === 'block')) return 'block';
  if (reasons.some(r => r.severity === 'warn')) return 'warn';
  return 'ok';
}
