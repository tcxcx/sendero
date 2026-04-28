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

            /*
              Pixel wordmark selection. We let the global vermillion
              selection rule from apps/marketing/app/globals.css win
              (vermillion bg + parchment text). The earlier local
              parchment-on-ink override read backwards against the
              rest of the marketing site's selection.
            */

            /*
              Get-started CTA topography wash. Mask-image sources the
              same /patterns/topography.svg the dashboard uses; the
              fill is a vermillion-tinted ink. Lives in front of the
              card bg, behind the content via a dedicated absolute
              span on the .agents-cta-topography class.
            */
            /*
              Code-block selection on dark surfaces. The global
              vermillion-bg + parchment-fg selection looks like a hot
              orange wash on the deep-navy code blocks inside the
              McpInstaller. Scope a parchment-bg + ink selection so
              highlighted text on a dark code surface stays readable.
            */
            .agents-route .mcp-installer pre::selection,
            .agents-route .mcp-installer pre *::selection {
              background: #fdfbf7;
              color: #111;
              -webkit-text-fill-color: #111;
              text-shadow: none;
            }
            .agents-route .mcp-installer pre::-moz-selection,
            .agents-route .mcp-installer pre *::-moz-selection {
              background: #fdfbf7;
              color: #111;
              text-shadow: none;
            }

            /*
              CopyInstall hover inversion text color — the marketing
              a:hover global underline + Tailwind's text-foreground
              cascade together can leave the icon stuck on parchment
              instead of inverting. Scope an explicit text-color for
              the hover state so the entire button reads as a coherent
              ink-on-parchment-flip.
            */
            .agents-route .copy-install:hover span,
            .agents-route .copy-install:hover svg {
              color: var(--bg) !important;
            }

            .agents-route .agents-cta-topography {
              background-color: color-mix(in oklab, var(--ink) 32%, transparent);
              -webkit-mask-image: url("/patterns/topography.svg");
              mask-image: url("/patterns/topography.svg");
              -webkit-mask-repeat: repeat;
              mask-repeat: repeat;
              -webkit-mask-size: 520px 520px;
              mask-size: 520px 520px;
              opacity: 0.42;
            }

            /*
              Copy-install hatch pattern. Lives on the route stylesheet
              instead of inline so the hover-inverted state can reach
              it via the cascade. .copy-install:hover swaps the
              background to ink — full-button inversion.
            */
            .agents-route .copy-install {
              background-image: repeating-linear-gradient(
                -60deg,
                color-mix(in oklab, hsl(var(--border)) 100%, transparent),
                color-mix(in oklab, hsl(var(--border)) 100%, transparent) 1px,
                transparent 1px,
                transparent 6px
              );
            }
            .agents-route .copy-install:hover {
              background-image: none;
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
