import { detectLocale } from '@sendero/locale';
import { headers } from 'next/headers';
import { HELP_CATEGORIES, getHelpArticles } from '@/lib/articles';

export const revalidate = 300;

const HELP_ROUTE_VISUALS = [
  {
    label: 'Secure request',
    title: 'Start with a protected instruction.',
    body: 'Locked context lets support, finance, and travel operations reason from the same source of truth.',
    image: '/brand/generated/trust-stamp-flow.jpg',
    alt: 'Sendero trust sequence showing secure route documents and approval stamps.',
  },
  {
    label: 'Operational graph',
    title: 'Trace the work across teams.',
    body: 'Policy, payment, inventory, traveler support, and receipts stay connected for later audit.',
    image: '/brand/generated/operations-network-map.jpg',
    alt: 'Sendero operations network map with travel and finance nodes connected by route lines.',
  },
  {
    label: 'Traveler handoff',
    title: 'Keep the destination visible.',
    body: 'The agent carries the journey through booking, reminders, support, changes, and final records.',
    image: '/brand/generated/traveler-world-panorama.jpg',
    alt: 'Sendero traveler panorama with route marks, envelopes, and destinations.',
  },
];

export default async function HelpHome() {
  const hdrs = await headers();
  const locale = detectLocale({
    acceptLanguage: hdrs.get('accept-language'),
    country: hdrs.get('x-vercel-ip-country'),
  });
  const articles = await getHelpArticles({ locale });

  return (
    <main className="hp-root">
      <header className="hp-nav">
        <div className="hp-brand">
          <span className="hp-mark" />
          <span>SENDERO</span>
          <span className="hp-x">·</span>
          <span>HELP</span>
        </div>
        <nav className="hp-nav-right">
          <a href="https://sendero.travel">Website</a>
          <a href="https://sendero-arc-web.vercel.app">App</a>
          <a href="/llms.txt">For AI agents</a>
        </nav>
      </header>

      <section className="hp-hero">
        <div className="hp-hero-copy">
          <div className="hp-eyebrow">Help center · {locale}</div>
          <h1>How can Sendero help?</h1>
          <p>
            Documentation for travelers, agencies, corporate finance teams, and the AI agents
            calling Sendero via MCP.
          </p>
        </div>
        <figure className="hp-hero-visual">
          <img
            alt="Sendero illustrated handoff map showing a traveler request routed through operators and approvals."
            decoding="async"
            src="/brand/generated/agent-handoff-map.jpg"
          />
          <figcaption>One help trail from traveler intent to operator action.</figcaption>
        </figure>
      </section>

      <section className="hp-route-strip" aria-label="Sendero support route examples">
        {HELP_ROUTE_VISUALS.map(visual => (
          <figure className="hp-route" key={visual.label}>
            <img alt={visual.alt} decoding="async" src={visual.image} />
            <figcaption>
              <span>{visual.label}</span>
              <strong>{visual.title}</strong>
              <p>{visual.body}</p>
            </figcaption>
          </figure>
        ))}
      </section>

      <section className="hp-categories">
        {HELP_CATEGORIES.map(cat => {
          const count = articles.filter(a => a.category === cat.id).length;
          return (
            <a key={cat.id} href={`/${cat.id}`} className="hp-cat">
              <div className="hp-cat-title">{cat.title}</div>
              <div className="hp-cat-desc">{cat.description}</div>
              <div className="hp-cat-count">
                {count} article{count === 1 ? '' : 's'}
              </div>
            </a>
          );
        })}
      </section>

      <section className="hp-section">
        <h2>All articles</h2>
        <ul className="hp-list">
          {articles.map(a => (
            <li key={a.slug}>
              <a href={`/article/${a.slug}`} className="hp-art">
                <span className="hp-art-title">{a.title}</span>
                <span className="hp-art-excerpt">{a.excerpt}</span>
              </a>
            </li>
          ))}
        </ul>
      </section>

      <style>{inlineCss}</style>
    </main>
  );
}

const inlineCss = `
  .hp-root { max-width: 1120px; margin: 0 auto; padding: 32px 24px 80px; }
  .hp-nav { display: flex; justify-content: space-between; align-items: center; font-family: var(--mono); font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; padding: 8px 0 48px; border-bottom: 1px solid var(--border); }
  .hp-brand { display: inline-flex; align-items: center; gap: 8px; }
  .hp-mark { display: inline-block; width: 12px; height: 12px; background: var(--accent); }
  .hp-x { opacity: 0.4; }
  .hp-nav-right { display: inline-flex; gap: 16px; }
  .hp-hero { display: grid; grid-template-columns: minmax(0, 0.78fr) minmax(320px, 1.22fr); gap: clamp(24px, 4vw, 44px); align-items: end; padding: 56px 0 32px; }
  .hp-hero-copy { padding-bottom: 10px; }
  .hp-eyebrow { font-family: var(--mono); font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); margin-bottom: 16px; }
  .hp-hero h1 { font-size: clamp(32px, 4.5vw, 48px); letter-spacing: -0.025em; margin: 0 0 16px; font-weight: 500; }
  .hp-hero p { font-size: 17px; color: var(--muted); max-width: 560px; margin: 0; }
  .hp-hero-visual { margin: 0; min-width: 0; }
  .hp-hero-visual img { display: block; width: 100%; aspect-ratio: 1.6; object-fit: cover; object-position: center; border: 1px solid var(--border); background: #eedcc7; filter: saturate(0.98) contrast(0.98); }
  .hp-hero-visual figcaption { margin-top: 10px; font-family: var(--mono); font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); }
  .hp-route-strip { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 24px 0 54px; }
  .hp-route { display: grid; align-content: start; gap: 12px; min-width: 0; margin: 0; }
  .hp-route img { display: block; width: 100%; aspect-ratio: 1.75; object-fit: cover; object-position: center; border: 1px solid var(--border); background: #eedcc7; }
  .hp-route figcaption { display: grid; gap: 5px; }
  .hp-route figcaption span { font-family: var(--mono); font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--accent); }
  .hp-route figcaption strong { font-size: 15px; line-height: 1.2; font-weight: 500; }
  .hp-route figcaption p { margin: 0; font-size: 13px; line-height: 1.5; color: var(--muted); }
  .hp-categories { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 0; margin: 48px 0; border-top: 1px solid var(--border); border-left: 1px solid var(--border); }
  .hp-cat { display: block; padding: 24px; background: var(--bg); border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); text-decoration: none; }
  .hp-cat:hover { background: color-mix(in oklab, var(--accent) 6%, var(--bg)); text-decoration: none; }
  .hp-cat-title { font-size: 18px; font-weight: 500; letter-spacing: -0.01em; margin-bottom: 6px; }
  .hp-cat-desc { font-size: 14px; color: var(--muted); margin-bottom: 12px; }
  .hp-cat-count { font-family: var(--mono); font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); }
  .hp-section { margin-top: 48px; }
  .hp-section h2 { font-family: var(--mono); font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); margin: 0 0 16px; }
  .hp-list { list-style: none; padding: 0; margin: 0; border-top: 1px solid var(--border); }
  .hp-art { display: flex; flex-direction: column; gap: 6px; padding: 16px 0; border-bottom: 1px solid var(--border); }
  .hp-art:hover { text-decoration: none; }
  .hp-art:hover .hp-art-title { text-decoration: underline; }
  .hp-art-title { font-size: 16px; font-weight: 500; letter-spacing: -0.01em; }
  .hp-art-excerpt { font-size: 14px; color: var(--muted); }
  @media (max-width: 640px) {
    .hp-root { padding: 24px 22px 72px; }
    .hp-nav { flex-direction: column; align-items: stretch; gap: 18px; padding-bottom: 34px; }
    .hp-nav-right { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; width: 100%; }
    .hp-nav-right a { display: flex; min-height: 40px; align-items: center; justify-content: center; border: 1px solid var(--border); padding: 8px 10px; text-align: center; line-height: 1.15; text-decoration: none; }
    .hp-nav-right a:last-child { grid-column: 1 / -1; }
    .hp-hero { grid-template-columns: 1fr; padding-top: 44px; }
    .hp-hero p { font-size: 16px; }
    .hp-hero-visual img { aspect-ratio: 1.35; }
    .hp-route-strip { grid-template-columns: 1fr; margin-top: 10px; }
  }
`;
