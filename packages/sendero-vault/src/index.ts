/**
 * @sendero/vault — encrypted storage + deterministic verification for
 * highly-sensitive traveler identity documents (passports, national IDs).
 *
 * Import guide for consumers:
 *
 *   // Route handlers / workflows — sanitized reads only.
 *   import { readVaultSignals, verifyTravelDocuments } from '@sendero/vault';
 *
 *   // Upload route — the one caller that encrypts.
 *   import { extractPassportFromMrz, upsertPassportVault } from '@sendero/vault';
 *
 *   // Traveler self-view (/dashboard/passport) — the one caller that decrypts.
 *   import { decryptVaultPayload } from '@sendero/vault';
 */

export {
  CURRENT_KEY_VERSION,
  dekToPgpPassword,
  deriveDek,
  newRowTag,
} from './envelope';

export type {
  PassportVaultExtractor,
  PassportVaultPayload,
  PassportVaultSignals,
  PassportVaultVariant,
  UpsertVaultInput,
  VaultActor,
  VaultTicketingRecord,
} from './passport';
export {
  decryptVaultPayload,
  readVaultSignals,
  readVaultTicketingRecord,
  revokeVault,
  upsertPassportVault,
} from './passport';

export type { EligibilityRunSummary, StartEligibilityRunInput } from './eligibility-run';
export { executeEligibilityRun, startEligibilityRun } from './eligibility-run';

export type { ExtractedPassport, ExtractFromMrzInput } from './extract';
export { extractPassportFromMrz } from './extract';

export type { DeclaredTravelerSignals } from './declared';
export {
  parseDeclaredFromMetadata,
  readDeclaredTravelerSignals,
  readTenantDefaultNationality,
  writeDeclaredTravelerSignals,
} from './declared';

export type { VisaStatus } from './visa-rules';
export { lookupVisaStatus } from './visa-rules';

export type {
  TravelEligibilityVerdict,
  VerdictAction,
  VerdictActionId,
  VerdictReason,
  VerdictReasonCode,
  VerdictStatus,
  VerifyTripInput,
} from './verify';
export { verifyTravelDocuments } from './verify';
