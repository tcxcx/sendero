/**
 * Slack OAuth v2 install flow with Enterprise Grid support.
 *
 * Sendero's 50–500 employee corporate customers frequently run on Slack
 * Enterprise Grid, where one install spans multiple workspaces
 * (`team_id`s) under a single `enterprise_id`. desk-v1 did NOT support
 * this. We fix it by:
 *   1. Requesting `orgInstall` via the URL when enterprise install is expected
 *   2. Parsing the OAuth response's `enterprise` + `is_enterprise_install`
 *   3. Persisting tokens keyed on `(enterpriseId, teamId)` with
 *      `enterpriseId` nullable for classic (non-Grid) installs.
 *
 * The TokenStore is an interface — the consuming app owns persistence
 * (Prisma, KV, whatever). This package provides the OAuth mechanics only.
 */

export interface SlackInstall {
  appId: string;
  /** Null for classic (non-Grid) installs. */
  enterpriseId: string | null;
  enterpriseName: string | null;
  teamId: string;
  teamName: string;
  botUserId: string;
  botToken: string;
  scope: string;
  isEnterpriseInstall: boolean;
  /** Installing user's Slack user id. */
  authedUserId: string;
  /** Raw response for audit / debugging. */
  raw: Record<string, unknown>;
}

export interface TokenStore {
  save: (install: SlackInstall) => Promise<void>;
  /**
   * Resolve a bot token for an incoming event. Must handle the Grid case
   * where only `enterpriseId` is known and the event carries a child
   * `teamId`.
   */
  lookup: (keys: {
    enterpriseId: string | null;
    teamId: string | null;
  }) => Promise<SlackInstall | null>;
}

export interface BuildInstallUrlConfig {
  clientId: string;
  /** Bot scopes; user scopes pass separately. */
  scopes: string[];
  /** Optional granular user-token scopes. */
  userScopes?: string[];
  /** Post-OAuth redirect, must match Slack app config. */
  redirectUri: string;
  /** Opaque state; verify on callback. Encode tenantId/userId here. */
  state: string;
  /** Set to true when targeting Enterprise Grid org-level install. */
  orgInstall?: boolean;
}

const SLACK_AUTHORIZE = 'https://slack.com/oauth/v2/authorize';
const SLACK_TOKEN_EXCHANGE = 'https://slack.com/api/oauth.v2.access';

export function buildInstallUrl(config: BuildInstallUrlConfig): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    scope: config.scopes.join(','),
    redirect_uri: config.redirectUri,
    state: config.state,
  });
  if (config.userScopes?.length) params.set('user_scope', config.userScopes.join(','));
  // `install_type=org_install` is the Grid-specific opt-in.
  if (config.orgInstall) params.set('install_type', 'org_install');
  return `${SLACK_AUTHORIZE}?${params.toString()}`;
}

export interface ExchangeCodeConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
}

/**
 * Exchange `code` for a bot token. Returns a fully-resolved install with
 * Grid metadata parsed out. Throws on non-ok Slack responses.
 */
export async function exchangeCode(config: ExchangeCodeConfig): Promise<SlackInstall> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    code: config.code,
  });

  const response = await fetch(SLACK_TOKEN_EXCHANGE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const json = (await response.json()) as {
    ok: boolean;
    error?: string;
    app_id?: string;
    authed_user?: { id?: string };
    scope?: string;
    token_type?: string;
    access_token?: string;
    bot_user_id?: string;
    team?: { id?: string; name?: string };
    enterprise?: { id?: string; name?: string } | null;
    is_enterprise_install?: boolean;
    [k: string]: unknown;
  };

  if (!json.ok || !json.access_token || !json.team?.id) {
    throw new Error(`Slack OAuth failed: ${json.error ?? 'unknown_error'}`);
  }

  return {
    appId: json.app_id ?? '',
    enterpriseId: json.enterprise?.id ?? null,
    enterpriseName: json.enterprise?.name ?? null,
    teamId: json.team.id,
    teamName: json.team.name ?? '',
    botUserId: json.bot_user_id ?? '',
    botToken: json.access_token,
    scope: json.scope ?? '',
    isEnterpriseInstall: Boolean(json.is_enterprise_install),
    authedUserId: json.authed_user?.id ?? '',
    raw: json as Record<string, unknown>,
  };
}

/**
 * Default bot scopes for Sendero's corporate travel flows.
 *
 * `users:read.email` is REQUIRED — it's how the Slack→Sendero user
 * mapper (`apps/app/lib/slack-user-mapping.ts`) reads `profile.email`
 * from `users.info` to bind the Slack member to the right Sendero User
 * row. Without it, every Slack-driven agent turn would either fall
 * back to the workspace admin (breaking per-user spend caps + audit
 * trails) or auto-provision a placeholder User that can never claim
 * itself by email match. Existing installs predating this change
 * keep working — fallback path stamps the bot installer's User —
 * but admins should re-install the Sendero app to grant the new scope
 * if they want correct per-user attribution. Surface a banner in
 * /dashboard/channels/slack when the install scope string lacks
 * `users:read.email` (TODO: sibling agent — UI banner).
 */
export const DEFAULT_BOT_SCOPES = [
  'app_mentions:read',
  'chat:write',
  'chat:write.public',
  'commands',
  'im:history',
  'im:read',
  'im:write',
  'groups:history',
  'groups:read',
  'channels:history',
  'channels:read',
  'channels:join',
  'users:read',
  'users:read.email',
  'reactions:write',
  'files:read',
];
