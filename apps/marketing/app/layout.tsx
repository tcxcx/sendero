import type { ReactNode } from 'react';
import { Providers } from './providers';
import './globals.css';

export const metadata = {
  title: 'Sendero — Agent-native travel, settled on Arc',
  description:
    'AI travel agents that live where your customers already are. One agent per trip, reachable over WhatsApp, Slack, email, and MCP. Real PNRs via Duffel. Settled in USDC on Arc.',
  metadataBase: new URL('https://sendero.travel'),
  openGraph: {
    title: 'Sendero — Agent-native travel, settled on Arc',
    description:
      'One agent per trip, reachable over WhatsApp, Slack, email, and MCP. Real PNRs via Duffel. Settled in USDC on Arc.',
    url: 'https://sendero.travel',
    siteName: 'Sendero',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Sendero — Agent-native travel, settled on Arc',
    description: 'One agent per trip, reachable over WhatsApp, Slack, email, and MCP.',
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
