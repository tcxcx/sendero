'use client';

/**
 * ChannelBadge — consistent badge for the channel a trip or message
 * originated in. Used in trip list rows, trip thread headers, and per
 * message bubbles so the operator can see at a glance whether a message
 * came from WhatsApp, Slack, email, the web console, or MCP.
 */

import { GlobeIcon, HashIcon, LaptopIcon, MailIcon, MessageCircleIcon } from 'lucide-react';

export type ChannelKindSlug = 'whatsapp' | 'slack' | 'email' | 'web' | 'mcp' | 'internal';

const CHANNEL_CONFIG: Record<
  ChannelKindSlug,
  { label: string; Icon: typeof MessageCircleIcon; tone: string }
> = {
  whatsapp: {
    label: 'WhatsApp',
    Icon: MessageCircleIcon,
    tone: 'border-[color:var(--accent-green)]/40 text-[color:var(--accent-green)]',
  },
  slack: {
    label: 'Slack',
    Icon: HashIcon,
    tone: 'border-[color:var(--ink)]/40 text-[color:var(--ink)]',
  },
  email: {
    label: 'Email',
    Icon: MailIcon,
    tone: 'border-border text-muted-foreground',
  },
  web: {
    label: 'Web',
    Icon: GlobeIcon,
    tone: 'border-border text-muted-foreground',
  },
  mcp: {
    label: 'MCP',
    Icon: LaptopIcon,
    tone: 'border-border text-muted-foreground',
  },
  internal: {
    label: 'Internal',
    Icon: LaptopIcon,
    tone: 'border-dashed border-border text-muted-foreground',
  },
};

export function ChannelBadge({
  channel,
  size = 'sm',
}: {
  channel: ChannelKindSlug;
  size?: 'xs' | 'sm';
}) {
  const cfg = CHANNEL_CONFIG[channel];
  const iconSize = size === 'xs' ? 'size-3' : 'size-3.5';
  const padding = size === 'xs' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border ${cfg.tone} ${padding} font-mono uppercase tracking-[0.1em]`}
    >
      <cfg.Icon className={iconSize} />
      {cfg.label}
    </span>
  );
}
