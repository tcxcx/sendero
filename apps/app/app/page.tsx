import Link from 'next/link';

import { Button } from '@sendero/ui/button';
import {
  ArrowRight,
  Blocks,
  Bot,
  BriefcaseBusiness,
  CircleDollarSign,
  KeyRound,
  Landmark,
  Link2,
  type LucideIcon,
  MessageCircle,
  Plane,
  ReceiptText,
  Route,
  ShieldCheck,
  Sparkles,
  WalletCards,
} from 'lucide-react';

import { LanguageSelector } from '@/components/language-selector';
import { ScrollReveal } from '@/components/scroll-reveal';
import { APP_SYMBOL_ATLAS, getAppCopy } from '@/lib/app-copy';
import { getRequestLocale } from '@/lib/request-locale';

const agentLoopIcons: Record<string, LucideIcon> = {
  receive: MessageCircle,
  resolve: Bot,
  quote: Plane,
  confirm: WalletCards,
  support: Route,
};

const segmentIcons: Record<string, LucideIcon> = {
  consumer: MessageCircle,
  agency: Landmark,
  corporate: BriefcaseBusiness,
  agents: Blocks,
};

const journeyIcons: Record<string, LucideIcon> = {
  traveler: MessageCircle,
  agency: Landmark,
  corporate: BriefcaseBusiness,
  mcp: Blocks,
};

const principleIcons: Record<string, LucideIcon> = {
  agent: Bot,
  sessions: Sparkles,
  policy: ShieldCheck,
  ledger: ReceiptText,
};

export default async function Page() {
  const locale = await getRequestLocale();
  const copy = getAppCopy(locale).home;

  return (
    <main className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <nav className="mx-auto flex w-full max-w-6xl flex-wrap items-start justify-between gap-4 px-5 py-5 sm:px-8">
        <Link href="/" className="s-press s-enter s-enter-1 flex items-center gap-3 no-underline">
          <img
            alt=""
            className="size-7 object-contain"
            decoding="async"
            src="/brand/logo-masters/clean/sendero_icon_vermilion_clean_2048.png"
          />
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--text)]">
            Sendero
          </span>
        </Link>

        <div className="s-enter s-enter-2 flex flex-wrap items-start justify-end gap-2">
          <LanguageSelector canonicalPath="/" currentLocale={locale} />
          <Link
            href="/llms.txt"
            className="s-press hidden font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--text-dim)] no-underline hover:text-[var(--ink)] sm:inline-flex"
          >
            {copy.nav.llms}
          </Link>
          <Button asChild variant="ghost" className="s-press rounded-none">
            <Link href="/sign-in">{copy.nav.signIn}</Link>
          </Button>
          <Button
            asChild
            className="s-press rounded-none border border-[var(--ink)] bg-[var(--ink)] text-white hover:bg-[var(--ink)]/90 hover:text-white"
          >
            <Link href="/waitlist">{copy.nav.requestAccess}</Link>
          </Button>
        </div>
      </nav>

      <section className="relative mx-auto grid w-full max-w-6xl gap-12 overflow-hidden px-5 pb-14 pt-10 sm:px-8 sm:pt-14 lg:grid-cols-[minmax(0,1.02fr)_minmax(360px,0.98fr)] lg:pb-16">
        <div
          aria-hidden="true"
          className="s-fade s-fade-2 pointer-events-none absolute inset-x-0 top-0 h-72 overflow-hidden opacity-[0.35] [mask-image:linear-gradient(to_bottom,black,transparent)]"
        >
          <img
            alt=""
            className="h-full w-full object-cover object-top"
            decoding="async"
            src="/brand/app-hero-transparent-edge.png"
          />
        </div>

        <div className="relative z-10 max-w-3xl">
          <div className="s-enter s-enter-1 mb-6 inline-flex items-center gap-2 border border-[var(--border)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--text-dim)]">
            <span
              aria-hidden="true"
              className="s-pulse-dot inline-block size-1.5 rounded-full bg-[var(--ink)]"
            />
            {copy.hero.eyebrow}
          </div>

          <h1 className="s-enter s-enter-2 m-0 text-[42px] font-medium leading-[0.98] tracking-normal text-[var(--text)] sm:text-[62px] lg:text-[76px]">
            {copy.hero.title}
          </h1>

          <p className="s-enter s-enter-3 mt-6 max-w-2xl text-base leading-7 text-[var(--text-dim)] sm:text-lg">
            {copy.hero.body}
          </p>

          <div className="s-enter s-enter-4 mt-6 flex flex-wrap gap-2">
            {copy.hero.channels.map(channel => (
              <span
                className="s-press border border-[var(--border)] bg-[var(--bg-elev)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-[var(--text-dim)] hover:border-[var(--ink)] hover:text-[var(--ink)]"
                key={channel}
              >
                {channel}
              </span>
            ))}
          </div>

          <div className="s-enter s-enter-5 mt-8 flex flex-col gap-3 sm:flex-row">
            <Button
              asChild
              size="lg"
              className="s-press h-12 rounded-none border border-[var(--ink)] bg-[var(--ink)] px-6 text-white hover:bg-[var(--ink)]/90 hover:text-white"
            >
              <Link href={copy.hero.primaryCta.href}>
                {copy.hero.primaryCta.label} <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="s-press h-12 rounded-none px-6">
              <Link href={copy.hero.secondaryCta.href}>{copy.hero.secondaryCta.label}</Link>
            </Button>
          </div>
        </div>

        <div className="s-enter s-enter-3 relative z-10 border border-[var(--border)] bg-[var(--bg-elev)]">
          <div className="aspect-[16/9] overflow-hidden border-b border-[var(--border)] bg-[#eedcc7]">
            <img
              alt=""
              className="h-full w-full object-cover object-center"
              data-reveal="reveal"
              decoding="async"
              src="/brand/generated/agent-workflow-map.png"
            />
          </div>
          <div className="border-b border-[var(--border)] px-5 py-4">
            <p className="m-0 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--ink)]">
              <span
                aria-hidden="true"
                className="s-pulse-dot inline-block size-1.5 rounded-full bg-[var(--ink)]"
              />
              {copy.agentLoopEyebrow}
            </p>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {copy.agentLoop.map((item, index) => {
              const Icon = agentLoopIcons[item.id] ?? Sparkles;
              return (
                <div
                  className="grid grid-cols-[40px_1fr] gap-4 px-5 py-5"
                  data-reveal
                  key={item.label}
                  style={{ ['--s-reveal-i' as string]: index + 2 }}
                >
                  <div className="relative flex size-10 items-center justify-center border border-[var(--border)] bg-[var(--bg)] text-[var(--ink)]">
                    <img
                      alt=""
                      className="size-7 object-contain"
                      decoding="async"
                      src={item.stamp}
                    />
                    <Icon className="absolute bottom-0.5 right-0.5 size-3 text-[var(--text-faint)]" />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-baseline justify-between gap-3">
                      <h2 className="m-0 text-base font-medium text-[var(--text)]">{item.label}</h2>
                      <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--text-faint)]">
                        {item.step}
                      </span>
                    </div>
                    <p className="m-0 mt-2 text-sm leading-6 text-[var(--text-dim)]">
                      {item.detail}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--border)]">
        <div className="mx-auto grid max-w-6xl gap-8 px-5 py-12 sm:px-8 lg:grid-cols-[minmax(0,0.86fr)_minmax(0,1.14fr)]">
          <div data-reveal>
            <div className="mb-3 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--ink)]">
              <Link2 className="size-4" />
              {copy.escrow.eyebrow}
            </div>
            <h2 className="m-0 text-3xl font-medium leading-tight tracking-normal text-[var(--text)] sm:text-4xl">
              {copy.escrow.title}
            </h2>
            <p className="m-0 mt-4 max-w-xl text-sm leading-6 text-[var(--text-dim)]">
              {copy.escrow.body}
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Button
                asChild
                className="s-press h-11 rounded-none border border-[var(--ink)] bg-[var(--ink)] text-white hover:bg-[var(--ink)]/90 hover:text-white"
              >
                <Link href={copy.escrow.primaryCta.href}>
                  {copy.escrow.primaryCta.label} <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button asChild variant="outline" className="s-press h-11 rounded-none">
                <Link href={copy.escrow.secondaryCta.href}>{copy.escrow.secondaryCta.label}</Link>
              </Button>
            </div>
          </div>

          <div className="border border-[var(--border)] bg-[var(--bg-elev)]">
            {copy.escrow.journey.map((item, index) => (
              <div
                className="grid gap-4 border-b border-[var(--border)] px-5 py-5 last:border-b-0 sm:grid-cols-[130px_44px_1fr]"
                data-reveal
                key={item.label}
                style={{ ['--s-reveal-i' as string]: index + 1 }}
              >
                <div className="aspect-[1.7] overflow-hidden border border-[var(--border)] bg-[#eedcc7]">
                  <img
                    alt=""
                    className="h-full w-full object-cover"
                    decoding="async"
                    src={item.panel}
                  />
                </div>
                <div className="flex size-11 items-center justify-center border border-[var(--border)] font-mono text-[12px] text-[var(--ink)]">
                  <img alt="" className="size-7 object-contain" decoding="async" src={item.stamp} />
                </div>
                <div>
                  <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--text-faint)]">
                    {String(index + 1).padStart(2, '0')}
                  </div>
                  <h3 className="m-0 mt-1 text-base font-medium text-[var(--text)]">
                    {item.label}
                  </h3>
                  <p className="m-0 mt-2 text-sm leading-6 text-[var(--text-dim)]">{item.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--border)] bg-[var(--bg-elev)]">
        <div className="mx-auto grid max-w-6xl gap-8 px-5 py-12 sm:px-8 lg:grid-cols-[260px_1fr]">
          <div data-reveal>
            <div className="mb-3 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--ink)]">
              <Bot className="size-4" />
              {copy.segments.eyebrow}
            </div>
            <p className="m-0 text-sm leading-6 text-[var(--text-dim)]">{copy.segments.body}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {copy.segments.items.map((item, index) => {
              const Icon = segmentIcons[item.id] ?? Sparkles;
              return (
                <div
                  className="s-lift border border-[var(--ink)] bg-[var(--ink)] px-4 py-4 text-white shadow-[0_14px_36px_rgba(120,49,25,0.12)] hover:shadow-[0_20px_44px_rgba(120,49,25,0.18)]"
                  data-reveal
                  key={item.label}
                  style={{ ['--s-reveal-i' as string]: index + 1 }}
                >
                  <Icon className="mb-4 size-5 text-white" />
                  <h2 className="m-0 text-base font-medium text-white">{item.label}</h2>
                  <p className="m-0 mt-2 text-sm leading-6 text-white/80">{item.detail}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--border)]">
        <div className="mx-auto grid max-w-6xl gap-8 px-5 py-12 sm:px-8 lg:grid-cols-[260px_1fr]">
          <div data-reveal>
            <div className="mb-3 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--ink)]">
              <KeyRound className="size-4" />
              {copy.journeys.eyebrow}
            </div>
            <p className="m-0 text-sm leading-6 text-[var(--text-dim)]">{copy.journeys.body}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {copy.journeys.items.map((item, index) => {
              const Icon = journeyIcons[item.id] ?? Sparkles;
              return (
                <article
                  className="s-lift border border-[var(--border)] bg-[var(--bg-elev)] p-5 hover:border-[var(--ink)]"
                  data-reveal
                  key={item.label}
                  style={{ ['--s-reveal-i' as string]: index + 1 }}
                >
                  <div className="-mx-5 -mt-5 mb-5 aspect-[1.7] overflow-hidden border-b border-[var(--border)] bg-[#eedcc7]">
                    <img
                      alt=""
                      className="h-full w-full object-cover object-center"
                      decoding="async"
                      src={item.panel}
                    />
                  </div>
                  <div className="mb-5 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2">
                      <img
                        alt=""
                        className="size-8 object-contain"
                        decoding="async"
                        src={item.stamp}
                      />
                      <Icon className="size-4 text-[var(--text-faint)]" />
                    </div>
                    <Link
                      href={item.href}
                      className="s-press border border-[var(--ink)] bg-[var(--ink)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-white no-underline hover:bg-[var(--ink)]/90 hover:text-white"
                    >
                      {item.cta}
                    </Link>
                  </div>
                  <h3 className="m-0 text-lg font-medium text-[var(--text)]">{item.label}</h3>
                  <p className="m-0 mt-2 text-sm leading-6 text-[var(--text-dim)]">{item.detail}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--border)]">
        <div className="mx-auto grid max-w-6xl gap-8 px-5 py-12 sm:px-8 lg:grid-cols-[260px_1fr]">
          <div data-reveal>
            <div className="mb-3 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--ink)]">
              <ReceiptText className="size-4" />
              {copy.routeStates.eyebrow}
            </div>
            <h2 className="m-0 text-3xl font-medium leading-tight tracking-normal text-[var(--text)]">
              {copy.routeStates.title}
            </h2>
            <p className="m-0 mt-4 text-sm leading-6 text-[var(--text-dim)]">
              {copy.routeStates.body}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {copy.routeStates.panels.map((panel, index) => (
              <figure
                className="s-lift m-0 overflow-hidden border border-[var(--border)] bg-[var(--bg-elev)] hover:border-[var(--ink)]"
                data-reveal
                key={panel.label}
                style={{ ['--s-reveal-i' as string]: index + 1 }}
              >
                <img
                  alt=""
                  className="aspect-[1.7] w-full object-cover"
                  decoding="async"
                  src={panel.src}
                />
                <figcaption className="flex min-h-11 items-center justify-between border-t border-[var(--ink)] bg-[var(--ink)] px-3 font-mono text-[11px] uppercase tracking-[0.12em] text-white">
                  <span className="text-white/80">{String(index + 1).padStart(2, '0')}</span>
                  {panel.label}
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--border)] bg-[var(--bg-elev)]">
        <div className="mx-auto grid max-w-6xl gap-8 px-5 py-12 sm:px-8 lg:grid-cols-[260px_1fr]">
          <div data-reveal>
            <div className="mb-3 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--ink)]">
              <Sparkles className="size-4" />
              {copy.assets.eyebrow}
            </div>
            <p className="m-0 text-sm leading-6 text-[var(--text-dim)]">{copy.assets.body}</p>
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            {copy.assets.items.map((asset, index) => (
              <figure
                className="s-lift m-0 border border-[var(--border)] bg-[var(--bg)] hover:border-[var(--ink)]"
                data-asset-brief={asset.detail}
                data-reveal
                key={asset.label}
                style={{ ['--s-reveal-i' as string]: index + 1 }}
              >
                <div
                  className={`grid aspect-[16/10] place-items-center overflow-hidden border-b border-[var(--border)] ${
                    asset.type === 'icon' ? 'bg-[#0b0b0b]' : 'bg-[#eedcc7]'
                  }`}
                  aria-hidden="true"
                >
                  <img
                    alt=""
                    className={`h-full w-full object-cover ${
                      asset.type === 'icon' ? 'object-center' : 'object-top'
                    }`}
                    decoding="async"
                    src={asset.src}
                  />
                </div>
                <figcaption className="p-4">
                  <h3 className="m-0 text-base font-medium text-[var(--text)]">{asset.label}</h3>
                  <p className="m-0 mt-2 text-sm leading-6 text-[var(--text-dim)]">
                    {asset.detail}
                  </p>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--border)]">
        <div className="mx-auto grid max-w-6xl gap-8 px-5 py-12 sm:px-8 lg:grid-cols-[260px_1fr]">
          <div data-reveal>
            <div className="mb-3 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--ink)]">
              <Sparkles className="size-4" />
              {copy.stampAtlas.eyebrow}
            </div>
            <p className="m-0 text-sm leading-6 text-[var(--text-dim)]">{copy.stampAtlas.body}</p>
          </div>
          <div
            className="grid grid-cols-4 border border-[var(--border)] bg-[var(--bg-elev)] sm:grid-cols-6 lg:grid-cols-8"
            data-reveal
          >
            {APP_SYMBOL_ATLAS.map((symbol, index) => (
              <div
                className="group flex aspect-square items-center justify-center border-b border-r border-[var(--border)] p-3 transition-colors duration-200 hover:bg-[var(--bg)]"
                data-reveal="fade"
                key={symbol}
                style={{ ['--s-reveal-i' as string]: index % 16 }}
              >
                <img
                  alt=""
                  className="h-full w-full object-contain transition-transform duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:scale-[1.06]"
                  decoding="async"
                  src={`/brand/icons/${symbol}`}
                />
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--border)]">
        <div className="mx-auto grid max-w-6xl gap-8 px-5 py-12 sm:px-8 lg:grid-cols-[260px_1fr]">
          <div data-reveal>
            <div className="mb-3 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--ink)]">
              <CircleDollarSign className="size-4" />
              {copy.metering.eyebrow}
            </div>
            <h2 className="m-0 text-3xl font-medium leading-tight tracking-normal text-[var(--text)]">
              {copy.metering.title}
            </h2>
            <p className="m-0 mt-4 text-sm leading-6 text-[var(--text-dim)]">
              {copy.metering.body}
            </p>
          </div>
          <div className="border border-[var(--border)] bg-[var(--bg-elev)]">
            {copy.metering.rows.map((item, index) => (
              <div
                className="grid gap-2 border-b border-[var(--border)] px-5 py-4 last:border-b-0 transition-colors duration-200 hover:bg-[var(--bg)] sm:grid-cols-[140px_120px_1fr] sm:items-baseline"
                data-reveal
                key={item.action}
                style={{ ['--s-reveal-i' as string]: index + 1 }}
              >
                <div className="font-medium text-[var(--text)]">{item.action}</div>
                <div className="font-mono text-[13px] text-[var(--ink)]">{item.price}</div>
                <div className="text-sm leading-6 text-[var(--text-dim)]">{item.detail}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--border)] bg-[var(--bg-elev)]">
        <div className="mx-auto grid max-w-6xl gap-8 px-5 py-12 sm:px-8 lg:grid-cols-[260px_1fr]">
          <div data-reveal>
            <div className="mb-3 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--ink)]">
              <ShieldCheck className="size-4" />
              {copy.principles.eyebrow}
            </div>
            <p className="m-0 text-sm leading-6 text-[var(--text-dim)]">{copy.principles.body}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {copy.principles.items.map((item, index) => {
              const Icon = principleIcons[item.id] ?? Sparkles;
              return (
                <div
                  className="s-lift border border-[var(--ink)] bg-[var(--ink)] px-4 py-4 text-white shadow-[0_14px_36px_rgba(120,49,25,0.12)] hover:shadow-[0_20px_44px_rgba(120,49,25,0.18)]"
                  data-reveal
                  key={item.label}
                  style={{ ['--s-reveal-i' as string]: index + 1 }}
                >
                  <Icon className="mb-4 size-5 text-white" />
                  <h2 className="m-0 text-base font-medium text-white">{item.label}</h2>
                  <p className="m-0 mt-2 text-sm leading-6 text-white/80">{item.detail}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <ScrollReveal />
    </main>
  );
}
