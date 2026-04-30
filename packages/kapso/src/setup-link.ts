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
  failureRedirectUrl?: string;
  /** ISO-3166-1 alpha-2 hints, e.g. ["US","BR","MX"]. */
  countryIsos?: string[];
  language?: string;
  /**
   * Tenant-admin links should normally connect the customer's own WABA.
   * Project-owned phone provisioning requires the Kapso project owner to
   * open the link, so it is opt-in for Sendero-internal setup only.
   */
  provisionPhoneNumber?: boolean;
  allowedConnectionTypes?: Array<'coexistence' | 'dedicated' | 'shared'>;
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
    allowed_connection_types: input.allowedConnectionTypes ?? ['coexistence', 'dedicated'],
    provision_phone_number: input.provisionPhoneNumber ?? false,
    success_redirect_url: input.redirectUrl,
    failure_redirect_url: input.failureRedirectUrl ?? input.redirectUrl,
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

export interface SetupLinkSnapshot {
  id: string;
  url: string;
  expires_at: string;
  status?: string;
  success_redirect_url?: string | null;
  failure_redirect_url?: string | null;
  provision_phone_number?: boolean;
  allowed_connection_types?: string[];
  whatsapp_setup_status?: string | null;
  whatsapp_setup_error?: string | null;
}

export function setupLinkSnapshot(link: KapsoSetupLink): SetupLinkSnapshot {
  return {
    id: link.id,
    url: link.url,
    expires_at: link.expires_at,
    status: link.status,
    success_redirect_url: link.success_redirect_url ?? null,
    failure_redirect_url: link.failure_redirect_url ?? null,
    provision_phone_number: link.provision_phone_number,
    allowed_connection_types: link.allowed_connection_types,
    whatsapp_setup_status: link.whatsapp_setup_status ?? null,
    whatsapp_setup_error: link.whatsapp_setup_error ?? null,
  };
}

export function readSetupLinkSnapshot(metadata: unknown): SetupLinkSnapshot | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const record = metadata as Record<string, unknown>;
  const nested = record.setupLink;
  const source =
    nested && typeof nested === 'object' ? (nested as Record<string, unknown>) : record;
  const id = typeof source.id === 'string' ? source.id : null;
  const url =
    typeof source.url === 'string'
      ? source.url
      : typeof record.setupLinkUrl === 'string'
        ? record.setupLinkUrl
        : null;
  const expiresAt =
    typeof source.expires_at === 'string'
      ? source.expires_at
      : typeof record.setupLinkExpiresAt === 'string'
        ? record.setupLinkExpiresAt
        : null;
  if (!id || !url || !expiresAt) return null;
  return {
    id,
    url,
    expires_at: expiresAt,
    status: typeof source.status === 'string' ? source.status : undefined,
    success_redirect_url:
      typeof source.success_redirect_url === 'string' ? source.success_redirect_url : null,
    failure_redirect_url:
      typeof source.failure_redirect_url === 'string' ? source.failure_redirect_url : null,
    provision_phone_number:
      typeof source.provision_phone_number === 'boolean'
        ? source.provision_phone_number
        : undefined,
    allowed_connection_types: Array.isArray(source.allowed_connection_types)
      ? source.allowed_connection_types.filter((item): item is string => typeof item === 'string')
      : undefined,
    whatsapp_setup_status:
      typeof source.whatsapp_setup_status === 'string' ? source.whatsapp_setup_status : null,
    whatsapp_setup_error:
      typeof source.whatsapp_setup_error === 'string' ? source.whatsapp_setup_error : null,
  };
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
