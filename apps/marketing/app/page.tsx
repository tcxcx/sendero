import { cookies, headers } from 'next/headers';

import {
  DEFAULT_LOCALE,
  detectLocale,
  LOCALE_COOKIE_NAME,
  LOCALE_HEADER_NAME,
  normalizeLocale,
} from '@sendero/locale';
import { resolvePublicOrigin } from '@sendero/seo';

import { getMarketingContent } from '@/lib/content';
import { heroTitleWithHighlights } from '@/lib/hero-title';

import { MarketingBrandHoverCard } from './brand-hover-card';
import { MarketingEngineScene } from './marketing-engine-scene';
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
    'https://app.sendero.travel'
  );
  // Marketing site lives on a different host from the app. Resolve any
  // app-relative path (/dashboard, /onboarding) to the app origin so it
  // works in dev (3010) AND prod (app.sendero.travel) without hardcoding.
  const APP_PATHS = ['/dashboard', '/onboarding'];
  const toAppHref = (href: string) =>
    APP_PATHS.some(p => href === p || href.startsWith(`${p}/`) || href.startsWith(`${p}?`))
      ? `${appOrigin.replace(/\/$/, '')}${href}`
      : href;

  // Header + footer come from app/layout.tsx (SiteHeader / SiteFooter).
  // SiteHeader renders the language selector + primary CTA on the right
  // of the nav row — see apps/marketing/components/site-shell/site-header.tsx.
  return (
    <>
      <section className="mk-hero">
        <div className="mk-hero-art s-fade s-fade-1" aria-hidden="true">
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

      <div className="mk-scene-banner" aria-hidden="true">
        <MarketingEngineScene />
      </div>

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

      {/* Footer comes from app/layout.tsx (SiteFooter). */}

      {/* All `mk-*` chrome lives in apps/marketing/app/globals.css. */}
    </>
  );
}
