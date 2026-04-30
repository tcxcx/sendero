/**
 * Setup-link orchestration for BYO WhatsApp onboarding.
 *
 * Sendero calls `startOnboarding` once per tenant. It:
 *   1) Creates (or reuses) a Kapso customer keyed on the Sendero tenantId.
 *   2) Generates a setup link with Sendero's preferred defaults.
 *   3) Returns the hosted onboarding URL to show the admin.
 *
 * After the admin finishes Meta embedded signup Kapso fires
 * `whatsapp.phone_number.created` to our project-scope webhook. The
 * webhook handler (apps/app route) writes the `WhatsAppInstall` row.
 *
 * Ported from desk-v1 (where the setup-link primitive did not exist),
 * adapted for Sendero per the integrate-whatsapp skill.
 */

import type { KapsoClient } from './client';
import type { CreateSetupLinkRequest, KapsoCustomer, KapsoSetupLink } from './types';

export interface StartOnboardingInput {
  /** Sendero tenant id — used as Kapso external_id so lookups stay stable. */
  tenantId: string;
  /** Tenant display name (shown in Kapso dashboards). */
  tenantName: string;
  /** Post-onboarding redirect, e.g. /dashboard/settings/channels?onboarding=whatsapp. */
  redirectUrl: string;
  /** ISO-3166-1 alpha-2 hints, e.g. ["US","BR","MX"]. */
  countryIsos?: string[];
  language?: string;
}

export interface StartOnboardingResult {
  customer: KapsoCustomer;
  setupLink: KapsoSetupLink;
}

export async function startOnboarding(
  kapso: KapsoClient,
  input: StartOnboardingInput
): Promise<StartOnboardingResult> {
  const customer = await kapso.findOrCreateCustomer({
    name: input.tenantName,
    externalCustomerId: input.tenantId,
  });

  const setupLinkInput: Partial<CreateSetupLinkRequest> = {
    allowed_connection_types: ['dedicated'],
    provision_phone_number: true,
    redirect_url: input.redirectUrl,
  };
  if (input.countryIsos?.length) {
    setupLinkInput.phone_number_country_isos = input.countryIsos;
  }
  if (input.language) {
    setupLinkInput.language = input.language;
  }

  const setupLink = await kapso.createSetupLink(customer.id, setupLinkInput);
  return { customer, setupLink };
}

/**
 * Kapso expires setup links after ~24h by default; re-issue when the
 * stored link has passed `expires_at`. Caller owns persistence.
 */
export function isSetupLinkExpired(
  link: Pick<KapsoSetupLink, 'expires_at'>,
  now = new Date()
): boolean {
  const expiry = Date.parse(link.expires_at);
  if (Number.isNaN(expiry)) return true;
  return expiry <= now.getTime();
}
