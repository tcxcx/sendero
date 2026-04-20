import type { ReactNode } from 'react';
import { RootProvider } from 'fumadocs-ui/provider';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';

// Pull the exact same token vocabulary the main Sendero app uses so
// the docs match the vermilion brand pixel-for-pixel. The relative
// path is intentional — we do NOT duplicate the stylesheet.
import '../../../app/globals.css';
import './docs-overrides.css';

export const metadata = {
  title: {
    default: 'Sendero API',
    template: '%s — Sendero API',
  },
  description:
    'Developer docs for Sendero — the AI travel agent that books real flights and settles on-chain via 14 MCP tools on Circle Arc, priced in sub-cent USDC nanopayments.',
  metadataBase: new URL('https://docs.sendero.travel'),
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <body>
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
