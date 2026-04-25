/**
 * Buyer-alert pipeline for SenderoGuestEscrow `ClaimLockoutTriggered`
 * events. Pairs with the on-chain protections from v3.0.0 — once the
 * contract emits a lockout, the indexer hands the event here and we
 * fan it out across every notification channel the trip's buyer
 * (a Sendero tenant) has configured.
 *
 * Design rationale:
 * `.gstack/projects/tcxcx-sendero/ship-2026-04-24-platform-release-otp-design-20260425-040506.md`
 * (Buyer notification + fast cancel-sweep on lockout — CRITICAL).
 *
 * Why dependency-injected IO:
 *   - `@sendero/notifications` deliberately has no Prisma / viem deps.
 *   - The handler needs both, so we accept them as ports. The app
 *     wires the real implementations; tests pass stubs and assert.
 *
 * Failure model:
 *   - We use `Promise.allSettled` for the channel fanout. One channel
 *     failing must not block the others or skip the SecurityAlert
 *     write. The audit row is the source of truth, even if zero
 *     deliveries succeeded.
 */

// ──────────────────────────────────────────────────────────────────────
// Public types
// ──────────────────────────────────────────────────────────────────────

export interface ClaimLockoutEvent {
  /** On-chain bytes32 trip id. */
  tripId: `0x${string}`;
  /** Unix seconds — pulled directly from the on-chain event payload. */
  lockedUntil: bigint;
  txHash: `0x${string}`;
  blockNumber: bigint;
}

export interface TenantNotificationContacts {
  notificationContactEmail?: string | null;
  notificationSlackChannelId?: string | null;
  notificationWhatsappPhone?: string | null;
}

export interface TenantRow {
  id: string;
  displayName: string;
  metadata: TenantNotificationContacts | Record<string, unknown> | null;
}

export interface AlertSendResult {
  ok: boolean;
  error?: string;
}

/**
 * Send-method shims. The real implementations live in `apps/app/lib`
 * (Resend for email, `@slack/web-api` via `sendSlackDirect`,
 * `@sendero/whatsapp` for WhatsApp). We accept them as a port so this
 * module stays free of cross-runtime imports and is unit-testable.
 */
export interface AlertSenders {
  sendSecurityAlertEmail(to: string, subject: string, body: string): Promise<AlertSendResult>;
  sendSecurityAlertSlack(
    channelId: string,
    subject: string,
    body: string
  ): Promise<AlertSendResult>;
  sendSecurityAlertWhatsapp(
    phoneE164: string,
    subject: string,
    body: string
  ): Promise<AlertSendResult>;
}

/**
 * Ports for everything off-package. The app wires:
 *   - readBuyerAddress: viem `escrow.read.trips([tripId])` → `t.buyer`.
 *   - findTenantByBuyer: prisma.tenant.findFirst({ where: { circleWallets: { some: { address: lower } } } }).
 *   - persistAlert: prisma.securityAlert.create({ data }).
 *
 * The senders are injected separately so a tenant with all three
 * channels configured exercises three independent error paths.
 */
export interface SecurityAlertDeps {
  readBuyerAddress(tripId: `0x${string}`): Promise<`0x${string}`>;
  findTenantByBuyer(buyerAddressLower: string): Promise<TenantRow | null>;
  persistAlert(input: SecurityAlertInput): Promise<{ id: string }>;
  senders: AlertSenders;
  /** Used when building the cancel-sweep + rotate deep links. Defaults to `https://app.sendero.travel`. */
  appOrigin?: string;
}

export interface SecurityAlertInput {
  tenantId: string | null;
  kind: 'claim_lockout' | 'claim_lockout_unknown_buyer' | 'otp_rate_limit_burst' | string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  onchainTripId: `0x${string}`;
  payload: Record<string, unknown>;
}

export interface HandleClaimLockoutResult {
  notificationsSent: number;
  alertId: string;
  /** True when no Tenant row matches the on-chain buyer. */
  unknownBuyer: boolean;
}

// ──────────────────────────────────────────────────────────────────────
// Templating (terse — caller's email/Slack/WhatsApp provider handles markup)
// ──────────────────────────────────────────────────────────────────────

interface TemplateInput {
  tenantName: string;
  onchainTripId: `0x${string}`;
  lockedUntil: Date;
  cancelSweepDeepLink: string;
  rotateOtpDeepLink: string;
}

function renderClaimLockoutAlert(input: TemplateInput): { subject: string; body: string } {
  const subject = '[Sendero] Suspicious activity on trip — funds need your attention';
  const lockedIso = input.lockedUntil.toISOString();
  const body = [
    `Hello ${input.tenantName},`,
    '',
    `Three failed attempts to claim trip ${input.onchainTripId} happened in the last few minutes.`,
    `On-chain protection has locked the trip until ${lockedIso}.`,
    '',
    'Most likely this is one of:',
    '  • Your guest mistyped the code → rotate to a fresh code',
    '  • Someone with the link tried to brute-force the OTP → cancel and reclaim funds',
    '',
    `Send a fresh code: ${input.rotateOtpDeepLink}`,
    `Cancel + reclaim funds: ${input.cancelSweepDeepLink}`,
    '',
    '— Sendero Security',
  ].join('\n');
  return { subject, body };
}

// ──────────────────────────────────────────────────────────────────────
// Handler
// ──────────────────────────────────────────────────────────────────────

/**
 * Process a single ClaimLockoutTriggered event end-to-end.
 *
 * Steps:
 *   1. Resolve the buyer address via the on-chain Trip view.
 *   2. Map address → Tenant (case-insensitive on the wallet column).
 *   3. If no tenant matches → write a `claim_lockout_unknown_buyer`
 *      audit row and exit. Notifications can't be dispatched without
 *      a known recipient; ops team picks it up from the dashboard.
 *   4. Fan out via every configured channel (Promise.allSettled —
 *      partial failure must not block the audit write).
 *   5. Persist the SecurityAlert row regardless of fan-out outcome.
 *      The payload includes per-channel ok/error so a partial failure
 *      is debuggable later.
 */
export async function handleClaimLockoutTriggered(
  event: ClaimLockoutEvent,
  deps: SecurityAlertDeps
): Promise<HandleClaimLockoutResult> {
  const appOrigin = deps.appOrigin ?? 'https://app.sendero.travel';

  // 1. Read on-chain Trip.buyer
  const buyerAddress = await deps.readBuyerAddress(event.tripId);
  const buyerAddressLower = buyerAddress.toLowerCase();

  // 2. Map to Tenant
  const tenant = await deps.findTenantByBuyer(buyerAddressLower);

  // 3. Unknown buyer → audit-only branch
  if (!tenant) {
    const created = await deps.persistAlert({
      tenantId: null,
      kind: 'claim_lockout_unknown_buyer',
      severity: 'medium',
      onchainTripId: event.tripId,
      payload: {
        buyerAddress: buyerAddressLower,
        lockedUntil: event.lockedUntil.toString(),
        txHash: event.txHash,
        blockNumber: event.blockNumber.toString(),
      },
    });
    return { notificationsSent: 0, alertId: created.id, unknownBuyer: true };
  }

  // 4. Build message + fan out
  const meta = (tenant.metadata ?? {}) as TenantNotificationContacts;
  const { subject, body } = renderClaimLockoutAlert({
    tenantName: tenant.displayName,
    onchainTripId: event.tripId,
    lockedUntil: new Date(Number(event.lockedUntil) * 1000),
    cancelSweepDeepLink: `${appOrigin}/dashboard/trips/${event.tripId}/cancel?reason=lockout`,
    rotateOtpDeepLink: `${appOrigin}/dashboard/trips/${event.tripId}/resend-code`,
  });

  type ChannelOutcome = { channel: 'email' | 'slack' | 'whatsapp'; ok: boolean; error?: string };
  const sends: Promise<ChannelOutcome>[] = [];

  if (meta.notificationContactEmail) {
    sends.push(
      deps.senders
        .sendSecurityAlertEmail(meta.notificationContactEmail, subject, body)
        .then(r => ({
          channel: 'email' as const,
          ok: r.ok,
          ...(r.error ? { error: r.error } : {}),
        }))
        .catch(err => ({
          channel: 'email' as const,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        }))
    );
  }
  if (meta.notificationSlackChannelId) {
    sends.push(
      deps.senders
        .sendSecurityAlertSlack(meta.notificationSlackChannelId, subject, body)
        .then(r => ({
          channel: 'slack' as const,
          ok: r.ok,
          ...(r.error ? { error: r.error } : {}),
        }))
        .catch(err => ({
          channel: 'slack' as const,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        }))
    );
  }
  if (meta.notificationWhatsappPhone) {
    sends.push(
      deps.senders
        .sendSecurityAlertWhatsapp(meta.notificationWhatsappPhone, subject, body)
        .then(r => ({
          channel: 'whatsapp' as const,
          ok: r.ok,
          ...(r.error ? { error: r.error } : {}),
        }))
        .catch(err => ({
          channel: 'whatsapp' as const,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        }))
    );
  }

  // Promise.allSettled-equivalent: each promise above already converts
  // rejections into `{ ok: false, error }` so a plain Promise.all is
  // safe and gives us a typed array out the other side.
  const outcomes = await Promise.all(sends);
  const notificationsSent = outcomes.filter(o => o.ok).length;

  // 5. Persist audit row regardless of fanout result
  const created = await deps.persistAlert({
    tenantId: tenant.id,
    kind: 'claim_lockout',
    severity: 'high',
    onchainTripId: event.tripId,
    payload: {
      buyerAddress: buyerAddressLower,
      lockedUntil: event.lockedUntil.toString(),
      attemptCountBeforeLockout: 3,
      txHash: event.txHash,
      blockNumber: event.blockNumber.toString(),
      cancelSweepDeepLink: `${appOrigin}/dashboard/trips/${event.tripId}/cancel?reason=lockout`,
      rotateOtpDeepLink: `${appOrigin}/dashboard/trips/${event.tripId}/resend-code`,
      fanout: outcomes,
    },
  });

  return { notificationsSent, alertId: created.id, unknownBuyer: false };
}
