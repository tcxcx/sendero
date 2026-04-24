/**
 * Slack OAuth `state` wire format: `<payload>.<signature>`.
 *
 * `payload`  = base64url(JSON({ tenantId, exp }))
 * `signature` = base64url(HMAC-SHA256(payload, SLACK_STATE_SECRET))
 *
 * Prevents install-CSRF where an attacker forges a `state` carrying a
 * foreign `tenantId`, tricks a target into the install URL, and ends
 * up with the victim's Slack workspace bound to the attacker's tenant.
 *
 * `exp` caps the install window to 10 minutes so a stolen state can't
 * be replayed weeks later. Verification is constant-time.
 *
 * Secret resolution prefers `SLACK_STATE_SECRET` and falls back to
 * `CLERK_SECRET_KEY` so the feature degrades gracefully in dev without
 * a dedicated env var. In production, set SLACK_STATE_SECRET explicitly.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import { env } from '@sendero/env';

const STATE_TTL_MS = 10 * 60 * 1000;

export type SlackStatePayload = {
  tenantId: string;
  exp: number;
};

export type SlackStateVerifyResult = { ok: true; tenantId: string } | { ok: false; reason: string };

export function signSlackState(tenantId: string): string {
  const payload: SlackStatePayload = {
    tenantId,
    exp: Date.now() + STATE_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = hmac(encoded);
  return `${encoded}.${sig}`;
}

export function verifySlackState(state: string): SlackStateVerifyResult {
  const [encoded, sig] = state.split('.');
  if (!encoded || !sig) return { ok: false, reason: 'malformed' };

  const expected = hmac(encoded);
  if (!constantTimeEqual(sig, expected)) return { ok: false, reason: 'bad_signature' };

  let payload: SlackStatePayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SlackStatePayload;
  } catch {
    return { ok: false, reason: 'bad_payload' };
  }

  if (typeof payload.tenantId !== 'string' || !payload.tenantId) {
    return { ok: false, reason: 'missing_tenant' };
  }
  if (typeof payload.exp !== 'number' || payload.exp <= Date.now()) {
    return { ok: false, reason: 'expired' };
  }

  return { ok: true, tenantId: payload.tenantId };
}

function hmac(input: string): string {
  return createHmac('sha256', slackStateSecret()).update(input).digest('base64url');
}

function slackStateSecret(): string {
  return (
    env.slackStateSecret() ?? process.env.CLERK_SECRET_KEY ?? 'sendero-slack-state-local-dev-secret'
  );
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
