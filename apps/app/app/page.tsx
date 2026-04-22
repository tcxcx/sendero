import {
  ArrowRight,
  Blocks,
  Bot,
  BriefcaseBusiness,
  CircleDollarSign,
  KeyRound,
  Landmark,
  Link2,
  MessageCircle,
  Plane,
  ReceiptText,
  Route,
  ShieldCheck,
  Sparkles,
  WalletCards,
} from 'lucide-react';
import Link from 'next/link';
import { Button } from '@sendero/ui/button';

const agentLoop = [
  {
    step: '01',
    label: 'Receive context',
    detail: 'A traveler, operator, or calling LLM starts on WhatsApp, Slack, web, Teams, or MCP.',
    icon: MessageCircle,
  },
  {
    step: '02',
    label: 'Resolve session',
    detail:
      'Sendero maps the channel thread to a persistent traveler state, preferences, trips, and policy.',
    icon: Bot,
  },
  {
    step: '03',
    label: 'Search and quote',
    detail:
      'Duffel inventory is filtered in real time across flights, hotels, ground, budgets, and rules.',
    icon: Plane,
  },
  {
    step: '04',
    label: 'Hold, pay, confirm',
    detail:
      'The agent holds the itinerary, collects payment, settles on Arc, and issues the booking.',
    icon: WalletCards,
  },
  {
    step: '05',
    label: 'Accompany the trip',
    detail: 'The same agent handles changes, alerts, local help, expense matching, and reporting.',
    icon: Route,
  },
];

const channels = ['WhatsApp', 'Web', 'Slack', 'Teams', 'MCP', 'API'];

const escrowJourney = [
  {
    label: 'Buyer prefunds the trip',
    detail:
      'A company, agency, or calling agent creates a USDC budget and receives a traveler-safe claim link.',
  },
  {
    label: 'Traveler claims once',
    detail:
      'The private claim key stays in the URL fragment. The optional 6-digit code travels out-of-band.',
  },
  {
    label: 'Agent books against budget',
    detail:
      'Sendero reserves, commits, confirms, settles, or refunds from the same prepaid escrow.',
  },
];

const channelJourneys = [
  {
    label: 'WhatsApp traveler',
    detail:
      'The traveler opens the prepaid link, claims the budget, then keeps booking and in-trip help in WhatsApp.',
    href: '/onboarding/consumer',
    cta: 'Pair WhatsApp',
    icon: MessageCircle,
  },
  {
    label: 'Agency WhatsApp',
    detail:
      'An agency installs Sendero on its WhatsApp Business number and sends prepaid links under its brand.',
    href: '/onboarding/agency',
    cta: 'Wire agency',
    icon: Landmark,
  },
  {
    label: 'Corporate Slack',
    detail:
      'Employees request travel in Slack, managers approve in-thread, and trips draw from policy-bound escrow.',
    href: '/onboarding/corporate',
    cta: 'Install Slack',
    icon: BriefcaseBusiness,
  },
  {
    label: 'MCP and API',
    detail:
      'Other agents call prefund_trip, guest_claim_link, reserve_booking, and settle_booking directly.',
    href: '/llms.txt',
    cta: 'Read llms.txt',
    icon: Blocks,
  },
];

const segments = [
  {
    label: 'Consumers',
    detail: 'A personal travel agent in chat that remembers preferences and stays with every trip.',
    icon: MessageCircle,
  },
  {
    label: 'Travel agencies',
    detail: "A white-label sub-agent on the agency's WhatsApp Business and web channels.",
    icon: Landmark,
  },
  {
    label: 'Corporate travel',
    detail:
      'A Slack or Teams agent with policy-as-code, approvals, spending controls, and CFO reporting.',
    icon: BriefcaseBusiness,
  },
  {
    label: 'Other AI agents',
    detail:
      'A metered MCP surface and llms.txt so another LLM can search, hold, book, and change travel.',
    icon: Blocks,
  },
];

const metering = [
  { action: 'Search', price: '$0.02', detail: 'per flight, hotel, or ground inventory search' },
  { action: 'Message', price: '$0.01', detail: 'per stateful traveler-agent exchange' },
  { action: 'Hold', price: '$0.15', detail: 'per itinerary hold or reservation lock' },
  { action: 'Booking', price: '$1.00', detail: 'per confirmed booking, plus 0.5% GMV' },
  { action: 'Context', price: '$0.05', detail: 'per MCP session context retrieval' },
];

const principles = [
  {
    label: 'Agent-first',
    detail: 'Every product surface starts as a capability another LLM can invoke.',
    icon: Bot,
  },
  {
    label: 'Stateful sessions',
    detail: 'WhatsApp threads, Slack DMs, web panels, and MCP calls resolve to one traveler state.',
    icon: Sparkles,
  },
  {
    label: 'Policy-as-code',
    detail: 'Rules are structured, versioned, evaluated at search and booking time, and auditable.',
    icon: ShieldCheck,
  },
  {
    label: 'Nanopayment ledger',
    detail: 'Every atomic action is idempotently metered to a session, timestamp, and operator.',
    icon: ReceiptText,
  },
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
          <Button asChild variant="ghost" className="rounded-none">
            <Link href="/sign-in">Sign in</Link>
          </Button>
          <Button asChild className="rounded-none bg-[var(--ink)] hover:bg-[var(--ink)]/90">
            <Link href="/waitlist">Request access</Link>
          </Button>
        </div>
      </nav>

      <section className="mx-auto grid w-full max-w-6xl gap-12 px-5 pb-14 pt-10 sm:px-8 sm:pt-14 lg:grid-cols-[minmax(0,1.02fr)_minmax(360px,0.98fr)] lg:pb-16">
        <div className="max-w-3xl">
          <div className="mb-6 inline-flex border border-[var(--border)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--text-dim)]">
            Agentic travel platform
          </div>

          <h1 className="m-0 text-[42px] font-medium leading-[0.98] tracking-normal text-[var(--text)] sm:text-[62px] lg:text-[76px]">
            AI travel agents that live where your customers already are.
          </h1>

          <p className="mt-6 max-w-2xl text-base leading-7 text-[var(--text-dim)] sm:text-lg">
            Sendero gives every traveler a persistent, context-aware agent that searches, books,
            changes, pays, and accompanies the entire trip lifecycle. It runs through WhatsApp,
            Slack, web, Teams, and MCP, with Duffel inventory and Arc USDC settlement underneath. No
            seat fees. No SaaS license. Pay only when the agent acts.
          </p>

          <div className="mt-6 flex flex-wrap gap-2">
            {channels.map(channel => (
              <span
                className="border border-[var(--border)] bg-[var(--bg-elev)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-[var(--text-dim)]"
                key={channel}
              >
                {channel}
              </span>
            ))}
          </div>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button
              asChild
              size="lg"
              className="h-12 rounded-none bg-[var(--ink)] px-6 hover:bg-[var(--ink)]/90"
            >
              <Link href="/waitlist">
                Request access <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-12 rounded-none px-6">
              <Link href="/llms.txt">Read llms.txt</Link>
            </Button>
          </div>
        </div>

        <div className="border border-[var(--border)] bg-[var(--bg-elev)]">
          <div className="border-b border-[var(--border)] px-5 py-4">
            <p className="m-0 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--ink)]">
              Live agent loop
            </p>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {agentLoop.map(item => {
              const Icon = item.icon;
              return (
                <div className="grid grid-cols-[40px_1fr] gap-4 px-5 py-5" key={item.label}>
                  <div className="flex size-10 items-center justify-center border border-[var(--border)] text-[var(--ink)]">
                    <Icon className="size-4" />
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
          <div>
            <div className="mb-3 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--ink)]">
              <Link2 className="size-4" />
              Prepaid traveler links
            </div>
            <h2 className="m-0 text-3xl font-medium leading-tight tracking-normal text-[var(--text)] sm:text-4xl">
              Connect operators and travelers with one escrow-backed claim link.
            </h2>
            <p className="m-0 mt-4 max-w-xl text-sm leading-6 text-[var(--text-dim)]">
              A buyer can prefund a trip before the traveler ever talks to Sendero. The traveler
              claims the budget once, then the agent books, changes, settles, and refunds against
              that escrow across WhatsApp, Slack, web, or MCP.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Button
                asChild
                className="h-11 rounded-none bg-[var(--ink)] hover:bg-[var(--ink)]/90"
              >
                <Link href="/waitlist">
                  Request escrow access <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button asChild variant="outline" className="h-11 rounded-none">
                <Link href="/llms.txt">Agent tool manifest</Link>
              </Button>
            </div>
          </div>

          <div className="border border-[var(--border)] bg-[var(--bg-elev)]">
            {escrowJourney.map((item, index) => (
              <div
                className="grid gap-4 border-b border-[var(--border)] px-5 py-5 last:border-b-0 sm:grid-cols-[44px_1fr]"
                key={item.label}
              >
                <div className="flex size-11 items-center justify-center border border-[var(--border)] font-mono text-[12px] text-[var(--ink)]">
                  {String(index + 1).padStart(2, '0')}
                </div>
                <div>
                  <h3 className="m-0 text-base font-medium text-[var(--text)]">{item.label}</h3>
                  <p className="m-0 mt-2 text-sm leading-6 text-[var(--text-dim)]">{item.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--border)] bg-[var(--bg-elev)]">
        <div className="mx-auto grid max-w-6xl gap-8 px-5 py-12 sm:px-8 lg:grid-cols-[260px_1fr]">
          <div>
            <div className="mb-3 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--ink)]">
              <Bot className="size-4" />
              Four channels, one engine
            </div>
            <p className="m-0 text-sm leading-6 text-[var(--text-dim)]">
              The dashboard is a channel, not the product. The product is the agent engine that
              resolves sessions, applies policy, books real travel, and meters every action.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {segments.map(item => {
              const Icon = item.icon;
              return (
                <div className="border border-[var(--border)] px-4 py-4" key={item.label}>
                  <Icon className="mb-4 size-5 text-[var(--ink)]" />
                  <h2 className="m-0 text-base font-medium text-[var(--text)]">{item.label}</h2>
                  <p className="m-0 mt-2 text-sm leading-6 text-[var(--text-dim)]">{item.detail}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--border)]">
        <div className="mx-auto grid max-w-6xl gap-8 px-5 py-12 sm:px-8 lg:grid-cols-[260px_1fr]">
          <div>
            <div className="mb-3 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--ink)]">
              <KeyRound className="size-4" />
              User journeys
            </div>
            <p className="m-0 text-sm leading-6 text-[var(--text-dim)]">
              Each channel is an adapter into the same session, policy, escrow, and metering engine.
              No duplicated travel logic.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {channelJourneys.map(item => {
              const Icon = item.icon;
              return (
                <article
                  className="border border-[var(--border)] bg-[var(--bg-elev)] p-5"
                  key={item.label}
                >
                  <div className="mb-5 flex items-center justify-between gap-4">
                    <Icon className="size-5 text-[var(--ink)]" />
                    <Link
                      href={item.href}
                      className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--text-dim)] no-underline hover:text-[var(--ink)]"
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
          <div>
            <div className="mb-3 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--ink)]">
              <CircleDollarSign className="size-4" />
              Nanopayments
            </div>
            <h2 className="m-0 text-3xl font-medium leading-tight tracking-normal text-[var(--text)]">
              Metered by action, not by seat.
            </h2>
            <p className="m-0 mt-4 text-sm leading-6 text-[var(--text-dim)]">
              Retries are idempotent. Every charge maps to a session, action, timestamp, and
              operator so agencies, companies, consumers, and calling LLMs can audit usage.
            </p>
          </div>
          <div className="border border-[var(--border)] bg-[var(--bg-elev)]">
            {metering.map(item => (
              <div
                className="grid gap-2 border-b border-[var(--border)] px-5 py-4 last:border-b-0 sm:grid-cols-[140px_120px_1fr] sm:items-baseline"
                key={item.action}
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
          <div>
            <div className="mb-3 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--ink)]">
              <ShieldCheck className="size-4" />
              Built to scale
            </div>
            <p className="m-0 text-sm leading-6 text-[var(--text-dim)]">
              Sendero keeps travel logic out of the channel adapters, so new surfaces can be added
              without rewriting the booking engine.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {principles.map(item => {
              const Icon = item.icon;
              return (
                <div className="border border-[var(--border)] px-4 py-4" key={item.label}>
                  <Icon className="mb-4 size-5 text-[var(--ink)]" />
                  <h2 className="m-0 text-base font-medium text-[var(--text)]">{item.label}</h2>
                  <p className="m-0 mt-2 text-sm leading-6 text-[var(--text-dim)]">{item.detail}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </main>
  );
}
