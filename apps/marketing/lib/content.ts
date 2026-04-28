/**
 * Locale-aware content source for the marketing site.
 *
 * The page renders from this contract only. Production can override any field
 * from the CMS; the checked-in fallback keeps every locale shippable when CMS
 * credentials are absent or a CMS payload is incomplete.
 */

import type { TravelGlossary } from '@sendero/locale';
import { getGlossary } from '@sendero/locale';

export interface MarketingCta {
  label: string;
  href: string;
}

export interface MarketingHero {
  eyebrow: string;
  title: string;
  subtitle: string;
  primaryCta: MarketingCta;
  secondaryCta: MarketingCta;
}

export interface MarketingFeature {
  id: string;
  title: string;
  body: string;
  iconSrc: string;
}

export interface MarketingVisualAsset {
  id: string;
  type: 'image' | 'icon-set' | 'lottie';
  title: string;
  brief: string;
  src: string;
  alt: string;
}

export interface MarketingMural {
  label: string;
  title: string;
  body: string;
  image: string;
  alt: string;
}

export interface MarketingStoryPath {
  eyebrow: string;
  title: string;
  body: string;
  panel: string;
  icons: string[];
}

export interface MarketingPostcard {
  label: string;
  title: string;
  body: string;
  image: string;
  alt: string;
}

export interface MarketingNav {
  website: string;
  app: string;
  pricing: string;
  agents: string;
}

export interface MarketingAudienceTile {
  id: string;
  label: string;
  headline: string;
  body: string;
  cta: MarketingCta;
}

export interface MarketingFooterGroup {
  label: string;
  links: Array<{ label: string; href: string }>;
}

export interface MarketingContent {
  locale: string;
  nav: MarketingNav;
  hero: MarketingHero;
  proof: {
    items: string[];
  };
  audiences: {
    eyebrow: string;
    title: string;
    items: MarketingAudienceTile[];
  };
  waitlist: {
    eyebrow: string;
    title: string;
    body: string;
  };
  routeMurals: {
    eyebrow: string;
    title: string;
    body: string;
    items: MarketingMural[];
  };
  story: {
    eyebrow: string;
    title: string;
    body: string;
    paths: MarketingStoryPath[];
  };
  features: MarketingFeature[];
  assetShowcase: {
    eyebrow: string;
    title: string;
    body: string;
    assets: MarketingVisualAsset[];
  };
  passport: {
    eyebrow: string;
    title: string;
    body: string;
    postcards: MarketingPostcard[];
  };
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
      cta: MarketingCta;
    }>;
  };
  symbols: {
    eyebrow: string;
    title: string;
    body: string;
  };
  footer: {
    copyright: string;
    links: Array<{ label: string; href: string }>;
    groups?: MarketingFooterGroup[];
  };
}

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Array<infer U>
    ? Array<DeepPartial<U>>
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K];
};

const CURRENT_YEAR = new Date().getFullYear();

const FOOTER_LINKS = [
  { label: 'Docs', href: 'https://docs.sendero.travel' },
  { label: 'Help', href: 'https://help.sendero.travel' },
  { label: 'Arc explorer', href: 'https://testnet.arcscan.app' },
  { label: 'Twitter', href: 'https://x.com/sendero_travel' },
];

const FOOTER_GROUPS_EN: MarketingFooterGroup[] = [
  {
    label: 'Product',
    links: [
      { label: 'For travelers', href: '/dashboard' },
      { label: 'For agencies', href: '/dashboard' },
      { label: 'For companies', href: 'mailto:sales@sendero.travel' },
      { label: 'For AI agents', href: '/agents' },
      { label: 'Pricing', href: '/pricing' },
    ],
  },
  {
    label: 'Developers',
    links: [
      { label: 'Docs', href: 'https://docs.sendero.travel' },
      { label: 'MCP server', href: 'https://docs.sendero.travel' },
      { label: 'llms.txt', href: '/llms.txt' },
      { label: 'Arc explorer', href: 'https://testnet.arcscan.app' },
    ],
  },
  {
    label: 'Company',
    links: [
      { label: 'Updates', href: '/updates' },
      { label: 'Help', href: 'https://help.sendero.travel' },
      { label: 'Sales', href: 'mailto:sales@sendero.travel' },
      { label: 'Twitter', href: 'https://x.com/sendero_travel' },
    ],
  },
  {
    label: 'Legal',
    links: [
      { label: 'Privacy', href: '/policy' },
      { label: 'Terms', href: '/terms' },
    ],
  },
];

const FOOTER_GROUPS_ES: MarketingFooterGroup[] = [
  {
    label: 'Producto',
    links: [
      { label: 'Para viajeros', href: '/dashboard' },
      { label: 'Para agencias', href: '/dashboard' },
      { label: 'Para empresas', href: 'mailto:sales@sendero.travel' },
      { label: 'Para agentes IA', href: '/llms.txt' },
      { label: 'Precios', href: '#pricing' },
    ],
  },
  {
    label: 'Desarrolladores',
    links: [
      { label: 'Docs', href: 'https://docs.sendero.travel' },
      { label: 'Servidor MCP', href: 'https://docs.sendero.travel' },
      { label: 'llms.txt', href: '/llms.txt' },
      { label: 'Arc explorer', href: 'https://testnet.arcscan.app' },
    ],
  },
  {
    label: 'Compañía',
    links: [
      { label: 'Soporte', href: 'https://help.sendero.travel' },
      { label: 'Ventas', href: 'mailto:sales@sendero.travel' },
      { label: 'Twitter', href: 'https://x.com/sendero_travel' },
    ],
  },
];

const FOOTER_GROUPS_PT: MarketingFooterGroup[] = [
  {
    label: 'Produto',
    links: [
      { label: 'Para viajantes', href: '/dashboard' },
      { label: 'Para agências', href: '/dashboard' },
      { label: 'Para empresas', href: 'mailto:sales@sendero.travel' },
      { label: 'Para agentes IA', href: '/llms.txt' },
      { label: 'Preços', href: '#pricing' },
    ],
  },
  {
    label: 'Desenvolvedores',
    links: [
      { label: 'Docs', href: 'https://docs.sendero.travel' },
      { label: 'Servidor MCP', href: 'https://docs.sendero.travel' },
      { label: 'llms.txt', href: '/llms.txt' },
      { label: 'Arc explorer', href: 'https://testnet.arcscan.app' },
    ],
  },
  {
    label: 'Empresa',
    links: [
      { label: 'Suporte', href: 'https://help.sendero.travel' },
      { label: 'Vendas', href: 'mailto:sales@sendero.travel' },
      { label: 'Twitter', href: 'https://x.com/sendero_travel' },
    ],
  },
];

const EN_US: MarketingContent = {
  locale: 'en-US',
  nav: {
    website: 'Product',
    app: 'App',
    pricing: 'Pricing',
    agents: 'For AI agents',
  },
  hero: {
    eyebrow: 'Live on Circle Arc',
    title: 'Travel infrastructure for the agent era.',
    subtitle:
      'Bookings, prepaid escrow, USDC settlement, and trip support — in one persistent thread.',
    primaryCta: { label: 'Start free', href: '/dashboard' },
    secondaryCta: { label: 'For AI agents', href: '/llms.txt' },
  },
  proof: {
    items: [
      'Live on Circle Arc',
      'USDC + EURC settlement',
      'MCP + x402 native',
      'WhatsApp + Slack + web',
      'EN · ES · PT',
    ],
  },
  audiences: {
    eyebrow: 'Four ways in',
    title: 'One engine. Every entry point.',
    items: [
      {
        id: 'travelers',
        label: 'Travelers',
        headline: 'Book from the thread in your hand.',
        body: 'WhatsApp, web, real options, prepaid budgets, receipts.',
        cta: { label: 'Start free', href: '/dashboard' },
      },
      {
        id: 'agencies',
        label: 'Agencies',
        headline: 'A staffed counter behind every link.',
        body: 'White-label quote, hold, ticket, settle, support.',
        cta: { label: 'Start free', href: '/dashboard' },
      },
      {
        id: 'companies',
        label: 'Companies',
        headline: 'Prepay the trip. Keep policy clean.',
        body: 'Slack approvals, tenant caps, USDC reconciliation.',
        cta: { label: 'Talk to sales', href: 'mailto:sales@sendero.travel' },
      },
      {
        id: 'agents',
        label: 'AI agents',
        headline: 'Call the travel back office.',
        body: 'MCP-discoverable. x402-priced. llms.txt-published.',
        cta: { label: 'Read llms.txt', href: '/llms.txt' },
      },
    ],
  },
  waitlist: {
    eyebrow: 'Mainnet wave',
    title: 'Get in line for production.',
    body: 'Agencies, companies, and AI builders go live in waves. Reserve your spot for prepaid budgets, MCP tools, and white-label ops.',
  },
  routeMurals: {
    eyebrow: 'Route intelligence',
    title: 'One request. One auditable route.',
    body: 'Intent, policy, approvals, inventory, escrow, support, and reconciliation stay attached to the same trip record.',
    items: [
      {
        label: 'Handoff map',
        title: 'Asks once. The system coordinates the rest.',
        body: 'Move between WhatsApp, web, Slack approvals, and MCP callers without losing trip state.',
        image: '/brand/generated/agent-handoff-map.jpg',
        alt: 'Sendero illustrated handoff map with traveler, operator checks, approvals, and a destination route.',
      },
      {
        label: 'Trust sequence',
        title: 'Locked, checked, approved, ticketed, settled.',
        body: 'Every irreversible action carries proof: claim links, policy, holds, confirmation, settlement.',
        image: '/brand/generated/trust-stamp-flow.jpg',
        alt: 'Sendero illustrated trust sequence of route documents, approval stamps, and settlement handoff.',
      },
      {
        label: 'Operations network',
        title: 'A graph for travel work, not just messages.',
        body: 'Bookings, approvals, receipts, invoices, caps, support events, and tool calls — inspectable.',
        image: '/brand/generated/operations-network-map.jpg',
        alt: 'Sendero illustrated operations network with travel, finance, policy, and support nodes.',
      },
      {
        label: 'Open route',
        title: 'The journey stays alive after the ticket.',
        body: 'Reminders, changes, receipts, support, refunds, and reconciliation — until the trip is closed.',
        image: '/brand/generated/traveler-world-panorama.jpg',
        alt: 'Sendero illustrated world map panorama with traveler, route marks, envelopes, and destinations.',
      },
      {
        label: 'Trip passport',
        title: 'An AI guide there. A stamped souvenir at the end.',
        body: 'Sendero rides along through the trip — then mints a personalized on-chain souvenir on Arc. Traceable, collectible, yours.',
        image: '/brand/generated/symbol-collage.png',
        alt: 'Sendero illustrated stamp collage representing the on-chain trip passport souvenir.',
      },
    ],
  },
  story: {
    eyebrow: 'Where travel starts',
    title: 'Same engine. Every entry point.',
    body: 'Travel begins in messy places — a chat, an agency desk, a finance approval, an LLM. Sendero gives each one the same booking, escrow, settlement, and support engine.',
    paths: [
      {
        eyebrow: 'Individual traveler',
        title: 'Book from the thread already open.',
        body: 'Start in WhatsApp or web, compare real options, claim a prepaid budget, keep the same agent for changes and support.',
        panel: '/brand/panels/panel-02.png',
        icons: [
          '/brand/icons/04-courier-profile.png',
          '/brand/icons/07-magnifier.png',
          '/brand/icons/12-traveler-bag.png',
        ],
      },
      {
        eyebrow: 'Travel agency',
        title: 'A booking link that runs like a staffed counter.',
        body: 'You keep the customer. Sendero handles quote, policy, hold, ticketing, payment, invoice, and trip support.',
        panel: '/brand/panels/panel-05.png',
        icons: [
          '/brand/icons/01-mail-circle.png',
          '/brand/icons/03-globe-stamp.png',
          '/brand/icons/11-ticket.png',
        ],
      },
      {
        eyebrow: 'Corporate travel',
        title: 'Prepay. Keep policy and audit aligned.',
        body: 'Issue prepaid guest links, route exceptions to Slack, cap tenant spend, reconcile every action to the right trip and invoice.',
        panel: '/brand/panels/panel-06.png',
        icons: [
          '/brand/icons/09-secure-check-shield.png',
          '/brand/icons/11-cost-gauge.png',
          '/brand/icons/14-bank.png',
        ],
      },
      {
        eyebrow: 'AI agents',
        title: 'Let another agent call the back office.',
        body: 'Discoverable via llms.txt and MCP. Tools for search, prefunding, reservation, settlement, refunds, and invoicing — priced per call.',
        panel: '/brand/panels/panel-04.png',
        icons: [
          '/brand/icons/16-ai-chip.png',
          '/brand/icons/04-network-nodes.png',
          '/brand/icons/05-airplane-circle.png',
        ],
      },
    ],
  },
  features: [
    {
      id: 'consumer',
      title: 'A trip agent that remembers',
      body: 'Preferences, passport, budget, dates, receipts, and changes — all in one conversation.',
      iconSrc: '/brand/icons/02-chat-bubbles.png',
    },
    {
      id: 'agency',
      title: 'White-label operations',
      body: 'Bring your WhatsApp number and customer relationship. We bring the booking, escrow, and support engine.',
      iconSrc: '/brand/icons/03-group-chat.png',
    },
    {
      id: 'corporate',
      title: 'Spend under control',
      body: 'Policy, approvals, prepaid guest budgets, caps, invoices, audit — built into the trip.',
      iconSrc: '/brand/icons/14-bank.png',
    },
    {
      id: 'agents',
      title: 'Travel tools for agents',
      body: 'MCP discovery, llms.txt, priced tool calls, and named workflows. Delegate real travel work safely.',
      iconSrc: '/brand/icons/16-ai-chip.png',
    },
  ],
  assetShowcase: {
    eyebrow: 'Visual system',
    title: 'A travel OS should look inspectable.',
    body: 'Maps, stamps, tickets, receipts, and route marks — because the product is custody of intent: who asked, who approved, what was held, what settled.',
    assets: [
      {
        id: 'agent-route-map',
        type: 'image',
        title: 'One route map',
        brief:
          'WhatsApp, Slack, web, or MCP — through inventory, policy, escrow, invoice, and support.',
        src: '/brand/panels/panel-04.png',
        alt: 'Risograph-style ticket and route map showing Sendero agent coordination.',
      },
      {
        id: 'escrow-lifecycle',
        type: 'lottie',
        title: 'Escrow lifecycle',
        brief:
          'Buyer prefunds, traveler claims, we reserve, ticket confirms, escrow settles, invoice appears.',
        src: '/brand/panels/panel-05.png',
        alt: 'Illustrated settlement document used for the prepaid escrow lifecycle.',
      },
      {
        id: 'channel-symbols',
        type: 'icon-set',
        title: 'Channel + trust symbols',
        brief:
          'Stamps for messages, routes, approvals, tickets, travelers, policy, payments, and tool calls.',
        src: '/brand/panels/panel-06.png',
        alt: 'Sendero delivery document panel used as the basis for channel and trust symbols.',
      },
    ],
  },
  passport: {
    eyebrow: 'Custody trail',
    title: 'Every action leaves a postcard.',
    body: 'Locked requests, tagged context, approval stamps, settlement marks, and final records. Invisible agent work, made visible.',
    postcards: [
      {
        label: 'Seal',
        title: 'Secure the request',
        body: 'The trip starts as a locked instruction, not a loose chat promise.',
        image: '/brand/postcards/sendero-3-01.png',
        alt: 'Sendero postcard showing a hand holding a locked travel note over an island route.',
      },
      {
        label: 'Tag',
        title: 'Attach the context',
        body: 'Traveler, budget, policy, and route metadata move with the work.',
        image: '/brand/postcards/sendero-3-02.png',
        alt: 'Sendero postcard showing a traveler tagging a document beside an island route.',
      },
      {
        label: 'Bind',
        title: 'Bundle the proofs',
        body: 'Approvals, holds, and claims stay tied to one operational thread.',
        image: '/brand/postcards/sendero-3-03.png',
        alt: 'Sendero postcard showing a banded bundle of travel documents and a route marker.',
      },
      {
        label: 'Clear',
        title: 'Approve the itinerary',
        body: 'The agent moves only when the next irreversible step is allowed.',
        image: '/brand/postcards/sendero-3-04.png',
        alt: 'Sendero postcard showing a ticket with a plane stamp and approval check.',
      },
      {
        label: 'Settle',
        title: 'Reconcile the money',
        body: 'USDC settlement, supplier rails, fees, and invoices — one trail.',
        image: '/brand/postcards/sendero-3-05.png',
        alt: 'Sendero postcard showing bank settlement, coins, a compass, and an invoice.',
      },
      {
        label: 'Deliver',
        title: 'Send the record home',
        body: 'Traveler, buyer, and agent share the same final state.',
        image: '/brand/postcards/sendero-3-06.png',
        alt: 'Sendero postcard showing a final travel document delivered along a coastal route.',
      },
    ],
  },
  pricing: {
    heading: 'Free to start. Scales when you do.',
    subheading:
      'Metered per travel action. Paid plans unlock workspaces, lower nanopayment + take rates, and production keys.',
    tiers: [
      {
        id: 'free',
        name: 'Free',
        price: '$0',
        unit: '1 workspace · sandbox',
        description: 'Ship a prototype, test the MCP, try the agent console.',
        features: [
          '1 workspace',
          'Sandbox API key',
          'Baseline nanopayment pricing',
          'Agent console + Arc testnet',
        ],
        cta: { label: 'Start free', href: '/dashboard' },
      },
      {
        id: 'basic',
        name: 'Basic',
        price: '$19',
        unit: '/mo · $15 annually',
        description: 'Agencies and small teams running multiple brands.',
        features: [
          'Up to 5 workspaces',
          '3 production API keys',
          'WhatsApp + Slack channels',
          '15% off nano · 5% off take rate',
        ],
        cta: { label: 'Start free', href: '/dashboard' },
      },
      {
        id: 'pro',
        name: 'Pro',
        price: '$60',
        unit: '/mo · $50 annually',
        description: 'TMCs and agentic platforms at scale.',
        features: [
          'Unlimited workspaces · 25 keys',
          'Public MCP + custom webhooks',
          'Audit export · priority support',
          '30% off nano · 10% off take rate',
        ],
        cta: { label: 'Start 14-day trial', href: '/dashboard' },
      },
      {
        id: 'enterprise',
        name: 'Enterprise',
        price: 'Custom',
        unit: 'contact sales',
        description: 'White-label, SSO/SAML, custom SLA, dedicated solution eng.',
        features: [
          'Unlimited keys + spend',
          'SSO/SAML + audit export',
          'White-label + custom SLA',
          '50% off nano · 15% off take rate',
        ],
        cta: { label: 'Talk to sales', href: 'mailto:sales@sendero.travel' },
      },
    ],
  },
  symbols: {
    eyebrow: 'Asset language',
    title: 'A stamp kit for every action.',
    body: 'Channel, trust, payment, and travel marks across product, docs, and launch — and the same kit becomes your on-chain trip passport. Blockchain traceability shipping next.',
  },
  footer: {
    copyright: `© ${CURRENT_YEAR} Sendero. All rights reserved.`,
    links: FOOTER_LINKS,
    groups: FOOTER_GROUPS_EN,
  },
};

const ES_MX: MarketingContent = {
  ...EN_US,
  locale: 'es-MX',
  nav: {
    website: 'Producto',
    app: 'App',
    pricing: 'Precios',
    agents: 'Para agentes IA',
  },
  hero: {
    eyebrow: 'En vivo en Circle Arc',
    title: 'Infraestructura de viajes para la era de los agentes IA.',
    subtitle: 'Reservas, escrow prepagado, liquidación en USDC y soporte — en un solo hilo.',
    primaryCta: { label: 'Empezar gratis', href: '/dashboard' },
    secondaryCta: { label: 'Para agentes IA', href: '/llms.txt' },
  },
  proof: {
    items: [
      'En vivo en Circle Arc',
      'Liquidación USDC + EURC',
      'MCP + x402 nativo',
      'WhatsApp + Slack + web',
      'EN · ES · PT',
    ],
  },
  audiences: {
    eyebrow: 'Cuatro entradas',
    title: 'Un mismo motor. Cada entrada.',
    items: [
      {
        id: 'travelers',
        label: 'Viajeros',
        headline: 'Reserva desde el chat que ya tienes abierto.',
        body: 'WhatsApp, web, opciones reales, presupuestos prepagados, recibos.',
        cta: { label: 'Empezar gratis', href: '/dashboard' },
      },
      {
        id: 'agencies',
        label: 'Agencias',
        headline: 'Un mostrador atendido detrás de cada link.',
        body: 'Cotización, hold, emisión, liquidación y soporte white-label.',
        cta: { label: 'Empezar gratis', href: '/dashboard' },
      },
      {
        id: 'companies',
        label: 'Empresas',
        headline: 'Prepaga el viaje. Mantén política y auditoría.',
        body: 'Aprobaciones en Slack, límites por tenant, conciliación en USDC.',
        cta: { label: 'Hablar con ventas', href: 'mailto:sales@sendero.travel' },
      },
      {
        id: 'agents',
        label: 'Agentes IA',
        headline: 'Llama al back office de viajes.',
        body: 'MCP descubrible. x402 con precio. llms.txt publicado.',
        cta: { label: 'Leer llms.txt', href: '/llms.txt' },
      },
    ],
  },
  waitlist: {
    eyebrow: 'Mainnet en camino',
    title: 'Aparta tu lugar en producción.',
    body: 'Agencias, empresas y desarrolladores de IA entran por etapas. Regístrate para acceso temprano a presupuestos prepagados, herramientas MCP y operaciones white-label.',
  },
  routeMurals: {
    eyebrow: 'Inteligencia de ruta',
    title: 'Una solicitud. Una ruta auditable.',
    body: 'Intención, política, aprobaciones, inventario, escrow, soporte y conciliación viven en el mismo registro de viaje.',
    items: EN_US.routeMurals.items.map(item => ({
      ...item,
      title:
        item.label === 'Handoff map'
          ? 'Pregunta una vez. El sistema coordina el resto.'
          : item.label === 'Trust sequence'
            ? 'Bloqueado, revisado, aprobado, emitido, liquidado.'
            : item.label === 'Operations network'
              ? 'Un grafo para trabajo de viaje, no solo mensajes.'
              : item.label === 'Open route'
                ? 'El viaje sigue vivo después del boleto.'
                : 'Un guía IA en el camino. Un souvenir sellado al final.',
      body:
        item.label === 'Handoff map'
          ? 'Se mueve entre WhatsApp, web, aprobaciones de Slack y MCP sin perder el estado del viaje.'
          : item.label === 'Trust sequence'
            ? 'Cada acción irreversible tiene prueba: link, política, hold, confirmación, liquidación.'
            : item.label === 'Operations network'
              ? 'Reservas, aprobaciones, recibos, facturas, límites, soporte y llamadas — inspeccionables.'
              : item.label === 'Open route'
                ? 'Recordatorios, cambios, recibos, soporte, reembolsos y conciliación — hasta cerrar.'
                : 'Sendero te acompaña durante el viaje y al cierre acuña un souvenir on-chain personalizado en Arc. Trazable, coleccionable, tuyo.',
    })),
  },
  story: {
    eyebrow: 'Donde empieza el viaje',
    title: 'Un mismo motor. Todas las entradas.',
    body: 'El viaje arranca en lugares imperfectos: chat, mostrador, aprobación financiera, otro LLM. Sendero le da a cada uno el mismo motor de reserva, escrow, liquidación y soporte.',
    paths: [
      {
        ...EN_US.story.paths[0],
        eyebrow: 'Viajero individual',
        title: 'Reserva desde el hilo que ya tienes abierto.',
        body: 'WhatsApp o web, opciones reales, presupuesto prepagado, mismo agente para cambios y soporte.',
      },
      {
        ...EN_US.story.paths[1],
        eyebrow: 'Agencia',
        title: 'Un link de reserva que opera como mostrador atendido.',
        body: 'Tú mantienes al cliente. Sendero hace cotización, política, hold, emisión, pago, factura y soporte.',
      },
      {
        ...EN_US.story.paths[2],
        eyebrow: 'Viaje corporativo',
        title: 'Prepaga. Mantén política y auditoría.',
        body: 'Links prepagados, excepciones a Slack, límites por tenant, conciliación de cada acción.',
      },
      {
        ...EN_US.story.paths[3],
        eyebrow: 'Agentes IA',
        title: 'Que otro agente llame al back office.',
        body: 'Descubrible por llms.txt y MCP. Búsqueda, prefunding, reserva, liquidación, reembolsos, facturación — con precio.',
      },
    ],
  },
  features: EN_US.features.map(feature => ({
    ...feature,
    title:
      feature.id === 'consumer'
        ? 'Un agente que recuerda'
        : feature.id === 'agency'
          ? 'Operaciones white-label'
          : feature.id === 'corporate'
            ? 'Gasto bajo control'
            : 'Herramientas para agentes',
    body:
      feature.id === 'consumer'
        ? 'Preferencias, contexto, presupuesto, fechas, recibos y cambios — en una sola conversación.'
        : feature.id === 'agency'
          ? 'Trae tu WhatsApp y la relación con el cliente. Nosotros aportamos reserva, escrow, liquidación y soporte.'
          : feature.id === 'corporate'
            ? 'Política, aprobaciones, presupuestos prepagados, límites, facturas y auditoría — dentro del viaje.'
            : 'MCP, llms.txt, llamadas con precio y workflows. Delega acciones reales de viaje sin riesgo.',
  })),
  assetShowcase: {
    ...EN_US.assetShowcase,
    eyebrow: 'Sistema visual',
    title: 'Un OS de viajes debe sentirse inspeccionable.',
    body: 'Mapas, sellos, tickets, recibos y marcas de ruta — porque el producto es custodia de intención.',
    assets: EN_US.assetShowcase.assets.map(asset => ({
      ...asset,
      title:
        asset.id === 'agent-route-map'
          ? 'Un mapa de ruta'
          : asset.id === 'escrow-lifecycle'
            ? 'Ciclo de escrow'
            : 'Símbolos de canal + confianza',
      brief:
        asset.id === 'agent-route-map'
          ? 'WhatsApp, Slack, web o MCP — pasando por inventario, política, escrow, factura y soporte.'
          : asset.id === 'escrow-lifecycle'
            ? 'El comprador prepaga, el viajero reclama, reservamos, el ticket confirma, el escrow liquida, aparece la factura.'
            : 'Sellos para mensajes, rutas, aprobaciones, tickets, viajeros, política, pagos y llamadas de herramientas.',
    })),
  },
  passport: {
    ...EN_US.passport,
    eyebrow: 'Rastro de custodia',
    title: 'Cada acción deja una postal.',
    body: 'Solicitudes bloqueadas, contexto etiquetado, sellos de aprobación, marcas de liquidación y registros finales.',
    postcards: EN_US.passport.postcards.map(card => ({
      ...card,
      title:
        card.label === 'Seal'
          ? 'Asegurar la solicitud'
          : card.label === 'Tag'
            ? 'Adjuntar el contexto'
            : card.label === 'Bind'
              ? 'Unir las pruebas'
              : card.label === 'Clear'
                ? 'Aprobar el itinerario'
                : card.label === 'Settle'
                  ? 'Conciliar el dinero'
                  : 'Entregar el registro',
    })),
  },
  pricing: {
    heading: 'Gratis para empezar. Crece a tu ritmo.',
    subheading:
      'Cobramos por acción de viaje. Los planes de paga desbloquean más workspaces, descuentos en nanopagos + take rate, y llaves de producción.',
    tiers: EN_US.pricing.tiers.map(t => ({
      ...t,
      name: t.id === 'free' ? 'Gratis' : t.id === 'enterprise' ? 'Empresa' : t.name,
      cta: {
        ...t.cta,
        label:
          t.id === 'free'
            ? 'Empezar gratis'
            : t.id === 'enterprise'
              ? 'Hablar con ventas'
              : t.id === 'pro'
                ? 'Probar 14 días'
                : 'Empezar gratis',
      },
    })),
  },
  symbols: {
    eyebrow: 'Lenguaje de activos',
    title: 'Un kit de sellos para cada acción.',
    body: 'Marcas de canal, confianza, pagos y viaje en producto, docs y lanzamiento — y el mismo kit se vuelve tu pasaporte de viaje on-chain. Trazabilidad en blockchain ya en camino.',
  },
  footer: {
    copyright: `© ${CURRENT_YEAR} Sendero. Todos los derechos reservados.`,
    links: FOOTER_LINKS,
    groups: FOOTER_GROUPS_ES,
  },
};

const PT_BR: MarketingContent = {
  ...EN_US,
  locale: 'pt-BR',
  nav: {
    website: 'Produto',
    app: 'App',
    pricing: 'Preços',
    agents: 'Para agentes IA',
  },
  hero: {
    eyebrow: 'No ar na Circle Arc',
    title: 'Infraestrutura de viagens para a era dos agentes IA.',
    subtitle: 'Reservas, escrow pré-pago, liquidação em USDC e suporte — em um único fio.',
    primaryCta: { label: 'Começar grátis', href: '/dashboard' },
    secondaryCta: { label: 'Para agentes IA', href: '/llms.txt' },
  },
  proof: {
    items: [
      'No ar na Circle Arc',
      'Liquidação USDC + EURC',
      'MCP + x402 nativo',
      'WhatsApp + Slack + web',
      'EN · ES · PT',
    ],
  },
  audiences: {
    eyebrow: 'Quatro entradas',
    title: 'Um motor. Toda entrada.',
    items: [
      {
        id: 'travelers',
        label: 'Viajantes',
        headline: 'Reserve do chat que já está aberto.',
        body: 'WhatsApp, web, opções reais, orçamentos pré-pagos, recibos.',
        cta: { label: 'Começar grátis', href: '/dashboard' },
      },
      {
        id: 'agencies',
        label: 'Agências',
        headline: 'Um balcão atendido atrás de cada link.',
        body: 'Cotação, hold, emissão, liquidação e suporte white-label.',
        cta: { label: 'Começar grátis', href: '/dashboard' },
      },
      {
        id: 'companies',
        label: 'Empresas',
        headline: 'Pré-pague a viagem. Mantenha política e auditoria.',
        body: 'Aprovações no Slack, limites por tenant, conciliação USDC.',
        cta: { label: 'Falar com vendas', href: 'mailto:sales@sendero.travel' },
      },
      {
        id: 'agents',
        label: 'Agentes IA',
        headline: 'Chame o back office de viagens.',
        body: 'Descobrível por MCP. Precificado por x402. llms.txt publicado.',
        cta: { label: 'Ler llms.txt', href: '/llms.txt' },
      },
    ],
  },
  waitlist: {
    eyebrow: 'Onda mainnet',
    title: 'Garanta seu lugar em produção.',
    body: 'Agências, empresas e builders de IA entram em ondas. Garanta acesso a orçamentos pré-pagos, ferramentas MCP e operações white-label.',
  },
  routeMurals: {
    eyebrow: 'Inteligência de rota',
    title: 'Um pedido. Uma rota auditável.',
    body: 'Intenção, política, aprovações, inventário, escrow, suporte e reconciliação no mesmo registro de viagem.',
    items: EN_US.routeMurals.items.map(item => ({
      ...item,
      title:
        item.label === 'Handoff map'
          ? 'Pede uma vez. O sistema coordena o resto.'
          : item.label === 'Trust sequence'
            ? 'Travado, verificado, aprovado, emitido, liquidado.'
            : item.label === 'Operations network'
              ? 'Um grafo para trabalho de viagem, não só mensagens.'
              : item.label === 'Open route'
                ? 'A jornada segue viva depois do bilhete.'
                : 'Um guia IA no caminho. Um souvenir carimbado no fim.',
      body:
        item.label === 'Handoff map'
          ? 'Transita entre WhatsApp, web, aprovações no Slack e MCP sem perder o estado da viagem.'
          : item.label === 'Trust sequence'
            ? 'Cada ação irreversível tem prova: link, política, hold, confirmação, liquidação.'
            : item.label === 'Operations network'
              ? 'Reservas, aprovações, recibos, notas, limites, suporte e chamadas — inspecionáveis.'
              : item.label === 'Open route'
                ? 'Lembretes, mudanças, recibos, suporte, reembolsos e reconciliação — até fechar.'
                : 'Sendero te acompanha durante a viagem e no fim cunha um souvenir on-chain personalizado na Arc. Rastreável, colecionável, seu.',
    })),
  },
  story: {
    eyebrow: 'Onde a viagem começa',
    title: 'Um motor. Todas as entradas.',
    body: 'A viagem nasce em lugares bagunçados: chat, balcão, aprovação financeira, outro LLM. Sendero entrega o mesmo motor de reserva, escrow, liquidação e suporte para cada um.',
    paths: [
      {
        ...EN_US.story.paths[0],
        eyebrow: 'Viajante individual',
        title: 'Reserve a partir da conversa que você já usa.',
        body: 'WhatsApp ou web, opções reais, orçamento pré-pago, mesmo agente para mudanças e suporte.',
      },
      {
        ...EN_US.story.paths[1],
        eyebrow: 'Agência',
        title: 'Um link de reserva que opera como balcão atendido.',
        body: 'Você mantém o cliente. Sendero faz cotação, política, hold, emissão, pagamento, nota e suporte.',
      },
      {
        ...EN_US.story.paths[2],
        eyebrow: 'Viagem corporativa',
        title: 'Pré-pague. Mantenha política e auditoria.',
        body: 'Links pré-pagos, exceções para o Slack, limites por tenant, conciliação de cada ação.',
      },
      {
        ...EN_US.story.paths[3],
        eyebrow: 'Agentes IA',
        title: 'Deixe outro agente chamar o back office.',
        body: 'Descobrível por llms.txt e MCP. Busca, prefunding, reserva, liquidação, reembolso, faturamento — precificado.',
      },
    ],
  },
  features: EN_US.features.map(feature => ({
    ...feature,
    title:
      feature.id === 'consumer'
        ? 'Um agente que lembra'
        : feature.id === 'agency'
          ? 'Operações white-label'
          : feature.id === 'corporate'
            ? 'Gasto sob controle'
            : 'Ferramentas para agentes',
    body:
      feature.id === 'consumer'
        ? 'Preferências, contexto, orçamento, datas, recibos e mudanças — numa única conversa.'
        : feature.id === 'agency'
          ? 'Traga seu WhatsApp e a relação. Trazemos reserva, escrow, liquidação e suporte.'
          : feature.id === 'corporate'
            ? 'Política, aprovações, orçamentos pré-pagos, limites, notas e auditoria — dentro da viagem.'
            : 'MCP, llms.txt, chamadas precificadas e workflows. Delegue ações reais sem risco.',
  })),
  assetShowcase: {
    ...EN_US.assetShowcase,
    eyebrow: 'Sistema visual',
    title: 'Um OS de viagens precisa parecer inspecionável.',
    body: 'Mapas, selos, bilhetes, recibos e marcas de rota — porque o produto trata da custódia da intenção.',
    assets: EN_US.assetShowcase.assets.map(asset => ({
      ...asset,
      title:
        asset.id === 'agent-route-map'
          ? 'Um mapa de rota'
          : asset.id === 'escrow-lifecycle'
            ? 'Ciclo de escrow'
            : 'Símbolos de canal + confiança',
      brief:
        asset.id === 'agent-route-map'
          ? 'WhatsApp, Slack, web ou MCP — passando por inventário, política, escrow, nota e suporte.'
          : asset.id === 'escrow-lifecycle'
            ? 'Comprador pré-paga, viajante resgata, reservamos, bilhete confirma, escrow liquida, nota aparece.'
            : 'Selos para mensagens, rotas, aprovações, bilhetes, viajantes, política, pagamentos e chamadas de ferramentas.',
    })),
  },
  passport: {
    ...EN_US.passport,
    eyebrow: 'Trilha de custódia',
    title: 'Cada ação deixa uma postal.',
    body: 'Pedidos travados, contexto etiquetado, selos de aprovação, marcas de liquidação e registros finais.',
    postcards: EN_US.passport.postcards,
  },
  pricing: {
    heading: 'Grátis para começar. Escala com você.',
    subheading:
      'Cobrado por ação de viagem. Planos pagos liberam workspaces, descontos em nano + take rate, e chaves de produção.',
    tiers: EN_US.pricing.tiers.map(t => ({
      ...t,
      name: t.id === 'free' ? 'Grátis' : t.id === 'enterprise' ? 'Empresa' : t.name,
      cta: {
        ...t.cta,
        label:
          t.id === 'free'
            ? 'Começar grátis'
            : t.id === 'enterprise'
              ? 'Falar com vendas'
              : t.id === 'pro'
                ? 'Testar 14 dias'
                : 'Começar grátis',
      },
    })),
  },
  symbols: {
    eyebrow: 'Linguagem visual',
    title: 'Um kit de selos para cada ação.',
    body: 'Marcas de canal, confiança, pagamento e viagem no produto, na documentação e no lançamento — e o mesmo kit vira seu passaporte de viagem on-chain. Rastreabilidade em blockchain a caminho.',
  },
  footer: {
    copyright: `© ${CURRENT_YEAR} Sendero. Todos os direitos reservados.`,
    links: FOOTER_LINKS,
    groups: FOOTER_GROUPS_PT,
  },
};

const ES_AR: MarketingContent = {
  ...ES_MX,
  locale: 'es-AR',
  hero: {
    ...ES_MX.hero,
    primaryCta: { label: 'Empezar gratis', href: '/dashboard' },
    secondaryCta: { label: 'Para agentes IA', href: '/llms.txt' },
  },
  audiences: {
    ...ES_MX.audiences,
    items: ES_MX.audiences.items.map(item =>
      item.id === 'travelers'
        ? { ...item, headline: 'Reservá desde el chat que ya tenés abierto.' }
        : item.id === 'companies'
          ? { ...item, headline: 'Prepagá el viaje. Mantené política y auditoría.' }
          : item.id === 'agents'
            ? { ...item, headline: 'Llamá al back office de viajes.' }
            : item
    ),
  },
  waitlist: {
    eyebrow: 'Mainnet en camino',
    title: 'Sumate a la lista de producción.',
    body: 'Agencias, empresas y desarrolladores de IA entran por etapas. Sumate para acceso temprano a presupuestos prepagados, herramientas MCP y operaciones white-label.',
  },
  routeMurals: {
    ...ES_MX.routeMurals,
    items: ES_MX.routeMurals.items.map(item =>
      item.label === 'Handoff map'
        ? { ...item, title: 'Preguntás una vez. El sistema coordina el resto.' }
        : item
    ),
  },
  story: {
    ...ES_MX.story,
    paths: ES_MX.story.paths.map((p, i) =>
      i === 0
        ? { ...p, title: 'Reservá desde el hilo que ya tenés abierto.' }
        : i === 1
          ? {
              ...p,
              body: 'Vos mantenés al cliente. Sendero hace cotización, política, hold, emisión, pago, factura y soporte.',
            }
          : i === 2
            ? {
                ...p,
                title: 'Prepagá. Mantené política y auditoría.',
                body: 'Links prepagados, excepciones a Slack, límites por tenant, conciliación de cada acción.',
              }
            : p
    ),
  },
  features: ES_MX.features.map(feature =>
    feature.id === 'agency'
      ? {
          ...feature,
          body: 'Traé tu WhatsApp y la relación con el cliente. Nosotros aportamos reserva, escrow, liquidación y soporte.',
        }
      : feature.id === 'agents'
        ? {
            ...feature,
            body: 'MCP, llms.txt, llamadas con precio y workflows. Delegá acciones reales de viaje sin riesgo.',
          }
        : feature
  ),
  pricing: {
    ...ES_MX.pricing,
    heading: 'Gratis para empezar. Crecé a tu ritmo.',
    subheading:
      'Cobramos por acción de viaje. Los planes pagos te desbloquean más workspaces, descuentos en nanopagos + take rate, y llaves de producción.',
  },
};

const FALLBACK_CONTENT: Record<string, MarketingContent> = {
  'en-US': EN_US,
  'es-MX': ES_MX,
  'pt-BR': PT_BR,
  'es-AR': ES_AR,
};

const CMS_REVALIDATE_SECONDS = 300;

export async function getMarketingContent(locale: string): Promise<MarketingContent> {
  const glossary: TravelGlossary = getGlossary(locale);
  const fallback = FALLBACK_CONTENT[glossary.locale] ?? FALLBACK_CONTENT['en-US'];
  const cms = await getCmsMarketingContent(glossary.locale);
  return cms ? mergeMarketingContent(fallback, cms) : fallback;
}

export function getFallbackMarketingContent(locale: string): MarketingContent {
  const glossary: TravelGlossary = getGlossary(locale);
  return FALLBACK_CONTENT[glossary.locale] ?? FALLBACK_CONTENT['en-US'];
}

async function getCmsMarketingContent(
  locale: string
): Promise<DeepPartial<MarketingContent> | null> {
  const fromJson = readCmsJson(locale);
  if (fromJson) return fromJson;

  const endpoint = process.env.BASEHUB_MARKETING_CONTENT_URL;
  if (!endpoint) return null;

  try {
    const url = new URL(endpoint);
    url.searchParams.set('locale', locale);

    const headers: HeadersInit = { accept: 'application/json' };
    if (process.env.BASEHUB_TOKEN) {
      headers.authorization = `Bearer ${process.env.BASEHUB_TOKEN}`;
    }

    const response = await fetch(url, {
      headers,
      next: { revalidate: CMS_REVALIDATE_SECONDS },
    });

    if (!response.ok) return null;
    return normalizeCmsPayload(await response.json(), locale);
  } catch {
    return null;
  }
}

function readCmsJson(locale: string): DeepPartial<MarketingContent> | null {
  const raw = process.env.BASEHUB_MARKETING_CONTENT_JSON;
  if (!raw) return null;

  try {
    return normalizeCmsPayload(JSON.parse(raw), locale);
  } catch {
    return null;
  }
}

function normalizeCmsPayload(
  payload: unknown,
  locale: string
): DeepPartial<MarketingContent> | null {
  if (!isRecord(payload)) return null;

  const data = isRecord(payload.data) ? payload.data : null;
  const marketing = isRecord(payload.marketing) ? payload.marketing : null;
  const marketingContent = isRecord(payload.marketingContent) ? payload.marketingContent : null;

  const candidates = [
    payload[locale],
    marketing?.[locale],
    marketingContent?.[locale],
    data?.marketingHome,
    data?.marketingContent,
    payload.marketingHome,
    payload.marketingContent,
    payload,
  ];

  for (const candidate of candidates) {
    if (isMarketingContentPartial(candidate)) return candidate;
  }

  return null;
}

function isMarketingContentPartial(value: unknown): value is DeepPartial<MarketingContent> {
  if (!isRecord(value)) return false;
  return (
    isRecord(value.nav) ||
    isRecord(value.hero) ||
    isRecord(value.waitlist) ||
    isRecord(value.routeMurals) ||
    isRecord(value.audiences) ||
    isRecord(value.proof) ||
    Array.isArray(value.features) ||
    isRecord(value.pricing)
  );
}

function mergeMarketingContent(
  fallback: MarketingContent,
  override: DeepPartial<MarketingContent>
): MarketingContent {
  return deepMerge(fallback, override) as MarketingContent;
}

function deepMerge(fallback: unknown, override: unknown): unknown {
  if (override === undefined || override === null) return fallback;
  if (typeof override === 'string') return override.trim() ? override : fallback;
  if (Array.isArray(override)) return override.length > 0 ? override : fallback;

  if (isRecord(fallback) && isRecord(override)) {
    const merged: Record<string, unknown> = { ...fallback };
    for (const [key, value] of Object.entries(override)) {
      merged[key] = deepMerge(fallback[key], value);
    }
    return merged;
  }

  return override;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
