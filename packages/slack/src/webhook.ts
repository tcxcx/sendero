/**
 * Slack Events API signature verification with 5-minute replay window.
 *
 * Verifier is the load-bearing piece: HMAC-SHA256 over
 * `v0:${timestamp}:${rawBody}` using the signing secret, then constant-time
 * compare. Timestamp outside the 5-minute window is rejected to defeat
 * replay. Ported verbatim from desk-v1 (the one part that's critical to
 * get right — many OSS examples botch the buffer-length check).
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

const SLACK_SIGNATURE_VERSION = 'v0';
const REPLAY_WINDOW_SECONDS = 5 * 60;

export interface SlackVerifyConfig {
  /** `SLACK_SIGNING_SECRET` from your Slack app's Basic Information page. */
  signingSecret: string;
  /** Override for tests. */
  nowSeconds?: () => number;
}

/**
 * Verify a Slack events/interactions request.
 * Pass the raw request body exactly as received (do not re-serialize).
 */
export function verifySlackSignature(
  rawBody: string,
  headers: {
    'x-slack-request-timestamp'?: string | null;
    'x-slack-signature'?: string | null;
  },
  config: SlackVerifyConfig
): { ok: true } | { ok: false; reason: string } {
  const timestamp = headers['x-slack-request-timestamp'];
  const slackSignature = headers['x-slack-signature'];

  if (!timestamp || !slackSignature) {
    return { ok: false, reason: 'missing_headers' };
  }
  if (!config.signingSecret) {
    return { ok: false, reason: 'missing_signing_secret' };
  }

  const now = (config.nowSeconds ?? (() => Math.floor(Date.now() / 1000)))();
  const parsed = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(parsed) || Math.abs(now - parsed) > REPLAY_WINDOW_SECONDS) {
    return { ok: false, reason: 'replay_outside_window' };
  }

  const basestring = `${SLACK_SIGNATURE_VERSION}:${timestamp}:${rawBody}`;
  const expected = `${SLACK_SIGNATURE_VERSION}=${createHmac('sha256', config.signingSecret)
    .update(basestring)
    .digest('hex')}`;

  const expectedBuf = Buffer.from(expected);
  const receivedBuf = Buffer.from(slackSignature);
  if (expectedBuf.length !== receivedBuf.length) {
    return { ok: false, reason: 'signature_length_mismatch' };
  }
  if (!timingSafeEqual(expectedBuf, receivedBuf)) {
    return { ok: false, reason: 'signature_mismatch' };
  }

  return { ok: true };
}

/** URL verification challenge handler (Slack's initial subscription check). */
export function isUrlVerificationChallenge(
  parsedBody: unknown
): parsedBody is { type: 'url_verification'; challenge: string } {
  return (
    typeof parsedBody === 'object' &&
    parsedBody !== null &&
    (parsedBody as { type?: string }).type === 'url_verification' &&
    typeof (parsedBody as { challenge?: unknown }).challenge === 'string'
  );
}

/** Normalized Slack event envelope (top-level of the outer callback payload). */
export interface SlackEventEnvelope {
  token: string;
  type: 'event_callback' | 'url_verification' | string;
  team_id?: string;
  api_app_id?: string;
  event?: SlackEvent;
  authed_users?: string[];
  event_id?: string;
  event_time?: number;
  /** Populated when the install is in an Enterprise Grid. */
  enterprise_id?: string;
  is_ext_shared_channel?: boolean;
  authorizations?: Array<{
    enterprise_id: string | null;
    team_id: string | null;
    user_id: string;
    is_bot: boolean;
    is_enterprise_install?: boolean;
  }>;
}

export interface SlackEvent {
  type: string;
  user?: string;
  text?: string;
  channel?: string;
  ts?: string;
  thread_ts?: string;
  subtype?: string;
  bot_id?: string;
  app_id?: string;
  [k: string]: unknown;
}

/**
 * Derive tenant key from the event envelope — critical for Enterprise Grid
 * where one install may cover many `team_id`s. Prefer `enterprise_id` when
 * the authorization indicates an enterprise install; otherwise `team_id`.
 */
export function deriveTenantKey(envelope: SlackEventEnvelope): {
  enterpriseId: string | null;
  teamId: string | null;
  isEnterpriseInstall: boolean;
} {
  const auth = envelope.authorizations?.[0];
  const enterpriseId = auth?.enterprise_id ?? envelope.enterprise_id ?? null;
  const teamId = auth?.team_id ?? envelope.team_id ?? null;
  const isEnterpriseInstall = Boolean(auth?.is_enterprise_install);
  return { enterpriseId, teamId, isEnterpriseInstall };
}
