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
        Page-level theme override — Sendero parchment (#eedcc7) with
        ink (#111) text and vermillion (#fb542b) accent. Tailwind's
        shadcn-ish utilities (bg-background, text-foreground, etc.)
        used inside the Midday-derived <Agents /> component get bound
        to the Sendero palette here, so we keep the layout/motion
        Midday gave us but ditch the Midday navy.

        The terminal hero is the single dark surface — it gets its
        own inline background a few lines below so it still pops as a
        Mac-window terminal against the parchment page.
      */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
            /* Bind shadcn-style tokens used by the Midday port to
               Sendero's parchment palette. HSL space. */
            .agents-route {
              --background: 36 50% 86%;    /* parchment #eedcc7 */
              --foreground: 0 0% 7%;       /* ink near-black #111 */
              --muted: 36 35% 80%;         /* dimmer parchment for surfaces */
              --muted-foreground: 0 0% 35%;/* secondary copy */
              --border: 30 22% 70%;        /* hairline #d8c1a7 */
              --primary: 13 96% 58%;       /* vermillion #fb542b */
              --primary-foreground: 36 50% 96%; /* parchment-on-vermillion */
              --secondary: 36 35% 80%;
              --secondary-foreground: 0 0% 7%;
            }

            /* Map shadcn utility classes to those tokens, scoped to
               the agents route. We don't override anywhere else so
               the home page styling stays put. */
            .agents-route .text-foreground { color: hsl(var(--foreground)) !important; }
            .agents-route .text-primary-foreground { color: hsl(var(--primary-foreground)) !important; }
            .agents-route .text-muted-foreground { color: hsl(var(--muted-foreground)) !important; }
            .agents-route .bg-background { background-color: hsl(var(--background)) !important; }
            .agents-route .bg-muted { background-color: hsl(var(--muted)) !important; }
            .agents-route .bg-muted\\/40 { background-color: hsl(var(--muted) / 0.4) !important; }
            .agents-route .bg-primary { background-color: hsl(var(--primary)) !important; }
            .agents-route .border-border { border-color: hsl(var(--border)) !important; }
            .agents-route .border-l-border { border-left-color: hsl(var(--border)) !important; }
            .agents-route .border-t-border { border-top-color: hsl(var(--border)) !important; }
            .agents-route .border-b-border { border-bottom-color: hsl(var(--border)) !important; }
            .agents-route .border-primary { border-color: hsl(var(--primary)) !important; }

            /* Inverted surface for the terminal hero card. The
               <Agents /> component opts in by wrapping the terminal
               in .agents-terminal so we don't have to re-color every
               internal Tailwind class. */
            .agents-route .agents-terminal {
              --background: 0 0% 8%;       /* deep terminal black */
              --foreground: 36 50% 96%;    /* parchment text */
              --muted: 0 0% 15%;
              --muted-foreground: 36 30% 75%;
              --border: 0 0% 22%;
              --primary: 13 96% 58%;
              --primary-foreground: 36 50% 96%;
            }

            /* Override the marketing-wide vermillion scrollbar on this
               route — it fights with parchment + ink palette. */
            .agents-route * {
              scrollbar-color: hsl(var(--border)) transparent;
            }
          `,
        }}
      />
      <div className="agents-route">
        <Agents pixelFontClass={GeistPixelLine.className} />
      </div>
    </>
  );
}
