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
    title: 'AI travel agents that live where your customers already are.',
    subtitle:
      'One agent per trip, reachable over WhatsApp, Slack, email, and MCP. Real PNRs via Duffel. Settled in USDC on Arc.',
    primaryCta: 'Start a trip',
    primaryCtaHref: 'https://sendero-arc-web.vercel.app',
    secondaryCta: 'For AI agents · llms.txt',
    secondaryCtaHref: '/llms.txt',
  },
  features: [
    {
      id: 'consumer',
      title: 'Consumer · WhatsApp',
      body: 'A persistent travel companion that knows your preferences, dates, and budget. No app install — just a conversation that picks up where it left off.',
    },
    {
      id: 'agency',
      title: 'Travel agencies · white-label',
      body: 'A branded AI agent on your own WhatsApp Business number. Quote in <60s, 24/7. Keeps your margin + optional markup. Deploys in under 24 hours.',
    },
    {
      id: 'corporate',
      title: 'Corporate · Slack · Teams',
      body: 'Policy-first booking, manager approvals via Slack buttons, CFO spend dashboard. 91% cheaper than a traditional TMC in Year 1.',
    },
    {
      id: 'agents',
      title: 'AI agents · MCP',
      body: 'Every travel operation exposed as an MCP tool. Your LLM calls search_flights, hold_booking, confirm_booking. We handle Duffel, compliance, and settlement.',
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
      { label: 'Help', href: '/help' },
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
    title: 'Agentes de viaje con IA, donde tus clientes ya están.',
    subtitle:
      'Un agente por viaje, accesible por WhatsApp, Slack, email y MCP. PNRs reales vía Duffel. Liquidación en USDC sobre Arc.',
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
    title: 'Agentes de viagem com IA onde seus clientes já estão.',
    subtitle:
      'Um agente por viagem, acessível via WhatsApp, Slack, e-mail e MCP. PNRs reais via Duffel. Liquidação em USDC na Arc.',
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
    title: 'Agentes de viaje con IA, donde tus clientes ya están.',
    subtitle:
      'Un agente por viaje. Accesible por WhatsApp, Slack, mail y MCP. PNR reales vía Duffel. Se liquida en USDC sobre Arc.',
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
