import Link from 'next/link';
import { TOOL_PRICING } from '@sendero/tools/pricing';

const DOC_VISUALS = [
  {
    label: 'Protocol path',
    title: 'Agent request, operator checks, route state.',
    image: '/brand/generated/agent-handoff-map.jpg',
    alt: 'Sendero handoff map showing a traveler request moving through agent operators and approvals.',
  },
  {
    label: 'Settlement path',
    title: 'Secure proofs from hold to supplier handoff.',
    image: '/brand/generated/trust-stamp-flow.jpg',
    alt: 'Sendero trust flow showing locked documents, route stamps, approvals, and settlement.',
  },
  {
    label: 'Tool graph',
    title: 'Travel, policy, finance, and support calls connected.',
    image: '/brand/generated/operations-network-map.jpg',
    alt: 'Sendero operations graph connecting travel, policy, finance, and support nodes.',
  },
];

/**
 * Docs landing page. Editorial, not marketing — it mirrors the
 * "one hero moment, then links" shape used by the main app.
 */
export default function HomePage() {
  const toolCount = Object.keys(TOOL_PRICING).length;
  return (
    <main className="docs-home">
      <section className="docs-hero">
        <div className="docs-copy">
          <p className="label docs-label">Sendero / Developer docs</p>
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

      <section className="docs-visuals" aria-label="Sendero developer workflow maps">
        {DOC_VISUALS.map(visual => (
          <figure key={visual.label}>
            <img alt={visual.alt} decoding="async" src={visual.image} />
            <figcaption>
              <span>{visual.label}</span>
              <strong>{visual.title}</strong>
            </figcaption>
          </figure>
        ))}
      </section>

      <style>{inlineCss}</style>
    </main>
  );
}

const inlineCss = `
  .docs-home { min-height: 100dvh; max-width: 1120px; margin: 0 auto; padding: clamp(48px, 7vw, 84px) 24px 88px; }
  .docs-hero { display: grid; grid-template-columns: minmax(0, 0.82fr) minmax(340px, 1.18fr); gap: clamp(28px, 5vw, 58px); align-items: end; }
  .docs-copy { padding-bottom: 10px; }
  .docs-label { color: var(--ink); }
  .docs-copy h1 { font-size: clamp(42px, 6vw, 76px); line-height: 1.02; letter-spacing: 0; margin: 16px 0 24px; font-weight: 500; text-wrap: balance; }
  .docs-copy h1 span { color: var(--ink); }
  .docs-subtitle { font-size: 18px; color: var(--text-dim); max-width: 590px; margin: 0 0 40px; line-height: 1.65; }
  .docs-actions { display: flex; gap: 12px; flex-wrap: wrap; }
  .docs-actions a { display: inline-flex; min-height: 44px; align-items: center; justify-content: center; padding: 12px 20px; border: 1px solid var(--ink); border-radius: 4px; text-decoration: none; font-family: var(--font-mono); font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; }
  .docs-actions a:first-child { background: var(--ink); color: #fafaf7; }
  .docs-actions a:last-child { color: var(--ink); }
  .docs-hero-visual { margin: 0; min-width: 0; }
  .docs-hero-visual img { display: block; width: 100%; aspect-ratio: 1.75; object-fit: cover; object-position: center; border: 1px solid var(--border); background: #eedcc7; filter: saturate(0.98) contrast(0.98); }
  .docs-hero-visual figcaption { display: grid; gap: 6px; padding-top: 12px; }
  .docs-hero-visual figcaption span,
  .docs-visuals figcaption span { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ink); }
  .docs-hero-visual figcaption strong { font-size: 15px; line-height: 1.3; font-weight: 500; color: var(--text); }
  .docs-visuals { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-top: clamp(42px, 6vw, 70px); }
  .docs-visuals figure { display: grid; align-content: start; gap: 10px; min-width: 0; margin: 0; }
  .docs-visuals img { display: block; width: 100%; aspect-ratio: 1.6; object-fit: cover; object-position: center; border: 1px solid var(--border); background: #eedcc7; }
  .docs-visuals figcaption { display: grid; gap: 5px; }
  .docs-visuals figcaption strong { font-size: 14px; line-height: 1.25; font-weight: 500; color: var(--text); }
  @media (max-width: 760px) {
    .docs-home { padding: 40px 20px 72px; }
    .docs-hero { grid-template-columns: 1fr; }
    .docs-actions { display: grid; }
    .docs-hero-visual img { aspect-ratio: 1.35; }
    .docs-visuals { grid-template-columns: 1fr; }
  }
`;
