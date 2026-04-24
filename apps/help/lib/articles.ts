/**
 * Locale-aware help center content source.
 *
 * The checked-in fallback keeps every supported locale shippable without CMS
 * credentials. Production can override any locale through Basehub/JSON with
 * the same shape, so pages do not need to know where the content came from.
 */

import type { TravelGlossary } from '@sendero/locale';
import { getGlossary } from '@sendero/locale';

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

export interface HelpRouteVisual {
  label: string;
  title: string;
  body: string;
  image: string;
  alt: string;
}

export interface HelpContent {
  locale: string;
  nav: {
    website: string;
    app: string;
    agents: string;
    language: string;
  };
  hero: {
    eyebrow: string;
    title: string;
    body: string;
    imageAlt: string;
    imageCaption: string;
  };
  routeStrip: {
    ariaLabel: string;
    visuals: HelpRouteVisual[];
  };
  categories: HelpCategory[];
  articleList: {
    heading: string;
    singular: string;
    plural: string;
  };
  article: {
    home: string;
    updated: string;
  };
  articles: HelpArticle[];
}

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Array<infer U>
    ? Array<DeepPartial<U>>
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K];
};

const EN_US: HelpContent = {
  locale: 'en-US',
  nav: {
    website: 'Website',
    app: 'App',
    agents: 'For AI agents',
    language: 'Language',
  },
  hero: {
    eyebrow: 'Help center',
    title: 'How can Sendero help?',
    body: 'Documentation for travelers, agencies, corporate finance teams, and the AI agents calling Sendero via MCP.',
    imageAlt:
      'Sendero illustrated handoff map showing a traveler request routed through operators and approvals.',
    imageCaption: 'One help trail from traveler intent to operator action.',
  },
  routeStrip: {
    ariaLabel: 'Sendero support route examples',
    visuals: [
      {
        label: 'Secure request',
        title: 'Start with a protected instruction.',
        body: 'Locked context lets support, finance, and travel operations reason from the same source of truth.',
        image: '/brand/generated/trust-stamp-flow.jpg',
        alt: 'Sendero trust sequence showing secure route documents and approval stamps.',
      },
      {
        label: 'Operational graph',
        title: 'Trace the work across teams.',
        body: 'Policy, payment, inventory, traveler support, and receipts stay connected for later audit.',
        image: '/brand/generated/operations-network-map.jpg',
        alt: 'Sendero operations network map with travel and finance nodes connected by route lines.',
      },
      {
        label: 'Traveler handoff',
        title: 'Keep the destination visible.',
        body: 'The agent carries the journey through booking, reminders, support, changes, and final records.',
        image: '/brand/generated/traveler-world-panorama.jpg',
        alt: 'Sendero traveler panorama with route marks, envelopes, and destinations.',
      },
    ],
  },
  categories: [
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
  ],
  articleList: {
    heading: 'All articles',
    singular: 'article',
    plural: 'articles',
  },
  article: {
    home: 'Help',
    updated: 'Updated',
  },
  articles: [
    {
      slug: 'what-is-sendero',
      title: 'What is Sendero?',
      excerpt: 'An AI travel agent that lives where your travelers already are.',
      body: `Sendero is an agentic travel platform. Every traveler, whether a tourist chatting on WhatsApp, an employee pinging Slack, or another AI making a booking via API, gets a persistent, context-aware travel agent that searches, books, changes, and accompanies them throughout the entire trip lifecycle.

No seat fees. No SaaS license. You pay only when the agent acts.`,
      category: 'getting-started',
      updatedAt: '2026-04-20',
      locale: 'en-US',
    },
    {
      slug: 'how-booking-works',
      title: 'How a booking works',
      excerpt: 'From intent to PNR to on-chain settlement in under six seconds.',
      body: `Sendero searches real-time Duffel inventory, holds an offer, runs policy checks when needed, confirms the booking, and settles the commission fan-out on Arc in a single on-chain transaction.

The same journey record keeps the traveler request, policy decision, supplier action, escrow state, ticket confirmation, and invoice together.`,
      category: 'getting-started',
      updatedAt: '2026-04-20',
      locale: 'en-US',
    },
    {
      slug: 'clerk-legal-express-consent',
      title: 'Legal documents and express consent across Sendero',
      excerpt:
        'Canonical Terms and Privacy URLs, and how explicit consent fits web sign-up, travelers, and operators.',
      body: `Sendero’s application logic treats legal clarity as a first-class concern: bookings, escrow, settlement, traveler sessions, and operator workspaces all assume people can read the same canonical legal documents. Use Sendero’s public Terms of Service and Privacy Policy everywhere you surface policy to humans or configure integrations:
https://sendero.travel/terms
https://sendero.travel/privacy

Express consent means a deliberate action—typically a checkbox or equivalent—before someone is bound to those documents. Product and compliance expectations apply across channels (web app, linked messaging surfaces, buyer-funded trips, and API/MCP callers acting on behalf of a tenant), not only on a single vendor screen.

Whenever you add or operate a Sendero surface—linked messaging, buyer-funded trip invites, API/MCP integrations, or tenant dashboards—the same Terms and Privacy links should appear wherever a person or integration can be bound to policy, and consent should match the channel (inline link, deep link, or recorded acceptance in your tenant flow). Clerk’s “express consent to legal documents” setting below only wires that pattern into browser sign-up and Clerk’s hosted Account Portal; it does not replace aligning other entry points with Sendero’s legal baseline.

For browser-based sign-up and Clerk’s hosted Account Portal, identity and organizations are powered by Clerk. In the Clerk Dashboard → Legal, you can require “express consent to legal documents” so sign-up and the hosted Account Portal collect that acceptance against the same Sendero URLs above. That control exists only on Clerk Core 2; hosted Account Portal must be upgraded to Core 2 before it appears.

Operator reference (Clerk):
https://clerk.com/docs/guides/secure/legal-compliance
https://clerk.com/docs/guides/development/upgrading/upgrade-guides/core-2
https://clerk.com/docs/guides/development/upgrading/upgrade-guides/core-2/nextjs
https://clerk.com/docs/account-portal/overview`,
      category: 'getting-started',
      updatedAt: '2026-04-23',
      locale: 'en-US',
    },
    {
      slug: 'whatsapp-link-token',
      title: 'Linking your phone to Sendero',
      excerpt: 'A one-time code pairs your web account with WhatsApp.',
      body: `Open Sendero on the web, request a link token, then message it to the Sendero WhatsApp number. The agent matches the code to your account and every future message arrives with your preferences pre-loaded.`,
      category: 'for-consumers',
      updatedAt: '2026-04-20',
      locale: 'en-US',
    },
    {
      slug: 'prepaid-escrow-links',
      title: 'Prepaid escrow links for travelers',
      excerpt: 'Send one secure link that lets a traveler claim a funded trip budget.',
      body: `A Sendero buyer can prefund a trip before the traveler starts chatting. The buyer creates a USDC budget, Sendero returns a claim link, and the traveler opens that link from WhatsApp, Slack, email, or the web.

The private claim key stays in the URL fragment, so it never reaches Sendero servers. If 2FA is enabled, the traveler also needs the 6-digit claim code from the invite. After claim, the same agent can search, reserve, book, settle, or refund against the prepaid escrow.`,
      category: 'for-consumers',
      updatedAt: '2026-04-21',
      locale: 'en-US',
    },
    {
      slug: 'agency-whatsapp-prepaid-trips',
      title: 'Agency WhatsApp prepaid trips',
      excerpt: 'White-label Sendero on your WhatsApp Business number and send funded trips.',
      body: `Agencies connect a WhatsApp Business number, then use Sendero to issue prepaid traveler links under their own customer relationship. Each inbound WhatsApp message resolves to the same traveler session, so preferences, active trips, policy, and budget state follow the conversation.

The agency keeps its markup and operating workflow. Sendero handles the agent tool calls, Duffel inventory, escrow lifecycle, and metered settlement.`,
      category: 'for-agencies',
      updatedAt: '2026-04-21',
      locale: 'en-US',
    },
    {
      slug: 'corporate-slack-approvals',
      title: 'Slack approvals for corporate travel',
      excerpt: 'Managers approve bookings in-thread. No dashboards, no email.',
      body: `When an employee's booking exceeds your policy threshold, the approver receives a DM with the trip summary plus Approve and Reject buttons. The traveler sees the resolved decision in WhatsApp within seconds.`,
      category: 'for-corporate',
      updatedAt: '2026-04-20',
      locale: 'en-US',
    },
    {
      slug: 'mcp-tool-catalog',
      title: 'Sendero MCP tool catalog',
      excerpt:
        'Call search_flights, prefund_trip, reserve_booking, and settle_booking from any LLM.',
      body: `Sendero exposes a shared tool registry over MCP plus a capability manifest at /.well-known/llms.txt. Other agents can discover tools with tools/list, call individual tools with tools/call, or use Sendero's workflow API for complete booking flows that include escrow, policy, Duffel ticketing, settlement, and invoice generation.`,
      category: 'for-ai-agents',
      updatedAt: '2026-04-21',
      locale: 'en-US',
    },
    {
      slug: 'connect-another-agent',
      title: 'Connect another AI agent to Sendero',
      excerpt: 'Let your LLM delegate flight search, booking, escrow, and invoices to Sendero.',
      body: `Start by reading /llms.txt. Then connect to the MCP endpoint at https://edge.sendero.travel/mcp and call initialize followed by tools/list. For a real booking, prefer the sendero.book_flight workflow instead of manually chaining tools. The workflow searches Duffel, checks policy, reserves prepaid escrow, holds the offer, waits for ticketing, settles the booking, and generates the invoice.

Direct HTTP clients can call /tools/:name with x402 Payment-Signature headers. Use safe identifiers such as tenantId, userId, tripId, bookingId, and runId. Never persist guest private-link fragments, plaintext claim codes, raw card data, seed phrases, or API secrets.`,
      category: 'for-ai-agents',
      updatedAt: '2026-04-21',
      locale: 'en-US',
    },
    {
      slug: 'nanopayment-pricing',
      title: 'Nanopayment pricing, explained',
      excerpt: 'You pay only when the agent acts. Batched USDC settlement on Arc.',
      body: `Every atomic action the agent performs is individually metered. Meter events accumulate per tenant; at the end of each window, hourly by default, Sendero builds a NanopayBatch and fires a single USDC transfer on Arc.`,
      category: 'billing-and-settlement',
      updatedAt: '2026-04-20',
      locale: 'en-US',
    },
  ],
};

const ES_MX: HelpContent = {
  ...EN_US,
  locale: 'es-MX',
  nav: {
    website: 'Sitio',
    app: 'App',
    agents: 'Para agentes IA',
    language: 'Idioma',
  },
  hero: {
    eyebrow: 'Centro de ayuda',
    title: '¿Cómo puede ayudarte Sendero?',
    body: 'Documentación para viajeros, agencias, equipos financieros corporativos y agentes de IA que llaman a Sendero por MCP.',
    imageAlt:
      'Mapa ilustrado de Sendero con una solicitud de viaje pasando por operadores y aprobaciones.',
    imageCaption: 'Un recorrido de ayuda desde la intención del viajero hasta la acción operativa.',
  },
  routeStrip: {
    ariaLabel: 'Ejemplos de rutas de soporte de Sendero',
    visuals: [
      {
        ...EN_US.routeStrip.visuals[0],
        label: 'Solicitud segura',
        title: 'Empieza con una instrucción protegida.',
        body: 'El contexto bloqueado permite que soporte, finanzas y operaciones trabajen desde la misma fuente de verdad.',
        alt: 'Secuencia de confianza de Sendero con documentos de ruta seguros y sellos de aprobación.',
      },
      {
        ...EN_US.routeStrip.visuals[1],
        label: 'Grafo operativo',
        title: 'Rastrea el trabajo entre equipos.',
        body: 'Política, pago, inventario, soporte al viajero y recibos quedan conectados para auditoría.',
        alt: 'Mapa de operaciones de Sendero con nodos de viaje y finanzas conectados.',
      },
      {
        ...EN_US.routeStrip.visuals[2],
        label: 'Traspaso al viajero',
        title: 'Mantén visible el destino.',
        body: 'El agente acompaña el viaje por reserva, recordatorios, soporte, cambios y registros finales.',
        alt: 'Panorama de viajero de Sendero con marcas de ruta, sobres y destinos.',
      },
    ],
  },
  categories: [
    {
      id: 'getting-started',
      title: 'Primeros pasos',
      description: 'Qué es Sendero y cómo poner en marcha tu primer agente.',
    },
    {
      id: 'for-consumers',
      title: 'Para viajeros',
      description: 'Reserva tu próximo viaje por WhatsApp. Divide pagos. Coordina grupos.',
    },
    {
      id: 'for-agencies',
      title: 'Para agencias',
      description: 'Despliega un agente de IA white-label en tu WhatsApp Business.',
    },
    {
      id: 'for-corporate',
      title: 'Para empresas',
      description: 'Aprobaciones en Slack y Teams, reserva con política y tablero de gasto.',
    },
    {
      id: 'for-ai-agents',
      title: 'Para agentes IA (MCP)',
      description: 'Llama herramientas de Sendero desde tu LLM con MCP y llms.txt.',
    },
    {
      id: 'billing-and-settlement',
      title: 'Facturación y liquidación',
      description: 'Nanopagos, topes, liquidación USDC y exportación de facturas.',
    },
  ],
  articleList: {
    heading: 'Todos los artículos',
    singular: 'artículo',
    plural: 'artículos',
  },
  article: {
    home: 'Ayuda',
    updated: 'Actualizado',
  },
  articles: [
    {
      slug: 'what-is-sendero',
      title: '¿Qué es Sendero?',
      excerpt: 'Un agente de viajes con IA que vive donde tus viajeros ya están.',
      body: `Sendero es una plataforma de viajes agentiva. Cada viajero, ya sea un turista escribiendo por WhatsApp, un empleado en Slack u otra IA reservando por API, obtiene un agente persistente y consciente del contexto que busca, reserva, cambia y acompaña durante todo el ciclo del viaje.

Sin tarifa por usuario. Sin licencia SaaS. Pagas solo cuando el agente actúa.`,
      category: 'getting-started',
      updatedAt: '2026-04-20',
      locale: 'es-MX',
    },
    {
      slug: 'how-booking-works',
      title: 'Cómo funciona una reserva',
      excerpt: 'De intención a PNR y liquidación on-chain en menos de seis segundos.',
      body: `Sendero busca inventario Duffel en tiempo real, mantiene una oferta, ejecuta controles de política cuando corresponde, confirma la reserva y liquida la distribución de comisión en Arc con una sola transacción on-chain.

El mismo registro de viaje conserva la solicitud, la decisión de política, la acción del proveedor, el estado del escrow, la confirmación del boleto y la factura.`,
      category: 'getting-started',
      updatedAt: '2026-04-20',
      locale: 'es-MX',
    },
    {
      slug: 'clerk-legal-express-consent',
      title: 'Documentos legales y consentimiento expreso en Sendero',
      excerpt:
        'URLs canónicas de Términos y Privacidad, y cómo encaja el consentimiento explícito en web, viajeros y operadores.',
      body: `La lógica de aplicación de Sendero trata la claridad legal como parte del producto: reservas, escrow, liquidación, sesiones de viaje y workspaces de operador suponen que las personas pueden leer los mismos documentos legales canónicos. Usa los Términos de servicio y la Política de privacidad públicos de Sendero donde muestres política a personas o configures integraciones:
https://sendero.travel/terms
https://sendero.travel/privacy

El consentimiento expreso es una acción deliberada—típicamente una casilla o equivalente—antes de quedar sujeto a esos documentos. Las expectativas de producto y cumplimiento aplican a todos los canales (app web, mensajería vinculada, viajes fondeados por un comprador y llamadas API/MCP en nombre de un tenant), no solo a una pantalla de un proveedor.

Cada vez que agregues u operes una superficie de Sendero—mensajería vinculada, invitaciones de viaje fondeadas por un comprador, integraciones API/MCP o tableros de tenant—deben aparecer los mismos enlaces de Términos y Privacidad donde una persona o integración quede sujeta a política, y el consentimiento debe adecuarse al canal (enlace en línea, enlace profundo o aceptación registrada en tu flujo de tenant). La opción de consentimiento expreso a documentos legales de Clerk que se describe abajo solo integra ese patrón en el registro por navegador y en el Account Portal hospedado de Clerk; no sustituye alinear otros puntos de entrada con la línea base legal de Sendero.

Para el registro en navegador y el Account Portal hospedado de Clerk, la identidad y las organizaciones usan Clerk. En Clerk Dashboard → Legal puedes activar “Require express consent to legal documents” para que el registro y el Account Portal hospedado recojan esa aceptación contra las mismas URLs de Sendero anteriores. Esa opción existe solo en Clerk Core 2; el Account Portal hospedado debe estar en Core 2 para que aparezca.

Referencia para operadores (Clerk):
https://clerk.com/docs/guides/secure/legal-compliance
https://clerk.com/docs/guides/development/upgrading/upgrade-guides/core-2
https://clerk.com/docs/guides/development/upgrading/upgrade-guides/core-2/nextjs
https://clerk.com/docs/account-portal/overview`,
      category: 'getting-started',
      updatedAt: '2026-04-23',
      locale: 'es-MX',
    },
    {
      slug: 'whatsapp-link-token',
      title: 'Vincular tu teléfono con Sendero',
      excerpt: 'Un código de un solo uso conecta tu cuenta web con WhatsApp.',
      body: `Abre Sendero en la web, solicita un código de vinculación y envíalo al número de WhatsApp de Sendero. El agente asocia el código con tu cuenta y cada mensaje futuro llega con tus preferencias precargadas.`,
      category: 'for-consumers',
      updatedAt: '2026-04-20',
      locale: 'es-MX',
    },
    {
      slug: 'prepaid-escrow-links',
      title: 'Links de escrow prepago para viajeros',
      excerpt: 'Envía un link seguro para que un viajero reclame un presupuesto financiado.',
      body: `Un comprador de Sendero puede fondear un viaje antes de que el viajero empiece a chatear. El comprador crea un presupuesto en USDC, Sendero devuelve un link de reclamo y el viajero lo abre desde WhatsApp, Slack, email o web.

La clave privada de reclamo queda en el fragmento de la URL, así que nunca llega a los servidores de Sendero. Si el 2FA está activo, el viajero también necesita el código de 6 dígitos de la invitación. Después del reclamo, el mismo agente puede buscar, reservar, emitir, liquidar o reembolsar contra el escrow prepago.`,
      category: 'for-consumers',
      updatedAt: '2026-04-21',
      locale: 'es-MX',
    },
    {
      slug: 'agency-whatsapp-prepaid-trips',
      title: 'Viajes prepagos por WhatsApp para agencias',
      excerpt: 'Usa Sendero white-label en tu WhatsApp Business y envía viajes fondeados.',
      body: `Las agencias conectan un número de WhatsApp Business y usan Sendero para emitir links de viaje prepago bajo su propia relación con el cliente. Cada mensaje entrante se resuelve contra la misma sesión del viajero, de modo que preferencias, viajes activos, política y presupuesto siguen la conversación.

La agencia conserva su margen y flujo operativo. Sendero maneja llamadas de herramienta, inventario Duffel, ciclo de escrow y liquidación medida.`,
      category: 'for-agencies',
      updatedAt: '2026-04-21',
      locale: 'es-MX',
    },
    {
      slug: 'corporate-slack-approvals',
      title: 'Aprobaciones de viaje corporativo en Slack',
      excerpt: 'Los managers aprueban en el hilo. Sin tableros, sin email.',
      body: `Cuando la reserva de un empleado supera el umbral de política, el aprobador recibe un DM con el resumen del viaje y botones para aprobar o rechazar. El viajero ve la decisión resuelta en WhatsApp en segundos.`,
      category: 'for-corporate',
      updatedAt: '2026-04-20',
      locale: 'es-MX',
    },
    {
      slug: 'mcp-tool-catalog',
      title: 'Catálogo de herramientas MCP de Sendero',
      excerpt:
        'Llama search_flights, prefund_trip, reserve_booking y settle_booking desde cualquier LLM.',
      body: `Sendero expone un registro compartido de herramientas por MCP y un manifiesto de capacidades en /.well-known/llms.txt. Otros agentes pueden descubrir herramientas con tools/list, llamar herramientas individuales con tools/call o usar la API de workflows de Sendero para reservas completas con escrow, política, emisión Duffel, liquidación y factura.`,
      category: 'for-ai-agents',
      updatedAt: '2026-04-21',
      locale: 'es-MX',
    },
    {
      slug: 'connect-another-agent',
      title: 'Conectar otro agente de IA a Sendero',
      excerpt: 'Deja que tu LLM delegue búsqueda, reserva, escrow y facturas a Sendero.',
      body: `Empieza leyendo /llms.txt. Luego conecta al endpoint MCP en https://edge.sendero.travel/mcp y llama initialize seguido de tools/list. Para una reserva real, prefiere el workflow sendero.book_flight en lugar de encadenar herramientas manualmente. El workflow busca en Duffel, revisa política, reserva escrow prepago, mantiene la oferta, espera emisión, liquida la reserva y genera la factura.

Los clientes HTTP directos pueden llamar /tools/:name con encabezados x402 Payment-Signature. Usa identificadores seguros como tenantId, userId, tripId, bookingId y runId. Nunca persistas fragmentos privados de links de invitado, códigos de reclamo en texto plano, datos crudos de tarjeta, seed phrases o secretos de API.`,
      category: 'for-ai-agents',
      updatedAt: '2026-04-21',
      locale: 'es-MX',
    },
    {
      slug: 'nanopayment-pricing',
      title: 'Precios por nanopago, explicado',
      excerpt: 'Pagas solo cuando el agente actúa. Liquidación USDC en lote sobre Arc.',
      body: `Cada acción atómica que ejecuta el agente se mide por separado. Los eventos se acumulan por tenant; al final de cada ventana, por defecto cada hora, Sendero construye un NanopayBatch y dispara una sola transferencia USDC en Arc.`,
      category: 'billing-and-settlement',
      updatedAt: '2026-04-20',
      locale: 'es-MX',
    },
  ],
};

const ES_AR: HelpContent = {
  ...ES_MX,
  locale: 'es-AR',
  hero: {
    ...ES_MX.hero,
    title: '¿En qué puede ayudarte Sendero?',
    body: 'Documentación para viajeros, agencias, equipos financieros corporativos y agentes de IA que llaman a Sendero por MCP.',
  },
  categories: ES_MX.categories.map(category =>
    category.id === 'for-consumers'
      ? {
          ...category,
          title: 'Para viajeros',
          description: 'Reservá tu próximo viaje por WhatsApp. Dividí pagos. Coordiná grupos.',
        }
      : category
  ),
  articles: ES_MX.articles.map(article => ({
    ...article,
    locale: 'es-AR',
    title:
      article.slug === 'how-booking-works'
        ? 'Cómo funciona una reserva'
        : article.slug === 'whatsapp-link-token'
          ? 'Vincular tu teléfono con Sendero'
          : article.title,
    body:
      article.slug === 'what-is-sendero'
        ? `Sendero es una plataforma de viajes agentiva. Cada viajero, ya sea una persona escribiendo por WhatsApp, un empleado en Slack u otra IA reservando por API, obtiene un agente persistente y consciente del contexto que busca, reserva, cambia y acompaña durante todo el ciclo del viaje.

Sin tarifa por usuario. Sin licencia SaaS. Pagás solo cuando el agente actúa.`
        : article.slug === 'prepaid-escrow-links'
          ? `Un comprador de Sendero puede fondear un viaje antes de que el viajero empiece a chatear. El comprador crea un presupuesto en USDC, Sendero devuelve un link de reclamo y el viajero lo abre desde WhatsApp, Slack, email o web.

La clave privada de reclamo queda en el fragmento de la URL, así que nunca llega a los servidores de Sendero. Si el 2FA está activo, el viajero también necesita el código de 6 dígitos de la invitación. Después del reclamo, el mismo agente puede buscar, reservar, emitir, liquidar o reembolsar contra el escrow prepago.`
          : article.slug === 'agency-whatsapp-prepaid-trips'
            ? `Las agencias conectan un número de WhatsApp Business y usan Sendero para emitir links de viaje prepago bajo su propia relación con el cliente. Cada mensaje entrante se resuelve contra la misma sesión del viajero, de modo que preferencias, viajes activos, política y presupuesto siguen la conversación.

La agencia conserva su margen y flujo operativo. Sendero maneja llamadas de herramienta, inventario Duffel, ciclo de escrow y liquidación medida.`
            : article.body,
  })),
};

const PT_BR: HelpContent = {
  ...EN_US,
  locale: 'pt-BR',
  nav: {
    website: 'Site',
    app: 'App',
    agents: 'Para agentes IA',
    language: 'Idioma',
  },
  hero: {
    eyebrow: 'Central de ajuda',
    title: 'Como a Sendero pode ajudar?',
    body: 'Documentação para viajantes, agências, equipes financeiras corporativas e agentes de IA que chamam a Sendero via MCP.',
    imageAlt:
      'Mapa ilustrado da Sendero mostrando uma solicitação de viagem roteada por operadores e aprovações.',
    imageCaption: 'Uma trilha de ajuda da intenção do viajante até a ação operacional.',
  },
  routeStrip: {
    ariaLabel: 'Exemplos de rotas de suporte da Sendero',
    visuals: [
      {
        ...EN_US.routeStrip.visuals[0],
        label: 'Pedido seguro',
        title: 'Comece com uma instrução protegida.',
        body: 'O contexto bloqueado permite que suporte, finanças e operações trabalhem a partir da mesma fonte de verdade.',
        alt: 'Sequência de confiança da Sendero com documentos de rota seguros e carimbos de aprovação.',
      },
      {
        ...EN_US.routeStrip.visuals[1],
        label: 'Grafo operacional',
        title: 'Acompanhe o trabalho entre equipes.',
        body: 'Política, pagamento, inventário, suporte ao viajante e recibos ficam conectados para auditoria.',
        alt: 'Mapa operacional da Sendero com nós de viagem e finanças conectados por linhas de rota.',
      },
      {
        ...EN_US.routeStrip.visuals[2],
        label: 'Passagem ao viajante',
        title: 'Mantenha o destino visível.',
        body: 'O agente acompanha a jornada por reserva, lembretes, suporte, alterações e registros finais.',
        alt: 'Panorama de viajante da Sendero com marcas de rota, envelopes e destinos.',
      },
    ],
  },
  categories: [
    {
      id: 'getting-started',
      title: 'Primeiros passos',
      description: 'O que é a Sendero e como colocar seu primeiro agente em operação.',
    },
    {
      id: 'for-consumers',
      title: 'Para viajantes',
      description: 'Reserve sua próxima viagem pelo WhatsApp. Divida pagamentos. Coordene grupos.',
    },
    {
      id: 'for-agencies',
      title: 'Para agências',
      description: 'Implante um agente de IA white-label no seu WhatsApp Business.',
    },
    {
      id: 'for-corporate',
      title: 'Para empresas',
      description: 'Aprovações no Slack e Teams, reserva com política e painel de gastos.',
    },
    {
      id: 'for-ai-agents',
      title: 'Para agentes IA (MCP)',
      description: 'Chame ferramentas da Sendero a partir do seu LLM via MCP e llms.txt.',
    },
    {
      id: 'billing-and-settlement',
      title: 'Cobrança e liquidação',
      description: 'Nanopagamentos, limites, liquidação em USDC e exportação de faturas.',
    },
  ],
  articleList: {
    heading: 'Todos os artigos',
    singular: 'artigo',
    plural: 'artigos',
  },
  article: {
    home: 'Ajuda',
    updated: 'Atualizado',
  },
  articles: [
    {
      slug: 'what-is-sendero',
      title: 'O que é a Sendero?',
      excerpt: 'Um agente de viagens com IA que vive onde seus viajantes já estão.',
      body: `A Sendero é uma plataforma agentiva de viagens. Cada viajante, seja uma pessoa conversando no WhatsApp, um funcionário chamando pelo Slack ou outra IA reservando por API, recebe um agente persistente e consciente de contexto que pesquisa, reserva, altera e acompanha durante todo o ciclo da viagem.

Sem taxa por assento. Sem licença SaaS. Você paga somente quando o agente age.`,
      category: 'getting-started',
      updatedAt: '2026-04-20',
      locale: 'pt-BR',
    },
    {
      slug: 'how-booking-works',
      title: 'Como uma reserva funciona',
      excerpt: 'Da intenção ao PNR e à liquidação on-chain em menos de seis segundos.',
      body: `A Sendero pesquisa inventário Duffel em tempo real, segura uma oferta, executa checagens de política quando necessário, confirma a reserva e liquida a distribuição de comissão na Arc em uma única transação on-chain.

O mesmo registro de jornada mantém juntos o pedido do viajante, a decisão de política, a ação do fornecedor, o estado do escrow, a confirmação do bilhete e a fatura.`,
      category: 'getting-started',
      updatedAt: '2026-04-20',
      locale: 'pt-BR',
    },
    {
      slug: 'clerk-legal-express-consent',
      title: 'Documentos legais e consentimento expresso na Sendero',
      excerpt:
        'URLs canônicas de Termos e Privacidade, e como o consentimento explícito se encaixa na web, viajantes e operadores.',
      body: `A lógica da aplicação Sendero trata clareza jurídica como parte do produto: reservas, escrow, liquidação, sessões de viajante e workspaces de operador pressupõem que as pessoas leem os mesmos documentos legais canônicos. Use os Termos de Serviço e a Política de Privacidade públicos da Sendero onde política for mostrada a pessoas ou em integrações:
https://sendero.travel/terms
https://sendero.travel/privacy

Consentimento expresso é uma ação deliberada—normalmente uma caixa de seleção ou equivalente—antes de ficar vinculado a esses documentos. Expectativas de produto e conformidade valem em todos os canais (app web, chat vinculado, viagens financiadas por comprador e chamadas API/MCP em nome de um tenant), não só em uma tela de um fornecedor.

Sempre que você adicionar ou operar uma superfície Sendero—chat vinculado, convites de viagem financiados por comprador, integrações API/MCP ou painéis do tenant—os mesmos links de Termos e Privacidade devem aparecer onde pessoa ou integração fique vinculada à política, e o consentimento deve combinar com o canal (link embutido, deep link ou aceite registrado no fluxo do tenant). O controle “Require express consent to legal documents” da Clerk abaixo só aplica esse padrão ao cadastro no navegador e ao Account Portal hospedado da Clerk; não substitui alinhar outras entradas com a base legal da Sendero.

Para cadastro no navegador e o Account Portal hospedado da Clerk, identidade e organizações usam a Clerk. No Clerk Dashboard → Legal você pode exigir “Require express consent to legal documents” para que cadastro e Account Portal hospedado registrem essa aceitação nas mesmas URLs Sendero acima. Esse controle existe apenas no Clerk Core 2; o Account Portal hospedado precisa estar em Core 2 para aparecer.

Referência para operadores (Clerk):
https://clerk.com/docs/guides/secure/legal-compliance
https://clerk.com/docs/guides/development/upgrading/upgrade-guides/core-2
https://clerk.com/docs/guides/development/upgrading/upgrade-guides/core-2/nextjs
https://clerk.com/docs/account-portal/overview`,
      category: 'getting-started',
      updatedAt: '2026-04-23',
      locale: 'pt-BR',
    },
    {
      slug: 'whatsapp-link-token',
      title: 'Vincular seu telefone à Sendero',
      excerpt: 'Um código de uso único conecta sua conta web ao WhatsApp.',
      body: `Abra a Sendero na web, solicite um token de vínculo e envie-o para o número de WhatsApp da Sendero. O agente associa o código à sua conta e cada mensagem futura chega com suas preferências pré-carregadas.`,
      category: 'for-consumers',
      updatedAt: '2026-04-20',
      locale: 'pt-BR',
    },
    {
      slug: 'prepaid-escrow-links',
      title: 'Links de escrow pré-pago para viajantes',
      excerpt: 'Envie um link seguro para um viajante reivindicar um orçamento financiado.',
      body: `Um comprador da Sendero pode financiar uma viagem antes de o viajante começar a conversar. O comprador cria um orçamento em USDC, a Sendero devolve um link de reivindicação e o viajante abre esse link pelo WhatsApp, Slack, email ou web.

A chave privada de reivindicação fica no fragmento da URL, então nunca chega aos servidores da Sendero. Se o 2FA estiver ativo, o viajante também precisa do código de 6 dígitos do convite. Depois da reivindicação, o mesmo agente pode pesquisar, reservar, emitir, liquidar ou reembolsar contra o escrow pré-pago.`,
      category: 'for-consumers',
      updatedAt: '2026-04-21',
      locale: 'pt-BR',
    },
    {
      slug: 'agency-whatsapp-prepaid-trips',
      title: 'Viagens pré-pagas por WhatsApp para agências',
      excerpt: 'Use a Sendero white-label no seu WhatsApp Business e envie viagens financiadas.',
      body: `Agências conectam um número de WhatsApp Business e usam a Sendero para emitir links de viagem pré-paga sob sua própria relação com o cliente. Cada mensagem recebida resolve para a mesma sessão do viajante, então preferências, viagens ativas, política e orçamento acompanham a conversa.

A agência mantém sua margem e operação. A Sendero cuida das chamadas de ferramentas, inventário Duffel, ciclo de escrow e liquidação medida.`,
      category: 'for-agencies',
      updatedAt: '2026-04-21',
      locale: 'pt-BR',
    },
    {
      slug: 'corporate-slack-approvals',
      title: 'Aprovações no Slack para viagens corporativas',
      excerpt: 'Gestores aprovam no próprio thread. Sem painéis, sem email.',
      body: `Quando a reserva de um funcionário ultrapassa o limite da política, o aprovador recebe uma DM com o resumo da viagem e botões para aprovar ou rejeitar. O viajante vê a decisão resolvida no WhatsApp em segundos.`,
      category: 'for-corporate',
      updatedAt: '2026-04-20',
      locale: 'pt-BR',
    },
    {
      slug: 'mcp-tool-catalog',
      title: 'Catálogo de ferramentas MCP da Sendero',
      excerpt:
        'Chame search_flights, prefund_trip, reserve_booking e settle_booking a partir de qualquer LLM.',
      body: `A Sendero expõe um registro compartilhado de ferramentas via MCP e um manifesto de capacidades em /.well-known/llms.txt. Outros agentes podem descobrir ferramentas com tools/list, chamar ferramentas individuais com tools/call ou usar a API de workflows da Sendero para fluxos completos de reserva com escrow, política, emissão Duffel, liquidação e geração de fatura.`,
      category: 'for-ai-agents',
      updatedAt: '2026-04-21',
      locale: 'pt-BR',
    },
    {
      slug: 'connect-another-agent',
      title: 'Conectar outro agente de IA à Sendero',
      excerpt: 'Deixe seu LLM delegar busca de voos, reserva, escrow e faturas à Sendero.',
      body: `Comece lendo /llms.txt. Depois conecte ao endpoint MCP em https://edge.sendero.travel/mcp e chame initialize seguido de tools/list. Para uma reserva real, prefira o workflow sendero.book_flight em vez de encadear ferramentas manualmente. O workflow pesquisa na Duffel, checa política, reserva escrow pré-pago, segura a oferta, aguarda emissão, liquida a reserva e gera a fatura.

Clientes HTTP diretos podem chamar /tools/:name com cabeçalhos x402 Payment-Signature. Use identificadores seguros como tenantId, userId, tripId, bookingId e runId. Nunca persista fragmentos privados de links de convidado, códigos de reivindicação em texto puro, dados brutos de cartão, seed phrases ou segredos de API.`,
      category: 'for-ai-agents',
      updatedAt: '2026-04-21',
      locale: 'pt-BR',
    },
    {
      slug: 'nanopayment-pricing',
      title: 'Preço por nanopagamento, explicado',
      excerpt: 'Você paga somente quando o agente age. Liquidação USDC em lote na Arc.',
      body: `Cada ação atômica executada pelo agente é medida individualmente. Os eventos se acumulam por tenant; ao fim de cada janela, por padrão a cada hora, a Sendero cria um NanopayBatch e dispara uma única transferência USDC na Arc.`,
      category: 'billing-and-settlement',
      updatedAt: '2026-04-20',
      locale: 'pt-BR',
    },
  ],
};

const FALLBACK_CONTENT: Record<string, HelpContent> = {
  'en-US': EN_US,
  'es-MX': ES_MX,
  'es-AR': ES_AR,
  'pt-BR': PT_BR,
};

export const HELP_CATEGORIES: HelpCategory[] = EN_US.categories;

const CMS_REVALIDATE_SECONDS = 300;

export async function getHelpContent(locale: string): Promise<HelpContent> {
  const glossary: TravelGlossary = getGlossary(locale);
  const fallback = FALLBACK_CONTENT[glossary.locale] ?? FALLBACK_CONTENT['en-US'];
  const cms = await getCmsHelpContent(glossary.locale);
  return cms ? mergeHelpContent(fallback, cms) : fallback;
}

export function getFallbackHelpContent(locale: string): HelpContent {
  const glossary: TravelGlossary = getGlossary(locale);
  return FALLBACK_CONTENT[glossary.locale] ?? FALLBACK_CONTENT['en-US'];
}

export function getFallbackHelpArticleSlugs(): string[] {
  return EN_US.articles.map(article => article.slug);
}

export async function getHelpArticles(
  opts: { locale?: string; category?: HelpCategoryId } = {}
): Promise<HelpArticle[]> {
  const content = await getHelpContent(opts.locale ?? 'en-US');
  let items = content.articles;
  if (opts.category) items = items.filter(article => article.category === opts.category);
  return items;
}

export async function getHelpArticleBySlug(
  slug: string,
  locale: string
): Promise<HelpArticle | null> {
  const content = await getHelpContent(locale);
  return content.articles.find(article => article.slug === slug) ?? null;
}

async function getCmsHelpContent(locale: string): Promise<DeepPartial<HelpContent> | null> {
  const fromJson = readCmsJson(locale);
  if (fromJson) return fromJson;

  const endpoint = process.env.BASEHUB_HELP_CONTENT_URL;
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

function readCmsJson(locale: string): DeepPartial<HelpContent> | null {
  const raw = process.env.BASEHUB_HELP_CONTENT_JSON;
  if (!raw) return null;

  try {
    return normalizeCmsPayload(JSON.parse(raw), locale);
  } catch {
    return null;
  }
}

function normalizeCmsPayload(payload: unknown, locale: string): DeepPartial<HelpContent> | null {
  if (!isRecord(payload)) return null;

  const data = isRecord(payload.data) ? payload.data : null;
  const help = isRecord(payload.help) ? payload.help : null;
  const helpContent = isRecord(payload.helpContent) ? payload.helpContent : null;

  const candidates = [
    payload[locale],
    help?.[locale],
    helpContent?.[locale],
    data?.helpCenter,
    data?.helpContent,
    payload.helpCenter,
    payload.helpContent,
    payload,
  ];

  for (const candidate of candidates) {
    if (isHelpContentPartial(candidate)) return candidate;
  }

  return null;
}

function isHelpContentPartial(value: unknown): value is DeepPartial<HelpContent> {
  if (!isRecord(value)) return false;
  return (
    isRecord(value.nav) ||
    isRecord(value.hero) ||
    isRecord(value.routeStrip) ||
    Array.isArray(value.categories) ||
    Array.isArray(value.articles)
  );
}

function mergeHelpContent(fallback: HelpContent, override: DeepPartial<HelpContent>): HelpContent {
  return deepMerge(fallback, override) as HelpContent;
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
