/**
 * Corporate travel approval flow.
 *
 * Posts a DM to the approver with trip summary + Approve / Reject buttons.
 * The `value` field round-trips the entire decision payload (tripId,
 * bookingId, tenantId) so the interactions handler can validate and act
 * without a DB lookup keyed on `action_id`.
 *
 * Desk-v1 kept approval state in Postgres; so do we, via `@sendero/database`
 * — but the state machine primitives here are DB-agnostic.
 */

import type { WebClient, KnownBlock } from '@slack/web-api';
import { actionsRow, button, context, header, sectionFields, sectionMarkdown } from './blocks';

const ACTION_PREFIX = 'sendero_approval';

export type ApprovalDecision = 'approve' | 'reject';

export interface ApprovalSubject {
  tenantId: string;
  tripId: string;
  bookingId: string;
  travelerName: string;
  route: string;
  departAt: string;
  amountUsd: number;
  fareClass: string;
  policyReasons?: string[];
}

export function buildApprovalBlocks(subject: ApprovalSubject, reviewUrl?: string): KnownBlock[] {
  const valuePayload = JSON.stringify({
    t: subject.tenantId,
    tr: subject.tripId,
    b: subject.bookingId,
  });

  const blocks: KnownBlock[] = [
    header(`Approval requested · ${subject.travelerName}`),
    sectionMarkdown(`*${subject.route}* · ${subject.fareClass}\n_Departs ${subject.departAt}_`),
    sectionFields([
      { label: 'Amount', value: `$${subject.amountUsd.toFixed(2)} USD` },
      { label: 'Fare class', value: subject.fareClass },
      { label: 'Booking', value: `\`${subject.bookingId}\`` },
      { label: 'Policy', value: subject.policyReasons?.length ? 'Out of policy' : 'Within policy' },
    ]),
  ];

  if (subject.policyReasons?.length) {
    blocks.push(
      sectionMarkdown(
        `> *Policy flags:*\n> ${subject.policyReasons.map(r => `• ${r}`).join('\n> ')}`
      )
    );
  }

  blocks.push(
    actionsRow([
      button({
        text: 'Approve',
        actionId: `${ACTION_PREFIX}.approve`,
        value: valuePayload,
        style: 'primary',
      }),
      button({
        text: 'Reject',
        actionId: `${ACTION_PREFIX}.reject`,
        value: valuePayload,
        style: 'danger',
      }),
      ...(reviewUrl
        ? [
            button({
              text: 'Open in Sendero',
              actionId: `${ACTION_PREFIX}.open`,
              value: subject.tripId,
              url: reviewUrl,
            }),
          ]
        : []),
    ]),
    context([`Booking held for 15 min · Sendero × Arc · _requested ${new Date().toISOString()}_`])
  );

  return blocks;
}

export interface SendApprovalArgs {
  client: WebClient;
  approverSlackUserId: string;
  subject: ApprovalSubject;
  reviewUrl?: string;
}

/** Sends the approval request as a DM to the approver. */
export async function sendApprovalRequest(
  args: SendApprovalArgs
): Promise<{ channel: string; ts: string }> {
  const im = await args.client.conversations.open({ users: args.approverSlackUserId });
  const channel = im.channel?.id;
  if (!channel) {
    throw new Error(`Failed to open DM with ${args.approverSlackUserId}`);
  }
  const posted = await args.client.chat.postMessage({
    channel,
    text: `Approval requested: ${args.subject.travelerName} · ${args.subject.route} · $${args.subject.amountUsd.toFixed(2)}`,
    blocks: buildApprovalBlocks(args.subject, args.reviewUrl),
  });
  if (!posted.ts) throw new Error('chat.postMessage returned no ts');
  return { channel, ts: posted.ts };
}

export interface ParsedApprovalAction {
  decision: ApprovalDecision | 'open';
  tenantId: string;
  tripId: string;
  bookingId: string;
}

/**
 * Interpret an incoming `block_actions` payload from Slack.
 * Returns null if it's not one of ours.
 */
export function parseApprovalAction(action: {
  action_id: string;
  value?: string;
}): ParsedApprovalAction | null {
  if (!action.action_id.startsWith(`${ACTION_PREFIX}.`)) return null;
  const [, decision] = action.action_id.split('.');
  if (decision !== 'approve' && decision !== 'reject' && decision !== 'open') return null;

  try {
    if (decision === 'open') {
      return { decision, tenantId: '', tripId: action.value ?? '', bookingId: '' };
    }
    const parsed = JSON.parse(action.value ?? '{}') as { t?: string; tr?: string; b?: string };
    if (!parsed.t || !parsed.tr || !parsed.b) return null;
    return {
      decision,
      tenantId: parsed.t,
      tripId: parsed.tr,
      bookingId: parsed.b,
    };
  } catch {
    return null;
  }
}

/**
 * Render a post-decision "resolved" card so the approver sees the outcome
 * locked in.
 */
export function buildResolvedBlocks(
  subject: ApprovalSubject,
  decision: ApprovalDecision,
  decidedBy: string
): KnownBlock[] {
  const verb = decision === 'approve' ? 'Approved' : 'Rejected';
  const emoji = decision === 'approve' ? ':white_check_mark:' : ':x:';
  return [
    header(`${emoji} ${verb} · ${subject.travelerName}`),
    sectionMarkdown(`*${subject.route}* · $${subject.amountUsd.toFixed(2)} · ${subject.fareClass}`),
    context([`Decision by <@${decidedBy}> · ${new Date().toISOString()}`]),
  ];
}
