import { cookies, headers } from 'next/headers';

import {
  detectLocale,
  LOCALE_COOKIE_NAME,
  LOCALE_HEADER_NAME,
  normalizeLocale,
} from '@sendero/locale';
import { resolvePublicOrigin } from '@sendero/seo';

import { getMarketingContent } from '@/lib/content';
import { createPageMetadata } from '@/lib/metadata';

export const metadata = createPageMetadata({
  title: 'Pricing — simple plans for travel-ops agents · Sendero',
  description:
    'Sendero pricing. Free tier with $100 cap, Basic at $19/mo, Pro at $60/mo (14-day trial), Enterprise on contact. Two revenue legs: SaaS subscription + per-call nanopayments. Sandbox keys ship with every workspace.',
  path: '/pricing',
  og: {
    title: 'Pricing · Sendero',
    description: 'Start on the free tier. Upgrade as your agents settle real money.',
  },
  keywords: [
    'sendero pricing',
    'travel agent pricing',
    'mcp server pricing',
    'usdc settlement fees',
    'agent platform pricing',
    'nanopayments pricing',
  ],
});

const APP_PATHS = ['/dashboard', '/onboarding', '/billing'];

function toAppHref(href: string, appOrigin: string): string {
  return APP_PATHS.some(p => href === p || href.startsWith(`${p}/`) || href.startsWith(`${p}?`))
    ? `${appOrigin.replace(/\/$/, '')}${href}`
    : href;
}

export default async function PricingPage() {
  const [hdrs, cookieStore] = await Promise.all([headers(), cookies()]);
  const locale = detectLocale({
    cookie: cookieStore.get(LOCALE_COOKIE_NAME)?.value,
    acceptLanguage:
      hdrs.get(LOCALE_HEADER_NAME) ?? hdrs.get('accept-language') ?? hdrs.get('x-vercel-ip-locale'),
    country: hdrs.get('x-vercel-ip-country') ?? hdrs.get('cf-ipcountry'),
  });
  const content = await getMarketingContent(locale);
  const _normalized = normalizeLocale(content.locale);
  const appOrigin = resolvePublicOrigin(
    process.env.NEXT_PUBLIC_APP_URL,
    'https://app.sendero.travel'
  );

  // Header + footer come from app/layout.tsx (SiteHeader / SiteFooter).
  return (
    <>
      <section className="mk-hero" style={{ minHeight: 'auto', paddingBottom: 32 }}>
        <div className="mk-hero-copy" style={{ maxWidth: '70ch' }}>
          <div className="mk-eyebrow">Pricing</div>
          <h1 className="mk-title">{content.pricing.heading}</h1>
          <p className="mk-subtitle">{content.pricing.subheading}</p>
        </div>
      </section>

      <section className="mk-pricing" id="pricing" style={{ marginTop: 0 }}>
        <div className="mk-pricing-banner">
          <span className="mk-pricing-banner-dot" aria-hidden="true" />
          <strong>Testnet beta</strong>
          <span>
            Arc is on testnet until Circle promotes mainnet. You can subscribe now to lock in plan
            access, but no card is charged and nanopayments settle in test USDC. We&apos;ll flip
            billing to live the day Arc mainnet ships.
          </span>
        </div>
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
              <a href={toAppHref(tier.cta.href, appOrigin)} className="mk-cta mk-cta-full">
                {tier.cta.label}
              </a>
            </article>
          ))}
        </div>
      </section>

      {/*
        Two-legs explainer — adds context the home anchor can't fit. SaaS leg
        + nanopayments leg are independent, and discounts compound.
      */}
      <section style={{ padding: '0 max(24px, 6vw) 80px', maxWidth: '900px', margin: '0 auto' }}>
        <h2
          style={{
            fontFamily: 'var(--display)',
            fontSize: 'clamp(22px, 2.5vw, 32px)',
            letterSpacing: '-0.01em',
            margin: '0 0 16px',
            fontWeight: 450,
          }}
        >
          How billing works
        </h2>
        <div
          style={{
            display: 'grid',
            gap: 16,
            gridTemplateColumns: '1fr',
            fontSize: 14,
            lineHeight: 1.6,
          }}
        >
          <p>
            <strong>Two revenue legs.</strong> A monthly SaaS subscription (this page) covers the
            seat. Per-call <strong>nanopayments</strong> are charged on top — every metered tool
            call your agent makes pays a small amount of USDC from your workspace's Arc wallet. They
            are independent: a Pro trial pauses leg 1 while leg 2 keeps flowing.
          </p>
          <p>
            <strong>Plan discounts compound.</strong> Pro gets 30% off nanopay rates and 10% off
            booking take-rate. Enterprise gets 50% / 15%. The discount is applied to the meter event
            at dispatch time — see{' '}
            <code style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>buildPlanOverrides()</code> in{' '}
            <code style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>
              apps/app/lib/billing-plan.ts
            </code>
            .
          </p>
          <p>
            <strong>Sandbox is always free.</strong> Every workspace mints a sandbox API key
            automatically on creation. Sandbox keys route meter events to{' '}
            <code style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>status: 'sandbox'</code>; no
            real USDC moves. Practice the whole flow before paying anything.
          </p>
          <p>
            <strong>Pro free trial: 14 days, no card required.</strong> Clerk handles the trial
            timing natively;{' '}
            <code style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>
              has({'{'} plan: 'pro' {'}'})
            </code>{' '}
            stays true throughout. Drop to Free at expiry, or upgrade with a card.
          </p>
        </div>
      </section>
    </>
  );
}
