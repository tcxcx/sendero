import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Sendero Help — AI travel agents on WhatsApp, Slack, and MCP',
  description:
    'Documentation and troubleshooting for Sendero — the agent-native travel platform. Consumer, agency, corporate, and AI-agent flows explained.',
  metadataBase: new URL('https://sendero.travel'),
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
