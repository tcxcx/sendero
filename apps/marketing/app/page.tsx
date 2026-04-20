import { getMarketingContent } from '@/lib/content';
import { detectLocale } from '@sendero/locale';
import { headers } from 'next/headers';

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
    .mk-feature { border-right: none; border-bottom: 1px solid var(--border); }
    .mk-feature:last-child { border-bottom: none; }
    .mk-tier { border-right: none; border-bottom: 1px solid var(--border); }
    .mk-tier:last-child { border-bottom: none; }
    .mk-foot { flex-direction: column; gap: 16px; }
  }
`;
