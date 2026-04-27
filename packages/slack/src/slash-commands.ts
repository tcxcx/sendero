/**
 * Slack slash-command parser + dispatcher.
 *
 * Slack POSTs slash commands as `application/x-www-form-urlencoded`
 * with the same HMAC-signed envelope as Events / Interactions, so
 * verification reuses `verifySlackSignature`. A 200 ack within 3s is
 * required; long work goes through the `response_url` after-ack.
 *
 * Routing model: command + first whitespace-separated subcommand
 * token. `/sendero note T_abc here is the note` → command=`/sendero`,
 * subcommand=`note`, args=`T_abc here is the note`. Each subcommand
 * registers its own handler — the dispatcher is just an O(1) map
 * lookup, no parsing magic.
 */

export interface SlashCommandPayload {
  command: string;
  text: string;
  /** First whitespace-delimited token of `text` — e.g. `note` from `/sendero note T_abc`. */
  subcommand: string;
  /** The remainder after the subcommand — e.g. `T_abc here is the note`. */
  args: string;
  user: { id: string; name: string };
  team: { id: string; domain: string | null };
  enterprise: { id: string; name: string | null } | null;
  channel: { id: string; name: string | null };
  responseUrl: string;
  triggerId: string;
  apiAppId: string;
  isEnterpriseInstall: boolean;
}

/**
 * Slash-command response shape.
 *
 * `text` (and optional `blocks`) are returned in the original POST
 * body for an immediate reply. Slack treats no-`response_type`-set as
 * `ephemeral`.
 *
 * Long-running work returns `kind: 'ack'` (empty 200) and posts the
 * real reply to `responseUrl` later via `respondToInteraction`.
 */
export type SlashCommandResult =
  | { kind: 'ack' }
  | {
      kind: 'reply';
      text?: string;
      blocks?: unknown[];
      responseType?: 'ephemeral' | 'in_channel';
    };

export type SlashCommandHandler = (
  payload: SlashCommandPayload
) => Promise<SlashCommandResult>;

/**
 * Parse the URL-encoded slash-command body Slack sends. Returns null
 * if the body is missing the required `command` field — caller should
 * 200 silently.
 */
export function parseSlashCommandBody(rawBody: string): SlashCommandPayload | null {
  const params = new URLSearchParams(rawBody);
  const command = params.get('command');
  if (!command) return null;

  const text = params.get('text') ?? '';
  const trimmed = text.trim();
  const firstSpace = trimmed.indexOf(' ');
  const subcommand = firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace);
  const args = firstSpace === -1 ? '' : trimmed.slice(firstSpace + 1).trim();

  return {
    command,
    text,
    subcommand,
    args,
    user: {
      id: params.get('user_id') ?? '',
      name: params.get('user_name') ?? '',
    },
    team: {
      id: params.get('team_id') ?? '',
      domain: params.get('team_domain') || null,
    },
    enterprise: params.get('enterprise_id')
      ? {
          id: params.get('enterprise_id') ?? '',
          name: params.get('enterprise_name') || null,
        }
      : null,
    channel: {
      id: params.get('channel_id') ?? '',
      name: params.get('channel_name') || null,
    },
    responseUrl: params.get('response_url') ?? '',
    triggerId: params.get('trigger_id') ?? '',
    apiAppId: params.get('api_app_id') ?? '',
    isEnterpriseInstall: params.get('is_enterprise_install') === 'true',
  };
}

/**
 * Routes `(command, subcommand)` pairs to handlers. Falling back to a
 * top-level command handler when no subcommand matches lets a command
 * print its own help text instead of getting silenced.
 */
export class SlashCommandRouter {
  private handlers = new Map<string, SlashCommandHandler>();
  private fallbacks = new Map<string, SlashCommandHandler>();

  /** Register a (command, subcommand) handler. Both keys are required. */
  register(command: string, subcommand: string, handler: SlashCommandHandler): this {
    this.handlers.set(routeKey(command, subcommand), handler);
    return this;
  }

  /** Register a fallback for `command` when no subcommand match is found. */
  registerFallback(command: string, handler: SlashCommandHandler): this {
    this.fallbacks.set(command, handler);
    return this;
  }

  async dispatch(payload: SlashCommandPayload): Promise<SlashCommandResult> {
    const exact = this.handlers.get(routeKey(payload.command, payload.subcommand));
    if (exact) return exact(payload);
    const fallback = this.fallbacks.get(payload.command);
    if (fallback) return fallback(payload);
    return { kind: 'ack' };
  }
}

/**
 * Serialize a `SlashCommandResult` into the JSON body Slack reads on the
 * original POST.
 */
export function serializeSlashCommandResult(
  result: SlashCommandResult
): Record<string, unknown> {
  if (result.kind === 'ack') return {};
  const body: Record<string, unknown> = {};
  if (result.text) body.text = result.text;
  if (result.blocks) body.blocks = result.blocks;
  body.response_type = result.responseType ?? 'ephemeral';
  return body;
}

function routeKey(command: string, subcommand: string): string {
  return `${command}::${subcommand}`;
}
