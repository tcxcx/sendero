import Link from 'next/link';

import { TOOL_PRICING } from '@sendero/tools/pricing';
import { buildLocaleApiHrefs, SenderoLanguageSelector } from '@sendero/ui/language-selector';

import { getDocsRequestLocale } from '@/lib/request-locale';

import { type DocsPathCard, DocsPathCards } from './docs-path-cards';

const DOC_PATHS: readonly DocsPathCard[] = [
  {
    href: '/docs/quickstart',
    label: 'Start path',
    title: 'Make the first paid tool call.',
    description: 'Use llms.txt, call the MCP surface, and complete a treasury check in minutes.',
    image: '/brand/generated/agent-handoff-map.jpg',
    alt: 'Sendero handoff map showing a traveler request moving through agent operators and approvals.',
  },
  {
    href: '/docs/agent-to-agent-booking',
    label: 'Booking path',
    title: 'Delegate a full travel workflow.',
    description:
      'Trace search, policy, hold, ticketing, settlement, and support handoff between agents.',
    image: '/brand/generated/trust-stamp-flow.jpg',
    alt: 'Sendero trust flow showing locked documents, route stamps, approvals, and settlement.',
  },
  {
    href: '/docs/tools/overview',
    label: 'Tool graph',
    title: 'Choose the right MCP tool.',
    description:
      'Scan travel, policy, finance, and support calls before wiring them into your agent.',
    image: '/brand/generated/operations-network-map.jpg',
    alt: 'Sendero operations graph connecting travel, policy, finance, and support nodes.',
  },
];

/**
 * Docs landing page. Editorial, not marketing — it mirrors the
 * "one hero moment, then links" shape used by the main app.
 */
export default async function HomePage() {
  const locale = await getDocsRequestLocale();
  const toolCount = Object.keys(TOOL_PRICING).length;
  return (
    <main className="docs-home">
      <section className="docs-hero">
        <div className="docs-copy">
          <h1>
            Book flights. <span>Settle on-chain.</span>
          </h1>
          <p className="docs-subtitle">
            Sendero exposes {toolCount} MCP tools: search flights, quote FX, settle a 4-way
            commission split, and price each action in sub-cent USDC via x402 nanopayments on Circle
            Arc.
          </p>
          <div className="docs-actions">
            <Link href="/docs">Read the docs &rarr;</Link>
            <Link href="/docs/quickstart">5-minute quickstart</Link>
          </div>
        </div>
        <figure className="docs-hero-visual">
          <img
            alt="Sendero world map panorama showing route marks, envelopes, destinations, and a traveler."
            decoding="async"
            src="/brand/generated/traveler-world-panorama.jpg"
          />
          <figcaption>
            <span>Agent-native routing</span>
            <strong>One graph from traveler intent to final receipt.</strong>
          </figcaption>
        </figure>
      </section>

      <DocsPathCards cards={DOC_PATHS} />

      <style>{inlineCss}</style>
    </main>
  );
}

const inlineCss = `
  .docs-home { --docs-ease-out: cubic-bezier(0.23, 1, 0.32, 1); min-height: 100dvh; max-width: 1120px; margin: 0 auto; padding: clamp(48px, 7vw, 84px) 24px 88px; }
  .docs-nav { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; padding-bottom: clamp(34px, 5vw, 52px); font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; animation: docsHeroCopyIn 460ms var(--docs-ease-out) both; }
  .docs-brand { display: inline-flex; align-items: center; gap: 8px; color: var(--text); text-decoration: none; }
  .docs-brand-mark { width: 28px; height: 28px; object-fit: contain; flex-shrink: 0; }
  .docs-brand-word { color: var(--ink); }
  .docs-hero { display: grid; grid-template-columns: minmax(0, 0.82fr) minmax(340px, 1.18fr); gap: clamp(28px, 5vw, 58px); align-items: end; }
  .docs-copy { padding-bottom: 10px; }
  .docs-copy > * { animation: docsHeroCopyIn 560ms var(--docs-ease-out) both; }
  .docs-copy > *:nth-child(2) { animation-delay: 70ms; }
  .docs-copy > *:nth-child(3) { animation-delay: 120ms; }
  .docs-copy > *:nth-child(4) { animation-delay: 170ms; }
  .docs-label { color: var(--ink); }
  .docs-copy h1 { font-size: clamp(42px, 6vw, 76px); line-height: 1.02; letter-spacing: 0; margin: 16px 0 24px; font-weight: 500; text-wrap: balance; }
  .docs-copy h1 span { color: var(--ink); }
  .docs-subtitle { font-size: 18px; color: var(--text-dim); max-width: 590px; margin: 0 0 40px; line-height: 1.65; }
  .docs-actions { display: flex; gap: 12px; flex-wrap: wrap; }
  .docs-actions a { display: inline-flex; min-height: 44px; align-items: center; justify-content: center; padding: 12px 20px; border: 1px solid var(--ink); border-radius: 4px; text-decoration: none; font-family: var(--font-mono); font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; transition: background 180ms var(--docs-ease-out), color 180ms var(--docs-ease-out), transform 140ms var(--docs-ease-out); }
  .docs-actions a:active { transform: scale(0.98); }
  .docs-actions a:first-child { background: var(--ink); color: #fafaf7; }
  .docs-actions a:last-child { color: var(--ink); }
  .docs-hero-visual { margin: 0; min-width: 0; animation: docsHeroImageIn 740ms var(--docs-ease-out) 120ms both; }
  .docs-hero-visual img { display: block; width: 100%; aspect-ratio: 1.75; object-fit: cover; object-position: center; border: 1px solid var(--border); background: #eedcc7; filter: saturate(0.98) contrast(0.98); transition: filter 220ms var(--docs-ease-out), transform 520ms var(--docs-ease-out); }
  .docs-hero-visual:hover img { filter: saturate(1.03) contrast(1); transform: scale(1.012); }
  .docs-hero-visual figcaption { display: grid; gap: 6px; padding-top: 12px; }
  .docs-hero-visual figcaption span,
  .docs-path-label { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ink); }
  .docs-hero-visual figcaption strong { font-size: 15px; line-height: 1.3; font-weight: 500; color: var(--text); }
  .docs-paths { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: clamp(14px, 2vw, 20px); margin-top: clamp(42px, 6vw, 70px); }
  .docs-path-motion { min-width: 0; }
  .docs-path-card { display: grid; align-content: start; gap: 14px; min-width: 0; color: inherit; text-decoration: none; }
  .docs-path-image-frame { position: relative; display: block; overflow: hidden; border: 1px solid var(--border); background: #eedcc7; }
  .docs-path-image-frame::after { content: ""; position: absolute; inset: 0; opacity: 0; background: color-mix(in oklab, var(--ink) 10%, transparent); transition: opacity 220ms var(--docs-ease-out); pointer-events: none; }
  .docs-path-image-frame img { display: block; width: 100%; aspect-ratio: 1.6; object-fit: cover; object-position: center; filter: saturate(0.96) contrast(0.98); transition: filter 220ms var(--docs-ease-out), transform 420ms var(--docs-ease-out); }
  .docs-path-copy { display: grid; gap: 6px; }
  .docs-path-copy strong { font-size: clamp(17px, 1.55vw, 22px); line-height: 1.22; font-weight: 500; color: var(--text); letter-spacing: 0; }
  .docs-path-description { max-width: 35ch; color: var(--text-dim); font-size: 14px; line-height: 1.5; }
  .docs-path-cta { display: inline-flex; align-items: center; gap: 8px; margin-top: 4px; font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--text-dim); transition: color 180ms var(--docs-ease-out), transform 220ms var(--docs-ease-out); }
  .docs-path-card:hover .docs-path-image-frame,
  .docs-path-card:focus-visible .docs-path-image-frame { border-color: color-mix(in oklab, var(--ink) 58%, var(--border)); }
  .docs-path-card:hover .docs-path-image-frame::after,
  .docs-path-card:focus-visible .docs-path-image-frame::after { opacity: 1; }
  .docs-path-card:hover img,
  .docs-path-card:focus-visible img { filter: saturate(1.05) contrast(1.02); transform: scale(1.018); }
  .docs-path-card:hover .docs-path-cta,
  .docs-path-card:focus-visible .docs-path-cta { color: var(--ink); transform: translateX(4px); }
  .docs-path-card:focus-visible { outline: 2px solid var(--ink); outline-offset: 8px; }
  @keyframes docsHeroCopyIn { from { opacity: 0; transform: translateY(9px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes docsHeroImageIn { from { opacity: 0; transform: translateY(12px) scale(0.992); } to { opacity: 1; transform: translateY(0) scale(1); } }
  @media (max-width: 760px) {
    .docs-home { padding: 40px 20px 72px; }
    .docs-nav { display: grid; gap: 18px; }
    .docs-hero { grid-template-columns: 1fr; }
    .docs-actions { display: grid; }
    .docs-hero-visual img { aspect-ratio: 1.35; }
    .docs-paths { grid-template-columns: 1fr; }
    .docs-path-description { max-width: 62ch; }
  }
  @media (prefers-reduced-motion: reduce) {
    .docs-copy > *,
    .docs-nav,
    .docs-hero-visual {
      animation: none;
      opacity: 1;
      transform: none;
    }
    .docs-path-image-frame img,
    .docs-path-cta,
    .docs-path-image-frame::after { transition: none; }
    .docs-hero-visual:hover img,
    .docs-path-card:hover img,
    .docs-path-card:focus-visible img,
    .docs-path-card:hover .docs-path-cta,
    .docs-path-card:focus-visible .docs-path-cta { transform: none; }
  }
`;
