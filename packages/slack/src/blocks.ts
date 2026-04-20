/**
 * Block Kit composition helpers.
 * Typed against @slack/web-api's KnownBlock so misuse fails at build time.
 */

import type { KnownBlock, Button, HeaderBlock, SectionBlock } from '@slack/web-api';

export function header(text: string): HeaderBlock {
  return {
    type: 'header',
    text: { type: 'plain_text', text: text.slice(0, 150), emoji: true },
  };
}

export function sectionMarkdown(text: string): SectionBlock {
  return {
    type: 'section',
    text: { type: 'mrkdwn', text },
  };
}

export function sectionFields(fields: Array<{ label: string; value: string }>): SectionBlock {
  return {
    type: 'section',
    fields: fields.map(f => ({
      type: 'mrkdwn',
      text: `*${f.label}*\n${f.value}`,
    })),
  };
}

export function divider(): KnownBlock {
  return { type: 'divider' };
}

export function context(texts: string[]): KnownBlock {
  return {
    type: 'context',
    elements: texts.map(t => ({ type: 'mrkdwn', text: t })),
  };
}

export interface ButtonArgs {
  text: string;
  actionId: string;
  value: string;
  style?: 'primary' | 'danger';
  url?: string;
}

export function button(args: ButtonArgs): Button {
  const btn: Button = {
    type: 'button',
    text: { type: 'plain_text', text: args.text, emoji: true },
    action_id: args.actionId,
    value: args.value,
  };
  if (args.style) btn.style = args.style;
  if (args.url) btn.url = args.url;
  return btn;
}

export function actionsRow(buttons: Button[]): KnownBlock {
  return { type: 'actions', elements: buttons };
}
