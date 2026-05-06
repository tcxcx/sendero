/**
 * whatsapp-sandbox-routing — DRY/KISS dev-mode outbound fallback.
 *
 * Tenant has no `WhatsAppInstall` of its own AND we're in dev →
 * `resolveSandboxOutboundInstall` falls back to the sandbox tenant's
 * install so the operator can still send. Wire goes out from the
 * sandbox phone number. Audit rows stay attributed to the sending
 * tenant via `attributionTenantId`.
 *
 * INBOUND deliberately does NOT remap. Inbound to a phoneNumberId
 * always lands on the install owner's tenant — the sender becomes a
 * customer ChannelIdentity there. This is what lets the operator
 * (also an admin User on the same tenant) text their org's sandbox
 * number from their personal phone and engage as a customer of their
 * own org. The web Admin User and the WhatsApp customer ChannelIdentity
 * are unified at the User level via `User.phone` match in
 * `ensureUserForWhatsAppIdentity`.
 *
 * Env: `SENDERO_DEV_SANDBOX_TENANT_ID` — tenant that owns the sandbox
 * install. Unset → outbound fallback no-ops (production posture).
 *
 * Dev gate: `NODE_ENV !== 'production'` OR
 * `VERCEL_ENV ∈ {undefined, development}`. Production preview/main
 * deploys NEVER fall back; missing install = `whatsapp_install_missing`.
 */

import { prisma } from '@sendero/database';
import type { WhatsAppInstall } from '@sendero/database';

function isDevMode(): boolean {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const vercelEnv = process.env.VERCEL_ENV;
  if (nodeEnv === 'production' && (vercelEnv === 'production' || vercelEnv === 'preview')) {
    return false;
  }
  return true;
}

function sandboxTenantId(): string | null {
  const id = process.env.SENDERO_DEV_SANDBOX_TENANT_ID;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

export interface SandboxOutboundResolution {
  /** The install actually used to send. */
  install: WhatsAppInstall;
  /** True iff we fell back to the sandbox tenant's install. */
  viaSandbox: boolean;
  /**
   * The originating tenant id — preserved so audit rows
   * (`WhatsAppOutboundMessage.tenantId`, MeterEvent.tenantId, etc.)
   * stay attributed to the sending tenant rather than the sandbox.
   */
  attributionTenantId: string;
}

/**
 * Find the install to use when sending outbound WhatsApp for `tenantId`.
 *
 * Real install present: returns it, `viaSandbox: false`.
 * No real install + dev mode + sandbox configured: returns sandbox
 *   install with `viaSandbox: true`, `attributionTenantId = tenantId`.
 * No real install + production: returns `null`.
 */
export async function resolveSandboxOutboundInstall(
  tenantId: string
): Promise<SandboxOutboundResolution | null> {
  const own = await prisma.whatsAppInstall.findUnique({ where: { tenantId } });
  if (own && own.status !== 'disabled') {
    return { install: own, viaSandbox: false, attributionTenantId: tenantId };
  }
  if (!isDevMode()) return null;
  const sandboxId = sandboxTenantId();
  if (!sandboxId || sandboxId === tenantId) return null;
  const sandbox = await prisma.whatsAppInstall.findUnique({
    where: { tenantId: sandboxId },
  });
  if (!sandbox || sandbox.status === 'disabled') return null;
  return { install: sandbox, viaSandbox: true, attributionTenantId: tenantId };
}
