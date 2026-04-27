/**
 * Block Kit interaction dispatcher.
 *
 * Slack posts `application/x-www-form-urlencoded` with a single `payload`
 * field (JSON string). We parse it, branch on `payload.type`, then route
 * to the right registered handler:
 *   - `block_actions`     → InteractionRouter, keyed on action_id prefix
 *   - `view_submission`   → ViewRouter, keyed on view.callback_id
 *   - `view_closed`       → ViewRouter, keyed on view.callback_id (cleanup)
 *
 * `view_submission` MUST be acked synchronously inside the 3-second
 * Slack window — Slack reads the response body of the original request
 * to decide whether to close the modal, show errors, or push another.
 * No `after()` deferral for that path.
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

/**
 * View state — one entry per input block, keyed by block_id, then by
 * action_id within the block. The `value` shape varies by element:
 *   - plain_text_input → { type: 'plain_text_input', value: string }
 *   - static_select    → { type: 'static_select', selected_option: { value, text } }
 *   - datepicker       → { type: 'datepicker', selected_date: 'YYYY-MM-DD' }
 *   - checkboxes       → { type: 'checkboxes', selected_options: [{ value }] }
 * Handlers narrow at the boundary.
 */
export interface ViewStateValue {
  type: string;
  value?: string;
  selected_date?: string;
  selected_time?: string;
  selected_option?: { value: string; text?: { text: string } };
  selected_options?: Array<{ value: string; text?: { text: string } }>;
}

export interface ViewSubmissionPayload {
  type: 'view_submission';
  user: { id: string; name?: string; team_id?: string };
  team?: { id: string; domain?: string };
  enterprise?: { id: string; name?: string } | null;
  is_enterprise_install?: boolean;
  trigger_id: string;
  view: {
    id: string;
    callback_id: string;
    /** Opaque per-modal blob the opener stashed via `private_metadata`. */
    private_metadata?: string;
    state: { values: Record<string, Record<string, ViewStateValue>> };
    title?: { type: string; text: string };
    /** App-id of the opening Slack app — useful for cross-app modals. */
    app_id?: string;
    /** Root view id when this is a stacked / pushed modal. */
    root_view_id?: string;
  };
}

export interface ViewClosedPayload {
  type: 'view_closed';
  user: { id: string; name?: string; team_id?: string };
  team?: { id: string; domain?: string };
  enterprise?: { id: string; name?: string } | null;
  view: {
    id: string;
    callback_id: string;
    private_metadata?: string;
  };
  /** True when the user dismissed the entire modal stack (X button), false on Cancel. */
  is_cleared: boolean;
}

export type SlackInteractionPayload =
  | BlockActionsPayload
  | ViewSubmissionPayload
  | ViewClosedPayload;

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
export function parseInteractionBody(rawBody: string): SlackInteractionPayload | null {
  const params = new URLSearchParams(rawBody);
  const payload = params.get('payload');
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload) as { type?: string };
    if (
      parsed.type === 'block_actions' ||
      parsed.type === 'view_submission' ||
      parsed.type === 'view_closed'
    ) {
      return parsed as SlackInteractionPayload;
    }
    // Unknown / unsupported payload type — let caller silently 200.
    return null;
  } catch {
    return null;
  }
}

/**
 * Slack-spec response actions returned from `view_submission`. These
 * MUST be returned in the body of the original Slack POST — Slack
 * reads them to drive modal lifecycle (close / show errors / push next).
 *
 * `kind: 'ack'` corresponds to an empty 200 (default close behavior).
 * Errors / push / update / clear all need a populated body.
 */
export type ViewSubmissionResult =
  | { kind: 'ack' }
  | { kind: 'errors'; errors: Record<string, string> }
  | { kind: 'update'; view: unknown }
  | { kind: 'push'; view: unknown }
  | { kind: 'clear' };

export type ViewSubmissionHandler = (
  payload: ViewSubmissionPayload
) => Promise<ViewSubmissionResult>;

export type ViewClosedHandler = (payload: ViewClosedPayload) => Promise<void>;

/**
 * Routes view_submission / view_closed payloads on `view.callback_id`.
 *
 * Handlers are keyed by exact callback_id (no prefix matching — modal
 * IDs are opaque, namespaced strings the opener controls). For
 * submissions, the handler returns a `ViewSubmissionResult` the caller
 * must serialize into the HTTP response body.
 */
export class ViewRouter {
  private submissionHandlers = new Map<string, ViewSubmissionHandler>();
  private closedHandlers = new Map<string, ViewClosedHandler>();

  registerSubmission(callbackId: string, handler: ViewSubmissionHandler): this {
    this.submissionHandlers.set(callbackId, handler);
    return this;
  }

  registerClosed(callbackId: string, handler: ViewClosedHandler): this {
    this.closedHandlers.set(callbackId, handler);
    return this;
  }

  /**
   * Returns the result the caller should serialize. If no handler matches
   * the callback_id, returns `kind: 'ack'` so Slack closes the modal
   * cleanly — surfacing a 4xx for a stale registered modal would freeze
   * the user's modal in place.
   */
  async dispatchSubmission(payload: ViewSubmissionPayload): Promise<ViewSubmissionResult> {
    const handler = this.submissionHandlers.get(payload.view.callback_id);
    if (!handler) return { kind: 'ack' };
    return handler(payload);
  }

  async dispatchClosed(payload: ViewClosedPayload): Promise<{ handled: boolean }> {
    const handler = this.closedHandlers.get(payload.view.callback_id);
    if (!handler) return { handled: false };
    await handler(payload);
    return { handled: true };
  }
}

/**
 * Serialize a `ViewSubmissionResult` into the JSON body Slack expects on
 * the original request response. `kind: 'ack'` returns an empty object
 * (Slack's "close the modal" signal); the others map to the
 * `response_action` envelope.
 */
export function serializeSubmissionResult(result: ViewSubmissionResult): Record<string, unknown> {
  switch (result.kind) {
    case 'ack':
      return {};
    case 'errors':
      return { response_action: 'errors', errors: result.errors };
    case 'update':
      return { response_action: 'update', view: result.view };
    case 'push':
      return { response_action: 'push', view: result.view };
    case 'clear':
      return { response_action: 'clear' };
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
