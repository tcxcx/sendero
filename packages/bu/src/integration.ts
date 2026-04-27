/**
 * Bufi integration metadata used by /dashboard/integrations and any
 * future surface that needs to advertise Bufi as a hand-off target.
 * Strings live here so copy stays consistent across the dashboard,
 * email, and docs.
 */

export const BUFI_INTEGRATION = {
  /** Slug used in URLs, logs, feature flags. */
  slug: 'bufi' as const,
  /** Display name. */
  name: 'Bufi',
  /** One-liner shown in cards + tooltips. */
  description: 'Bufi balance + payouts inside the operator console. Wait-listed for now.',
  /** Status — flipped to `available` once the integration ships. */
  status: 'coming-soon' as 'available' | 'coming-soon',
  /** Canonical "Coming soon" caption shown when status === 'coming-soon'. */
  comingSoonLabel: 'Coming soon',
} as const;

export type BufiIntegrationStatus = (typeof BUFI_INTEGRATION)['status'];

export function isBufiAvailable(): boolean {
  return BUFI_INTEGRATION.status === 'available';
}
