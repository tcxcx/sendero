/**
 * Block Kit interaction dispatcher.
 *
 * Slack posts `application/x-www-form-urlencoded` with a single `payload`
 * field (JSON string). We parse it, then route by the first action's
 * `action_id` prefix to a registered handler.
 */

export interface BlockActionsPayload {
  type: 'block_actions';
  user: { id: string; name?: string; team_id?: string };
  team?: { id: string; domain?: string };
  enterprise?: { id: string; name?: string } | null;
  is_enterprise_install?: boolean;
  channel?: { id: string; name?: string };
  message?: { ts: string; thread_ts?: string };
  response_url: string;
  trigger_id: string;
  actions: Array<{
    type: string;
    action_id: string;
    block_id?: string;
    value?: string;
    selected_option?: { value: string };
    text?: { text: string };
  }>;
}

export type InteractionHandler = (
  payload: BlockActionsPayload,
  action: BlockActionsPayload['actions'][number]
) => Promise<void>;

/** Routes action_id prefixes (e.g. `sendero_approval`) to handlers. */
export class InteractionRouter {
  private handlers = new Map<string, InteractionHandler>();

  register(prefix: string, handler: InteractionHandler): this {
    this.handlers.set(prefix, handler);
    return this;
  }

  async dispatch(payload: BlockActionsPayload): Promise<{
    handled: boolean;
    matchedPrefix: string | null;
  }> {
    for (const action of payload.actions) {
      const prefix = action.action_id.split('.')[0];
      const handler = this.handlers.get(prefix);
      if (handler) {
        await handler(payload, action);
        return { handled: true, matchedPrefix: prefix };
      }
    }
    return { handled: false, matchedPrefix: null };
  }
}

/** Parse the URL-encoded Slack interactions body into a typed payload. */
export function parseInteractionBody(rawBody: string): BlockActionsPayload | null {
  const params = new URLSearchParams(rawBody);
  const payload = params.get('payload');
  if (!payload) return null;
  try {
    return JSON.parse(payload) as BlockActionsPayload;
  } catch {
    return null;
  }
}

/**
 * POST to the interaction's `response_url` with `replace_original: true` to
 * swap out the original message (e.g. replace the approval card with a
 * "resolved" card).
 */
export async function respondToInteraction(
  responseUrl: string,
  body: {
    text?: string;
    blocks?: unknown[];
    replace_original?: boolean;
    delete_original?: boolean;
    response_type?: 'ephemeral' | 'in_channel';
  }
): Promise<void> {
  const res = await fetch(responseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Slack response_url POST failed: ${res.status}`);
  }
}
