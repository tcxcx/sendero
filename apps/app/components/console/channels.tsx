/**
 * Channel atoms — icons, tints, accents, handles.
 *
 * Mirrors `/sendero/project/route-artboards.jsx` CHANNELS table so the
 * MetaInbox console renders channel pills, header chips, and customer
 * bubbles with the same visual language as the design canvas. CSS
 * variables (`--ch-whatsapp` etc.) live in globals.css; the SVG icons
 * stay co-located here because they're tightly coupled to the
 * channel definitions.
 */

import type { ReactNode } from 'react';

export type ChannelKey = 'whatsapp' | 'slack' | 'sms' | 'email' | 'web' | 'internal';

export interface ChannelDef {
  key: ChannelKey;
  name: string;
  /** Display handle — phone number / channel name / email / "private". */
  handle: string;
  /** Tint background colour (CSS var or hex). */
  tint: string;
  /** Accent colour for borders + meta type. */
  accent: string;
  icon: (size?: number) => ReactNode;
}

const WhatsAppIcon = (size = 14) => (
  <svg
    aria-label="WhatsApp"
    fill="#25d366"
    height={size}
    role="img"
    viewBox="0 0 24 24"
    width={size}
  >
    <title>WhatsApp</title>
    <path d="M17.5 14.4c-.3-.2-1.7-.8-2-.9-.3-.1-.5-.2-.7.2-.2.3-.8.9-.9 1.1-.2.2-.3.2-.6.1-.3-.2-1.2-.5-2.4-1.5-.9-.8-1.5-1.8-1.6-2.1-.2-.3 0-.5.1-.6.1-.1.3-.4.4-.5.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5l-.7-1.7c-.2-.4-.4-.4-.6-.4h-.5c-.2 0-.5.1-.7.4-.2.3-.9.9-.9 2.2 0 1.3.9 2.5 1 2.7.1.2 1.7 2.7 4.2 3.7 2.5 1 2.5.7 3 .6.4 0 1.5-.6 1.7-1.2.2-.6.2-1.1.1-1.2-.1-.1-.3-.2-.6-.4zM12 2C6.5 2 2 6.5 2 12c0 1.8.5 3.5 1.3 5L2 22l5.1-1.3c1.4.8 3.1 1.3 4.9 1.3 5.5 0 10-4.5 10-10S17.5 2 12 2z" />
  </svg>
);

const SlackIcon = (size = 14) => (
  <svg aria-label="Slack" height={size} role="img" viewBox="0 0 24 24" width={size}>
    <title>Slack</title>
    <path
      d="M5.1 14.5c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2h2v2zm1 0c0-1.1.9-2 2-2s2 .9 2 2v5c0 1.1-.9 2-2 2s-2-.9-2-2v-5z"
      fill="#e01e5a"
    />
    <path
      d="M8.1 5.1c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2v2H8.1zm0 1c1.1 0 2 .9 2 2s-.9 2-2 2H3.1c-1.1 0-2-.9-2-2s.9-2 2-2h5z"
      fill="#36c5f0"
    />
    <path
      d="M17.5 8.1c0-1.1.9-2 2-2s2 .9 2 2-.9 2-2 2h-2v-2zm-1 0c0 1.1-.9 2-2 2s-2-.9-2-2v-5c0-1.1.9-2 2-2s2 .9 2 2v5z"
      fill="#2eb67d"
    />
    <path
      d="M14.5 17.5c1.1 0 2 .9 2 2s-.9 2-2 2-2-.9-2-2v-2h2zm0-1c-1.1 0-2-.9-2-2s.9-2 2-2h5c1.1 0 2 .9 2 2s-.9 2-2 2h-5z"
      fill="#ecb22e"
    />
  </svg>
);

const SmsIcon = (size = 14) => (
  <svg aria-label="SMS" fill="#3b82f6" height={size} role="img" viewBox="0 0 24 24" width={size}>
    <title>SMS</title>
    <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM7 9h2v2H7V9zm4 0h2v2h-2V9zm4 0h2v2h-2V9z" />
  </svg>
);

const EmailIcon = (size = 14) => (
  <svg aria-label="Email" height={size} role="img" viewBox="0 0 24 24" width={size}>
    <title>Email</title>
    <path
      d="M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zm0 2 8 5 8-5"
      fill="none"
      stroke="#7c5a3a"
      strokeLinejoin="round"
      strokeWidth="1.5"
    />
  </svg>
);

const WebIcon = (size = 14) => (
  <svg aria-label="Web" height={size} role="img" viewBox="0 0 24 24" width={size}>
    <title>Web</title>
    <circle cx="12" cy="12" fill="none" r="9" stroke="#1f2a44" strokeWidth="1.5" />
    <path
      d="M3 12h18M12 3a13 13 0 0 1 0 18M12 3a13 13 0 0 0 0 18"
      fill="none"
      stroke="#1f2a44"
      strokeWidth="1.5"
    />
  </svg>
);

const InternalIcon = (size = 14) => (
  <svg aria-label="Internal" height={size} role="img" viewBox="0 0 24 24" width={size}>
    <title>Internal · Sendero AI</title>
    <path d="M12 2 3 6v6c0 5 3.8 9.4 9 10 5.2-.6 9-5 9-10V6l-9-4z" fill="#1f2a44" />
    <path
      d="m12 7-1.5 3.2L7 11l2.5 2.4L9 17l3-1.7 3 1.7-.5-3.6L17 11l-3.5-.8L12 7z"
      fill="#fdfbf7"
    />
  </svg>
);

export const CHANNELS: Record<ChannelKey, ChannelDef> = {
  whatsapp: {
    key: 'whatsapp',
    name: 'WhatsApp',
    handle: 'wa.me/14155557788',
    tint: 'var(--ch-whatsapp-tint)',
    accent: 'var(--ch-whatsapp)',
    icon: WhatsAppIcon,
  },
  slack: {
    key: 'slack',
    name: 'Slack',
    handle: '#travel-ops',
    tint: 'var(--ch-slack-tint)',
    accent: 'var(--ch-slack)',
    icon: SlackIcon,
  },
  sms: {
    key: 'sms',
    name: 'SMS',
    handle: '+1 (415) 555-7788',
    tint: 'var(--ch-sms-tint)',
    accent: 'var(--ch-sms)',
    icon: SmsIcon,
  },
  email: {
    key: 'email',
    name: 'Email',
    handle: 'travel@sendero.app',
    tint: 'var(--tint-sand-soft)',
    accent: 'var(--sand)',
    icon: EmailIcon,
  },
  web: {
    key: 'web',
    name: 'Web',
    handle: 'sendero.travel',
    tint: 'var(--tint-midnight-soft)',
    accent: 'var(--midnight)',
    icon: WebIcon,
  },
  internal: {
    key: 'internal',
    name: 'Internal · Sendero AI',
    handle: 'private — operator only',
    tint: 'var(--ch-internal-tint)',
    accent: 'var(--ch-internal)',
    icon: InternalIcon,
  },
};

/** Coerce a Prisma `ChannelKind` value (or unknown string) into a known ChannelKey. */
export function asChannelKey(raw: string | null | undefined): ChannelKey {
  switch ((raw ?? '').toLowerCase()) {
    case 'whatsapp':
    case 'slack':
    case 'sms':
    case 'email':
    case 'web':
    case 'internal':
      return (raw as string).toLowerCase() as ChannelKey;
    default:
      return 'web';
  }
}
