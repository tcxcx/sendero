import { cookies, headers } from 'next/headers';

import {
  DEFAULT_LOCALE,
  detectLocale,
  LOCALE_COOKIE_NAME,
  LOCALE_HEADER_NAME,
  normalizeLocale,
} from '@sendero/locale';
import { resolvePublicOrigin } from '@sendero/seo';
import { buildLocaleApiHrefs, SenderoLanguageSelector } from '@sendero/ui/language-selector';

import { getMarketingContent } from '@/lib/content';
import { heroTitleWithHighlights } from '@/lib/hero-title';

import { MarketingBrandHoverCard } from './brand-hover-card';
import { MarketingHeroScene } from './marketing-hero-scene';
import { MarketingWaitlist } from './waitlist';

export const revalidate = 300; // 5 minutes; basehub will push on-demand in Phase 4

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
  const [hdrs, cookieStore] = await Promise.all([headers(), cookies()]);
  const locale = detectLocale({
    cookie: cookieStore.get(LOCALE_COOKIE_NAME)?.value,
    acceptLanguage:
      hdrs.get(LOCALE_HEADER_NAME) ?? hdrs.get('accept-language') ?? hdrs.get('x-vercel-ip-locale'),
    country: hdrs.get('x-vercel-ip-country') ?? hdrs.get('cf-ipcountry'),
  });
  return <MarketingHomeForLocale locale={locale} />;
}

export async function MarketingHomeForLocale({ locale }: { locale: string }) {
  const content = await getMarketingContent(locale);
  const normalized = normalizeLocale(content.locale) ?? DEFAULT_LOCALE;
  const appOrigin = resolvePublicOrigin(
    process.env.NEXT_PUBLIC_APP_URL,
    'https://www.sendero.travel'
  );
  // Marketing site lives on a different host from the app. Resolve any
  // app-relative path (/dashboard, /onboarding) to the app origin so it
  // works in dev (3010) AND prod (app.sendero.travel) without hardcoding.
  const APP_PATHS = ['/dashboard', '/onboarding'];
  const toAppHref = (href: string) =>
    APP_PATHS.some(p => href === p || href.startsWith(`${p}/`) || href.startsWith(`${p}?`))
      ? `${appOrigin.replace(/\/$/, '')}${href}`
      : href;

  return (
    <main className="mk-root">
      <header className="mk-nav">
        <div className="mk-brand">
          <img
            alt=""
            className="mk-mark"
            decoding="async"
            src="/brand/logo-masters/clean/sendero_icon_vermilion_clean_2048.png"
          />
          <span>SENDERO</span>
          <span className="mk-x">·</span>
          <span>ARC</span>
        </div>
        <div className="mk-nav-tools">
          <nav className="mk-nav-apps" aria-label="Sendero product navigation">
            <a href="#audiences">{content.nav.website}</a>
            <a href="#pricing">{content.nav.pricing ?? 'Pricing'}</a>
            <a href={appOrigin}>{content.nav.app}</a>
          </nav>
          <nav className="mk-nav-right" aria-label="Marketing actions">
            <div className="mk-nav-stack">
              <SenderoLanguageSelector
                className="mk-language"
                currentLocale={normalized}
                hrefs={buildLocaleApiHrefs('/')}
              />
              <a
                href={toAppHref(content.hero.primaryCta.href)}
                className="mk-cta mk-nav-waitlist s-press"
              >
                {content.hero.primaryCta.label}
              </a>
              <a
                href={toAppHref(content.hero.secondaryCta.href)}
                className="mk-nav-secondary s-press"
              >
                {content.hero.secondaryCta.label}
              </a>
            </div>
          </nav>
        </div>
      </header>

      <section className="mk-hero">
        <div className="mk-hero-art s-fade s-fade-1" aria-hidden="true">
          <MarketingHeroScene />
        </div>
        <div className="mk-hero-copy">
          <div className="mk-eyebrow s-enter s-enter-1">{content.hero.eyebrow}</div>
          <h1 className="mk-title s-enter s-enter-2">
            {heroTitleWithHighlights(content.hero.title, normalized)}
          </h1>
          <p className="mk-subtitle s-enter s-enter-3">{content.hero.subtitle}</p>
          <div className="mk-hero-ctas s-enter s-enter-4">
            <a href={toAppHref(content.hero.primaryCta.href)} className="mk-cta mk-cta-lg s-press">
              {content.hero.primaryCta.label}
            </a>
            <a
              href={toAppHref(content.hero.secondaryCta.href)}
              className="mk-cta mk-cta-ghost s-press"
            >
              {content.hero.secondaryCta.label}
            </a>
          </div>
        </div>
      </section>

      <section className="mk-proof" aria-label="Sendero capabilities">
        <div className="mk-proof-track" aria-hidden="true">
          {(['a', 'b'] as const).flatMap(round =>
            content.proof.items.map(item => (
              <span className="mk-proof-item" key={`${round}-${item}`}>
                <span className="mk-proof-dot" aria-hidden="true" />
                {item}
              </span>
            ))
          )}
        </div>
      </section>

      <section className="mk-audiences" id="audiences" aria-labelledby="mk-audiences-title">
        <div className="mk-audiences-head">
          <div className="mk-eyebrow">{content.audiences.eyebrow}</div>
          <h2 id="mk-audiences-title" className="mk-audiences-title">
            {content.audiences.title}
          </h2>
        </div>
        <div className="mk-audience-grid">
          {content.audiences.items.map((tile, i) => (
            <a
              key={tile.id}
              href={toAppHref(tile.cta.href)}
              className="mk-audience"
              style={{ ['--mk-audience-i' as never]: i }}
            >
              <div className="mk-audience-head">
                <span className="mk-audience-num">{String(i + 1).padStart(2, '0')}</span>
                <span className="mk-audience-label">{tile.label}</span>
              </div>
              <h3 className="mk-audience-headline">{tile.headline}</h3>
              <p className="mk-audience-body">{tile.body}</p>
              <span className="mk-audience-cta">
                {tile.cta.label}
                <span className="mk-audience-arrow" aria-hidden="true">
                  →
                </span>
              </span>
            </a>
          ))}
        </div>
      </section>

      <section className="mk-waitlist" id="waitlist" aria-labelledby="mk-waitlist-title">
        <div className="mk-waitlist-copy">
          <div className="mk-eyebrow">{content.waitlist.eyebrow}</div>
          <h2 id="mk-waitlist-title">{content.waitlist.title}</h2>
          <p>{content.waitlist.body}</p>
        </div>
        <MarketingWaitlist />
      </section>

      <section className="mk-murals" aria-labelledby="mk-murals-title">
        <div className="mk-murals-copy">
          <div className="mk-eyebrow">{content.routeMurals.eyebrow}</div>
          <h2 id="mk-murals-title">{content.routeMurals.title}</h2>
          <p>{content.routeMurals.body}</p>
        </div>
        <div className="mk-mural-gallery">
          {content.routeMurals.items.map((mural, index) => (
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
          <div className="mk-eyebrow">{content.story.eyebrow}</div>
          <h2 id="mk-story-title">{content.story.title}</h2>
          <p>{content.story.body}</p>
        </div>
        <div className="mk-story-grid">
          {content.story.paths.map(path => (
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
            <img alt="" className="mk-feature-symbol" decoding="async" src={feature.iconSrc} />
            <h3>{feature.title}</h3>
            <p>{feature.body}</p>
          </article>
        ))}
      </section>

      <section className="mk-assets" aria-labelledby="mk-assets-title">
        <div className="mk-assets-copy">
          <div className="mk-eyebrow">{content.assetShowcase.eyebrow}</div>
          <h2 id="mk-assets-title">{content.assetShowcase.title}</h2>
          <p>{content.assetShowcase.body}</p>
        </div>
        <div className="mk-assets-grid">
          {content.assetShowcase.assets.map(asset => (
            <figure className="mk-asset" data-asset-brief={asset.brief} key={asset.id}>
              <div className={`mk-asset-media mk-asset-media-${asset.id}`} aria-hidden="true">
                <img alt="" decoding="async" src={asset.src} />
              </div>
              <figcaption>
                <strong>{asset.title}</strong>
                <span>{asset.brief}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section className="mk-passport" aria-labelledby="mk-passport-title">
        <div className="mk-passport-copy">
          <div className="mk-eyebrow">{content.passport.eyebrow}</div>
          <h2 id="mk-passport-title">{content.passport.title}</h2>
          <p>{content.passport.body}</p>
        </div>
        <div className="mk-postcard-stage">
          <div className="mk-postcard-rail">
            {content.passport.postcards.map((card, index) => (
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

      <section className="mk-pricing" id="pricing">
        <div className="mk-pricing-banner">
          <span className="mk-pricing-banner-dot" aria-hidden="true" />
          <strong>Testnet beta</strong>
          <span>
            Arc is on testnet until Circle promotes mainnet. You can subscribe now to lock in plan
            access, but no card is charged and nanopayments settle in test USDC. We&apos;ll flip
            billing to live the day Arc mainnet ships.
          </span>
        </div>
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
              <a href={toAppHref(tier.cta.href)} className="mk-cta mk-cta-full">
                {tier.cta.label}
              </a>
            </article>
          ))}
        </div>
      </section>

      <section className="mk-symbols" aria-labelledby="mk-symbols-title">
        <div>
          <div className="mk-eyebrow">{content.symbols.eyebrow}</div>
          <h2 id="mk-symbols-title">{content.symbols.title}</h2>
          <p>{content.symbols.body}</p>
        </div>
        <div className="mk-symbol-grid" aria-hidden="true">
          {SYMBOL_ATLAS.map(symbol => (
            <img alt="" decoding="async" key={symbol} src={`/brand/icons/${symbol}`} />
          ))}
          <MarketingBrandHoverCard locale={normalized} appOrigin={appOrigin} />
        </div>
      </section>

      <footer className="mk-foot">
        <div className="mk-foot-grid">
          <div className="mk-foot-brand">
            <div className="mk-brand mk-foot-brand-row">
              <img
                alt=""
                className="mk-mark"
                decoding="async"
                src="/brand/logo-masters/clean/sendero_icon_vermilion_clean_2048.png"
              />
              <span>SENDERO</span>
              <span className="mk-x">·</span>
              <span>ARC</span>
            </div>
            <p className="mk-foot-tagline">{content.hero.subtitle}</p>
          </div>
          {(content.footer.groups ?? []).map(group => (
            <div className="mk-foot-col" key={group.label}>
              <strong>{group.label}</strong>
              <nav aria-label={group.label}>
                {group.links.map(link => (
                  <a key={`${group.label}-${link.label}`} href={toAppHref(link.href)}>
                    {link.label}
                  </a>
                ))}
              </nav>
            </div>
          ))}
        </div>
        <div className="mk-foot-bottom">
          <span>{content.footer.copyright}</span>
          <nav className="mk-foot-bottom-links" aria-label="Quick links">
            {content.footer.links.map(link => (
              <a key={link.href} href={link.href}>
                {link.label}
              </a>
            ))}
          </nav>
        </div>
      </footer>

      <style>{inlineCss}</style>
    </main>
  );
}

const inlineCss = `
  .mk-root { --mk-ease-out: cubic-bezier(0.23, 1, 0.32, 1); --mk-ease-in-out: cubic-bezier(0.77, 0, 0.175, 1); max-width: 1220px; margin: 0 auto; padding: 24px clamp(16px, 3vw, 48px) 80px; color-scheme: light; }
  .mk-nav { display: flex; justify-content: space-between; align-items: flex-start; font-family: var(--mono-x); font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; padding: 8px 0 20px; animation: mkNavIn 520ms var(--mk-ease-out) both; }
  .mk-brand { display: inline-flex; align-items: center; gap: 8px; font-weight: 500; }
  .mk-mark { display: inline-block; width: 28px; height: 28px; object-fit: contain; flex-shrink: 0; }
  .mk-x { opacity: 0.4; }
  .mk-nav-tools {
    display: flex;
    align-items: flex-start;
    justify-content: flex-end;
    gap: 22px;
    min-width: 0;
  }
  .mk-nav-apps {
    display: inline-flex;
    gap: 16px;
    padding-top: 7px;
    font-family: var(--mono-x);
    font-size: 11px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  .mk-nav-apps a {
    color: inherit;
    text-decoration: none;
    opacity: 0.85;
  }
  .mk-nav-apps a:hover {
    opacity: 1;
    text-decoration: underline;
  }
  .mk-nav-right { display: flex; justify-content: flex-end; align-items: flex-start; }
  /* Grid keeps waitlist + llms in column 2 so the secondary link cannot sit under the language block */
  .mk-nav-stack {
    display: grid;
    grid-template-columns: max-content max-content;
    grid-template-rows: auto auto;
    column-gap: 16px;
    row-gap: 10px;
    align-items: start;
    justify-items: end;
  }
  .mk-nav-stack > nav {
    grid-column: 1;
    grid-row: 1;
    justify-self: end;
  }
  .mk-nav-stack > a.mk-nav-waitlist {
    grid-column: 2;
    grid-row: 1;
    justify-self: end;
    align-self: start;
    margin-top: 23px;
  }
  .mk-nav-stack > a.mk-nav-secondary {
    grid-column: 2;
    grid-row: 2;
    justify-self: end;
  }
  .mk-nav-secondary {
    text-align: right;
    text-decoration: none;
    color: inherit;
    opacity: 0.85;
  }
  .mk-nav-secondary:hover { opacity: 1; text-decoration: underline; }
  .mk-cta { font-family: var(--mono-x); font-size: 11px; letter-spacing: 0.12em; padding: 8px 14px; background: var(--fg); color: var(--bg); text-transform: uppercase; transition: background 180ms var(--mk-ease-out), color 180ms var(--mk-ease-out), transform 140ms var(--mk-ease-out); }
  .mk-cta:hover { text-decoration: none; background: var(--accent); color: #fff7ec; }
  .mk-cta:active { transform: scale(0.98); }
  .mk-cta-lg { padding: 14px 22px; font-size: 12px; }
  .mk-cta-ghost { background: transparent; color: var(--fg); border: 1px solid var(--fg); }
  .mk-cta-ghost:hover { background: var(--fg); color: var(--bg); }
  .mk-cta-full { display: block; text-align: center; margin-top: 16px; }
  .mk-eyebrow { font-family: var(--mono-x); font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--ink); margin-bottom: 24px; }
  .mk-hero { --mk-hero-ease: cubic-bezier(0.23, 1, 0.32, 1); position: relative; isolation: isolate; width: 100vw; min-height: clamp(600px, 72vw, 760px); display: grid; align-items: end; margin: 0 calc(50% - 50vw) 80px; overflow: hidden; border-bottom: 1px solid var(--border); background: #eedcc7; }
  .mk-hero::after { content: ""; position: absolute; z-index: 1; inset: 36% 0 0; background: linear-gradient(to bottom, transparent, color-mix(in oklab, var(--bg) 92%, transparent) 72%); pointer-events: none; }
  .mk-hero-art { position: absolute; inset: 0; overflow: hidden; opacity: 0; animation: mkHeroImageIn 1100ms var(--mk-hero-ease) 80ms both; will-change: opacity; }
  .mk-hero-art::after { content: ""; position: absolute; inset: auto 9% 12% auto; width: min(34vw, 420px); height: 1px; background: linear-gradient(90deg, transparent, color-mix(in oklab, var(--accent) 76%, #111) 22%, color-mix(in oklab, var(--accent) 76%, #111) 72%, transparent); opacity: 0.72; transform-origin: left center; animation: mkRouteTrace 1300ms var(--mk-hero-ease) 520ms both; }
  .mk-hero-scene-wrap { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
  .mk-hero-scene-wrap > * { width: 100% !important; height: 100% !important; }
  .mk-hero-copy { position: relative; z-index: 2; width: min(820px, calc(100% - clamp(48px, 14vw, 192px))); margin: 0 auto clamp(40px, 7vh, 96px); padding: 0 0 clamp(40px, 6vw, 72px); }
  .mk-hero-copy > * { opacity: 0; transform: translateY(10px); animation: mkHeroTextIn 760ms var(--mk-hero-ease) both; will-change: opacity, transform; }
  /* Hero kicker: same fill as SenderoLanguageSelector active (.is-active / --sendero-language-ink + #fafaf7) */
  .mk-hero-copy .mk-eyebrow {
    display: inline-block;
    color: #fafaf7;
    background: var(--ink);
    padding: 0.42em 0.72em;
    margin-bottom: 24px;
    box-decoration-break: clone;
    -webkit-box-decoration-break: clone;
    animation-delay: 180ms;
  }
  .mk-hero-copy .mk-eyebrow::selection {
    background: color-mix(in oklab, #fafaf7 28%, var(--ink));
    color: #fafaf7;
    -webkit-text-fill-color: #fafaf7;
  }
  .mk-hero-copy .mk-eyebrow::-moz-selection {
    background: color-mix(in oklab, #fafaf7 28%, var(--ink));
    color: #fafaf7;
  }
  .mk-hero-copy .mk-title { animation-delay: 245ms; }
  .mk-hero-copy .mk-subtitle { animation-delay: 310ms; }
  .mk-hero-copy .mk-hero-ctas { animation-delay: 375ms; }
  .mk-title { font-family: var(--display); font-size: clamp(42px, 6.4vw, 76px); line-height: 1.12; letter-spacing: -0.015em; margin: 0 0 24px; font-weight: 450; max-width: 780px; color: #111111; text-wrap: balance; font-feature-settings: "ss01" on; word-spacing: 0.06em; }
  /* Same ink pill as language selector active + hero eyebrow */
  .mk-title-em {
    box-decoration-break: clone;
    -webkit-box-decoration-break: clone;
    color: #fafaf7;
    background: var(--ink);
    padding: 0.06em 0.22em;
    margin: 0 0.08em;
  }
  .mk-title-em::selection {
    background: color-mix(in oklab, #fafaf7 28%, var(--ink));
    color: #fafaf7;
    -webkit-text-fill-color: #fafaf7;
  }
  .mk-title-em::-moz-selection {
    background: color-mix(in oklab, #fafaf7 28%, var(--ink));
    color: #fafaf7;
  }
  .mk-subtitle { font-size: 18px; color: #4f4a43; max-width: 650px; margin: 0 0 32px; }
  .mk-hero-copy .mk-subtitle { margin-bottom: 22px; }
  .mk-hero-ctas { display: inline-flex; gap: 12px; flex-wrap: wrap; }
  .mk-waitlist { display: grid; grid-template-columns: minmax(0, 0.95fr) minmax(280px, 1.05fr); gap: 24px; align-items: center; margin: 0 0 80px; padding: 28px 24px; border: 1px solid var(--border); background: color-mix(in oklab, var(--accent) 4%, var(--bg)); box-shadow: inset 0 1px 0 var(--accent); }
  .mk-waitlist-copy { max-width: 480px; }
  .mk-waitlist-copy .mk-eyebrow { margin-bottom: 14px; color: var(--accent); }
  .mk-waitlist h2 { font-family: var(--display); font-size: clamp(28px, 3.5vw, 44px); line-height: 1.05; letter-spacing: -0.01em; margin: 0 0 12px; font-weight: 450; }
  .mk-waitlist p { color: var(--muted); max-width: 520px; margin: 0; font-size: 15px; line-height: 1.6; }
  .mk-waitlist-clerk-root { width: 100%; }
  .mk-waitlist-clerk-card { width: 100%; max-width: none; border: 0; box-shadow: none; background: transparent; padding: 0; }
  .mk-waitlist-clerk-hidden { display: none; }
  .mk-waitlist-clerk-input { border-radius: 0; border-color: var(--border); box-shadow: none; }
  .mk-waitlist-clerk-button { border-radius: 0; background: var(--fg); color: var(--bg); font-family: var(--mono-x); font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; box-shadow: none; }
  .mk-waitlist-loading { display: grid; gap: 10px; width: 100%; border: 1px solid var(--border); background: var(--bg); padding: 18px; }
  .mk-waitlist-loading span { font-family: var(--mono-x); font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); }
  .mk-waitlist-loading div { height: 42px; border: 1px solid var(--border); background: color-mix(in oklab, var(--accent) 4%, var(--bg)); animation: mkPulse 1.2s ease-in-out infinite alternate; }
  .mk-waitlist-loading div:last-child { border-color: var(--fg); background: var(--fg); }
  .mk-waitlist-loading .mk-waitlist-recovery { height: auto; display: grid; gap: 10px; border: 1px solid var(--border); background: var(--bg); padding: 14px; animation: none; }
  .mk-waitlist-recovery strong { font-family: var(--mono-x); font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--accent); }
  .mk-waitlist-recovery p { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.5; }
  .mk-waitlist-recovery button { height: 40px; border: 1px solid var(--fg); background: var(--fg); color: var(--bg); font-family: var(--mono-x); font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; }
  @keyframes mkPulse { from { opacity: 0.45; } to { opacity: 1; } }
  @keyframes mkNavIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes mkHeroImageIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes mkHeroTextIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes mkRouteTrace { from { opacity: 0; transform: scaleX(0); } to { opacity: 0.72; transform: scaleX(1); } }
  .mk-murals { display: grid; grid-template-columns: minmax(240px, 0.5fr) minmax(0, 1.5fr); gap: clamp(24px, 4vw, 48px); align-items: start; margin: 0 calc(clamp(16px, 3vw, 48px) * -1) 80px; padding: clamp(42px, 6vw, 70px) clamp(16px, 3vw, 48px); border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); background: color-mix(in oklab, #eedcc7 72%, var(--bg)); }
  .mk-murals-copy { position: sticky; top: 24px; }
  .mk-murals-copy h2 { font-family: var(--display); font-size: clamp(30px, 4vw, 50px); line-height: 1.03; letter-spacing: -0.012em; margin: 0 0 16px; font-weight: 450; text-wrap: balance; }
  .mk-murals-copy p { color: var(--muted); margin: 0; font-size: 15px; line-height: 1.65; max-width: 480px; }
  .mk-mural-gallery { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; min-width: 0; }
  .mk-mural { display: grid; align-content: start; gap: 14px; min-width: 0; margin: 0; }
  .mk-mural-1 { grid-column: 1 / -1; }
  .mk-mural img { display: block; width: 100%; aspect-ratio: 1.74; object-fit: cover; object-position: center; border: 1px solid var(--border); background: #eedcc7; filter: saturate(0.98) contrast(0.98); transition: filter 240ms var(--mk-ease-out), transform 420ms var(--mk-ease-out); }
  .mk-mural:hover img { filter: saturate(1.03) contrast(1); transform: translateY(-2px); }
  .mk-mural-1 img { aspect-ratio: 1.6; object-position: center; }
  .mk-mural figcaption { display: grid; gap: 7px; padding: 0 2px 10px; }
  .mk-mural figcaption span { font-family: var(--mono-x); font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--accent); }
  .mk-mural figcaption strong { font-size: 16px; line-height: 1.2; font-weight: 500; color: var(--fg); text-wrap: balance; }
  .mk-mural figcaption p { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.55; }
  .mk-story { margin: 0 0 80px; }
  .mk-story-intro { display: grid; grid-template-columns: minmax(0, 0.78fr) minmax(0, 1.22fr); gap: 28px; align-items: end; margin-bottom: 24px; }
  .mk-story-intro h2,
  .mk-passport-copy h2,
  .mk-symbols h2 { font-family: var(--display); font-size: clamp(28px, 3.5vw, 44px); line-height: 1.05; letter-spacing: -0.01em; margin: 0; font-weight: 450; text-wrap: balance; }
  .mk-story-intro p,
  .mk-passport-copy p,
  .mk-symbols p { color: var(--muted); margin: 0; font-size: 15px; line-height: 1.6; max-width: 650px; }
  .mk-story-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border: 1px solid var(--border); }
  .mk-story-card { display: grid; grid-template-rows: auto 1fr; min-width: 0; border-right: 1px solid var(--border); background: var(--bg); transition: background 220ms var(--mk-ease-out), transform 220ms var(--mk-ease-out); }
  .mk-story-card:hover { background: color-mix(in oklab, var(--accent) 4%, var(--bg)); transform: translateY(-2px); }
  .mk-story-card:last-child { border-right: none; }
  @media (max-width: 1024px) {
    .mk-story-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .mk-story-card:nth-child(2n) { border-right: none; }
    .mk-story-card:nth-child(-n + 2) { border-bottom: 1px solid var(--border); }
  }
  .mk-story-panel { aspect-ratio: 1.7; overflow: hidden; border-bottom: 1px solid var(--border); background: #eedcc7; }
  .mk-story-panel img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: center; filter: saturate(0.98) contrast(0.96); }
  .mk-story-body { display: grid; align-content: start; gap: 12px; padding: 22px; }
  .mk-story-icons { display: flex; gap: 10px; align-items: center; min-height: 38px; }
  .mk-story-icons img { width: 34px; height: 34px; object-fit: contain; }
  .mk-story-body span { font-family: var(--mono-x); font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--accent); }
  .mk-story-body h3 { font-size: 19px; line-height: 1.2; letter-spacing: 0; margin: 0; font-weight: 500; text-wrap: balance; }
  .mk-story-body p { color: var(--muted); font-size: 14px; line-height: 1.58; margin: 0; }
  .mk-features { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 0; margin: 0 0 80px; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
  .mk-feature { padding: 28px 24px; border-right: 1px solid var(--border); }
  .mk-feature:last-child { border-right: none; }
  .mk-feature-symbol { width: 44px; height: 44px; object-fit: contain; margin-bottom: 18px; }
  .mk-feature h3 { font-size: 16px; margin: 0 0 10px; letter-spacing: 0; }
  .mk-feature p { color: var(--muted); font-size: 14px; margin: 0; line-height: 1.55; }
  .mk-assets { display: grid; grid-template-columns: minmax(0, 0.72fr) minmax(0, 1.28fr); gap: 28px; margin: 0 0 80px; align-items: start; }
  .mk-assets-copy h2 { font-family: var(--display); font-size: clamp(28px, 3.5vw, 44px); line-height: 1.05; letter-spacing: -0.01em; margin: 0 0 14px; font-weight: 450; }
  .mk-assets-copy p { color: var(--muted); margin: 0; font-size: 15px; line-height: 1.6; }
  .mk-assets-grid { display: grid; gap: 12px; }
  .mk-asset { display: grid; grid-template-columns: 178px 1fr; min-height: 148px; margin: 0; border: 1px solid var(--border); background: var(--bg); overflow: hidden; }
  .mk-asset-media { position: relative; min-height: 148px; border-right: 1px solid var(--border); background: #eedcc7; overflow: hidden; }
  .mk-asset-media img { position: absolute; inset: 0; box-sizing: border-box; display: block; width: 100%; height: 100%; object-fit: contain; object-position: center; padding: 8px; filter: saturate(0.98) contrast(0.96); transition: transform 360ms var(--mk-ease-out), filter 220ms var(--mk-ease-out); }
  .mk-asset:hover .mk-asset-media img { filter: saturate(1.03) contrast(1); transform: scale(1.018); }
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
  .mk-postcard figcaption span { font-family: var(--mono-x); font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--accent); }
  .mk-postcard figcaption strong { font-size: 14px; line-height: 1.2; font-weight: 600; letter-spacing: 0; color: var(--fg); }
  .mk-postcard figcaption small { font-size: 12px; line-height: 1.25; color: #4d463d; }
  .mk-postcard figcaption p { margin: 0; color: var(--muted); font-size: 11px; line-height: 1.45; }
  .mk-pricing { margin: 0 0 80px; }
  .mk-pricing h2 { font-family: var(--display); font-size: clamp(28px, 3.5vw, 44px); letter-spacing: -0.01em; margin: 0 0 12px; font-weight: 450; }
  .mk-pricing-sub { color: var(--muted); max-width: 620px; margin: 0 0 32px; }
  .mk-pricing-banner {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    padding: 10px 16px;
    margin: 0 0 24px;
    border: 1px solid color-mix(in oklab, var(--ink) 45%, transparent);
    background: color-mix(in oklab, var(--ink) 6%, var(--bg));
    border-radius: 999px;
    font-family: var(--mono-x);
    font-size: 11px;
    letter-spacing: 0.08em;
    color: var(--fg);
    flex-wrap: wrap;
  }
  .mk-pricing-banner strong {
    color: var(--ink);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    font-weight: 600;
  }
  .mk-pricing-banner span:last-child {
    color: var(--muted);
    letter-spacing: 0;
    font-family: var(--sans);
    font-size: 13px;
  }
  .mk-pricing-banner-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--ink);
    box-shadow: 0 0 0 3px color-mix(in oklab, var(--ink) 24%, transparent);
  }
  .mk-tiers { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 0; border: 1px solid var(--border); }
  .mk-tier { padding: 28px 24px; border-right: 1px solid var(--border); display: flex; flex-direction: column; }
  .mk-tier:last-child { border-right: none; }
  .mk-tier-name { font-family: var(--mono-x); font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); margin-bottom: 12px; }
  .mk-tier-price { font-size: 40px; font-weight: 500; letter-spacing: 0; color: var(--accent); line-height: 1; }
  .mk-tier-unit { font-family: var(--mono-x); font-size: 11px; letter-spacing: 0.08em; color: var(--muted); margin: 6px 0 16px; text-transform: uppercase; }
  .mk-tier-desc { font-size: 14px; color: var(--muted); margin: 0 0 14px; flex: 0 0 auto; }
  .mk-tier ul { list-style: none; padding: 0; margin: 0 0 20px; font-size: 13px; flex: 1 1 auto; }
  .mk-tier li { padding: 4px 0; color: var(--fg); }
  .mk-symbols { display: grid; grid-template-columns: minmax(0, 0.72fr) minmax(0, 1.28fr); gap: 28px; align-items: start; margin: 0 0 80px; }
  .mk-symbol-grid { display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); border: 1px solid var(--border); background: color-mix(in oklab, var(--fg) 4%, var(--bg)); }
  .mk-symbol-grid img { display: block; width: 100%; aspect-ratio: 1; object-fit: contain; padding: 12px; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); }
  .mk-symbol-grid img:nth-child(8n) { border-right: none; }
  .mk-symbol-grid img:nth-last-child(-n + 8) { border-bottom: none; }
  .mk-brand-hover-trigger { display: flex; align-items: center; justify-content: center; aspect-ratio: 1; background: var(--ink); cursor: pointer; transition: background 220ms var(--mk-ease-out); position: relative; outline: none; }
  .mk-brand-hover-trigger::after { content: ""; position: absolute; inset: 8px; border: 1px dashed color-mix(in oklab, #fafaf7 38%, transparent); opacity: 0; transition: opacity 220ms var(--mk-ease-out); pointer-events: none; }
  .mk-brand-hover-trigger:hover, .mk-brand-hover-trigger:focus-visible { background: color-mix(in oklab, var(--ink) 88%, #000); text-decoration: none; }
  .mk-brand-hover-trigger:hover::after, .mk-brand-hover-trigger:focus-visible::after { opacity: 1; }
  .mk-brand-hover-trigger img { display: block; width: 78%; height: 78%; object-fit: contain; padding: 0; border: none; aspect-ratio: 1; transition: transform 240ms var(--mk-ease-out); }
  .mk-brand-hover-trigger:hover img, .mk-brand-hover-trigger:focus-visible img { transform: scale(1.06); }

  /* Hover card — mirrors apps/app BrandUpgradeCard pattern, marketing-side CTA */
  .mk-brand-hover-card { z-index: 60; width: 320px; padding: 0; border: 1px solid color-mix(in oklab, var(--ink) 22%, transparent); background: var(--bg); color: var(--fg); box-shadow: 0 18px 48px -16px color-mix(in oklab, var(--ink) 32%, transparent), 0 4px 12px -6px rgba(0, 0, 0, 0.12); border-radius: 4px; outline: none; overflow: hidden; }
  .mk-brand-hover-card[data-state=open] { animation: mkBrandCardIn 220ms var(--mk-ease-out) both; }
  .mk-brand-hover-head { display: flex; align-items: center; gap: 12px; padding: 16px 16px 12px; }
  .mk-brand-hover-head img { width: 40px; height: 40px; object-fit: contain; border-radius: 4px; }
  .mk-brand-hover-head-copy { display: grid; gap: 2px; min-width: 0; flex: 1; }
  .mk-brand-hover-kicker { font-family: var(--mono-x); font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); }
  .mk-brand-hover-head-copy strong { font-size: 15px; line-height: 1.2; font-weight: 500; color: var(--fg); }
  .mk-brand-hover-body { margin: 0; padding: 12px 16px; border-top: 1px solid color-mix(in oklab, var(--ink) 12%, transparent); font-size: 13px; line-height: 1.55; color: var(--muted); }
  .mk-brand-hover-bullets { list-style: none; margin: 0; padding: 0 16px 14px; display: grid; gap: 8px; }
  .mk-brand-hover-bullets li { display: flex; align-items: center; gap: 8px; font-family: var(--mono-x); font-size: 10px; letter-spacing: 0.10em; text-transform: uppercase; color: var(--muted); }
  .mk-brand-hover-dot { width: 4px; height: 4px; border-radius: 50%; background: var(--ink); flex-shrink: 0; }
  .mk-brand-hover-cta { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 13px 16px; border-top: 1px solid color-mix(in oklab, var(--ink) 12%, transparent); font-family: var(--mono-x); font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #fafaf7; background: var(--ink); text-decoration: none; transition: background 180ms var(--mk-ease-out); }
  .mk-brand-hover-cta:hover { background: color-mix(in oklab, var(--ink) 88%, #000); text-decoration: none; }
  @keyframes mkBrandCardIn { from { opacity: 0; transform: translateY(6px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
  /* Proof strip — capability marquee under the hero (YC pattern 5: lead with scale) */
  .mk-proof { position: relative; width: 100vw; margin: -80px calc(50% - 50vw) 64px; padding: 14px 0; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); background: color-mix(in oklab, var(--accent) 6%, var(--bg)); overflow: hidden; -webkit-mask-image: linear-gradient(90deg, transparent, #000 6%, #000 94%, transparent); mask-image: linear-gradient(90deg, transparent, #000 6%, #000 94%, transparent); }
  .mk-proof-track { display: inline-flex; align-items: center; gap: 36px; padding-left: 36px; white-space: nowrap; will-change: transform; animation: mkProofMarquee 38s linear infinite; }
  .mk-proof:hover .mk-proof-track { animation-play-state: paused; }
  .mk-proof-item { display: inline-flex; align-items: center; gap: 10px; font-family: var(--mono-x); font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--fg); }
  .mk-proof-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 3px color-mix(in oklab, var(--accent) 22%, transparent); flex-shrink: 0; }
  @keyframes mkProofMarquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }

  /* Audiences strip — four ways in (YC pattern 3: every audience gets a CTA in 3 seconds) */
  .mk-audiences { margin: 0 0 80px; scroll-margin-top: 32px; }
  .mk-audiences-head { display: grid; grid-template-columns: minmax(0, 0.78fr) minmax(0, 1.22fr); gap: 28px; align-items: end; margin-bottom: 24px; }
  .mk-audiences-head .mk-eyebrow { margin-bottom: 0; color: var(--accent); }
  .mk-audiences-title { font-family: var(--display); font-size: clamp(28px, 3.5vw, 44px); line-height: 1.05; letter-spacing: -0.01em; margin: 0; font-weight: 450; text-wrap: balance; }
  .mk-audience-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border: 1px solid var(--border); }
  .mk-audience { position: relative; display: grid; align-content: start; gap: 12px; padding: 28px 22px; min-height: 232px; border-right: 1px solid var(--border); background: var(--bg); color: inherit; text-decoration: none; isolation: isolate; transition: background 220ms var(--mk-ease-out), transform 220ms var(--mk-ease-out); }
  .mk-audience:last-child { border-right: none; }
  .mk-audience::before { content: ""; position: absolute; left: 0; top: 0; right: 0; height: 0; background: var(--accent); transition: height 240ms var(--mk-ease-out); z-index: -1; }
  .mk-audience:hover { text-decoration: none; transform: translateY(-2px); background: color-mix(in oklab, var(--accent) 5%, var(--bg)); }
  .mk-audience:hover::before { height: 3px; }
  .mk-audience-head { display: flex; align-items: baseline; gap: 10px; }
  .mk-audience-num { font-family: var(--mono-x); font-size: 10px; letter-spacing: 0.16em; color: var(--accent); }
  .mk-audience-label { font-family: var(--mono-x); font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--fg); }
  .mk-audience-headline { font-family: var(--display); font-size: 22px; line-height: 1.18; letter-spacing: -0.005em; font-weight: 450; margin: 0; color: var(--fg); text-wrap: balance; }
  .mk-audience-body { font-size: 13.5px; line-height: 1.55; color: var(--muted); margin: 0; }
  .mk-audience-cta { display: inline-flex; align-items: center; gap: 8px; margin-top: auto; padding-top: 14px; font-family: var(--mono-x); font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--accent); }
  .mk-audience-arrow { display: inline-block; transition: transform 200ms var(--mk-ease-out); }
  .mk-audience:hover .mk-audience-arrow { transform: translateX(4px); }
  @supports (animation-timeline: view()) {
    .mk-audience { opacity: 0; transform: translateY(12px); animation: mkSectionIn 600ms var(--mk-ease-out) both; animation-delay: calc(var(--mk-audience-i, 0) * 70ms); animation-range: entry 0% cover 18%; animation-timeline: view(); }
  }

  /* Footer — sitemap (YC pattern 10) */
  .mk-foot { padding-top: 48px; margin-top: 32px; border-top: 1px solid var(--border); }
  .mk-foot-grid { display: grid; grid-template-columns: minmax(0, 1.6fr) repeat(3, minmax(0, 1fr)); gap: clamp(24px, 4vw, 56px); padding-bottom: 40px; }
  .mk-foot-brand { display: grid; gap: 14px; align-content: start; max-width: 360px; }
  .mk-foot-brand-row { font-family: var(--mono-x); font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; }
  .mk-foot-tagline { margin: 0; font-size: 13px; line-height: 1.55; color: var(--muted); }
  .mk-foot-col { display: grid; gap: 14px; align-content: start; }
  .mk-foot-col strong { font-family: var(--mono-x); font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--fg); font-weight: 600; }
  .mk-foot-col nav { display: grid; gap: 10px; }
  .mk-foot-col a { font-size: 13px; color: var(--muted); text-decoration: none; transition: color 160ms var(--mk-ease-out); }
  .mk-foot-col a:hover { color: var(--accent); text-decoration: none; }
  .mk-foot-bottom { display: flex; flex-wrap: wrap; gap: 16px 24px; justify-content: space-between; align-items: center; padding-top: 24px; border-top: 1px solid var(--border); font-family: var(--mono-x); font-size: 11px; color: var(--muted); letter-spacing: 0.08em; text-transform: uppercase; }
  .mk-foot-bottom-links { display: inline-flex; flex-wrap: wrap; gap: 18px; }
  .mk-foot-bottom-links a { color: inherit; text-decoration: none; }
  .mk-foot-bottom-links a:hover { color: var(--accent); }

  @supports (animation-timeline: view()) {
    .mk-proof,
    .mk-waitlist,
    .mk-murals,
    .mk-story,
    .mk-features,
    .mk-assets,
    .mk-passport,
    .mk-pricing,
    .mk-symbols {
      animation: mkSectionIn 720ms var(--mk-ease-out) both;
      animation-range: entry 0% cover 24%;
      animation-timeline: view();
      opacity: 0;
      transform: translateY(14px);
    }
  }
  @keyframes mkSectionIn { to { opacity: 1; transform: translateY(0); } }
  @media (max-width: 640px) {
    .mk-root { padding: 20px 14px 64px; }
    .mk-nav { display: grid; grid-template-columns: 1fr; gap: 14px; align-items: stretch; padding-bottom: 24px; }
    .mk-nav-tools {
      display: grid;
      grid-template-columns: 1fr;
      gap: 12px;
      width: 100%;
      align-items: stretch;
    }
    .mk-nav-apps {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      width: 100%;
      padding-top: 0;
    }
    .mk-nav-apps a {
      display: flex;
      min-height: 40px;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--border);
      padding: 8px 10px;
      text-align: center;
      line-height: 1.15;
      text-decoration: none;
      opacity: 1;
    }
    .mk-nav-apps a:last-child {
      grid-column: 1 / -1;
    }
    .mk-nav-right { display: grid; grid-template-columns: 1fr; gap: 10px; width: 100%; }
    .mk-nav-stack {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 10px;
      width: 100%;
    }
    .mk-nav-stack > nav,
    .mk-nav-stack > a.mk-nav-waitlist,
    .mk-nav-stack > a.mk-nav-secondary {
      grid-column: auto;
      grid-row: auto;
      justify-self: stretch;
      margin-top: 0;
    }
    .mk-nav-right a { display: flex; min-height: 40px; align-items: center; justify-content: center; border: 1px solid var(--border); padding: 8px 10px; text-align: center; line-height: 1.15; text-decoration: none; }
    .mk-nav-right .mk-cta { border-color: var(--fg); white-space: normal; }
    .mk-hero { min-height: 620px; margin-left: calc(50% - 50vw); margin-right: calc(50% - 50vw); margin-bottom: 64px; }
    .mk-hero-copy { width: calc(100% - 28px); margin-bottom: clamp(32px, 6vh, 72px); padding-bottom: 40px; }
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
    .mk-symbol-grid img:nth-last-child(-n + 8) { border-bottom: 1px solid var(--border); }
    .mk-symbol-grid img:nth-last-child(-n + 4) { border-bottom: none; }
    .mk-assets { grid-template-columns: 1fr; }
    .mk-asset { grid-template-columns: 1fr; }
    .mk-asset-media { border-right: none; border-bottom: 1px solid var(--border); }
    .mk-feature { border-right: none; border-bottom: 1px solid var(--border); }
    .mk-feature:last-child { border-bottom: none; }
    .mk-tier { border-right: none; border-bottom: 1px solid var(--border); }
    .mk-tier:last-child { border-bottom: none; }
    .mk-proof { width: 100vw; margin-left: calc(50% - 50vw); margin-right: calc(50% - 50vw); margin-top: -56px; }
    .mk-audiences-head { grid-template-columns: 1fr; gap: 14px; align-items: start; }
    .mk-audience-grid { grid-template-columns: 1fr 1fr; }
    .mk-audience { border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); min-height: 200px; padding: 22px 18px; }
    .mk-audience:nth-child(2n) { border-right: none; }
    .mk-audience:nth-last-child(-n + 2) { border-bottom: none; }
    .mk-audience-headline { font-size: 19px; }
    .mk-foot-grid { grid-template-columns: 1fr 1fr; gap: 28px 24px; }
    .mk-foot-brand { grid-column: 1 / -1; max-width: none; }
    .mk-foot-bottom { flex-direction: column; align-items: flex-start; gap: 12px; }
  }
  @media (max-width: 420px) {
    .mk-audience-grid { grid-template-columns: 1fr; }
    .mk-audience { border-right: none; border-bottom: 1px solid var(--border); }
    .mk-audience:last-child { border-bottom: none; }
    .mk-foot-grid { grid-template-columns: 1fr; }
  }
  @media (prefers-reduced-motion: reduce) {
    .mk-hero-art,
    .mk-hero-art::after,
    .mk-nav,
    .mk-hero-copy > *,
    .mk-proof,
    .mk-proof-track,
    .mk-audience,
    .mk-waitlist,
    .mk-murals,
    .mk-story,
    .mk-features,
    .mk-assets,
    .mk-passport,
    .mk-pricing,
    .mk-symbols {
      opacity: 1;
      animation: none;
      will-change: auto;
    }
    .mk-hero-copy > *,
    .mk-proof-track,
    .mk-audience,
    .mk-waitlist,
    .mk-murals,
    .mk-story,
    .mk-features,
    .mk-assets,
    .mk-passport,
    .mk-pricing,
    .mk-symbols,
    .mk-story-card:hover,
    .mk-mural:hover img,
    .mk-asset:hover .mk-asset-media img,
    .mk-audience:hover { transform: none; }
  }
`;
