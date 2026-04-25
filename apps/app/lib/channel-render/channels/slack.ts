/**
 * Slack channel renderer.
 *
 * Translates a `ChannelMessage` into a Slack chat.postMessage payload.
 * The operator (DM) and channel-routed (public/private) Slack UIs both
 * consume the same Block Kit blocks, so this renderer's output flows
 * straight into the existing `@sendero/slack` send helpers.
 *
 * Reference: https://api.slack.com/reference/block-kit/blocks
 *
 * Channel + thread_ts are populated by the SENDER, not the renderer.
 * The renderer emits `channel: ''` and `thread_ts: undefined`; the
 * downstream send helper (e.g. `sendApprovalRequest`) fills both from
 * its own context (DM open response, parent message ts, etc.). This
 * keeps the renderer pure: canonical message in, native shape out, no
 * runtime dependency on Slack identifiers.
 *
 * The approval kind reuses `buildApprovalBlocks` from `@sendero/slack`
 * so this canonical renderer and the existing `sendApprovalRequest`
 * path produce byte-identical Block Kit. When folding the legacy path
 * into this renderer in a follow-up, the only change should be the
 * call site, not the rendered blocks.
 *
 * Returns null when the canonical kind is intentionally not relayed
 * to Slack (reasoning, raw tool_result without share, empty sources).
 */

import { buildApprovalBlocks } from '@sendero/slack';
import type {
  ChannelCta,
  ChannelMessage,
  ChannelMessageCard,
  ChannelMessageToolResult,
  ChannelRenderer,
  RenderedForChannel,
} from '../types';

/**
 * Slack chat.postMessage subset. Use Slack's KnownBlock when narrowing
 * downstream — kept loose here so this renderer doesn't pull
 * `@slack/web-api` types into the channel-render package.
 */
export interface SlackPayload {
  channel: string;
  thread_ts?: string;
  text: string;
  blocks?: unknown[];
  attachments?: unknown[];
}

const MAX_SECTION_TEXT = 2900;
const MAX_BUTTONS_PER_ACTIONS_BLOCK = 5;

export const renderForSlack: ChannelRenderer<SlackPayload> = (
  msg: ChannelMessage
): RenderedForChannel<SlackPayload> | null => {
  switch (msg.kind) {
    case 'text':
      return renderText(msg.content);
    case 'card':
      return renderCard(msg);
    case 'tool_invocation':
      return renderToolInvocation(msg.toolName);
    case 'tool_result':
      return renderToolResult(msg);
    case 'approval_request':
      return renderApprovalRequest(msg);
    case 'reasoning':
      // Reasoning is operator-only by design. Slack never sees raw
      // model thinking — surfacing it would leak the agent's
      // intermediate state to travelers and approvers.
      return null;
    case 'sources':
      return renderSources(msg.items);
    default:
      return exhaustive(msg);
  }
};

function renderText(content: string): RenderedForChannel<SlackPayload> {
  const mrkdwn = toSlackMrkdwn(content);
  const truncated = truncate(mrkdwn, MAX_SECTION_TEXT);
  return {
    channel: 'slack',
    payload: {
      channel: '',
      thread_ts: undefined,
      text: stripMrkdwn(truncated),
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: truncated },
        },
      ],
    },
  };
}

function renderCard(msg: ChannelMessageCard): RenderedForChannel<SlackPayload> {
  const blocks: unknown[] = [];

  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: truncate(msg.title, 150), emoji: true },
  });

  if (msg.body) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: truncate(toSlackMrkdwn(msg.body), MAX_SECTION_TEXT),
      },
    });
  }

  if (msg.bullets && msg.bullets.length > 0) {
    const bulletText = msg.bullets.map(b => `• ${toSlackMrkdwn(b)}`).join('\n');
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: truncate(bulletText, MAX_SECTION_TEXT) },
    });
  }

  if (msg.imageUrl) {
    blocks.push({
      type: 'image',
      image_url: msg.imageUrl,
      alt_text: msg.title || 'Sendero card',
    });
  }

  if (msg.ctas && msg.ctas.length > 0) {
    blocks.push(...buildActionsBlocks(msg.ctas));
  }

  return {
    channel: 'slack',
    payload: {
      channel: '',
      thread_ts: undefined,
      text: msg.title,
      blocks,
    },
  };
}

function renderToolInvocation(toolName: string): RenderedForChannel<SlackPayload> {
  // In-flight tool calls don't have a clean Slack representation the
  // way the operator console does. Emit a single mrkdwn line so the
  // operator (when this is their DM) sees something rather than a
  // dropped message. Callers gate this kind to operator-DM
  // destinations; the `degraded: true` flag signals the lossy mapping.
  const text = `_Sendero AI invoking \`${toolName}\`..._`;
  return {
    channel: 'slack',
    degraded: true,
    payload: {
      channel: '',
      thread_ts: undefined,
      text: `Sendero AI invoking ${toolName}`,
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text },
        },
      ],
    },
  };
}

function renderToolResult(msg: ChannelMessageToolResult): RenderedForChannel<SlackPayload> | null {
  // Raw tool results never reach Slack verbatim. Only the agent-curated
  // `share` block is safe to surface to operator + traveler.
  if (!msg.share) return null;

  const blocks: unknown[] = [];

  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: truncate(msg.share.title, 150), emoji: true },
  });

  if (msg.share.body) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: truncate(toSlackMrkdwn(msg.share.body), MAX_SECTION_TEXT),
      },
    });
  }

  if (msg.share.bullets && msg.share.bullets.length > 0) {
    const bulletText = msg.share.bullets.map(b => `• ${toSlackMrkdwn(b)}`).join('\n');
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: truncate(bulletText, MAX_SECTION_TEXT) },
    });
  }

  if (msg.share.imageUrl) {
    blocks.push({
      type: 'image',
      image_url: msg.share.imageUrl,
      alt_text: msg.share.title || 'Sendero card',
    });
  }

  const ctas: ChannelCta[] = [];
  if (msg.share.primaryCta) ctas.push(msg.share.primaryCta);
  if (msg.share.secondaryCtas) ctas.push(...msg.share.secondaryCtas);
  if (ctas.length > 0) {
    blocks.push(...buildActionsBlocks(ctas));
  }

  return {
    channel: 'slack',
    payload: {
      channel: '',
      thread_ts: undefined,
      text: msg.share.title,
      blocks,
    },
  };
}

function renderApprovalRequest(msg: {
  id: string;
  subject: {
    travelerName: string;
    route: string;
    amountUsd: number;
    expiresAt?: string;
    reason?: string;
  };
  reviewUrl?: string;
}): RenderedForChannel<SlackPayload> {
  // Reuse the canonical Slack approval card. tenantId + tripId are
  // populated by the caller — this renderer is a pure mapper and does
  // not touch the DB. The send-helper wraps the blocks with a real
  // tenantId/tripId before chat.postMessage. bookingId doubles as the
  // canonical ChannelMessage id so the interaction round-trip lands
  // on the right record.
  const blocks = buildApprovalBlocks(
    {
      tenantId: '',
      tripId: '',
      bookingId: msg.id,
      travelerName: msg.subject.travelerName,
      route: msg.subject.route,
      departAt: msg.subject.expiresAt ?? '',
      amountUsd: msg.subject.amountUsd,
      fareClass: '',
      policyReasons: msg.subject.reason ? [msg.subject.reason] : undefined,
    },
    msg.reviewUrl
  );

  return {
    channel: 'slack',
    payload: {
      channel: '',
      thread_ts: undefined,
      text: `Approval requested: ${msg.subject.travelerName}`,
      blocks: blocks as unknown[],
    },
  };
}

function renderSources(
  items: Array<{ title: string; url: string; snippet?: string; faviconUrl?: string }>
): RenderedForChannel<SlackPayload> | null {
  if (items.length === 0) return null;

  const linksMrkdwn = items.map(it => `<${it.url}|${escapeMrkdwn(it.title)}>`).join(' · ');
  return {
    channel: 'slack',
    payload: {
      channel: '',
      thread_ts: undefined,
      text: `Sources: ${items.map(it => it.title).join(', ')}`,
      blocks: [
        {
          type: 'context',
          elements: [{ type: 'mrkdwn', text: truncate(linksMrkdwn, MAX_SECTION_TEXT) }],
        },
      ],
    },
  };
}

function buildActionsBlocks(ctas: ChannelCta[]): unknown[] {
  const elements = ctas.map(cta => ctaToButton(cta));
  const blocks: unknown[] = [];
  for (let i = 0; i < elements.length; i += MAX_BUTTONS_PER_ACTIONS_BLOCK) {
    blocks.push({
      type: 'actions',
      elements: elements.slice(i, i + MAX_BUTTONS_PER_ACTIONS_BLOCK),
    });
  }
  return blocks;
}

function ctaToButton(cta: ChannelCta): Record<string, unknown> {
  const text = { type: 'plain_text', text: cta.label, emoji: true } as const;
  const style = cta.emphasis === 'primary' ? 'primary' : undefined;

  if (cta.kind === 'open_link') {
    const btn: Record<string, unknown> = {
      type: 'button',
      text,
      action_id: 'sendero_open_link',
      url: cta.href ?? cta.value ?? '',
    };
    if (cta.value) btn.value = cta.value;
    if (style) btn.style = style;
    return btn;
  }

  // Stable action_id matches the prefix convention enforced by
  // `apps/app/app/api/webhooks/slack/interactions/route.ts`. The
  // dispatcher splits on '.' and routes by the leading segment, so
  // every kind we emit gets `sendero_<kind>.<value>`.
  const btn: Record<string, unknown> = {
    type: 'button',
    text,
    action_id: `sendero_${cta.kind}.${cta.value ?? ''}`,
  };
  if (cta.value !== undefined) btn.value = cta.value;
  if (style) btn.style = style;
  return btn;
}

// markdown-to-mrkdwn conversion. Intentionally minimal: the agent
// emits markdown-lite already, so this only handles the gaps that
// would render visibly broken.
//
// Intentional:
//   `**bold**`       -> `*bold*`        (Slack mrkdwn bold)
//   `[label](url)`   -> `<url|label>`   (Slack link syntax)
//   `- item` / `* item` -> `• item`     (visible bullet)
//
// Lossy / not handled:
//   - headings (`# foo`) pass through as plain text
//   - inline `_italic_` already valid mrkdwn; markdown italic
//     `*italic*` collides with bold and is left alone
//   - tables, footnotes, blockquotes beyond a single `> `
function toSlackMrkdwn(input: string): string {
  let s = input;
  s = s.replace(/\*\*(.+?)\*\*/g, '*$1*');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<$2|$1>');
  s = s.replace(/^[\t ]*[-*][\t ]+/gm, '• ');
  return s;
}

// Plain-text fallback for the top-level `text` field. Strips the
// mrkdwn markers added above plus any link syntax so screen readers
// and notification previews get a clean string.
function stripMrkdwn(input: string): string {
  let s = input;
  s = s.replace(/<([^|>]+)\|([^>]+)>/g, '$2');
  s = s.replace(/\*([^*]+)\*/g, '$1');
  s = s.replace(/_([^_]+)_/g, '$1');
  return s;
}

function escapeMrkdwn(text: string): string {
  // Slack's link syntax breaks if the label contains `|` or `>`. Drop
  // them rather than HTML-escape — the surrounding context block is
  // tiny grey footer text and a missing pipe is invisible in practice.
  return text.replace(/[|>]/g, ' ');
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

function exhaustive(_: never): never {
  throw new Error('Unhandled ChannelMessage kind');
}
