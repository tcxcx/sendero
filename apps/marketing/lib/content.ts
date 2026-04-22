/**
 * Content source for the marketing site.
 *
 * Phase 3 ships a static fallback with all 4 locales so the site
 * renders without any CMS credentials. Phase 4 will swap the
 * implementation for a basehub fetch while keeping the same contract
 * — consumer code doesn't change.
 */

import type { TravelGlossary } from '@sendero/locale';
import { getGlossary } from '@sendero/locale';

export interface MarketingContent {
  locale: string;
  hero: {
    eyebrow: string;
    title: string;
    subtitle: string;
    primaryCta: string;
    primaryCtaHref: string;
    secondaryCta: string;
    secondaryCtaHref: string;
  };
  features: Array<{
    id: string;
    title: string;
    body: string;
  }>;
  assetPlaceholders: Array<{
    id: string;
    type: 'image' | 'icon-set' | 'lottie';
    title: string;
    brief: string;
  }>;
  pricing: {
    heading: string;
    subheading: string;
    tiers: Array<{
      id: string;
      name: string;
      price: string;
      unit: string;
      description: string;
      features: string[];
      cta: string;
      ctaHref: string;
    }>;
  };
  footer: {
    copyright: string;
    links: Array<{ label: string; href: string }>;
  };
}

const EN_US: MarketingContent = {
  locale: 'en-US',
  hero: {
    eyebrow: 'Sendero × Circle Arc',
    title: 'Travel AI that knows the way.',
    subtitle:
      'A traveler messages. An agency sends a link. A company prefunds a trip. Sendero turns each path into real inventory, real bookings, USDC settlement, and one persistent agent.',
    primaryCta: 'Start a trip',
    primaryCtaHref: 'https://sendero-arc-web.vercel.app',
    secondaryCta: 'For AI agents · llms.txt',
    secondaryCtaHref: '/llms.txt',
  },
  features: [
    {
      id: 'consumer',
      title: 'Consumer · WhatsApp',
      body: 'A personal travel agent that remembers preferences, dates, budget, receipts, and changes. No app install. Just the thread the traveler already has open.',
    },
    {
      id: 'agency',
      title: 'Travel agencies · white-label',
      body: 'A branded agent on your WhatsApp Business number. Quote fast, keep your margin, send prepaid links, and let Sendero handle repetitive travel operations.',
    },
    {
      id: 'corporate',
      title: 'Corporate · Slack · Teams',
      body: 'Policy-first booking, manager approvals, prepaid budgets, auditable spend, and settlement records without forcing employees into another portal.',
    },
    {
      id: 'agents',
      title: 'AI agents · MCP',
      body: 'MCP tools and named workflows for LLMs that need to search, prefund, hold, book, settle, refund, or reconcile travel safely.',
    },
  ],
  assetPlaceholders: [
    {
      id: 'agent-route-map',
      type: 'image',
      title: 'One route map',
      brief:
        'One session can begin in WhatsApp, Slack, web, or MCP, then pass through inventory, policy, escrow, invoice, and support.',
    },
    {
      id: 'escrow-lifecycle',
      type: 'lottie',
      title: 'Escrow lifecycle',
      brief:
        'Buyer prefunds, traveler claims, Sendero reserves, ticket confirms, escrow settles, invoice appears.',
    },
    {
      id: 'channel-symbols',
      type: 'icon-set',
      title: 'Channel and trust symbols',
      brief:
        'A custom stamp kit for messages, routes, approvals, tickets, travelers, policy, payments, and agent calls.',
    },
  ],
  pricing: {
    heading: 'Nanopayments, not seats.',
    subheading:
      'Every action the agent performs is individually priced. Sendero makes money only when the agent creates value.',
    tiers: [
      {
        id: 'search',
        name: 'Search',
        price: '$0.02',
        unit: 'per flight or hotel search',
        description: 'Real-time Duffel inventory. Policy-filtered for corporate.',
        features: [
          'Real-time flight inventory',
          'Real-time hotel inventory',
          'No subscription fees',
        ],
        cta: 'Start searching',
        ctaHref: 'https://sendero-arc-web.vercel.app',
      },
      {
        id: 'book',
        name: 'Book',
        price: '$1.00',
        unit: 'per confirmed booking · +0.5% GMV',
        description: 'End-to-end hold + confirm + settlement. USDC or card.',
        features: ['Duffel PNR issuance', 'On-chain settlement', 'Automatic expense matching'],
        cta: 'Talk to sales',
        ctaHref: 'mailto:sales@sendero.travel',
      },
      {
        id: 'agents',
        name: 'AI agents',
        price: '$0.05',
        unit: 'per MCP context call',
        description: 'Full travel toolkit exposed as MCP. Your LLM talks to Sendero.',
        features: ['MCP server + llms.txt', 'Stateful traveler sessions', 'Prepaid USDC billing'],
        cta: 'Read /llms.txt',
        ctaHref: '/llms.txt',
      },
    ],
  },
  footer: {
    copyright: `© ${new Date().getFullYear()} Sendero. All rights reserved.`,
    links: [
      { label: 'Docs', href: 'https://docs.sendero.travel' },
      { label: 'Help', href: 'https://help.sendero.travel' },
      { label: 'Arc explorer', href: 'https://testnet.arcscan.app' },
      { label: 'Twitter', href: 'https://x.com/sendero_travel' },
    ],
  },
};

const ES_MX: MarketingContent = {
  ...EN_US,
  locale: 'es-MX',
  hero: {
    ...EN_US.hero,
    eyebrow: 'Sendero × Circle Arc',
    title: 'IA de viajes que conoce el camino.',
    subtitle:
      'Un viajero escribe. Una agencia envía un link. Una empresa prefunde el viaje. Sendero convierte cada camino en inventario real, reservas reales y liquidación en USDC.',
    primaryCta: 'Iniciar viaje',
    secondaryCta: 'Para agentes IA · llms.txt',
  },
  features: EN_US.features.map(f => ({
    ...f,
    title:
      f.id === 'consumer'
        ? 'Consumidor · WhatsApp'
        : f.id === 'agency'
          ? 'Agencias · marca blanca'
          : f.id === 'corporate'
            ? 'Corporativo · Slack · Teams'
            : 'Agentes IA · MCP',
  })),
  pricing: { ...EN_US.pricing, heading: 'Nanopagos, no asientos.' },
};

const PT_BR: MarketingContent = {
  ...EN_US,
  locale: 'pt-BR',
  hero: {
    ...EN_US.hero,
    title: 'IA de viagem que conhece o caminho.',
    subtitle:
      'Um viajante escreve. Uma agência envia um link. Uma empresa pré-financia a viagem. Sendero transforma cada caminho em inventário real, reservas reais e liquidação em USDC.',
    primaryCta: 'Iniciar viagem',
    secondaryCta: 'Para agentes de IA · llms.txt',
  },
  pricing: { ...EN_US.pricing, heading: 'Nanopagamentos, não assentos.' },
};

const ES_AR: MarketingContent = {
  ...EN_US,
  locale: 'es-AR',
  hero: {
    ...EN_US.hero,
    title: 'IA de viajes que conoce el camino.',
    subtitle:
      'Un viajero escribe. Una agencia manda un link. Una empresa prefunde el viaje. Sendero convierte cada camino en inventario real, reservas reales y liquidación en USDC.',
    primaryCta: 'Empezar un viaje',
  },
};

const FALLBACK_CONTENT: Record<string, MarketingContent> = {
  'en-US': EN_US,
  'es-MX': ES_MX,
  'pt-BR': PT_BR,
  'es-AR': ES_AR,
};

/**
 * Resolve marketing content for a locale. Current implementation reads
 * from the static fallback above; Phase 4 swaps this for a basehub
 * `cms.query(marketingContentQuery, { variables: { locale } })` call.
 */
export async function getMarketingContent(locale: string): Promise<MarketingContent> {
  const glossary: TravelGlossary = getGlossary(locale);
  return FALLBACK_CONTENT[glossary.locale] ?? FALLBACK_CONTENT['en-US'];
}
