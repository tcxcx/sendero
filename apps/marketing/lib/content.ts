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

export interface MarketingContent {
  locale: string;
  nav: MarketingNav;
  hero: MarketingHero;
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

const EN_US: MarketingContent = {
  locale: 'en-US',
  nav: {
    website: 'Website',
    app: 'App',
    pricing: 'Pricing',
    agents: 'For AI agents',
  },
  hero: {
    eyebrow: 'Sendero on Circle Arc',
    title: 'The travel agent for humans, teams, and AI agents.',
    subtitle:
      'Sendero turns a travel request into a coordinated booking workflow: real inventory, policy checks, prepaid guest escrow, PNR issuance, USDC settlement on Arc, invoices, and trip support in one persistent agent thread.',
    primaryCta: { label: 'Join the launch waitlist', href: '#waitlist' },
    secondaryCta: { label: 'Read llms.txt', href: '/llms.txt' },
  },
  waitlist: {
    eyebrow: 'Arc testnet live',
    title: 'Join the mainnet launch list.',
    body: 'We are opening production onboarding for agencies, companies, and AI builders in waves. Join the list if you want early access to prepaid travel budgets, MCP booking tools, or white-label travel operations.',
  },
  routeMurals: {
    eyebrow: 'Route intelligence',
    title: 'One request becomes an auditable travel route.',
    body: 'The product is not a chat wrapper. Sendero keeps traveler intent, policy, approvals, inventory, escrow, supplier actions, support, and reconciliation attached to the same journey record.',
    items: [
      {
        label: 'Handoff map',
        title: 'A traveler asks once. The system coordinates every next step.',
        body: 'The agent can move between WhatsApp, web, Slack approvals, and MCP callers without losing the trip state.',
        image: '/brand/generated/agent-handoff-map.jpg',
        alt: 'Sendero illustrated handoff map with traveler, operator checks, approvals, and a destination route.',
      },
      {
        label: 'Trust sequence',
        title: 'Locked, checked, approved, ticketed, settled.',
        body: 'Every irreversible action has a proof point: claim links, policy decisions, offer holds, ticket confirmation, and payment settlement.',
        image: '/brand/generated/trust-stamp-flow.jpg',
        alt: 'Sendero illustrated trust sequence of route documents, approval stamps, and settlement handoff.',
      },
      {
        label: 'Operations network',
        title: 'A graph for travel work, not just messages.',
        body: 'Bookings, approvals, receipts, invoices, tenant spend caps, support events, and agent tool calls become inspectable records.',
        image: '/brand/generated/operations-network-map.jpg',
        alt: 'Sendero illustrated operations network with travel, finance, policy, and support nodes.',
      },
      {
        label: 'Open route',
        title: 'The journey stays alive after the ticket is issued.',
        body: 'Sendero continues through reminders, changes, receipts, support, refunds, and reconciliation until the trip is complete.',
        image: '/brand/generated/traveler-world-panorama.jpg',
        alt: 'Sendero illustrated world map panorama with traveler, route marks, envelopes, and destinations.',
      },
    ],
  },
  story: {
    eyebrow: 'Four ways in',
    title: 'The agent meets each buyer where travel actually starts.',
    body: 'Travel begins in messy places: a WhatsApp thread, an agency desk, a finance approval, or another LLM. Sendero gives each entry point the same booking, escrow, settlement, and support engine.',
    paths: [
      {
        eyebrow: 'Individual traveler',
        title: 'Book from the thread already in your hand.',
        body: 'A traveler can start in WhatsApp or web, compare real options, claim a prepaid budget when needed, and keep the same agent for changes, receipts, alerts, and local help.',
        panel: '/brand/panels/panel-02.png',
        icons: [
          '/brand/icons/04-courier-profile.png',
          '/brand/icons/07-magnifier.png',
          '/brand/icons/12-traveler-bag.png',
        ],
      },
      {
        eyebrow: 'Travel agency',
        title: 'Send a booking link that behaves like a staffed counter.',
        body: 'Agencies keep the customer relationship while Sendero handles quote, policy check, offer hold, ticketing, payment, invoice, and trip support behind the scenes.',
        panel: '/brand/panels/panel-05.png',
        icons: [
          '/brand/icons/01-mail-circle.png',
          '/brand/icons/03-globe-stamp.png',
          '/brand/icons/11-ticket.png',
        ],
      },
      {
        eyebrow: 'Corporate travel',
        title: 'Prepay the journey. Keep policy and audit in line.',
        body: 'Companies can issue prepaid guest links, route exceptions to Slack or Teams, cap tenant spend, and reconcile each travel action back to the right trip and invoice.',
        panel: '/brand/panels/panel-06.png',
        icons: [
          '/brand/icons/09-secure-check-shield.png',
          '/brand/icons/11-cost-gauge.png',
          '/brand/icons/14-bank.png',
        ],
      },
      {
        eyebrow: 'AI agents',
        title: 'Let another agent call the travel back office.',
        body: 'LLMs can discover Sendero through llms.txt and MCP, then call tools for search, prefunding, reservation, settlement, refunds, and invoice generation with x402-style payment boundaries.',
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
      title: 'Travelers get a persistent trip agent',
      body: 'Preferences, passport context, budget, dates, receipts, and changes stay attached to the same conversation instead of being scattered across apps.',
      iconSrc: '/brand/icons/02-chat-bubbles.png',
    },
    {
      id: 'agency',
      title: 'Agencies get white-label operations',
      body: 'Bring your WhatsApp Business number and customer relationship. Sendero supplies the booking workflow, escrow lifecycle, settlement records, and repetitive support automation.',
      iconSrc: '/brand/icons/03-group-chat.png',
    },
    {
      id: 'corporate',
      title: 'Companies get controlled spend',
      body: 'Policy checks, manager approvals, prepaid guest budgets, tenant caps, invoices, and audit trails are built into the trip instead of bolted on after booking.',
      iconSrc: '/brand/icons/14-bank.png',
    },
    {
      id: 'agents',
      title: 'AI agents get travel tools',
      body: 'MCP discovery, llms.txt, priced tool calls, and named workflows let other agents delegate real travel actions without handling supplier or payment risk themselves.',
      iconSrc: '/brand/icons/16-ai-chip.png',
    },
  ],
  assetShowcase: {
    eyebrow: 'Visual system',
    title: 'A travel operating system should look inspectable.',
    body: 'Sendero uses maps, stamps, tickets, receipts, and route marks because the product is about custody of intent: who asked, who approved, what was held, what settled, and what remains open.',
    assets: [
      {
        id: 'agent-route-map',
        type: 'image',
        title: 'One route map',
        brief:
          'A single session can begin in WhatsApp, Slack, web, or MCP, then pass through inventory, policy, escrow, invoice, and support.',
        src: '/brand/panels/panel-04.png',
        alt: 'Risograph-style ticket and route map showing Sendero agent coordination.',
      },
      {
        id: 'escrow-lifecycle',
        type: 'lottie',
        title: 'Escrow lifecycle',
        brief:
          'Buyer prefunds, traveler claims, Sendero reserves, ticket confirms, escrow settles, invoice appears.',
        src: '/brand/panels/panel-05.png',
        alt: 'Illustrated settlement document used for the prepaid escrow lifecycle.',
      },
      {
        id: 'channel-symbols',
        type: 'icon-set',
        title: 'Channel and trust symbols',
        brief:
          'A stamp kit for messages, routes, approvals, tickets, travelers, policy, payments, and agent calls.',
        src: '/brand/panels/panel-06.png',
        alt: 'Sendero delivery document panel used as the basis for channel and trust symbols.',
      },
    ],
  },
  passport: {
    eyebrow: 'Custody trail',
    title: 'Every agent action leaves a travel postcard.',
    body: 'The story is intentionally physical: locked requests, tagged context, approval stamps, settlement marks, and final records. It makes invisible agent work inspectable.',
    postcards: [
      {
        label: 'Seal',
        title: 'Secure the request',
        body: 'The trip begins as a locked instruction, not a loose chat promise.',
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
        body: 'Approvals, holds, and claims stay tied to the same operational thread.',
        image: '/brand/postcards/sendero-3-03.png',
        alt: 'Sendero postcard showing a banded bundle of travel documents and a route marker.',
      },
      {
        label: 'Clear',
        title: 'Approve the itinerary',
        body: 'The agent moves only when the next irreversible action is allowed.',
        image: '/brand/postcards/sendero-3-04.png',
        alt: 'Sendero postcard showing a ticket with a plane stamp and approval check.',
      },
      {
        label: 'Settle',
        title: 'Reconcile the money',
        body: 'USDC settlement, supplier rails, fees, and invoices resolve into one trail.',
        image: '/brand/postcards/sendero-3-05.png',
        alt: 'Sendero postcard showing bank settlement, coins, a compass, and an invoice.',
      },
      {
        label: 'Deliver',
        title: 'Send the record home',
        body: 'The traveler, buyer, and agent keep the same final document state.',
        image: '/brand/postcards/sendero-3-06.png',
        alt: 'Sendero postcard showing a final travel document delivered along a coastal route.',
      },
    ],
  },
  pricing: {
    heading: 'One workspace free. Scale when you need to.',
    subheading:
      'Sendero meters per travel action — search, book, MCP. A paid plan unlocks more workspaces, discounts on nanopayments, and a lower booking take rate. Start free.',
    tiers: [
      {
        id: 'free',
        name: 'Free',
        price: '$0',
        unit: 'one workspace · sandbox only',
        description: 'Ship a prototype, test the MCP, try the agent console.',
        features: [
          '1 workspace',
          'Sandbox API key (rate-limited)',
          'Baseline nanopayment pricing',
          'Agent console + Arc testnet',
        ],
        cta: { label: 'Start free', href: '/dashboard' },
      },
      {
        id: 'basic',
        name: 'Basic',
        price: '$19',
        unit: '/mo · or $15/mo billed annually',
        description: 'Agencies and small teams running multiple brands.',
        features: [
          'Up to 5 workspaces',
          '3 production API keys',
          'WhatsApp + Slack channels',
          '15% off nanopayments · 5% off take rate',
        ],
        cta: { label: 'Upgrade to Basic', href: '/dashboard/billing/plans' },
      },
      {
        id: 'pro',
        name: 'Pro',
        price: '$60',
        unit: '/mo · or $50/mo billed annually',
        description: 'TMCs and agentic platforms at scale.',
        features: [
          'Unlimited workspaces · 25 API keys',
          'Public MCP server + custom webhooks',
          'Audit log export · priority support',
          '30% off nanopayments · 10% off take rate',
        ],
        cta: { label: 'Upgrade to Pro', href: '/dashboard/billing/plans' },
      },
      {
        id: 'enterprise',
        name: 'Enterprise',
        price: 'Custom',
        unit: 'contact sales',
        description: 'White-label, SSO/SAML, custom SLA, dedicated solution eng.',
        features: [
          'Unlimited API keys and spend',
          'SSO/SAML + audit export',
          'White-label + custom SLA',
          '50% off nanopayments · 15% off take rate',
        ],
        cta: { label: 'Talk to sales', href: 'mailto:sales@sendero.travel' },
      },
    ],
  },
  symbols: {
    eyebrow: 'Asset language',
    title: 'A stamp kit for every agent action.',
    body: 'These marks appear across product states, empty states, docs, and launch assets so Sendero can explain channel work, trust work, payment work, and travel work without stock illustrations.',
  },
  footer: {
    copyright: `© ${CURRENT_YEAR} Sendero. All rights reserved.`,
    links: FOOTER_LINKS,
  },
};

const ES_MX: MarketingContent = {
  ...EN_US,
  locale: 'es-MX',
  nav: {
    website: 'Sitio',
    app: 'App',
    pricing: 'Precios',
    agents: 'Para agentes IA',
  },
  hero: {
    eyebrow: 'Sendero en Circle Arc',
    title: 'El agente de viajes para personas, equipos y agentes de IA.',
    subtitle:
      'Sendero convierte una solicitud de viaje en un flujo coordinado: inventario real, reglas de política, escrow prepagado para invitados, emisión de PNR, liquidación en USDC sobre Arc, facturas y soporte en un mismo hilo persistente.',
    primaryCta: { label: 'Unirme a la lista', href: '#waitlist' },
    secondaryCta: { label: 'Leer llms.txt', href: '/llms.txt' },
  },
  waitlist: {
    eyebrow: 'Arc testnet activo',
    title: 'Únete a la lista de mainnet.',
    body: 'Estamos abriendo producción por etapas para agencias, empresas y builders de IA. Únete si quieres acceso temprano a presupuestos prepagados, herramientas MCP de reserva o operaciones white-label.',
  },
  routeMurals: {
    eyebrow: 'Inteligencia de ruta',
    title: 'Una solicitud se vuelve una ruta de viaje auditable.',
    body: 'Sendero mantiene intención, política, aprobaciones, inventario, escrow, acciones de proveedor, soporte y conciliación dentro del mismo registro de viaje.',
    items: EN_US.routeMurals.items.map(item => ({
      ...item,
      title:
        item.label === 'Handoff map'
          ? 'El viajero pregunta una vez. El sistema coordina cada paso.'
          : item.label === 'Trust sequence'
            ? 'Bloqueado, revisado, aprobado, emitido y liquidado.'
            : item.label === 'Operations network'
              ? 'Un grafo para trabajo de viaje, no solo mensajes.'
              : 'El viaje sigue vivo después del boleto.',
      body:
        item.label === 'Handoff map'
          ? 'El agente puede moverse entre WhatsApp, web, aprobaciones en Slack y agentes MCP sin perder el estado del viaje.'
          : item.label === 'Trust sequence'
            ? 'Cada acción irreversible tiene prueba: links de reclamo, decisiones de política, holds, confirmación y liquidación.'
            : item.label === 'Operations network'
              ? 'Reservas, aprobaciones, recibos, facturas, límites de gasto, soporte y llamadas de herramientas quedan inspeccionables.'
              : 'Sendero continúa con recordatorios, cambios, recibos, soporte, reembolsos y conciliación hasta cerrar el viaje.',
    })),
  },
  story: {
    eyebrow: 'Cuatro entradas',
    title: 'El agente aparece donde el viaje realmente empieza.',
    body: 'El viaje comienza en lugares imperfectos: WhatsApp, una mesa de agencia, una aprobación de finanzas o otro LLM. Sendero da a cada entrada el mismo motor de reserva, escrow, liquidación y soporte.',
    paths: [
      {
        ...EN_US.story.paths[0],
        eyebrow: 'Viajero individual',
        title: 'Reserva desde el hilo que ya tienes abierto.',
        body: 'El viajero inicia en WhatsApp o web, compara opciones reales, reclama un presupuesto prepagado si hace falta y conserva el mismo agente para cambios, recibos, alertas y ayuda local.',
      },
      {
        ...EN_US.story.paths[1],
        eyebrow: 'Agencia de viajes',
        title: 'Envía un link de reserva que opera como mostrador atendido.',
        body: 'La agencia conserva la relación con el cliente mientras Sendero gestiona cotización, política, hold, emisión, pago, factura y soporte.',
      },
      {
        ...EN_US.story.paths[2],
        eyebrow: 'Viaje corporativo',
        title: 'Prepaga el viaje. Mantén política y auditoría alineadas.',
        body: 'Las empresas emiten links prepagados, enrutan excepciones a Slack o Teams, limitan gasto por tenant y concilian cada acción con el viaje y la factura correcta.',
      },
      {
        ...EN_US.story.paths[3],
        eyebrow: 'Agentes de IA',
        title: 'Deja que otro agente llame al back office de viajes.',
        body: 'Los LLMs descubren Sendero con llms.txt y MCP, y llaman herramientas de búsqueda, prefunding, reserva, liquidación, reembolsos y facturación.',
      },
    ],
  },
  features: EN_US.features.map(feature => ({
    ...feature,
    title:
      feature.id === 'consumer'
        ? 'Los viajeros obtienen un agente persistente'
        : feature.id === 'agency'
          ? 'Las agencias obtienen operaciones white-label'
          : feature.id === 'corporate'
            ? 'Las empresas controlan el gasto'
            : 'Los agentes de IA obtienen herramientas de viaje',
    body:
      feature.id === 'consumer'
        ? 'Preferencias, contexto, presupuesto, fechas, recibos y cambios permanecen en la misma conversación.'
        : feature.id === 'agency'
          ? 'Trae tu WhatsApp Business y relación comercial. Sendero aporta flujo de reserva, escrow, liquidación y soporte repetitivo.'
          : feature.id === 'corporate'
            ? 'Políticas, aprobaciones, presupuestos prepagados, límites, facturas y auditoría viven dentro del viaje.'
            : 'MCP, llms.txt, llamadas con precio y workflows permiten que otros agentes deleguen acciones reales de viaje.',
  })),
  assetShowcase: {
    ...EN_US.assetShowcase,
    eyebrow: 'Sistema visual',
    title: 'Un sistema operativo de viajes debe sentirse inspeccionable.',
    body: 'Sendero usa mapas, sellos, tickets, recibos y marcas de ruta porque el producto trata sobre custodia de intención: quién pidió, quién aprobó, qué se retuvo, qué se liquidó y qué sigue abierto.',
    assets: EN_US.assetShowcase.assets.map(asset => ({
      ...asset,
      title:
        asset.id === 'agent-route-map'
          ? 'Un mapa de ruta'
          : asset.id === 'escrow-lifecycle'
            ? 'Ciclo de escrow'
            : 'Símbolos de canal y confianza',
    })),
  },
  passport: {
    ...EN_US.passport,
    eyebrow: 'Rastro de custodia',
    title: 'Cada acción del agente deja una postal de viaje.',
    body: 'La historia es física: solicitudes bloqueadas, contexto etiquetado, sellos de aprobación, marcas de liquidación y registros finales. Hace visible el trabajo del agente.',
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
    heading: 'Un workspace gratis. Escala cuando lo necesites.',
    subheading:
      'Sendero se mide por acción de viaje: búsqueda, reserva, MCP. Un plan pago desbloquea más workspaces, descuentos en nanopagos y una tarifa de reserva menor. Empieza gratis.',
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
              : `Actualizar a ${t.name}`,
      },
    })),
  },
  symbols: {
    eyebrow: 'Lenguaje de activos',
    title: 'Un kit de sellos para cada acción del agente.',
    body: 'Estas marcas aparecen en producto, documentación y lanzamiento para explicar trabajo de canal, confianza, pagos y viajes sin ilustraciones genéricas.',
  },
};

const PT_BR: MarketingContent = {
  ...EN_US,
  locale: 'pt-BR',
  nav: {
    website: 'Site',
    app: 'App',
    pricing: 'Preços',
    agents: 'Para agentes IA',
  },
  hero: {
    eyebrow: 'Sendero na Circle Arc',
    title: 'O agente de viagens para pessoas, equipes e agentes de IA.',
    subtitle:
      'A Sendero transforma um pedido de viagem em um fluxo coordenado: inventário real, regras de política, escrow pré-pago para convidados, emissão de PNR, liquidação em USDC na Arc, notas e suporte em uma mesma conversa persistente.',
    primaryCta: { label: 'Entrar na lista', href: '#waitlist' },
    secondaryCta: { label: 'Ler llms.txt', href: '/llms.txt' },
  },
  waitlist: {
    eyebrow: 'Arc testnet ativo',
    title: 'Entre na lista de lançamento mainnet.',
    body: 'Estamos abrindo produção em ondas para agências, empresas e builders de IA. Entre na lista para acessar orçamentos pré-pagos, ferramentas MCP de reserva e operações white-label.',
  },
  routeMurals: {
    eyebrow: 'Inteligência de rota',
    title: 'Um pedido vira uma rota de viagem auditável.',
    body: 'A Sendero mantém intenção, política, aprovações, inventário, escrow, ações de fornecedor, suporte e reconciliação no mesmo registro de viagem.',
    items: EN_US.routeMurals.items.map(item => ({
      ...item,
      title:
        item.label === 'Handoff map'
          ? 'O viajante pede uma vez. O sistema coordena cada passo.'
          : item.label === 'Trust sequence'
            ? 'Travado, verificado, aprovado, emitido e liquidado.'
            : item.label === 'Operations network'
              ? 'Um grafo para trabalho de viagem, não só mensagens.'
              : 'A jornada segue viva depois do bilhete.',
      body:
        item.label === 'Handoff map'
          ? 'O agente transita entre WhatsApp, web, aprovações no Slack e chamadas MCP sem perder o estado da viagem.'
          : item.label === 'Trust sequence'
            ? 'Cada ação irreversível tem prova: links de resgate, decisões de política, holds, confirmação e liquidação.'
            : item.label === 'Operations network'
              ? 'Reservas, aprovações, recibos, notas, limites, suporte e chamadas de ferramentas viram registros inspecionáveis.'
              : 'A Sendero continua com lembretes, mudanças, recibos, suporte, reembolsos e reconciliação até o fechamento da viagem.',
    })),
  },
  story: {
    eyebrow: 'Quatro entradas',
    title: 'O agente aparece onde a viagem realmente começa.',
    body: 'A viagem nasce em lugares bagunçados: WhatsApp, balcão de agência, aprovação financeira ou outro LLM. A Sendero entrega a mesma reserva, escrow, liquidação e suporte para cada entrada.',
    paths: [
      {
        ...EN_US.story.paths[0],
        eyebrow: 'Viajante individual',
        title: 'Reserve a partir da conversa que você já usa.',
        body: 'O viajante começa no WhatsApp ou web, compara opções reais, resgata um orçamento pré-pago quando necessário e mantém o mesmo agente para mudanças, recibos, alertas e ajuda local.',
      },
      {
        ...EN_US.story.paths[1],
        eyebrow: 'Agência de viagens',
        title: 'Envie um link de reserva que opera como um balcão atendido.',
        body: 'A agência mantém a relação com o cliente enquanto a Sendero executa cotação, política, hold, emissão, pagamento, nota e suporte.',
      },
      {
        ...EN_US.story.paths[2],
        eyebrow: 'Viagem corporativa',
        title: 'Pré-pague a jornada. Mantenha política e auditoria alinhadas.',
        body: 'Empresas emitem links pré-pagos, roteiam exceções para Slack ou Teams, limitam gastos por tenant e conciliam cada ação com a viagem e nota corretas.',
      },
      {
        ...EN_US.story.paths[3],
        eyebrow: 'Agentes de IA',
        title: 'Deixe outro agente chamar o back office de viagens.',
        body: 'LLMs descobrem a Sendero por llms.txt e MCP e chamam ferramentas de busca, prefunding, reserva, liquidação, reembolso e faturamento.',
      },
    ],
  },
  features: EN_US.features.map(feature => ({
    ...feature,
    title:
      feature.id === 'consumer'
        ? 'Viajantes ganham um agente persistente'
        : feature.id === 'agency'
          ? 'Agências ganham operações white-label'
          : feature.id === 'corporate'
            ? 'Empresas controlam gastos'
            : 'Agentes de IA ganham ferramentas de viagem',
    body:
      feature.id === 'consumer'
        ? 'Preferências, contexto, orçamento, datas, recibos e mudanças ficam na mesma conversa.'
        : feature.id === 'agency'
          ? 'Traga seu WhatsApp Business e a relação comercial. A Sendero entrega reserva, escrow, liquidação e automação de suporte.'
          : feature.id === 'corporate'
            ? 'Políticas, aprovações, orçamentos pré-pagos, limites, notas e auditoria vivem dentro da viagem.'
            : 'MCP, llms.txt, chamadas precificadas e workflows permitem que outros agentes deleguem ações reais de viagem.',
  })),
  assetShowcase: {
    ...EN_US.assetShowcase,
    eyebrow: 'Sistema visual',
    title: 'Um sistema operacional de viagens precisa parecer inspecionável.',
    body: 'A Sendero usa mapas, selos, bilhetes, recibos e marcas de rota porque o produto trata da custódia da intenção: quem pediu, quem aprovou, o que foi retido, o que liquidou e o que segue aberto.',
    assets: EN_US.assetShowcase.assets,
  },
  passport: {
    ...EN_US.passport,
    eyebrow: 'Trilha de custódia',
    title: 'Cada ação do agente deixa uma postal de viagem.',
    body: 'A história é física: pedidos travados, contexto etiquetado, selos de aprovação, marcas de liquidação e registros finais. O trabalho invisível do agente fica visível.',
    postcards: EN_US.passport.postcards,
  },
  pricing: {
    heading: 'Um workspace grátis. Escale quando precisar.',
    subheading:
      'A Sendero cobra por ação de viagem: busca, reserva, MCP. Um plano pago libera mais workspaces, desconto em nanopagamentos e taxa de reserva menor. Comece grátis.',
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
              : `Assinar ${t.name}`,
      },
    })),
  },
  symbols: {
    eyebrow: 'Linguagem visual',
    title: 'Um kit de selos para cada ação do agente.',
    body: 'Essas marcas aparecem no produto, na documentação e no lançamento para explicar canais, confiança, pagamentos e viagem sem ilustrações genéricas.',
  },
};

const ES_AR: MarketingContent = {
  ...ES_MX,
  locale: 'es-AR',
  hero: {
    ...ES_MX.hero,
    title: 'El agente de viajes para personas, equipos y agentes de IA.',
    subtitle:
      'Sendero convierte un pedido de viaje en un flujo coordinado: inventario real, reglas de política, escrow prepagado para invitados, emisión de PNR, liquidación en USDC sobre Arc, facturas y soporte en un mismo hilo persistente.',
    primaryCta: { label: 'Sumarme a la lista', href: '#waitlist' },
  },
  waitlist: {
    eyebrow: 'Arc testnet activo',
    title: 'Sumate a la lista de mainnet.',
    body: 'Estamos abriendo onboarding productivo por etapas para agencias, empresas y builders de IA. Sumate si querés acceso temprano a presupuestos prepagados, herramientas MCP o operaciones white-label.',
  },
  pricing: ES_MX.pricing,
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
