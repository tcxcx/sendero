/**
 * Customer-account Slack-install invite wire format: `<payload>.<signature>`.
 *
 * `payload`   = base64url(JSON({ tenantId, customerAccountId, exp }))
 * `signature` = base64url(HMAC-SHA256(payload, INVITE_SIGNING_SECRET))
 *
 * Flow B (corporate-customer Slack install) needs a signed handoff from
 * the TMC operator (on `/dashboard/customer-accounts/[id]`) to the
 * corporate's Slack admin (who receives the invite via email). Without
 * a signed token, anyone with the invite URL could install Sendero
 * into an arbitrary corporate workspace and have it bind to a foreign
 * `CustomerAccount`.
 *
 * Mirrors `lib/slack-oauth-state.ts` shape so the OAuth callback can
 * use the same verify-then-branch pattern. TTL is 1h (the link travels
 * via email and may sit in an inbox for an hour) vs Slack OAuth state's
 * 10min (machine-to-machine round-trip).
 *
 * Secret resolution prefers `INVITE_SIGNING_SECRET`, falls back to
 * `SLACK_STATE_SECRET` (already used by sibling signer), then to
 * `CLERK_SECRET_KEY` so dev works without a dedicated env var. In
 * production set `INVITE_SIGNING_SECRET` explicitly + rotate quarterly.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

const INVITE_TTL_MS = 60 * 60 * 1000; // 1 hour

export type CustomerAccountInvitePayload = {
  tenantId: string;
  customerAccountId: string;
  exp: number;
};

export type CustomerAccountInviteVerifyResult =
  | { ok: true; tenantId: string; customerAccountId: string }
  | { ok: false; reason: string };

export function signCustomerAccountInvite(
  tenantId: string,
  customerAccountId: string
): string {
  const payload: CustomerAccountInvitePayload = {
    tenantId,
    customerAccountId,
    exp: Date.now() + INVITE_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = hmac(encoded);
  return `${encoded}.${sig}`;
}

export function verifyCustomerAccountInvite(
  token: string
): CustomerAccountInviteVerifyResult {
  const [encoded, sig] = token.split('.');
  if (!encoded || !sig) return { ok: false, reason: 'malformed' };

  const expected = hmac(encoded);
  if (!constantTimeEqual(sig, expected)) {
    return { ok: false, reason: 'bad_signature' };
  }

  let payload: CustomerAccountInvitePayload;
  try {
    payload = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8')
    ) as CustomerAccountInvitePayload;
  } catch {
    return { ok: false, reason: 'bad_payload' };
  }

  if (typeof payload.tenantId !== 'string' || !payload.tenantId) {
    return { ok: false, reason: 'missing_tenant' };
  }
  if (
    typeof payload.customerAccountId !== 'string' ||
    !payload.customerAccountId
  ) {
    return { ok: false, reason: 'missing_customer_account' };
  }
  if (typeof payload.exp !== 'number' || payload.exp <= Date.now()) {
    return { ok: false, reason: 'expired' };
  }

  return {
    ok: true,
    tenantId: payload.tenantId,
    customerAccountId: payload.customerAccountId,
  };
}

function hmac(input: string): string {
  return createHmac('sha256', inviteSigningSecret()).update(input).digest('base64url');
}

function inviteSigningSecret(): string {
  return (
    process.env.INVITE_SIGNING_SECRET ??
    process.env.SLACK_STATE_SECRET ??
    process.env.CLERK_SECRET_KEY ??
    'sendero-customer-account-invite-local-dev-secret'
  );
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
