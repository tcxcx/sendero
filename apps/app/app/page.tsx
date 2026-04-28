import Link from 'next/link';

import { Button } from '@sendero/ui/button';
import { ArrowRight } from 'lucide-react';

import { AppHeroScene } from '@/components/app-hero-scene';
import { LanguageSelector } from '@/components/language-selector';
import { getAppCopy } from '@/lib/app-copy';
import { getRequestLocale } from '@/lib/request-locale';

export default async function Page() {
  const locale = await getRequestLocale();
  const copy = getAppCopy(locale).home;

  return (
    <main className="relative min-h-screen overflow-hidden bg-[var(--bg)] text-[var(--text)]">
      {/* Cloud background */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0"
        style={{ width: '100%', height: '100%' }}
      >
        <AppHeroScene />
      </div>

      {/* Gradient fade so text stays legible */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background:
            'linear-gradient(to bottom, rgba(250,249,247,0.18) 0%, rgba(250,249,247,0.72) 55%, var(--bg) 88%)',
        }}
      />

      <nav className="relative z-10 mx-auto flex w-full max-w-6xl flex-wrap items-start justify-between gap-4 px-5 py-5 sm:px-8">
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

      <section className="relative z-10 mx-auto flex w-full max-w-6xl flex-col items-start justify-end px-5 pb-16 pt-10 sm:px-8 sm:pt-14" style={{ minHeight: 'calc(100vh - 68px)' }}>
        <div className="max-w-3xl">
          <div className="s-enter s-enter-1 mb-6 inline-flex items-center gap-2 border border-[var(--border)] bg-[var(--bg)]/70 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--text-dim)] backdrop-blur-sm">
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

          <div className="s-enter s-enter-4 mt-8 flex flex-col gap-3 sm:flex-row">
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
      </section>
    </main>
  );
}
