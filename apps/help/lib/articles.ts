/**
 * Help center content source.
 *
 * Phase 4 ships static fallback articles per category. The shape
 * mirrors basehub's HelpArticle collection so swapping this fetcher
 * for `cms.query(helpArticles, { locale })` in a follow-up is a
 * no-op for consumers.
 */

export interface HelpArticle {
  slug: string;
  title: string;
  excerpt: string;
  body: string;
  category: HelpCategoryId;
  updatedAt: string;
  locale: string;
}

export type HelpCategoryId =
  | 'getting-started'
  | 'for-consumers'
  | 'for-agencies'
  | 'for-corporate'
  | 'for-ai-agents'
  | 'billing-and-settlement';

export interface HelpCategory {
  id: HelpCategoryId;
  title: string;
  description: string;
}

export const HELP_CATEGORIES: HelpCategory[] = [
  {
    id: 'getting-started',
    title: 'Getting started',
    description: 'What Sendero is, and how to get your first agent running.',
  },
  {
    id: 'for-consumers',
    title: 'For travelers',
    description: 'Book your next trip via WhatsApp. Split payments. Group trips.',
  },
  {
    id: 'for-agencies',
    title: 'For agencies',
    description: 'Deploy a white-label AI agent on your own WhatsApp Business number.',
  },
  {
    id: 'for-corporate',
    title: 'For corporate teams',
    description: 'Slack + Teams approvals, policy-first booking, CFO spend dashboard.',
  },
  {
    id: 'for-ai-agents',
    title: 'For AI agents (MCP)',
    description: 'Call Sendero tools from your LLM via MCP + llms.txt.',
  },
  {
    id: 'billing-and-settlement',
    title: 'Billing & settlement',
    description: 'Nanopayments, caps, USDC settlement, invoice exports.',
  },
];

const FALLBACK_ARTICLES: HelpArticle[] = [
  {
    slug: 'what-is-sendero',
    title: 'What is Sendero?',
    excerpt: 'An AI travel agent that lives where your travelers already are.',
    body: `Sendero is an agentic travel platform. Every traveler — whether a tourist
chatting on WhatsApp, an employee pinging Slack, or another AI making a booking
via API — gets a persistent, context-aware travel agent that searches, books,
changes, and accompanies them throughout the entire trip lifecycle.

No seat fees. No SaaS license. You pay only when the agent acts.`,
    category: 'getting-started',
    updatedAt: '2026-04-20',
    locale: 'en-US',
  },
  {
    slug: 'how-booking-works',
    title: 'How a booking works',
    excerpt: 'From intent to PNR to on-chain settlement in under six seconds.',
    body: `Sendero searches real-time Duffel inventory, holds an offer, runs policy
checks (if you're a corporate customer), confirms the booking, and settles
the commission fan-out on Arc in a single on-chain transaction.`,
    category: 'getting-started',
    updatedAt: '2026-04-20',
    locale: 'en-US',
  },
  {
    slug: 'whatsapp-link-token',
    title: 'Linking your phone to Sendero',
    excerpt: 'A one-time code pairs your web account with WhatsApp.',
    body: `Open Sendero on the web, request a link token, then message it to the
Sendero WhatsApp number. The agent matches the code to your account and every
future message arrives with your preferences pre-loaded.`,
    category: 'for-consumers',
    updatedAt: '2026-04-20',
    locale: 'en-US',
  },
  {
    slug: 'corporate-slack-approvals',
    title: 'Slack approvals for corporate travel',
    excerpt: 'Managers approve bookings in-thread. No dashboards, no email.',
    body: `When an employee's booking exceeds your policy threshold, the approver
receives a DM with the trip summary plus Approve / Reject buttons. The
traveler sees the resolved decision in WhatsApp within seconds.`,
    category: 'for-corporate',
    updatedAt: '2026-04-20',
    locale: 'en-US',
  },
  {
    slug: 'mcp-tool-catalog',
    title: 'Sendero MCP tool catalog',
    excerpt: 'Call search_flights, hold_booking, confirm_booking from any LLM.',
    body: `Sendero exposes 14 tools over MCP plus a capability manifest at
/.well-known/llms.txt. Authenticate with a prepaid USDC balance; every
tool call is metered per the public pricing table.`,
    category: 'for-ai-agents',
    updatedAt: '2026-04-20',
    locale: 'en-US',
  },
  {
    slug: 'nanopayment-pricing',
    title: 'Nanopayment pricing, explained',
    excerpt: 'You pay only when the agent acts. Batched USDC settlement on Arc.',
    body: `Every atomic action the agent performs is individually metered. Meter
events accumulate per tenant; at the end of each window (hourly by default)
Sendero builds a NanopayBatch and fires a single USDC transfer on Arc.`,
    category: 'billing-and-settlement',
    updatedAt: '2026-04-20',
    locale: 'en-US',
  },
];

export async function getHelpArticles(
  opts: { locale?: string; category?: HelpCategoryId } = {}
): Promise<HelpArticle[]> {
  // Phase 5 swap: `await cms.query(listHelpArticles, { variables: { locale, category } })`.
  const locale = opts.locale ?? 'en-US';
  let items = FALLBACK_ARTICLES.filter(a => a.locale === locale);
  if (items.length === 0) items = FALLBACK_ARTICLES.filter(a => a.locale === 'en-US');
  if (opts.category) items = items.filter(a => a.category === opts.category);
  return items;
}

export async function getHelpArticleBySlug(
  slug: string,
  locale: string
): Promise<HelpArticle | null> {
  const items = await getHelpArticles({ locale });
  return items.find(a => a.slug === slug) ?? null;
}
