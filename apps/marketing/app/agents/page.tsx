import { GeistPixelLine } from 'geist/font/pixel';

import { Agents } from '@/components/agents/agents';
import { createPageMetadata } from '@/lib/metadata';

export const metadata = createPageMetadata({
  title: 'Agents — Let agents run your travel ops · Sendero',
  description:
    'Sendero CLI and MCP server let AI agents search inventory, place holds, ticket bookings, settle on-chain in USDC, and audit every step. One npx, ~49 tools, any MCP client.',
  path: '/agents',
  og: {
    title: 'Agents · Sendero',
    description: 'Let AI agents run your travel ops.',
  },
  keywords: [
    'agent native cli',
    'travel ops automation for agents',
    'MCP travel agent',
    'Sendero CLI',
    'on-chain settlement',
    'usdc travel booking',
    'duffel agent',
  ],
});

export default function Page() {
  return (
    <>
      {/*
        Page-level theme override — paint the whole route in Sendero
        ink (deep navy) with parchment "white" text. Mirrors Midday's
        agents-page approach (apps/website/src/app/agents/page.tsx)
        but uses Sendero's own color tokens.

        We override the CSS vars Tailwind reads (`--background`,
        `--foreground`, etc.) in HSL space so every `bg-background`,
        `text-foreground`, `border-border` class on this route
        resolves to Sendero's deep ink palette. The rest of the
        marketing site keeps parchment-on-ink.

        HSL values:
          - 225 70% 14%  → #0c1226 (deep ink, near our --ink #1f2a44)
          - 0 0% 100%    → parchment-on-ink "white"
          - 225 60% 75%  → muted parchment for secondary text
          - 225 50% 28%  → border / hairline
          - 225 60% 18%  → muted bg surface
      */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
            :root, .dark, body {
              --background: 225 70% 14% !important;
              --foreground: 0 0% 100% !important;
              --muted-foreground: 225 60% 75% !important;
              --border: 225 50% 28% !important;
              --primary: 0 0% 100% !important;
              --primary-foreground: 225 70% 14% !important;
              --muted: 225 60% 18% !important;
              --secondary: 225 70% 14% !important;
              --secondary-foreground: 0 0% 100% !important;
            }
            body {
              background: hsl(225 70% 14%);
              color: hsl(0 0% 100%);
            }
            .text-foreground { color: hsl(0 0% 100%) !important; }
            .text-primary-foreground { color: hsl(225 70% 14%) !important; }
            .bg-background { background-color: hsl(225 70% 14%) !important; }
            .bg-muted { background-color: hsl(225 60% 18%) !important; }
            .bg-muted\\/40 { background-color: hsl(225 60% 18% / 0.4) !important; }
            .bg-primary { background-color: hsl(0 0% 100%) !important; }
            .border-border { border-color: hsl(225 50% 28%) !important; }
            .border-l-border { border-left-color: hsl(225 50% 28%) !important; }
            .border-primary { border-color: hsl(0 0% 100%) !important; }
          `,
        }}
      />
      <Agents pixelFontClass={GeistPixelLine.className} />
    </>
  );
}
