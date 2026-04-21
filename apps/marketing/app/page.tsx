import { getMarketingContent } from '@/lib/content';
import { detectLocale } from '@sendero/locale';
import { headers } from 'next/headers';
import { MarketingWaitlist } from './waitlist';

export const revalidate = 300; // 5 minutes; basehub will push on-demand in Phase 4

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
          <span className="mk-mark" />
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

      <section className="mk-features">
        {content.features.map(feature => (
          <article key={feature.id} className="mk-feature">
            <h3>{feature.title}</h3>
            <p>{feature.body}</p>
          </article>
        ))}
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
  .mk-root { max-width: 1120px; margin: 0 auto; padding: 24px clamp(16px, 3vw, 48px) 80px; }
  .mk-nav { display: flex; justify-content: space-between; align-items: center; font-family: var(--mono); font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; padding: 8px 0 48px; }
  .mk-brand { display: inline-flex; align-items: center; gap: 8px; font-weight: 500; }
  .mk-mark { display: inline-block; width: 12px; height: 12px; background: var(--accent); }
  .mk-x { opacity: 0.4; }
  .mk-nav-right { display: inline-flex; align-items: center; gap: 16px; }
  .mk-pill { padding: 3px 8px; border: 1px solid var(--border); }
  .mk-cta { font-family: var(--mono); font-size: 11px; letter-spacing: 0.12em; padding: 8px 14px; background: var(--fg); color: var(--bg); text-transform: uppercase; }
  .mk-cta:hover { text-decoration: none; background: var(--accent); color: #fff; }
  .mk-cta-lg { padding: 14px 22px; font-size: 12px; }
  .mk-cta-ghost { background: transparent; color: var(--fg); border: 1px solid var(--fg); }
  .mk-cta-ghost:hover { background: var(--fg); color: var(--bg); }
  .mk-cta-full { display: block; text-align: center; margin-top: 16px; }
  .mk-eyebrow { font-family: var(--mono); font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); margin-bottom: 24px; }
  .mk-hero { max-width: 820px; margin: 0 auto 80px; text-align: left; }
  .mk-title { font-size: clamp(40px, 6vw, 72px); line-height: 1.02; letter-spacing: -0.035em; margin: 0 0 24px; font-weight: 500; }
  .mk-subtitle { font-size: 18px; color: var(--muted); max-width: 640px; margin: 0 0 32px; }
  .mk-hero-ctas { display: inline-flex; gap: 12px; flex-wrap: wrap; }
  .mk-waitlist { display: grid; grid-template-columns: minmax(0, 0.95fr) minmax(280px, 1.05fr); gap: 24px; align-items: center; margin: 0 0 80px; padding: 28px 24px; border: 1px solid var(--border); border-left: 2px solid var(--accent); background: color-mix(in oklab, var(--accent) 4%, var(--bg)); }
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
  @keyframes mkPulse { from { opacity: 0.45; } to { opacity: 1; } }
  .mk-features { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 0; margin: 0 0 80px; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
  .mk-feature { padding: 28px 24px; border-right: 1px solid var(--border); }
  .mk-feature:last-child { border-right: none; }
  .mk-feature h3 { font-size: 16px; margin: 0 0 10px; letter-spacing: -0.01em; }
  .mk-feature p { color: var(--muted); font-size: 14px; margin: 0; line-height: 1.55; }
  .mk-pricing { margin: 0 0 80px; }
  .mk-pricing h2 { font-size: clamp(28px, 3.5vw, 44px); letter-spacing: -0.02em; margin: 0 0 12px; font-weight: 500; }
  .mk-pricing-sub { color: var(--muted); max-width: 620px; margin: 0 0 32px; }
  .mk-tiers { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 0; border: 1px solid var(--border); }
  .mk-tier { padding: 28px 24px; border-right: 1px solid var(--border); display: flex; flex-direction: column; }
  .mk-tier:last-child { border-right: none; }
  .mk-tier-name { font-family: var(--mono); font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); margin-bottom: 12px; }
  .mk-tier-price { font-size: 40px; font-weight: 500; letter-spacing: -0.02em; color: var(--accent); line-height: 1; }
  .mk-tier-unit { font-family: var(--mono); font-size: 11px; letter-spacing: 0.08em; color: var(--muted); margin: 6px 0 16px; text-transform: uppercase; }
  .mk-tier-desc { font-size: 14px; color: var(--muted); margin: 0 0 14px; flex: 0 0 auto; }
  .mk-tier ul { list-style: none; padding: 0; margin: 0 0 20px; font-size: 13px; flex: 1 1 auto; }
  .mk-tier li { padding: 4px 0; color: var(--fg); }
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
    .mk-title { font-size: clamp(42px, 14vw, 56px); line-height: 1.03; letter-spacing: -0.02em; }
    .mk-subtitle { font-size: 17px; line-height: 1.55; }
    .mk-hero-ctas { display: grid; width: 100%; }
    .mk-hero-ctas .mk-cta { display: flex; min-height: 46px; align-items: center; justify-content: center; text-align: center; }
    .mk-waitlist { grid-template-columns: 1fr; }
    .mk-feature { border-right: none; border-bottom: 1px solid var(--border); }
    .mk-feature:last-child { border-bottom: none; }
    .mk-tier { border-right: none; border-bottom: 1px solid var(--border); }
    .mk-tier:last-child { border-bottom: none; }
    .mk-foot { flex-direction: column; gap: 16px; }
  }
`;
