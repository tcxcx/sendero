/**
 * Augments Clerk's `CustomJwtSessionClaims` with the metadata fields
 * we configure on the session token via Clerk dashboard:
 *
 *   Sessions → Customize session token →
 *     {
 *       "metadata": "{{user.public_metadata}}",
 *       "email":    "{{user.primary_email_address}}"
 *     }
 *
 * Once those land in the JWT, `auth().sessionClaims` carries them on
 * every authenticated request — no extra round-trip to Clerk's REST
 * API. Per-org roles + permissions are already in the token by
 * default (`org_role`, `org_permissions`, `org_id`, `org_slug`).
 */

export {};

declare global {
  /**
   * Cross-org Sendero-internal roles. Sendero is the platform; these
   * roles describe SENDERO STAFF, not vertical-tenant users. Vertical
   * tenants get scoped via Clerk Organizations + custom org roles.
   *
   * A user can hold MULTIPLE platform roles simultaneously
   * (`["superadmin", "eng"]`, `["finance", "sales"]`, etc.). The
   * canonical metadata key is `platformRoles` (array). `platformRole`
   * (string) and `role` (string) are tolerated as legacy fallbacks
   * during the Phase 7.0 → 7.2 migration.
   */
  type PlatformRole =
    | 'superadmin'
    | 'sales'
    | 'eng'
    | 'support'
    | 'finance';

  interface CustomJwtSessionClaims {
    metadata?: {
      /** Canonical: array of roles. */
      platformRoles?: readonly PlatformRole[];
      /** Phase 7.2-intermediate single-role key. Lower priority than `platformRoles`. */
      platformRole?: PlatformRole;
      /** Phase 7.0 legacy. Only `superadmin` is honored. */
      role?: string;
    };
    email?: string;
  }
}
