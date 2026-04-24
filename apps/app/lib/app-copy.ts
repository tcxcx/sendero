import { normalizeLocale } from '@sendero/locale';

export type CtaCopy = { label: string; href: string };

export type AppHomeCopy = {
  nav: {
    llms: string;
    signIn: string;
    requestAccess: string;
  };
  hero: {
    eyebrow: string;
    title: string;
    body: string;
    primaryCta: CtaCopy;
    secondaryCta: CtaCopy;
    channels: string[];
  };
  agentLoopEyebrow: string;
  agentLoop: Array<{
    id: string;
    step: string;
    label: string;
    detail: string;
    stamp: string;
  }>;
  escrow: {
    eyebrow: string;
    title: string;
    body: string;
    primaryCta: CtaCopy;
    secondaryCta: CtaCopy;
    journey: Array<{
      label: string;
      detail: string;
      stamp: string;
      panel: string;
    }>;
  };
  segments: {
    eyebrow: string;
    body: string;
    items: Array<{ id: string; label: string; detail: string }>;
  };
  journeys: {
    eyebrow: string;
    body: string;
    items: Array<{
      id: string;
      label: string;
      detail: string;
      href: string;
      cta: string;
      stamp: string;
      panel: string;
    }>;
  };
  routeStates: {
    eyebrow: string;
    title: string;
    body: string;
    panels: Array<{ label: string; src: string }>;
  };
  assets: {
    eyebrow: string;
    body: string;
    items: Array<{
      type: 'lottie' | 'image' | 'icon';
      label: string;
      detail: string;
      src: string;
    }>;
  };
  stampAtlas: {
    eyebrow: string;
    body: string;
  };
  metering: {
    eyebrow: string;
    title: string;
    body: string;
    rows: Array<{ action: string; price: string; detail: string }>;
  };
  principles: {
    eyebrow: string;
    body: string;
    items: Array<{ id: string; label: string; detail: string }>;
  };
};

export type AppShellCopy = {
  nav: Array<{ href: string; label: string; exact?: boolean }>;
  header: {
    signIn: string;
    getStarted: string;
  };
};

export type DashboardCopy = {
  pageTitle: string;
  pageDescription: (tenantName: string) => string;
  journeyTitle: string;
  journeyDescription: string;
  agentConsole: {
    title: string;
    description: string;
    cta: string;
  };
  shortcutOpen: string;
  shortcuts: Array<{ href: string; label: string; description: string }>;
  stats: {
    activeTrips: string;
    unpaidInvoices: string;
    monthToDateSpend: string;
    openInvoices: (count: number) => string;
  };
  recentTrips: {
    title: string;
    trip: string;
    status: string;
    budget: string;
    created: string;
    empty: string;
  };
};

export type TripsCopy = {
  title: string;
  description: string;
  createCta: string;
  emptyTitle: string;
  emptyDescription: string;
};

export type InvoicesCopy = {
  title: string;
  description: string;
  emptyTitle: string;
  emptyDescription: string;
};

export type AppCopy = {
  home: AppHomeCopy;
  shell: AppShellCopy;
  dashboard: DashboardCopy;
  trips: TripsCopy;
  invoices: InvoicesCopy;
};

const symbolAtlas = [
  '01-mail-circle.png',
  '01-sendero-s.png',
  '02-chat-bubbles.png',
  '02-north-star.png',
  '03-globe-stamp.png',
  '03-group-chat.png',
  '04-courier-profile.png',
  '04-network-nodes.png',
  '05-airplane-circle.png',
  '05-shopping-bag.png',
  '06-shield.png',
  '06-speed-lines-circle.png',
  '07-compass-circle.png',
  '07-magnifier.png',
  '08-capsule-star.png',
  '08-receipt.png',
  '09-archway.png',
  '09-secure-check-shield.png',
  '10-check-circle.png',
  '10-map-pin.png',
  '11-cost-gauge.png',
  '11-ticket.png',
  '12-binoculars.png',
  '12-traveler-bag.png',
  '13-globe.png',
  '13-stacked-stones.png',
  '14-bank.png',
  '14-bird.png',
  '15-square-portrait.png',
  '15-user-tie.png',
  '16-ai-chip.png',
];

export const APP_SYMBOL_ATLAS = symbolAtlas;

const EN_US: AppCopy = {
  home: {
    nav: {
      llms: 'llms.txt',
      signIn: 'Sign in',
      requestAccess: 'Request access',
    },
    hero: {
      eyebrow: 'Agentic travel operations',
      title: 'Run every trip from one Agentic workspace.',
      body: 'Sendero is the product console for agent-native travel: launch prepaid traveler links, connect WhatsApp or Slack channels, let other LLMs call MCP tools, watch trip state, issue invoices, and settle metered actions in USDC on Arc.',
      primaryCta: { label: 'Request access', href: '/waitlist' },
      secondaryCta: { label: 'Read llms.txt', href: '/llms.txt' },
      channels: ['WhatsApp', 'Web', 'Slack', 'Teams', 'MCP', 'API'],
    },
    agentLoopEyebrow: 'Live agent loop',
    agentLoop: [
      {
        id: 'receive',
        step: '01',
        label: 'Receive the request',
        detail:
          'A traveler, operator, or calling LLM starts from WhatsApp, Slack, web, Teams, or MCP.',
        stamp: '/brand/icons/01-mail-circle.png',
      },
      {
        id: 'resolve',
        step: '02',
        label: 'Resolve the session',
        detail:
          'Sendero maps the channel thread to persistent traveler state, preferences, trips, policy, and tenant spend controls.',
        stamp: '/brand/icons/04-network-nodes.png',
      },
      {
        id: 'quote',
        step: '03',
        label: 'Search and quote',
        detail:
          'Supplier inventory is filtered in real time across flights, hotels, budgets, payment state, and policy rules.',
        stamp: '/brand/icons/07-magnifier.png',
      },
      {
        id: 'confirm',
        step: '04',
        label: 'Hold, pay, confirm',
        detail:
          'The agent holds the itinerary, spends from escrow or card rails, settles on Arc, and records the booking.',
        stamp: '/brand/icons/11-ticket.png',
      },
      {
        id: 'support',
        step: '05',
        label: 'Support the trip',
        detail:
          'The same agent handles changes, alerts, local help, expense matching, refunds, and reporting.',
        stamp: '/brand/icons/10-map-pin.png',
      },
    ],
    escrow: {
      eyebrow: 'Prepaid traveler links',
      title: 'Connect buyers and travelers with one escrow-backed claim link.',
      body: 'A buyer can prefund a trip before the traveler talks to Sendero. The traveler claims once, then the agent books, changes, settles, and refunds against that same budget across WhatsApp, Slack, web, or MCP.',
      primaryCta: { label: 'Request escrow access', href: '/waitlist' },
      secondaryCta: { label: 'Agent tool manifest', href: '/llms.txt' },
      journey: [
        {
          label: 'Buyer prefunds the trip',
          detail:
            'A company, agency, or calling agent creates a USDC budget and receives a traveler-safe claim link.',
          stamp: '/brand/icons/11-cost-gauge.png',
          panel: '/brand/panels/panel-01.png',
        },
        {
          label: 'Traveler claims once',
          detail:
            'The private claim key stays in the URL fragment. Optional 2FA uses a separate six-digit claim code.',
          stamp: '/brand/icons/09-secure-check-shield.png',
          panel: '/brand/panels/panel-02.png',
        },
        {
          label: 'Agent books against budget',
          detail:
            'Sendero reserves, commits, confirms, settles, or refunds from the same prepaid escrow record.',
          stamp: '/brand/icons/10-check-circle.png',
          panel: '/brand/panels/panel-04.png',
        },
      ],
    },
    segments: {
      eyebrow: 'Four channels, one engine',
      body: 'The dashboard is a control surface, not the whole product. The product is the agent engine that resolves sessions, applies policy, books real travel, and meters each action.',
      items: [
        {
          id: 'consumer',
          label: 'Travelers',
          detail:
            'A personal travel agent in chat that remembers preferences, budgets, receipts, and every open trip.',
        },
        {
          id: 'agency',
          label: 'Travel agencies',
          detail:
            "A white-label sub-agent on the agency's WhatsApp Business number and web channels.",
        },
        {
          id: 'corporate',
          label: 'Corporate travel',
          detail:
            'A Slack or Teams agent with policy-as-code, approvals, spend controls, and finance reporting.',
        },
        {
          id: 'agents',
          label: 'Other AI agents',
          detail:
            'A metered MCP surface and llms.txt so another LLM can search, hold, book, settle, and change travel.',
        },
      ],
    },
    journeys: {
      eyebrow: 'User journeys',
      body: 'Each channel is an adapter into the same session, policy, escrow, and metering engine. Travel logic stays centralized.',
      items: [
        {
          id: 'traveler',
          label: 'WhatsApp traveler',
          detail:
            'The traveler opens the prepaid link, claims the budget, then keeps booking and in-trip help in WhatsApp.',
          href: '/onboarding/consumer',
          cta: 'Pair WhatsApp',
          stamp: '/brand/icons/02-chat-bubbles.png',
          panel: '/brand/panels/panel-02.png',
        },
        {
          id: 'agency',
          label: 'Agency WhatsApp',
          detail:
            'An agency installs Sendero on its WhatsApp Business number and sends funded links under its own brand.',
          href: '/onboarding/agency',
          cta: 'Wire agency',
          stamp: '/brand/icons/03-group-chat.png',
          panel: '/brand/panels/panel-05.png',
        },
        {
          id: 'corporate',
          label: 'Corporate Slack',
          detail:
            'Employees request travel in Slack, managers approve in-thread, and trips draw from policy-bound escrow.',
          href: '/onboarding/corporate',
          cta: 'Install Slack',
          stamp: '/brand/icons/14-bank.png',
          panel: '/brand/panels/panel-06.png',
        },
        {
          id: 'mcp',
          label: 'MCP and API',
          detail:
            'Other agents call prefund_trip, guest_claim_link, reserve_booking, settle_booking, and invoice tools directly.',
          href: '/llms.txt',
          cta: 'Read llms.txt',
          stamp: '/brand/icons/16-ai-chip.png',
          panel: '/brand/panels/panel-03.png',
        },
      ],
    },
    routeStates: {
      eyebrow: 'Route states',
      title: 'From budget to receipt, every step has a visible state.',
      body: 'Operators should not guess what the agent did. Sendero turns invisible agent work into stamped checkpoints that can be audited, retried, refunded, and explained.',
      panels: [
        { label: 'Prefund', src: '/brand/panels/panel-01.png' },
        { label: 'Claim', src: '/brand/panels/panel-02.png' },
        { label: 'Authorize', src: '/brand/panels/panel-03.png' },
        { label: 'Confirm', src: '/brand/panels/panel-04.png' },
        { label: 'Settle', src: '/brand/panels/panel-05.png' },
        { label: 'Deliver', src: '/brand/panels/panel-06.png' },
      ],
    },
    assets: {
      eyebrow: 'Visual system',
      body: 'Custom map, receipt, and symbol art keeps the travel, escrow, and channel language legible without turning the console into a generic SaaS dashboard.',
      items: [
        {
          type: 'lottie',
          label: 'Traveler handoff',
          detail:
            'A traveler can move from WhatsApp to web to Slack while the same session stays active.',
          src: '/brand/generated/story-map-wide-b.png',
        },
        {
          type: 'image',
          label: 'Arc escrow receipt',
          detail:
            'A receipt-style product image for prefund, reserve, commit, settle, refund, and invoice states.',
          src: '/brand/generated/escrow-document-flow.png',
        },
        {
          type: 'icon',
          label: 'Operator dashboard symbols',
          detail:
            'Custom icons for policy, approvals, invoices, channel identity, spend caps, and MCP callers.',
          src: '/brand/generated/symbol-collage.png',
        },
      ],
    },
    stampAtlas: {
      eyebrow: 'Stamp atlas',
      body: 'The full Sendero icon set appears in product states, empty states, onboarding checkpoints, help docs, and agent capability labels.',
    },
    metering: {
      eyebrow: 'Nanopayments',
      title: 'Metered by action, not by seat.',
      body: 'Retries are idempotent. Every charge maps to a session, action, timestamp, and operator so agencies, companies, consumers, and calling LLMs can audit usage.',
      rows: [
        {
          action: 'Search',
          price: '$0.02',
          detail: 'per flight, hotel, or ground inventory search',
        },
        { action: 'Message', price: '$0.01', detail: 'per stateful traveler-agent exchange' },
        { action: 'Hold', price: '$0.15', detail: 'per itinerary hold or reservation lock' },
        { action: 'Booking', price: '$1.00', detail: 'per confirmed booking, plus 0.5% GMV' },
        { action: 'Context', price: '$0.05', detail: 'per MCP session context retrieval' },
      ],
    },
    principles: {
      eyebrow: 'Built to scale',
      body: 'Sendero keeps travel logic out of channel adapters, so new surfaces can be added without rewriting the booking engine.',
      items: [
        {
          id: 'agent',
          label: 'Agent-first',
          detail: 'Every product surface starts as a capability another LLM can invoke.',
        },
        {
          id: 'sessions',
          label: 'Stateful sessions',
          detail:
            'WhatsApp threads, Slack DMs, web panels, and MCP calls resolve to one traveler state.',
        },
        {
          id: 'policy',
          label: 'Policy-as-code',
          detail:
            'Rules are structured, versioned, evaluated at search and booking time, and auditable.',
        },
        {
          id: 'ledger',
          label: 'Nanopayment ledger',
          detail:
            'Every atomic action is idempotently metered to a session, timestamp, and operator.',
        },
      ],
    },
  },
  shell: {
    nav: [
      { href: '/app', label: 'Home', exact: true },
      { href: '/app/ops', label: 'Ops' },
      { href: '/app/trips', label: 'Trips' },
      { href: '/app/billing/invoices', label: 'Invoices' },
      { href: '/app/spend', label: 'Spend' },
      { href: '/app/caps', label: 'Caps' },
      { href: '/app/settings/billing', label: 'Settings' },
    ],
    header: {
      signIn: 'Sign in',
      getStarted: 'Get started',
    },
  },
  dashboard: {
    pageTitle: 'Home',
    pageDescription: tenantName => `Control workspace for ${tenantName}`,
    journeyTitle: 'Launch a traveler journey',
    journeyDescription:
      'Start with a prepaid escrow link, then route the traveler through WhatsApp, Slack, web, or MCP without changing the booking engine.',
    agentConsole: {
      title: 'Agent console',
      description:
        'Run the full Sendero workspace: quotes, booking, treasury, and org tools — same experience as main.',
      cta: 'Open agent console',
    },
    shortcutOpen: 'Open',
    shortcuts: [
      {
        href: '/app/ops',
        label: 'Ops workspace',
        description: 'Run quote, approval, service, refund, and artifact chains.',
      },
      {
        href: '/app/trips?sheet=new',
        label: 'Prepaid trip',
        description: 'Create a USDC budget and traveler claim link.',
      },
      {
        href: '/app/channels/whatsapp',
        label: 'WhatsApp agency',
        description: 'Connect a Business number for white-label travel.',
      },
      {
        href: '/app/channels/slack',
        label: 'Slack workplace',
        description: 'Install approvals and employee travel DMs.',
      },
      {
        href: '/app/integrations/mcp',
        label: 'MCP agents',
        description: 'Expose the same journey engine to other LLMs.',
      },
    ],
    stats: {
      activeTrips: 'Active trips',
      unpaidInvoices: 'Unpaid invoices',
      monthToDateSpend: 'Month-to-date spend',
      openInvoices: count => `${count} open`,
    },
    recentTrips: {
      title: 'Recent trips',
      trip: 'Trip',
      status: 'Status',
      budget: 'Budget',
      created: 'Created',
      empty: 'No trips yet.',
    },
  },
  trips: {
    title: 'Trips',
    description:
      'Create prepaid escrow links, send them to travelers, and monitor booking drawdown.',
    createCta: 'Create prepaid trip',
    emptyTitle: 'No trips yet',
    emptyDescription:
      'Create a prepaid trip, copy the claim link into WhatsApp or Slack, and let the traveler claim their Arc escrow budget.',
  },
  invoices: {
    title: 'Invoices',
    description: 'Review booking invoices, platform bills, payment status, and issued PDFs.',
    emptyTitle: 'No invoices found',
    emptyDescription: 'Invoices appear here after bookings or platform bills are issued.',
  },
};

const ES_MX: AppCopy = {
  ...EN_US,
  home: {
    ...EN_US.home,
    nav: { llms: 'llms.txt', signIn: 'Ingresar', requestAccess: 'Solicitar acceso' },
    hero: {
      ...EN_US.home.hero,
      eyebrow: 'Operaciones de viaje agentic',
      title: 'Opera cada viaje desde un solo workspace de agente.',
      body: 'Sendero es la consola de producto para viajes agent-native: crea links prepagados para viajeros, conecta WhatsApp o Slack, permite que otros LLMs llamen herramientas MCP, monitorea viajes, emite facturas y liquida acciones en USDC sobre Arc.',
      primaryCta: { label: 'Solicitar acceso', href: '/waitlist' },
      secondaryCta: { label: 'Leer llms.txt', href: '/llms.txt' },
    },
    agentLoopEyebrow: 'Loop de agente en vivo',
    agentLoop: [
      {
        ...EN_US.home.agentLoop[0],
        label: 'Recibir la solicitud',
        detail: 'Un viajero, operador o LLM inicia desde WhatsApp, Slack, web, Teams o MCP.',
      },
      {
        ...EN_US.home.agentLoop[1],
        label: 'Resolver la sesión',
        detail:
          'Sendero mapea el hilo del canal a estado persistente de viajero, preferencias, viajes, política y controles de gasto.',
      },
      {
        ...EN_US.home.agentLoop[2],
        label: 'Buscar y cotizar',
        detail:
          'El inventario de proveedores se filtra en tiempo real por vuelos, hoteles, presupuestos, estado de pago y reglas.',
      },
      {
        ...EN_US.home.agentLoop[3],
        label: 'Retener, pagar, confirmar',
        detail:
          'El agente retiene el itinerario, gasta desde escrow o tarjeta, liquida en Arc y registra la reserva.',
      },
      {
        ...EN_US.home.agentLoop[4],
        label: 'Acompañar el viaje',
        detail:
          'El mismo agente gestiona cambios, alertas, ayuda local, recibos, reembolsos y reportes.',
      },
    ],
    escrow: {
      ...EN_US.home.escrow,
      eyebrow: 'Links prepagados para viajeros',
      title: 'Conecta compradores y viajeros con un link respaldado por escrow.',
      body: 'Un comprador puede prefundear un viaje antes de que el viajero hable con Sendero. El viajero reclama una vez y el agente reserva, cambia, liquida y reembolsa contra ese presupuesto.',
      primaryCta: { label: 'Solicitar escrow', href: '/waitlist' },
      secondaryCta: { label: 'Manifiesto de herramientas', href: '/llms.txt' },
      journey: [
        {
          ...EN_US.home.escrow.journey[0],
          label: 'El comprador prefundea el viaje',
          detail: 'Una empresa, agencia o agente crea un presupuesto USDC y recibe un link seguro.',
        },
        {
          ...EN_US.home.escrow.journey[1],
          label: 'El viajero reclama una vez',
          detail:
            'La clave privada queda en el fragmento de URL. El 2FA opcional usa un código separado.',
        },
        {
          ...EN_US.home.escrow.journey[2],
          label: 'El agente reserva contra el presupuesto',
          detail: 'Sendero reserva, confirma, liquida o reembolsa desde el mismo escrow prepagado.',
        },
      ],
    },
    segments: {
      ...EN_US.home.segments,
      eyebrow: 'Cuatro canales, un motor',
      body: 'El dashboard es una superficie de control, no todo el producto. El producto es el motor de agentes que resuelve sesiones, aplica políticas, reserva viajes reales y mide cada acción.',
      items: [
        {
          ...EN_US.home.segments.items[0],
          label: 'Viajeros',
          detail:
            'Un agente personal en chat que recuerda preferencias, presupuestos, recibos y viajes abiertos.',
        },
        {
          ...EN_US.home.segments.items[1],
          label: 'Agencias de viaje',
          detail: 'Un sub-agente white-label en WhatsApp Business y canales web de la agencia.',
        },
        {
          ...EN_US.home.segments.items[2],
          label: 'Viaje corporativo',
          detail:
            'Un agente en Slack o Teams con política como código, aprobaciones, controles y reporting.',
        },
        {
          ...EN_US.home.segments.items[3],
          label: 'Otros agentes IA',
          detail:
            'Una superficie MCP medida y llms.txt para que otro LLM busque, reserve, liquide y cambie viajes.',
        },
      ],
    },
    journeys: {
      ...EN_US.home.journeys,
      eyebrow: 'Journeys de usuario',
      body: 'Cada canal es un adaptador hacia la misma sesión, política, escrow y motor de medición. La lógica de viaje queda centralizada.',
      items: [
        {
          ...EN_US.home.journeys.items[0],
          label: 'Viajero WhatsApp',
          detail:
            'El viajero abre el link prepagado, reclama presupuesto y conserva reserva y ayuda en WhatsApp.',
          cta: 'Vincular WhatsApp',
        },
        {
          ...EN_US.home.journeys.items[1],
          label: 'Agencia WhatsApp',
          detail:
            'La agencia instala Sendero en su WhatsApp Business y envía links fondeados bajo su marca.',
          cta: 'Conectar agencia',
        },
        {
          ...EN_US.home.journeys.items[2],
          label: 'Slack corporativo',
          detail:
            'Empleados piden viajes en Slack, managers aprueban en hilo y el viaje usa escrow con política.',
          cta: 'Instalar Slack',
        },
        {
          ...EN_US.home.journeys.items[3],
          label: 'MCP y API',
          detail:
            'Otros agentes llaman herramientas de prefund, claim, reserva, liquidación e invoice directamente.',
          cta: 'Leer llms.txt',
        },
      ],
    },
    routeStates: {
      ...EN_US.home.routeStates,
      eyebrow: 'Estados de ruta',
      title: 'Del presupuesto al recibo, cada paso tiene estado visible.',
      body: 'Los operadores no deberían adivinar qué hizo el agente. Sendero convierte trabajo invisible en checkpoints auditables, reintentables y explicables.',
      panels: [
        { label: 'Prefund', src: '/brand/panels/panel-01.png' },
        { label: 'Claim', src: '/brand/panels/panel-02.png' },
        { label: 'Autorizar', src: '/brand/panels/panel-03.png' },
        { label: 'Confirmar', src: '/brand/panels/panel-04.png' },
        { label: 'Liquidar', src: '/brand/panels/panel-05.png' },
        { label: 'Entregar', src: '/brand/panels/panel-06.png' },
      ],
    },
    assets: {
      ...EN_US.home.assets,
      eyebrow: 'Sistema visual',
      body: 'Mapas, recibos y símbolos propios mantienen claro el lenguaje de viaje, escrow y canales sin convertir la consola en SaaS genérico.',
      items: [
        {
          ...EN_US.home.assets.items[0],
          label: 'Handoff del viajero',
          detail: 'El viajero puede pasar de WhatsApp a web y Slack con la misma sesión activa.',
        },
        {
          ...EN_US.home.assets.items[1],
          label: 'Recibo de escrow Arc',
          detail:
            'Una imagen tipo recibo para prefund, reserva, commit, liquidación, reembolso e invoice.',
        },
        {
          ...EN_US.home.assets.items[2],
          label: 'Símbolos del dashboard',
          detail:
            'Iconos para política, aprobaciones, invoices, identidad de canal, caps y callers MCP.',
        },
      ],
    },
    stampAtlas: {
      eyebrow: 'Atlas de sellos',
      body: 'El set completo de iconos aparece en estados de producto, empty states, onboarding, ayuda y etiquetas de capacidades del agente.',
    },
    metering: {
      ...EN_US.home.metering,
      eyebrow: 'Nanopagos',
      title: 'Medido por acción, no por asiento.',
      body: 'Los reintentos son idempotentes. Cada cargo mapea a sesión, acción, timestamp y operador para auditar uso.',
      rows: [
        { action: 'Búsqueda', price: '$0.02', detail: 'por búsqueda de vuelo, hotel o transporte' },
        { action: 'Mensaje', price: '$0.01', detail: 'por intercambio stateful viajero-agente' },
        { action: 'Hold', price: '$0.15', detail: 'por retención de itinerario o reserva' },
        { action: 'Reserva', price: '$1.00', detail: 'por reserva confirmada, más 0.5% GMV' },
        { action: 'Contexto', price: '$0.05', detail: 'por recuperación de contexto MCP' },
      ],
    },
    principles: {
      ...EN_US.home.principles,
      eyebrow: 'Construido para escalar',
      body: 'Sendero mantiene la lógica de viaje fuera de los adaptadores de canal para agregar superficies sin reescribir el motor.',
      items: [
        {
          ...EN_US.home.principles.items[0],
          label: 'Agent-first',
          detail: 'Cada superficie empieza como una capacidad que otro LLM puede invocar.',
        },
        {
          ...EN_US.home.principles.items[1],
          label: 'Sesiones con estado',
          detail: 'WhatsApp, Slack, web y MCP resuelven al mismo estado de viajero.',
        },
        {
          ...EN_US.home.principles.items[2],
          label: 'Política como código',
          detail: 'Reglas estructuradas, versionadas, evaluadas al buscar y reservar.',
        },
        {
          ...EN_US.home.principles.items[3],
          label: 'Ledger de nanopagos',
          detail: 'Cada acción queda medida de forma idempotente por sesión, timestamp y operador.',
        },
      ],
    },
  },
  shell: {
    nav: [
      { href: '/app', label: 'Inicio', exact: true },
      { href: '/app/ops', label: 'Ops' },
      { href: '/app/trips', label: 'Viajes' },
      { href: '/app/billing/invoices', label: 'Facturas' },
      { href: '/app/spend', label: 'Gasto' },
      { href: '/app/caps', label: 'Límites' },
      { href: '/app/settings/billing', label: 'Ajustes' },
    ],
    header: { signIn: 'Ingresar', getStarted: 'Empezar' },
  },
  dashboard: {
    ...EN_US.dashboard,
    pageTitle: 'Inicio',
    pageDescription: tenantName => `Workspace de control para ${tenantName}`,
    journeyTitle: 'Lanzar un journey de viajero',
    journeyDescription:
      'Empieza con un link de escrow prepagado y enruta al viajero por WhatsApp, Slack, web o MCP sin cambiar el motor de reservas.',
    agentConsole: {
      title: 'Consola de agente',
      description:
        'Ejecuta el workspace completo: cotizaciones, reservas, tesorería y herramientas de org — la misma experiencia que main.',
      cta: 'Abrir consola de agente',
    },
    shortcutOpen: 'Abrir',
    shortcuts: [
      {
        href: '/app/ops',
        label: 'Workspace ops',
        description: 'Opera cotización, aprobación, soporte, reembolso y artefactos.',
      },
      {
        href: '/app/trips?sheet=new',
        label: 'Viaje prepagado',
        description: 'Crea presupuesto USDC y link de claim.',
      },
      {
        href: '/app/channels/whatsapp',
        label: 'Agencia WhatsApp',
        description: 'Conecta un número Business white-label.',
      },
      {
        href: '/app/channels/slack',
        label: 'Slack workplace',
        description: 'Instala aprobaciones y DMs de viaje.',
      },
      {
        href: '/app/integrations/mcp',
        label: 'Agentes MCP',
        description: 'Expone el journey a otros LLMs.',
      },
    ],
    stats: {
      activeTrips: 'Viajes activos',
      unpaidInvoices: 'Facturas pendientes',
      monthToDateSpend: 'Gasto del mes',
      openInvoices: count => `${count} abiertas`,
    },
    recentTrips: {
      title: 'Viajes recientes',
      trip: 'Viaje',
      status: 'Estado',
      budget: 'Presupuesto',
      created: 'Creado',
      empty: 'Todavía no hay viajes.',
    },
  },
  trips: {
    title: 'Viajes',
    description:
      'Crea links de escrow prepagados, envíalos a viajeros y monitorea el consumo de reserva.',
    createCta: 'Crear viaje prepagado',
    emptyTitle: 'Todavía no hay viajes',
    emptyDescription:
      'Crea un viaje prepagado, copia el link a WhatsApp o Slack y deja que el viajero reclame su presupuesto Arc.',
  },
  invoices: {
    title: 'Facturas',
    description:
      'Revisa facturas de reservas, bills de plataforma, estado de pago y PDFs emitidos.',
    emptyTitle: 'No se encontraron facturas',
    emptyDescription: 'Las facturas aparecerán después de emitir reservas o bills de plataforma.',
  },
};

const ES_AR: AppCopy = {
  ...ES_MX,
  home: {
    ...ES_MX.home,
    nav: { llms: 'llms.txt', signIn: 'Entrar', requestAccess: 'Pedir acceso' },
    hero: {
      ...ES_MX.home.hero,
      body: 'Sendero es la consola de producto para viajes agent-native: lanzá links prepagados para viajeros, conectá WhatsApp o Slack, dejá que otros LLMs llamen herramientas MCP, mirá el estado del viaje, emití facturas y liquidá acciones en USDC sobre Arc.',
      primaryCta: { label: 'Pedir acceso', href: '/waitlist' },
    },
    agentLoopEyebrow: 'Loop de agente en vivo',
    escrow: {
      ...ES_MX.home.escrow,
      body: 'Un comprador puede prefundear un viaje antes de que el viajero hable con Sendero. El viajero reclama una vez y el agente reserva, cambia, liquida y reembolsa contra ese presupuesto.',
      primaryCta: { label: 'Pedir acceso a escrow', href: '/waitlist' },
    },
  },
  shell: {
    ...ES_MX.shell,
    header: { signIn: 'Entrar', getStarted: 'Empezar' },
  },
  dashboard: {
    ...ES_MX.dashboard,
    journeyDescription:
      'Empezá con un link de escrow prepagado y enruta al viajero por WhatsApp, Slack, web o MCP sin cambiar el motor de reservas.',
    shortcuts: [
      {
        href: '/app/ops',
        label: 'Workspace ops',
        description: 'Operá cotización, aprobación, soporte, reembolso y artefactos.',
      },
      {
        href: '/app/trips?sheet=new',
        label: 'Viaje prepagado',
        description: 'Creá presupuesto USDC y link de claim.',
      },
      {
        href: '/app/channels/whatsapp',
        label: 'Agencia WhatsApp',
        description: 'Conectá un número Business white-label.',
      },
      {
        href: '/app/channels/slack',
        label: 'Slack workplace',
        description: 'Instalá aprobaciones y DMs de viaje.',
      },
      {
        href: '/app/integrations/mcp',
        label: 'Agentes MCP',
        description: 'Exponé el journey a otros LLMs.',
      },
    ],
  },
};

const PT_BR: AppCopy = {
  ...EN_US,
  home: {
    ...EN_US.home,
    nav: { llms: 'llms.txt', signIn: 'Entrar', requestAccess: 'Solicitar acesso' },
    hero: {
      ...EN_US.home.hero,
      eyebrow: 'Operações de viagem agentic',
      title: 'Opere cada viagem em um único workspace de agente.',
      body: 'A Sendero é a console de produto para viagens agent-native: lance links pré-pagos para viajantes, conecte WhatsApp ou Slack, permita que outros LLMs chamem ferramentas MCP, acompanhe viagens, emita notas e liquide ações em USDC na Arc.',
      primaryCta: { label: 'Solicitar acesso', href: '/waitlist' },
      secondaryCta: { label: 'Ler llms.txt', href: '/llms.txt' },
    },
    agentLoopEyebrow: 'Loop do agente ao vivo',
    agentLoop: [
      {
        ...EN_US.home.agentLoop[0],
        label: 'Receber o pedido',
        detail: 'Um viajante, operador ou LLM começa no WhatsApp, Slack, web, Teams ou MCP.',
      },
      {
        ...EN_US.home.agentLoop[1],
        label: 'Resolver a sessão',
        detail:
          'A Sendero mapeia o canal para estado persistente do viajante, preferências, viagens, política e controles de gasto.',
      },
      {
        ...EN_US.home.agentLoop[2],
        label: 'Buscar e cotar',
        detail:
          'Inventário de fornecedores é filtrado em tempo real por voos, hotéis, orçamento, pagamento e regras.',
      },
      {
        ...EN_US.home.agentLoop[3],
        label: 'Reter, pagar, confirmar',
        detail:
          'O agente segura o itinerário, gasta do escrow ou cartão, liquida na Arc e registra a reserva.',
      },
      {
        ...EN_US.home.agentLoop[4],
        label: 'Acompanhar a viagem',
        detail:
          'O mesmo agente gerencia mudanças, alertas, ajuda local, recibos, reembolsos e relatórios.',
      },
    ],
    escrow: {
      ...EN_US.home.escrow,
      eyebrow: 'Links pré-pagos para viajantes',
      title: 'Conecte compradores e viajantes com um link respaldado por escrow.',
      body: 'Um comprador pode pré-financiar uma viagem antes do viajante falar com a Sendero. O viajante resgata uma vez e o agente reserva, altera, liquida e reembolsa contra o mesmo orçamento.',
      primaryCta: { label: 'Solicitar escrow', href: '/waitlist' },
      secondaryCta: { label: 'Manifesto de ferramentas', href: '/llms.txt' },
      journey: [
        {
          ...EN_US.home.escrow.journey[0],
          label: 'Comprador pré-financia a viagem',
          detail:
            'Uma empresa, agência ou agente cria um orçamento em USDC e recebe um link seguro.',
        },
        {
          ...EN_US.home.escrow.journey[1],
          label: 'Viajante resgata uma vez',
          detail:
            'A chave privada fica no fragmento da URL. O 2FA opcional usa um código separado.',
        },
        {
          ...EN_US.home.escrow.journey[2],
          label: 'Agente reserva contra o orçamento',
          detail: 'A Sendero reserva, confirma, liquida ou reembolsa a partir do mesmo escrow.',
        },
      ],
    },
    segments: {
      ...EN_US.home.segments,
      eyebrow: 'Quatro canais, um motor',
      body: 'O dashboard é uma superfície de controle, não o produto inteiro. O produto é o motor de agentes que resolve sessões, aplica política, reserva viagens reais e mede cada ação.',
      items: [
        {
          ...EN_US.home.segments.items[0],
          label: 'Viajantes',
          detail:
            'Um agente pessoal no chat que lembra preferências, orçamento, recibos e viagens abertas.',
        },
        {
          ...EN_US.home.segments.items[1],
          label: 'Agências de viagem',
          detail: 'Um subagente white-label no WhatsApp Business e canais web da agência.',
        },
        {
          ...EN_US.home.segments.items[2],
          label: 'Viagem corporativa',
          detail:
            'Um agente em Slack ou Teams com política como código, aprovações, controles e relatórios.',
        },
        {
          ...EN_US.home.segments.items[3],
          label: 'Outros agentes IA',
          detail:
            'Uma superfície MCP medida e llms.txt para outro LLM buscar, reservar, liquidar e alterar viagens.',
        },
      ],
    },
    journeys: {
      ...EN_US.home.journeys,
      eyebrow: 'Jornadas de usuário',
      body: 'Cada canal é um adaptador para a mesma sessão, política, escrow e motor de medição. A lógica de viagem fica centralizada.',
      items: [
        {
          ...EN_US.home.journeys.items[0],
          label: 'Viajante WhatsApp',
          detail:
            'O viajante abre o link pré-pago, resgata o orçamento e continua com reserva e ajuda no WhatsApp.',
          cta: 'Conectar WhatsApp',
        },
        {
          ...EN_US.home.journeys.items[1],
          label: 'Agência WhatsApp',
          detail:
            'A agência instala Sendero no WhatsApp Business e envia links financiados sob sua marca.',
          cta: 'Conectar agência',
        },
        {
          ...EN_US.home.journeys.items[2],
          label: 'Slack corporativo',
          detail:
            'Funcionários pedem viagens no Slack, gestores aprovam no thread e a viagem usa escrow com política.',
          cta: 'Instalar Slack',
        },
        {
          ...EN_US.home.journeys.items[3],
          label: 'MCP e API',
          detail:
            'Outros agentes chamam ferramentas de prefund, claim, reserva, liquidação e invoice diretamente.',
          cta: 'Ler llms.txt',
        },
      ],
    },
    routeStates: {
      ...EN_US.home.routeStates,
      eyebrow: 'Estados da rota',
      title: 'Do orçamento ao recibo, cada passo tem estado visível.',
      body: 'Operadores não deveriam adivinhar o que o agente fez. A Sendero transforma trabalho invisível em checkpoints auditáveis, reexecutáveis e explicáveis.',
      panels: [
        { label: 'Prefund', src: '/brand/panels/panel-01.png' },
        { label: 'Claim', src: '/brand/panels/panel-02.png' },
        { label: 'Autorizar', src: '/brand/panels/panel-03.png' },
        { label: 'Confirmar', src: '/brand/panels/panel-04.png' },
        { label: 'Liquidar', src: '/brand/panels/panel-05.png' },
        { label: 'Entregar', src: '/brand/panels/panel-06.png' },
      ],
    },
    assets: {
      ...EN_US.home.assets,
      eyebrow: 'Sistema visual',
      body: 'Mapas, recibos e símbolos próprios mantêm clara a linguagem de viagem, escrow e canais sem transformar a console em SaaS genérico.',
      items: [
        {
          ...EN_US.home.assets.items[0],
          label: 'Handoff do viajante',
          detail: 'O viajante pode passar de WhatsApp para web e Slack com a mesma sessão ativa.',
        },
        {
          ...EN_US.home.assets.items[1],
          label: 'Recibo de escrow Arc',
          detail:
            'Uma imagem tipo recibo para prefund, reserva, commit, liquidação, reembolso e invoice.',
        },
        {
          ...EN_US.home.assets.items[2],
          label: 'Símbolos do dashboard',
          detail:
            'Ícones para política, aprovações, invoices, identidade de canal, caps e callers MCP.',
        },
      ],
    },
    stampAtlas: {
      eyebrow: 'Atlas de selos',
      body: 'O conjunto completo de ícones aparece em estados de produto, empty states, onboarding, ajuda e etiquetas de capacidades do agente.',
    },
    metering: {
      ...EN_US.home.metering,
      eyebrow: 'Nanopagamentos',
      title: 'Medido por ação, não por assento.',
      body: 'Retries são idempotentes. Cada cobrança mapeia para sessão, ação, timestamp e operador para auditoria.',
      rows: [
        { action: 'Busca', price: '$0.02', detail: 'por busca de voo, hotel ou transporte' },
        { action: 'Mensagem', price: '$0.01', detail: 'por troca stateful viajante-agente' },
        { action: 'Hold', price: '$0.15', detail: 'por retenção de itinerário ou reserva' },
        { action: 'Reserva', price: '$1.00', detail: 'por reserva confirmada, mais 0,5% GMV' },
        { action: 'Contexto', price: '$0.05', detail: 'por recuperação de contexto MCP' },
      ],
    },
    principles: {
      ...EN_US.home.principles,
      eyebrow: 'Construído para escalar',
      body: 'A Sendero mantém a lógica de viagem fora dos adaptadores de canal para adicionar superfícies sem reescrever o motor.',
      items: [
        {
          ...EN_US.home.principles.items[0],
          label: 'Agent-first',
          detail: 'Cada superfície começa como uma capacidade que outro LLM pode invocar.',
        },
        {
          ...EN_US.home.principles.items[1],
          label: 'Sessões com estado',
          detail: 'WhatsApp, Slack, web e MCP resolvem para o mesmo estado do viajante.',
        },
        {
          ...EN_US.home.principles.items[2],
          label: 'Política como código',
          detail: 'Regras estruturadas, versionadas, avaliadas ao buscar e reservar.',
        },
        {
          ...EN_US.home.principles.items[3],
          label: 'Ledger de nanopagamentos',
          detail: 'Cada ação é medida de forma idempotente por sessão, timestamp e operador.',
        },
      ],
    },
  },
  shell: {
    nav: [
      { href: '/app', label: 'Início', exact: true },
      { href: '/app/ops', label: 'Ops' },
      { href: '/app/trips', label: 'Viagens' },
      { href: '/app/billing/invoices', label: 'Faturas' },
      { href: '/app/spend', label: 'Gastos' },
      { href: '/app/caps', label: 'Limites' },
      { href: '/app/settings/billing', label: 'Configurações' },
    ],
    header: { signIn: 'Entrar', getStarted: 'Começar' },
  },
  dashboard: {
    ...EN_US.dashboard,
    pageTitle: 'Início',
    pageDescription: tenantName => `Workspace de controle para ${tenantName}`,
    journeyTitle: 'Lançar uma jornada de viajante',
    journeyDescription:
      'Comece com um link de escrow pré-pago e direcione o viajante por WhatsApp, Slack, web ou MCP sem trocar o motor de reservas.',
    agentConsole: {
      title: 'Console do agente',
      description:
        'Execute o workspace completo: cotações, reservas, tesouraria e ferramentas da org — a mesma experiência do main.',
      cta: 'Abrir console do agente',
    },
    shortcutOpen: 'Abrir',
    shortcuts: [
      {
        href: '/app/ops',
        label: 'Workspace ops',
        description: 'Opere cotação, aprovação, suporte, reembolso e artefatos.',
      },
      {
        href: '/app/trips?sheet=new',
        label: 'Viagem pré-paga',
        description: 'Crie orçamento USDC e link de claim.',
      },
      {
        href: '/app/channels/whatsapp',
        label: 'Agência WhatsApp',
        description: 'Conecte um número Business white-label.',
      },
      {
        href: '/app/channels/slack',
        label: 'Slack workplace',
        description: 'Instale aprovações e DMs de viagem.',
      },
      {
        href: '/app/integrations/mcp',
        label: 'Agentes MCP',
        description: 'Exponha a jornada para outros LLMs.',
      },
    ],
    stats: {
      activeTrips: 'Viagens ativas',
      unpaidInvoices: 'Faturas pendentes',
      monthToDateSpend: 'Gasto do mês',
      openInvoices: count => `${count} abertas`,
    },
    recentTrips: {
      title: 'Viagens recentes',
      trip: 'Viagem',
      status: 'Status',
      budget: 'Orçamento',
      created: 'Criado',
      empty: 'Ainda não há viagens.',
    },
  },
  trips: {
    title: 'Viagens',
    description:
      'Crie links de escrow pré-pagos, envie aos viajantes e monitore o consumo da reserva.',
    createCta: 'Criar viagem pré-paga',
    emptyTitle: 'Ainda não há viagens',
    emptyDescription:
      'Crie uma viagem pré-paga, copie o link para WhatsApp ou Slack e deixe o viajante resgatar o orçamento Arc.',
  },
  invoices: {
    title: 'Faturas',
    description:
      'Revise faturas de reservas, bills da plataforma, status de pagamento e PDFs emitidos.',
    emptyTitle: 'Nenhuma fatura encontrada',
    emptyDescription:
      'Faturas aparecerão depois de reservas ou bills da plataforma serem emitidos.',
  },
};

const APP_COPY: Record<string, AppCopy> = {
  'en-US': EN_US,
  'es-MX': ES_MX,
  'es-AR': ES_AR,
  'pt-BR': PT_BR,
};

export function getAppCopy(locale: string | null | undefined): AppCopy {
  const normalized = normalizeLocale(locale) ?? 'en-US';
  return APP_COPY[normalized] ?? EN_US;
}
