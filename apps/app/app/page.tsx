import { Show } from '@clerk/nextjs';
import { ArrowRight, Bot, CreditCard, FileText, Plane, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@sendero/ui/button';

const operations = [
  {
    label: 'Search',
    value: 'Duffel inventory',
    detail: 'Policy-aware flight and hotel search for every traveler request.',
    icon: Plane,
  },
  {
    label: 'Book',
    value: 'Real PNRs',
    detail: 'Hold, confirm, and track bookings from one protected workspace.',
    icon: Bot,
  },
  {
    label: 'Fund',
    value: 'USDC prefund',
    detail: 'Create invite links and scoped spending caps for each trip.',
    icon: CreditCard,
  },
  {
    label: 'Bill',
    value: 'Tenant invoices',
    detail: 'Download branded PDFs and reconcile platform fees by tenant.',
    icon: FileText,
  },
];

const trustItems = [
  'Clerk-managed sign-in, organizations, roles, MFA, and SSO.',
  'Protected buyer routes for trips, billing, spend, caps, and settings.',
  'Arc Testnet settlement with tenant wallets and retryable operations.',
];

export default function Page() {
  return (
    <main className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <nav className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
        <Link href="/" className="flex items-center gap-3 no-underline">
          <span className="size-3 bg-[var(--ink)]" aria-hidden="true" />
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--text)]">
            Sendero
          </span>
        </Link>

        <div className="flex items-center gap-2">
          <Link
            href="/llms.txt"
            className="hidden font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--text-dim)] no-underline hover:text-[var(--ink)] sm:inline-flex"
          >
            llms.txt
          </Link>
          <Show when="signed-out">
            <Button asChild variant="ghost" className="rounded-none">
              <Link href="/sign-in">Sign in</Link>
            </Button>
            <Button asChild className="rounded-none bg-[var(--ink)] hover:bg-[var(--ink)]/90">
              <Link href="/waitlist">Request access</Link>
            </Button>
          </Show>
          <Show when="signed-in">
            <Button asChild className="rounded-none bg-[var(--ink)] hover:bg-[var(--ink)]/90">
              <Link href="/app">Open app</Link>
            </Button>
          </Show>
        </div>
      </nav>

      <section className="mx-auto grid min-h-[calc(100vh-82px)] w-full max-w-6xl content-center gap-12 px-5 pb-16 pt-8 sm:px-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
        <div className="max-w-3xl">
          <div className="mb-6 inline-flex border border-[var(--border)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--text-dim)]">
            Arc Testnet workspace
          </div>

          <h1 className="m-0 text-[44px] font-medium leading-[0.96] tracking-normal text-[var(--text)] sm:text-[64px] lg:text-[80px]">
            Corporate travel that books, bills, and settles itself.
          </h1>

          <p className="mt-6 max-w-2xl text-base leading-7 text-[var(--text-dim)] sm:text-lg">
            Sendero gives agencies and corporate travel teams a protected operations console. Every
            trip has an AI workflow, real Duffel booking data, tenant billing, and USDC settlement
            on Arc. Testnet access is waitlist-gated while mainnet readiness finishes.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Show when="signed-out">
              <Button
                asChild
                size="lg"
                className="h-12 rounded-none bg-[var(--ink)] px-6 hover:bg-[var(--ink)]/90"
              >
                <Link href="/waitlist">
                  Request testnet access <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-12 rounded-none px-6">
                <Link href="/sign-in">Sign in</Link>
              </Button>
            </Show>
            <Show when="signed-in">
              <Button
                asChild
                size="lg"
                className="h-12 rounded-none bg-[var(--ink)] px-6 hover:bg-[var(--ink)]/90"
              >
                <Link href="/app">
                  Open your workspace <ArrowRight className="size-4" />
                </Link>
              </Button>
            </Show>
          </div>
        </div>

        <div className="border border-[var(--border)] bg-[var(--bg-elev)]">
          <div className="border-b border-[var(--border)] px-5 py-4">
            <p className="m-0 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--ink)]">
              Platform loop
            </p>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {operations.map(item => {
              const Icon = item.icon;
              return (
                <div className="grid grid-cols-[36px_1fr] gap-4 px-5 py-5" key={item.label}>
                  <div className="flex size-9 items-center justify-center border border-[var(--border)] text-[var(--ink)]">
                    <Icon className="size-4" />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-baseline justify-between gap-3">
                      <h2 className="m-0 text-base font-medium text-[var(--text)]">{item.label}</h2>
                      <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--text-faint)]">
                        {item.value}
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

      <section className="border-t border-[var(--border)] bg-[var(--bg-elev)]">
        <div className="mx-auto grid max-w-6xl gap-8 px-5 py-10 sm:px-8 lg:grid-cols-[280px_1fr]">
          <div>
            <div className="mb-3 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--ink)]">
              <ShieldCheck className="size-4" />
              Clerk managed
            </div>
            <p className="m-0 text-sm leading-6 text-[var(--text-dim)]">
              Authentication belongs to Clerk. Wallet and passkey setup belongs inside protected
              onboarding, after a user and organization exist.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {trustItems.map(item => (
              <div
                className="border border-[var(--border)] px-4 py-4 text-sm leading-6 text-[var(--text-dim)]"
                key={item}
              >
                {item}
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
