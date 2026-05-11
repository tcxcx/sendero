/**
 * UnifiedMessage — canonical envelope for the multi-channel inbox view.
 *
 * One trip can carry traffic across WhatsApp, Slack, web, email, plus
 * private operator ↔ Sendero AI dialogue. The console + trip inbox
 * render all of it in a single chronological thread, with per-channel
 * UI treatment so the operator can scan and immediately see who said
 * what to whom on which channel.
 *
 * Source mapping:
 *   - `Trip.events` JSONB ledger is the canonical store (see
 *     `apps/app/lib/trip-events.ts`). Channel handlers (WhatsApp
 *     inbound, Slack inbound, agent dispatch outbound, operator
 *     reply) all append events to this column.
 *   - `eventsToUnifiedMessages()` below maps the column into a
 *     typed `UnifiedMessage[]` that the UI consumes.
 *
 * Render contract (used by `ConversationRow`):
 *   - `direction = 'inbound'`  → traveler → us, channel-tinted bubble
 *   - `direction = 'outbound'` → us → traveler, ink-border bubble
 *     with channel watermark
 *   - `direction = 'internal'` → operator ↔ Sendero AI, ink/parchment
 *     bubble with PRIVATE pill
 */

import type { Prisma } from '@sendero/database';

import type { ChannelKey } from '@/components/console/channels';

export type Direction = 'inbound' | 'outbound' | 'internal';

export type AuthorKind = 'traveler' | 'operator' | 'agent' | 'system';

export interface UnifiedAuthor {
  kind: AuthorKind;
  /** Display name for the row (falls back to the role label). */
  displayName?: string;
  /** Initials for avatar circles. */
  initials?: string;
  /** Source-specific ids for tooltips / debugging — never rendered. */
  slackUserId?: string;
  waId?: string;
  userId?: string;
}

export type MessageKind = 'message' | 'tool_call' | 'tool_result' | 'system_note';

export type DeliveryStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed' | 'internal';

export interface UnifiedMessage {
  /** Stable id (wamid for WA, event_id for Slack, generated otherwise). */
  id: string;
  /** ISO8601 timestamp. UI computes display time. */
  at: string;
  channel: ChannelKey;
  direction: Direction;
  kind: MessageKind;
  author: UnifiedAuthor;
  /** Body text (for `kind: 'message'` and `kind: 'system_note'`). */
  body?: string;
  /** Tool call surface (for `kind: 'tool_call'`). */
  toolName?: string;
  toolArgs?: string;
  toolCost?: string;
  /** Tool result rows (for `kind: 'tool_result'`). */
  rows?: Array<Record<string, unknown>>;
  /** Delivery state — drives the "delivered ✓ / read ✓✓" tag. */
  status?: DeliveryStatus;
}

/**
 * Map a `Trip.events` JSONB column into a typed UnifiedMessage[]. The
 * column is append-only and append order is preserved by Postgres'
 * `||` operator, so the array order IS chronological. We don't re-sort.
 *
 * Tolerant of legacy event shapes — the ledger has been written by
 * three generations of channel handlers; this function never throws on
 * unknown kinds, it just returns null for that entry and the filter
 * drops it. New event kinds register here first; UI layers downstream
 * just see UnifiedMessage and don't need to know the source schema.
 */
export function eventsToUnifiedMessages(events: Prisma.JsonValue): UnifiedMessage[] {
  if (!Array.isArray(events)) return [];
  const mapped = events
    .map((raw, i): UnifiedMessage | null => mapOneEvent(raw, i))
    .filter((m): m is UnifiedMessage => m !== null);
  return normalizeMessageIds(mapped);
}

function mapOneEvent(raw: unknown, idx: number): UnifiedMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = pickString(r.id) ?? `evt-${idx}`;
  const at = pickString(r.createdAt) ?? pickString(r.at) ?? new Date(0).toISOString();
  const text = pickString(r.text);
  const direction = pickDirection(r.direction);
  const channel = pickChannel(r.channel);
  const kind = pickString(r.kind);
  const status = pickStatus(r.status);
  const authorRaw =
    r.author && typeof r.author === 'object' ? (r.author as Record<string, unknown>) : null;

  // Operator-composed inbound-reply (web composer) and the WA/Slack
  // inbound writes from the dispatch route share the same kind +
  // direction shape. Tenant-side composer writes use direction
  // 'outbound'; channel writes use 'inbound'. Either way: a "message".
  if (kind === 'inbox_reply' && direction && channel) {
    if (!text) return null;
    return {
      id,
      at,
      channel,
      direction,
      kind: 'message',
      author: authorFromInboxReply(direction, authorRaw, r),
      body: text,
      ...(status ? { status } : {}),
    };
  }

  // Agent reply — written by dispatch route after runAgentTurn returns.
  // Always outbound on a real channel, OR internal when there's no
  // trip-bound channel (private operator-AI session, doesn't pass
  // through here today but we map defensively).
  if (kind === 'agent_reply' || direction === ('agent' as unknown as string)) {
    if (!text) return null;
    return {
      id,
      at,
      channel: channel ?? 'internal',
      direction: direction ?? (channel ? 'outbound' : 'internal'),
      kind: 'message',
      author: { kind: 'agent', displayName: 'Sendero AI', initials: 'S' },
      body: text,
      ...(status ? { status } : {}),
    };
  }

  // Tool call — surface on the thread as a centered chip. Doesn't have
  // a direction the way messages do, but we use 'internal' so it groups
  // with the operator's own dialogue when filtered to PRIVATE.
  if (kind === 'tool_call') {
    return {
      id,
      at,
      channel: channel ?? 'internal',
      direction: 'internal',
      kind: 'tool_call',
      author: { kind: 'agent', displayName: 'Sendero AI', initials: 'S' },
      toolName: pickString(r.toolName) ?? 'tool',
      toolArgs: pickString(r.toolArgs),
      toolCost:
        pickString(r.priceMicroUsdc) !== undefined ? `$${pickString(r.priceMicroUsdc)}` : undefined,
    };
  }

  if (kind === 'tool_result') {
    const rowsRaw = r.rows;
    const rows = Array.isArray(rowsRaw)
      ? rowsRaw.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
      : undefined;
    return {
      id,
      at,
      channel: channel ?? 'internal',
      direction: 'internal',
      kind: 'tool_result',
      author: { kind: 'agent', displayName: 'Sendero AI', initials: 'S' },
      toolName: pickString(r.toolName) ?? 'tool',
      ...(rows ? { rows } : {}),
    };
  }

  // Workflow step transition — appended by the agent-workflow-session
  // runner's `onStep` hook so multi-step flows (book_flight, refund,
  // group_trip, …) progress visibly in MetaInbox + trip inbox in real
  // time. Mirrors Kapso's `execution events` log.
  if (kind === 'workflow_step_finished') {
    const stepLabel = pickString(r.label) ?? pickString(r.stepId) ?? 'step';
    const stepKind = pickString(r.stepKind) ?? 'tool';
    const ok = typeof r.ok === 'boolean' ? r.ok : true;
    const wfId = pickString(r.workflowId);
    const head = `${ok ? '✓' : '✕'} ${stepKind} · ${stepLabel}`;
    const body = wfId ? `${head}  ⟶  ${wfId}` : head;
    return {
      id,
      at,
      channel: 'internal',
      direction: 'internal',
      kind: 'system_note',
      author: { kind: 'agent', displayName: 'Sendero · workflow', initials: 'SW' },
      body,
    };
  }

  // Handoff lifecycle — agent escalation that pauses for an operator
  // answer. Renders inline in MetaInbox / trip inbox so the operator
  // sees the question alongside the rest of the conversation. The
  // answer event is `direction: outbound` because it ends up sent to
  // the traveler verbatim (or via reformulating turn).
  if (kind === 'handoff_requested') {
    const question = pickString(r.question) ?? text;
    if (!question) return null;
    const summary = pickString(r.summary);
    return {
      id,
      at,
      channel: channel ?? 'internal',
      direction: 'internal',
      kind: 'system_note',
      author: { kind: 'agent', displayName: 'Sendero AI', initials: 'S' },
      body: summary ? `Asked the team: ${question}\n\n${summary}` : `Asked the team: ${question}`,
    };
  }
  if (kind === 'handoff_answered') {
    if (!text) return null;
    return {
      id,
      at,
      channel: channel ?? 'internal',
      direction: 'outbound',
      kind: 'message',
      author: { kind: 'operator', displayName: 'Operator', initials: 'OP' },
      body: text,
    };
  }

  // Operator note (private from /sendero note <trip>) and explicit
  // system notes (legacy). Both render as internal-tagged messages.
  if (kind === 'operator_note' || kind === 'system_note') {
    if (!text) return null;
    return {
      id,
      at,
      channel: 'internal',
      direction: 'internal',
      kind: kind === 'system_note' ? 'system_note' : 'message',
      author:
        kind === 'system_note'
          ? { kind: 'system' }
          : authorFromInboxReply('internal', authorRaw, r),
      body: text,
    };
  }

  // Legacy fallback — generic text-bearing event with no kind. Map to
  // a private operator message so the operator at least sees the row
  // even if a future code path added an event type without updating
  // this mapper. Better-than-silently-dropping.
  if (text) {
    return {
      id,
      at,
      channel: channel ?? 'internal',
      direction: direction ?? 'internal',
      kind: 'message',
      author: authorFromInboxReply(direction ?? 'internal', authorRaw, r),
      body: text,
    };
  }

  return null;
}

// ─── helpers ────────────────────────────────────────────────────────

function pickString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function normalizeMessageIds(messages: UnifiedMessage[]): UnifiedMessage[] {
  const seenFingerprints = new Set<string>();
  const seenIds = new Map<string, number>();
  const out: UnifiedMessage[] = [];

  for (const message of messages) {
    const fingerprint = messageFingerprint(message);
    if (seenFingerprints.has(fingerprint)) continue;
    seenFingerprints.add(fingerprint);

    const count = seenIds.get(message.id) ?? 0;
    seenIds.set(message.id, count + 1);
    out.push(count === 0 ? message : { ...message, id: `${message.id}#${count + 1}` });
  }

  return out;
}

function messageFingerprint(message: UnifiedMessage): string {
  return JSON.stringify({
    id: message.id,
    at: message.at,
    channel: message.channel,
    direction: message.direction,
    kind: message.kind,
    author: message.author,
    body: message.body,
    toolName: message.toolName,
    toolArgs: message.toolArgs,
    rows: message.rows,
    status: message.status,
  });
}

function pickDirection(v: unknown): Direction | undefined {
  if (v === 'inbound' || v === 'outbound' || v === 'internal') return v;
  return undefined;
}

function pickChannel(v: unknown): ChannelKey | undefined {
  if (
    v === 'whatsapp' ||
    v === 'slack' ||
    v === 'sms' ||
    v === 'email' ||
    v === 'web' ||
    v === 'internal'
  ) {
    return v;
  }
  return undefined;
}

function pickStatus(v: unknown): DeliveryStatus | undefined {
  if (
    v === 'pending' ||
    v === 'sent' ||
    v === 'delivered' ||
    v === 'read' ||
    v === 'failed' ||
    v === 'internal'
  ) {
    return v;
  }
  return undefined;
}

function authorFromInboxReply(
  direction: Direction,
  authorRaw: Record<string, unknown> | null,
  fallbackRow: Record<string, unknown>
): UnifiedAuthor {
  // Author kind defaults from direction: inbound = traveler,
  // outbound = operator (the operator pressed Send), internal =
  // operator (private aside with Sendero AI). The agent path goes
  // through `agent_reply` not here.
  const fallbackKind: AuthorKind = direction === 'inbound' ? 'traveler' : 'operator';

  if (!authorRaw) {
    // Legacy events stamped author info on the top level (authorName,
    // authorUserId). Keep that path honest.
    const displayName = pickString(fallbackRow.authorName);
    return {
      kind: fallbackKind,
      ...(displayName ? { displayName } : {}),
      ...(typeof fallbackRow.authorUserId === 'string'
        ? { userId: fallbackRow.authorUserId as string }
        : {}),
    };
  }

  const kindRaw = pickString(authorRaw.kind);
  const kind: AuthorKind =
    kindRaw === 'traveler' || kindRaw === 'operator' || kindRaw === 'agent' || kindRaw === 'system'
      ? kindRaw
      : fallbackKind;

  return {
    kind,
    ...(pickString(authorRaw.displayName) ? { displayName: authorRaw.displayName as string } : {}),
    ...(pickString(authorRaw.initials) ? { initials: authorRaw.initials as string } : {}),
    ...(pickString(authorRaw.slackUserId) ? { slackUserId: authorRaw.slackUserId as string } : {}),
    ...(pickString(authorRaw.waId) ? { waId: authorRaw.waId as string } : {}),
    ...(pickString(authorRaw.userId) ? { userId: authorRaw.userId as string } : {}),
  };
}
