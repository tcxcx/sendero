import { getMarketingContent } from '@/lib/content';
import { detectLocale } from '@sendero/locale';
import { headers } from 'next/headers';
import { MarketingWaitlist } from './waitlist';

export const revalidate = 300; // 5 minutes; basehub will push on-demand in Phase 4

const MARKETING_ASSET_VISUALS: Record<string, { src: string; alt: string }> = {
  'agent-route-map': {
    src: '/brand/panels/panel-04.png',
    alt: 'Risograph-style ticket and route map showing Sendero agent coordination.',
  },
  'escrow-lifecycle': {
    src: '/brand/panels/panel-05.png',
    alt: 'Illustrated settlement document used for the prepaid escrow lifecycle.',
  },
  'channel-symbols': {
    src: '/brand/panels/panel-06.png',
    alt: 'Sendero delivery document panel used as the basis for channel and trust symbols.',
  },
};

const FEATURE_SYMBOLS: Record<string, string> = {
  consumer: '/brand/icons/02-chat-bubbles.png',
  agency: '/brand/icons/03-group-chat.png',
  corporate: '/brand/icons/14-bank.png',
  agents: '/brand/icons/16-ai-chip.png',
};

const STORY_PATHS = [
  {
    eyebrow: 'Individual traveler',
    title: 'Tell Sendero where you need to go. Keep moving in the same thread.',
    body: 'A traveler starts in WhatsApp or web, gets real inventory, claims prepaid funds when needed, and keeps the agent for changes, alerts, receipts, and local help.',
    panel: '/brand/panels/panel-02.png',
    icons: [
      '/brand/icons/04-courier-profile.png',
      '/brand/icons/07-magnifier.png',
      '/brand/icons/12-traveler-bag.png',
    ],
  },
  {
    eyebrow: 'Travel agency',
    title: 'Send a booking link that behaves like a staffed counter.',
    body: 'Agencies keep the customer relationship while Sendero handles the repetitive work: quote, policy check, hold, ticket, payment, invoice, and trip support.',
    panel: '/brand/panels/panel-05.png',
    icons: [
      '/brand/icons/01-mail-circle.png',
      '/brand/icons/03-globe-stamp.png',
      '/brand/icons/11-ticket.png',
    ],
  },
  {
    eyebrow: 'Corporate and AI buyers',
    title: 'Prepay the journey. Keep policy, settlement, and audit in line.',
    body: 'Companies and calling agents can prefund USDC budgets, issue safe claim links, and let Sendero settle each travel action against the right session.',
    panel: '/brand/panels/panel-06.png',
    icons: [
      '/brand/icons/09-secure-check-shield.png',
      '/brand/icons/11-cost-gauge.png',
      '/brand/icons/14-bank.png',
    ],
  },
];

const POSTCARD_SERIES = [
  {
    label: 'Seal',
    title: 'Secure the request',
    body: 'The trip begins as a locked instruction, not a loose chat promise.',
    image: '/brand/postcards/sendero-3-01.png',
    alt: 'Sendero postcard showing a hand holding a locked travel note over an island route.',
  },
  {
    label: 'Tag',
    title: 'Attach the context',
    body: 'Traveler, budget, policy, and route metadata move with the work.',
    image: '/brand/postcards/sendero-3-02.png',
    alt: 'Sendero postcard showing a traveler tagging a document beside an island route.',
  },
  {
    label: 'Bind',
    title: 'Bundle the proofs',
    body: 'Approvals, holds, and claims stay tied to the same operational thread.',
    image: '/brand/postcards/sendero-3-03.png',
    alt: 'Sendero postcard showing a banded bundle of travel documents and a route marker.',
  },
  {
    label: 'Clear',
    title: 'Approve the itinerary',
    body: 'The agent moves only when the next irreversible action is allowed.',
    image: '/brand/postcards/sendero-3-04.png',
    alt: 'Sendero postcard showing a ticket with a plane stamp and approval check.',
  },
  {
    label: 'Settle',
    title: 'Reconcile the money',
    body: 'USDC settlement, rails, suppliers, and invoices resolve into one trail.',
    image: '/brand/postcards/sendero-3-05.png',
    alt: 'Sendero postcard showing bank settlement, coins, a compass, and an invoice.',
  },
  {
    label: 'Deliver',
    title: 'Send the record home',
    body: 'The traveler, buyer, and agent keep the same final document state.',
    image: '/brand/postcards/sendero-3-06.png',
    alt: 'Sendero postcard showing a final travel document delivered along a coastal route.',
  },
];

const ROUTE_MURALS = [
  {
    label: 'Handoff map',
    title: 'One request becomes coordinated travel work.',
    body: 'Traveler intent, operator review, channel updates, approvals, and route state stay connected instead of splintering across tools.',
    image: '/brand/generated/agent-handoff-map.jpg',
    alt: 'Sendero illustrated handoff map with traveler, agent operators, approvals, and a destination route.',
  },
  {
    label: 'Trust sequence',
    title: 'Locked, checked, cleared, and settled.',
    body: 'Every irreversible step has a proof point: secure intake, route context, approval, delivery, and supplier settlement.',
    image: '/brand/generated/trust-stamp-flow.jpg',
    alt: 'Sendero illustrated trust sequence of route documents, approval stamps, and settlement handoff.',
  },
  {
    label: 'Operations network',
    title: 'A graph for travel actions, not just messages.',
    body: 'Bookings, policies, receipts, finance, support, and agent calls are modeled as connected events that can be inspected later.',
    image: '/brand/generated/operations-network-map.jpg',
    alt: 'Sendero illustrated operations network with travel, finance, policy, and support nodes.',
  },
  {
    label: 'Open route',
    title: 'The journey remains visible after the ticket is issued.',
    body: 'The agent continues through changes, reminders, receipts, support, and reconciliation until the trip is complete.',
    image: '/brand/generated/traveler-world-panorama.jpg',
    alt: 'Sendero illustrated world map panorama with traveler, route marks, envelopes, and destinations.',
  },
];

const SYMBOL_ATLAS = [
  '01-mail-circle.png',
  '01-sendero-s.png',
  '02-chat-bubbles.png',
  '02-north-star.png',
  '03-globe-stamp.png',
  '03-group-chat.png',
  '04-courier-profile.png',
  '04-network-nodes.png',
  '05-airplane-circle.png',
  '05-shopping-bag.png',
  '06-shield.png',
  '06-speed-lines-circle.png',
  '07-compass-circle.png',
  '07-magnifier.png',
  '08-capsule-star.png',
  '08-receipt.png',
  '09-archway.png',
  '09-secure-check-shield.png',
  '10-check-circle.png',
  '10-map-pin.png',
  '11-cost-gauge.png',
  '11-ticket.png',
  '12-binoculars.png',
  '12-traveler-bag.png',
  '13-globe.png',
  '13-stacked-stones.png',
  '14-bank.png',
  '14-bird.png',
  '15-square-portrait.png',
  '15-user-tie.png',
  '16-ai-chip.png',
];

export default async function MarketingHome() {
  const hdrs = await headers();
  const locale = detectLocale({
    acceptLanguage: hdrs.get('accept-language'),
    country: hdrs.get('x-vercel-ip-country'),
  });
  const content = await getMarketingContent(locale);

  return (
    <main className="mk-root">
      <header className="mk-nav">
        <div className="mk-brand">
          <img alt="" className="mk-mark" decoding="async" src="/brand/icons/01-sendero-s.png" />
          <span>SENDERO</span>
          <span className="mk-x">×</span>
          <span>ARC</span>
        </div>
        <nav className="mk-nav-right">
          <span className="mk-pill">{content.locale}</span>
          <a href={content.hero.secondaryCtaHref}>{content.hero.secondaryCta}</a>
          <a href={content.hero.primaryCtaHref} className="mk-cta">
            {content.hero.primaryCta}
          </a>
        </nav>
      </header>

      <section className="mk-hero">
        <div className="mk-hero-art" aria-hidden="true">
          <img
            alt=""
            className="mk-hero-art-img"
            decoding="async"
            src="/brand/marketing-hero-wide.png"
          />
          <img
            alt=""
            className="mk-hero-art-edge"
            decoding="async"
            src="/brand/marketing-hero-transparent-edge.png"
          />
        </div>
        <div className="mk-hero-copy">
          <div className="mk-eyebrow">{content.hero.eyebrow}</div>
          <h1 className="mk-title">{content.hero.title}</h1>
          <p className="mk-subtitle">{content.hero.subtitle}</p>
          <div className="mk-hero-ctas">
            <a href={content.hero.primaryCtaHref} className="mk-cta mk-cta-lg">
              {content.hero.primaryCta}
            </a>
            <a href={content.hero.secondaryCtaHref} className="mk-cta mk-cta-ghost">
              {content.hero.secondaryCta}
            </a>
          </div>
        </div>
      </section>

      <section className="mk-waitlist" aria-labelledby="mk-waitlist-title">
        <div className="mk-waitlist-copy">
          <div className="mk-eyebrow">Arc Testnet live</div>
          <h2 id="mk-waitlist-title">Get notified for mainnet launch.</h2>
          <p>
            Sendero is available for testnet QA today. Join the waitlist and we will email you when
            production buyer organizations can onboard on mainnet.
          </p>
        </div>
        <MarketingWaitlist />
      </section>

      <section className="mk-murals" aria-labelledby="mk-murals-title">
        <div className="mk-murals-copy">
          <div className="mk-eyebrow">Route intelligence</div>
          <h2 id="mk-murals-title">The agent keeps the whole journey on one map.</h2>
          <p>
            The new Sendero art system shows the hidden work behind every trip: intake, policy,
            approval, payment, supplier handoff, traveler support, and the final audit trail.
          </p>
        </div>
        <div className="mk-mural-gallery">
          {ROUTE_MURALS.map((mural, index) => (
            <figure className={`mk-mural mk-mural-${index + 1}`} key={mural.label}>
              <img alt={mural.alt} decoding="async" src={mural.image} />
              <figcaption>
                <span>{mural.label}</span>
                <strong>{mural.title}</strong>
                <p>{mural.body}</p>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section className="mk-story" aria-labelledby="mk-story-title">
        <div className="mk-story-intro">
          <div className="mk-eyebrow">Three paths in</div>
          <h2 id="mk-story-title">The agent meets the buyer at the door they already use.</h2>
          <p>
            Sendero is not another travel portal. It is one operational agent with enough context to
            move a trip from intent to ticket, whether the request starts with a traveler, agency
            desk, finance team, or another LLM.
          </p>
        </div>
        <div className="mk-story-grid">
          {STORY_PATHS.map(path => (
            <article className="mk-story-card" key={path.eyebrow}>
              <div className="mk-story-panel" aria-hidden="true">
                <img alt="" decoding="async" src={path.panel} />
              </div>
              <div className="mk-story-body">
                <div className="mk-story-icons" aria-hidden="true">
                  {path.icons.map(icon => (
                    <img alt="" decoding="async" key={icon} src={icon} />
                  ))}
                </div>
                <span>{path.eyebrow}</span>
                <h3>{path.title}</h3>
                <p>{path.body}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="mk-features">
        {content.features.map(feature => (
          <article key={feature.id} className="mk-feature">
            <img
              alt=""
              className="mk-feature-symbol"
              decoding="async"
              src={FEATURE_SYMBOLS[feature.id] ?? '/brand/icons/02-north-star.png'}
            />
            <h3>{feature.title}</h3>
            <p>{feature.body}</p>
          </article>
        ))}
      </section>

      <section className="mk-assets" aria-labelledby="mk-assets-title">
        <div className="mk-assets-copy">
          <div className="mk-eyebrow">Visual system</div>
          <h2 id="mk-assets-title">Product art that explains the agent engine.</h2>
          <p>
            Sendero uses map fragments, route marks, receipts, and travel stamps to show how one
            persistent agent coordinates channels, escrow, booking, and invoices.
          </p>
        </div>
        <div className="mk-assets-grid">
          {content.assetPlaceholders.map(asset => {
            const visual = MARKETING_ASSET_VISUALS[asset.id];
            return (
              <figure className="mk-asset" data-asset-brief={asset.brief} key={asset.id}>
                <div className={`mk-asset-media mk-asset-media-${asset.id}`} aria-hidden="true">
                  <img alt="" decoding="async" src={visual.src} />
                </div>
                <figcaption>
                  <strong>{asset.title}</strong>
                  <span>{asset.brief}</span>
                </figcaption>
              </figure>
            );
          })}
        </div>
      </section>

      <section className="mk-passport" aria-labelledby="mk-passport-title">
        <div className="mk-passport-copy">
          <div className="mk-eyebrow">Custody trail</div>
          <h2 id="mk-passport-title">Every agent action leaves a travel postcard.</h2>
          <p>
            The story is intentionally physical: locked requests, tagged context, approval stamps,
            settlement marks, and final records. It makes invisible agent work inspectable.
          </p>
        </div>
        <div className="mk-postcard-stage">
          <div className="mk-postcard-rail">
            {POSTCARD_SERIES.map((card, index) => (
              <figure className={`mk-postcard mk-postcard-${index + 1}`} key={card.label}>
                <img alt={card.alt} decoding="async" src={card.image} />
                <figcaption>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <strong>{card.label}</strong>
                  <small>{card.title}</small>
                  <p>{card.body}</p>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      <section className="mk-pricing">
        <h2>{content.pricing.heading}</h2>
        <p className="mk-pricing-sub">{content.pricing.subheading}</p>
        <div className="mk-tiers">
          {content.pricing.tiers.map(tier => (
            <article key={tier.id} className="mk-tier">
              <div className="mk-tier-name">{tier.name}</div>
              <div className="mk-tier-price">{tier.price}</div>
              <div className="mk-tier-unit">{tier.unit}</div>
              <p className="mk-tier-desc">{tier.description}</p>
              <ul>
                {tier.features.map((f, i) => (
                  <li key={`${tier.id}-${i}`}>{f}</li>
                ))}
              </ul>
              <a href={tier.ctaHref} className="mk-cta mk-cta-full">
                {tier.cta}
              </a>
            </article>
          ))}
        </div>
      </section>

      <section className="mk-symbols" aria-labelledby="mk-symbols-title">
        <div>
          <div className="mk-eyebrow">Asset language</div>
          <h2 id="mk-symbols-title">A full stamp kit for every agent action.</h2>
          <p>
            These marks appear across product states, empty states, docs, and launch assets so the
            brand can explain channel work, trust work, payment work, and travel work without stock
            illustrations.
          </p>
        </div>
        <div className="mk-symbol-grid" aria-hidden="true">
          {SYMBOL_ATLAS.map(symbol => (
            <img alt="" decoding="async" key={symbol} src={`/brand/icons/${symbol}`} />
          ))}
        </div>
      </section>

      <footer className="mk-foot">
        <span>{content.footer.copyright}</span>
        <nav>
          {content.footer.links.map(link => (
            <a key={link.href} href={link.href}>
              {link.label}
            </a>
          ))}
        </nav>
      </footer>

      <style>{inlineCss}</style>
    </main>
  );
}

const inlineCss = `
  .mk-root { max-width: 1120px; margin: 0 auto; padding: 24px clamp(16px, 3vw, 48px) 80px; color-scheme: light; }
  .mk-nav { display: flex; justify-content: space-between; align-items: center; font-family: var(--mono); font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; padding: 8px 0 48px; }
  .mk-brand { display: inline-flex; align-items: center; gap: 8px; font-weight: 500; }
  .mk-mark { display: inline-block; width: 18px; height: 18px; object-fit: contain; }
  .mk-x { opacity: 0.4; }
  .mk-nav-right { display: inline-flex; align-items: center; gap: 16px; }
  .mk-pill { padding: 3px 8px; border: 1px solid var(--border); }
  .mk-cta { font-family: var(--mono); font-size: 11px; letter-spacing: 0.12em; padding: 8px 14px; background: var(--fg); color: var(--bg); text-transform: uppercase; }
  .mk-cta:hover { text-decoration: none; background: var(--accent); color: #fff7ec; }
  .mk-cta-lg { padding: 14px 22px; font-size: 12px; }
  .mk-cta-ghost { background: transparent; color: var(--fg); border: 1px solid var(--fg); }
  .mk-cta-ghost:hover { background: var(--fg); color: var(--bg); }
  .mk-cta-full { display: block; text-align: center; margin-top: 16px; }
  .mk-eyebrow { font-family: var(--mono); font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); margin-bottom: 24px; }
  .mk-hero { position: relative; min-height: clamp(620px, 72vw, 760px); display: grid; align-items: end; margin: 0 calc(clamp(16px, 3vw, 48px) * -1) 80px; overflow: hidden; border-bottom: 1px solid var(--border); background: #eedcc7; }
  .mk-hero::after { content: ""; position: absolute; inset: 38% 0 0; background: linear-gradient(to bottom, transparent, var(--bg) 72%); pointer-events: none; }
  .mk-hero-art { position: absolute; inset: 0; overflow: hidden; }
  .mk-hero-art-img,
  .mk-hero-art-edge { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; pointer-events: none; }
  .mk-hero-art-img { object-position: center top; filter: saturate(0.96) contrast(0.98); }
  .mk-hero-art-edge { opacity: 0.54; object-position: center top; mix-blend-mode: multiply; }
  .mk-hero-copy { position: relative; z-index: 1; width: min(820px, calc(100% - clamp(32px, 8vw, 96px))); margin: 0 auto; padding: 0 0 clamp(54px, 8vw, 92px); }
  .mk-title { font-size: clamp(42px, 6.4vw, 76px); line-height: 1.01; letter-spacing: 0; margin: 0 0 24px; font-weight: 500; max-width: 780px; color: #111111; text-wrap: balance; }
  .mk-subtitle { font-size: 18px; color: #4f4a43; max-width: 650px; margin: 0 0 32px; }
  .mk-hero-ctas { display: inline-flex; gap: 12px; flex-wrap: wrap; }
  .mk-waitlist { display: grid; grid-template-columns: minmax(0, 0.95fr) minmax(280px, 1.05fr); gap: 24px; align-items: center; margin: 0 0 80px; padding: 28px 24px; border: 1px solid var(--border); background: color-mix(in oklab, var(--accent) 4%, var(--bg)); box-shadow: inset 0 1px 0 var(--accent); }
  .mk-waitlist-copy { max-width: 480px; }
  .mk-waitlist-copy .mk-eyebrow { margin-bottom: 14px; color: var(--accent); }
  .mk-waitlist h2 { font-size: clamp(28px, 3.5vw, 44px); line-height: 1.05; letter-spacing: 0; margin: 0 0 12px; font-weight: 500; }
  .mk-waitlist p { color: var(--muted); max-width: 520px; margin: 0; font-size: 15px; line-height: 1.6; }
  .mk-waitlist-clerk-root { width: 100%; }
  .mk-waitlist-clerk-card { width: 100%; max-width: none; border: 0; box-shadow: none; background: transparent; padding: 0; }
  .mk-waitlist-clerk-hidden { display: none; }
  .mk-waitlist-clerk-input { border-radius: 0; border-color: var(--border); box-shadow: none; }
  .mk-waitlist-clerk-button { border-radius: 0; background: var(--fg); color: var(--bg); font-family: var(--mono); font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; box-shadow: none; }
  .mk-waitlist-loading { display: grid; gap: 10px; width: 100%; border: 1px solid var(--border); background: var(--bg); padding: 18px; }
  .mk-waitlist-loading span { font-family: var(--mono); font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); }
  .mk-waitlist-loading div { height: 42px; border: 1px solid var(--border); background: color-mix(in oklab, var(--accent) 4%, var(--bg)); animation: mkPulse 1.2s ease-in-out infinite alternate; }
  .mk-waitlist-loading div:last-child { border-color: var(--fg); background: var(--fg); }
  .mk-waitlist-loading .mk-waitlist-recovery { height: auto; display: grid; gap: 10px; border: 1px solid var(--border); background: var(--bg); padding: 14px; animation: none; }
  .mk-waitlist-recovery strong { font-family: var(--mono); font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--accent); }
  .mk-waitlist-recovery p { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.5; }
  .mk-waitlist-recovery button { height: 40px; border: 1px solid var(--fg); background: var(--fg); color: var(--bg); font-family: var(--mono); font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; }
  @keyframes mkPulse { from { opacity: 0.45; } to { opacity: 1; } }
  .mk-murals { display: grid; grid-template-columns: minmax(240px, 0.5fr) minmax(0, 1.5fr); gap: clamp(24px, 4vw, 48px); align-items: start; margin: 0 calc(clamp(16px, 3vw, 48px) * -1) 80px; padding: clamp(42px, 6vw, 70px) clamp(16px, 3vw, 48px); border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); background: color-mix(in oklab, #eedcc7 72%, var(--bg)); }
  .mk-murals-copy { position: sticky; top: 24px; }
  .mk-murals-copy h2 { font-size: clamp(30px, 4vw, 50px); line-height: 1.03; letter-spacing: 0; margin: 0 0 16px; font-weight: 500; text-wrap: balance; }
  .mk-murals-copy p { color: var(--muted); margin: 0; font-size: 15px; line-height: 1.65; max-width: 480px; }
  .mk-mural-gallery { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; min-width: 0; }
  .mk-mural { display: grid; align-content: start; gap: 14px; min-width: 0; margin: 0; }
  .mk-mural-1 { grid-column: 1 / -1; }
  .mk-mural img { display: block; width: 100%; aspect-ratio: 1.74; object-fit: cover; object-position: center; border: 1px solid var(--border); background: #eedcc7; filter: saturate(0.98) contrast(0.98); }
  .mk-mural-1 img { aspect-ratio: 1.6; object-position: center; }
  .mk-mural figcaption { display: grid; gap: 7px; padding: 0 2px 10px; }
  .mk-mural figcaption span { font-family: var(--mono); font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--accent); }
  .mk-mural figcaption strong { font-size: 16px; line-height: 1.2; font-weight: 500; color: var(--fg); text-wrap: balance; }
  .mk-mural figcaption p { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.55; }
  .mk-story { margin: 0 0 80px; }
  .mk-story-intro { display: grid; grid-template-columns: minmax(0, 0.78fr) minmax(0, 1.22fr); gap: 28px; align-items: end; margin-bottom: 24px; }
  .mk-story-intro h2,
  .mk-passport-copy h2,
  .mk-symbols h2 { font-size: clamp(28px, 3.5vw, 44px); line-height: 1.05; letter-spacing: 0; margin: 0; font-weight: 500; text-wrap: balance; }
  .mk-story-intro p,
  .mk-passport-copy p,
  .mk-symbols p { color: var(--muted); margin: 0; font-size: 15px; line-height: 1.6; max-width: 650px; }
  .mk-story-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border: 1px solid var(--border); }
  .mk-story-card { display: grid; grid-template-rows: auto 1fr; min-width: 0; border-right: 1px solid var(--border); background: var(--bg); }
  .mk-story-card:last-child { border-right: none; }
  .mk-story-panel { aspect-ratio: 1.7; overflow: hidden; border-bottom: 1px solid var(--border); background: #eedcc7; }
  .mk-story-panel img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: center; filter: saturate(0.98) contrast(0.96); }
  .mk-story-body { display: grid; align-content: start; gap: 12px; padding: 22px; }
  .mk-story-icons { display: flex; gap: 10px; align-items: center; min-height: 38px; }
  .mk-story-icons img { width: 34px; height: 34px; object-fit: contain; }
  .mk-story-body span { font-family: var(--mono); font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--accent); }
  .mk-story-body h3 { font-size: 19px; line-height: 1.2; letter-spacing: 0; margin: 0; font-weight: 500; text-wrap: balance; }
  .mk-story-body p { color: var(--muted); font-size: 14px; line-height: 1.58; margin: 0; }
  .mk-features { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 0; margin: 0 0 80px; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
  .mk-feature { padding: 28px 24px; border-right: 1px solid var(--border); }
  .mk-feature:last-child { border-right: none; }
  .mk-feature-symbol { width: 44px; height: 44px; object-fit: contain; margin-bottom: 18px; }
  .mk-feature h3 { font-size: 16px; margin: 0 0 10px; letter-spacing: 0; }
  .mk-feature p { color: var(--muted); font-size: 14px; margin: 0; line-height: 1.55; }
  .mk-assets { display: grid; grid-template-columns: minmax(0, 0.72fr) minmax(0, 1.28fr); gap: 28px; margin: 0 0 80px; align-items: start; }
  .mk-assets-copy h2 { font-size: clamp(28px, 3.5vw, 44px); line-height: 1.05; letter-spacing: 0; margin: 0 0 14px; font-weight: 500; }
  .mk-assets-copy p { color: var(--muted); margin: 0; font-size: 15px; line-height: 1.6; }
  .mk-assets-grid { display: grid; gap: 12px; }
  .mk-asset { display: grid; grid-template-columns: 178px 1fr; min-height: 148px; margin: 0; border: 1px solid var(--border); background: var(--bg); overflow: hidden; }
  .mk-asset-media { position: relative; min-height: 148px; border-right: 1px solid var(--border); background: #eedcc7; overflow: hidden; }
  .mk-asset-media img { position: absolute; inset: 0; box-sizing: border-box; display: block; width: 100%; height: 100%; object-fit: contain; object-position: center; padding: 8px; filter: saturate(0.98) contrast(0.96); }
  .mk-asset figcaption { display: grid; align-content: center; gap: 8px; padding: 18px; }
  .mk-asset strong { font-size: 15px; font-weight: 500; color: var(--fg); }
  .mk-asset figcaption span { color: var(--muted); font-size: 13px; line-height: 1.55; }
  .mk-passport { display: grid; grid-template-columns: minmax(240px, 0.48fr) minmax(0, 1.52fr); gap: clamp(28px, 4vw, 56px); align-items: start; margin: 0 calc(clamp(16px, 3vw, 48px) * -1) 22px; padding: clamp(42px, 6vw, 72px) clamp(16px, 3vw, 48px); border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); background: #eedcc7; overflow: hidden; }
  .mk-postcard-stage { min-width: 0; }
  .mk-postcard-rail { display: grid; grid-template-columns: repeat(6, minmax(118px, 1fr)); gap: clamp(10px, 1.1vw, 16px); align-items: start; }
  .mk-postcard { margin: 0; min-width: 0; }
  .mk-postcard img { display: block; width: 100%; aspect-ratio: 0.64; object-fit: contain; filter: saturate(0.98) contrast(0.98); transition: transform 180ms ease-out, filter 180ms ease-out; }
  .mk-postcard-1 img,
  .mk-postcard-4 img { transform: rotate(-1.25deg); }
  .mk-postcard-2 img,
  .mk-postcard-6 img { transform: rotate(0.9deg); }
  .mk-postcard:hover img { transform: translateY(-4px) rotate(0deg); filter: saturate(1.04) contrast(1); }
  .mk-postcard figcaption { display: grid; gap: 5px; padding: 12px 2px 0; }
  .mk-postcard figcaption span { font-family: var(--mono); font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--accent); }
  .mk-postcard figcaption strong { font-size: 14px; line-height: 1.2; font-weight: 600; letter-spacing: 0; color: var(--fg); }
  .mk-postcard figcaption small { font-size: 12px; line-height: 1.25; color: #4d463d; }
  .mk-postcard figcaption p { margin: 0; color: var(--muted); font-size: 11px; line-height: 1.45; }
  .mk-pricing { margin: 0 0 80px; }
  .mk-pricing h2 { font-size: clamp(28px, 3.5vw, 44px); letter-spacing: 0; margin: 0 0 12px; font-weight: 500; }
  .mk-pricing-sub { color: var(--muted); max-width: 620px; margin: 0 0 32px; }
  .mk-tiers { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 0; border: 1px solid var(--border); }
  .mk-tier { padding: 28px 24px; border-right: 1px solid var(--border); display: flex; flex-direction: column; }
  .mk-tier:last-child { border-right: none; }
  .mk-tier-name { font-family: var(--mono); font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); margin-bottom: 12px; }
  .mk-tier-price { font-size: 40px; font-weight: 500; letter-spacing: 0; color: var(--accent); line-height: 1; }
  .mk-tier-unit { font-family: var(--mono); font-size: 11px; letter-spacing: 0.08em; color: var(--muted); margin: 6px 0 16px; text-transform: uppercase; }
  .mk-tier-desc { font-size: 14px; color: var(--muted); margin: 0 0 14px; flex: 0 0 auto; }
  .mk-tier ul { list-style: none; padding: 0; margin: 0 0 20px; font-size: 13px; flex: 1 1 auto; }
  .mk-tier li { padding: 4px 0; color: var(--fg); }
  .mk-symbols { display: grid; grid-template-columns: minmax(0, 0.72fr) minmax(0, 1.28fr); gap: 28px; align-items: start; margin: 0 0 80px; }
  .mk-symbol-grid { display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); border: 1px solid var(--border); background: color-mix(in oklab, var(--fg) 4%, var(--bg)); }
  .mk-symbol-grid img { display: block; width: 100%; aspect-ratio: 1; object-fit: contain; padding: 12px; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); }
  .mk-symbol-grid img:nth-child(8n) { border-right: none; }
  .mk-symbol-grid img:nth-last-child(-n + 7) { border-bottom: none; }
  .mk-foot { display: flex; justify-content: space-between; padding-top: 32px; border-top: 1px solid var(--border); font-family: var(--mono); font-size: 11px; color: var(--muted); letter-spacing: 0.08em; text-transform: uppercase; }
  .mk-foot nav { display: inline-flex; gap: 18px; }
  @media (max-width: 640px) {
    .mk-root { padding: 20px 14px 64px; }
    .mk-nav { display: grid; grid-template-columns: 1fr; gap: 14px; align-items: stretch; padding-bottom: 42px; }
    .mk-nav-right { display: grid; grid-template-columns: auto minmax(0, 1fr) minmax(0, 1fr); gap: 8px; width: 100%; }
    .mk-pill,
    .mk-nav-right a { display: flex; min-height: 40px; align-items: center; justify-content: center; border: 1px solid var(--border); padding: 8px 10px; text-align: center; line-height: 1.15; text-decoration: none; }
    .mk-nav-right .mk-cta { border-color: var(--fg); white-space: nowrap; }
    .mk-hero { margin-bottom: 64px; }
    .mk-hero { min-height: 620px; margin-left: -14px; margin-right: -14px; }
    .mk-hero-art-img { object-position: 58% top; }
    .mk-hero-art-edge { opacity: 0.42; object-position: 58% top; }
    .mk-hero-copy { width: calc(100% - 28px); padding-bottom: 48px; }
    .mk-title { font-size: clamp(42px, 14vw, 56px); line-height: 1.03; letter-spacing: 0; }
    .mk-subtitle { font-size: 17px; line-height: 1.55; }
    .mk-hero-ctas { display: grid; width: 100%; }
    .mk-hero-ctas .mk-cta { display: flex; min-height: 46px; align-items: center; justify-content: center; text-align: center; }
    .mk-waitlist { grid-template-columns: 1fr; }
    .mk-story-intro,
    .mk-murals,
    .mk-passport,
    .mk-symbols { grid-template-columns: 1fr; }
    .mk-murals { margin-left: -14px; margin-right: -14px; }
    .mk-murals-copy { position: static; }
    .mk-mural-gallery { grid-template-columns: 1fr; }
    .mk-mural-1 { grid-column: auto; }
    .mk-mural img,
    .mk-mural-1 img { aspect-ratio: 1.45; }
    .mk-story-grid { grid-template-columns: 1fr; }
    .mk-story-card { border-right: none; border-bottom: 1px solid var(--border); }
    .mk-story-card:last-child { border-bottom: none; }
    .mk-passport { margin-left: -14px; margin-right: -14px; }
    .mk-postcard-stage { overflow: visible; padding-bottom: 0; }
    .mk-postcard-rail { width: auto; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px 12px; }
    .mk-postcard figcaption { padding-top: 10px; }
    .mk-symbol-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .mk-symbol-grid img:nth-child(8n) { border-right: 1px solid var(--border); }
    .mk-symbol-grid img:nth-child(4n) { border-right: none; }
    .mk-symbol-grid img:nth-last-child(-n + 7) { border-bottom: 1px solid var(--border); }
    .mk-symbol-grid img:nth-last-child(-n + 3) { border-bottom: none; }
    .mk-assets { grid-template-columns: 1fr; }
    .mk-asset { grid-template-columns: 1fr; }
    .mk-asset-media { border-right: none; border-bottom: 1px solid var(--border); }
    .mk-feature { border-right: none; border-bottom: 1px solid var(--border); }
    .mk-feature:last-child { border-bottom: none; }
    .mk-tier { border-right: none; border-bottom: 1px solid var(--border); }
    .mk-tier:last-child { border-bottom: none; }
    .mk-foot { flex-direction: column; gap: 16px; }
  }
`;
