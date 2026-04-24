import { absoluteUrl, type LlmsItem, type LlmsSection, type LlmsTxtConfig } from './next';

export type SenderoSurface = 'app' | 'marketing' | 'help' | 'docs' | 'edge';

export const defaultOrigins: Record<SenderoSurface, string> = {
  app: 'https://www.sendero.travel',
  marketing: 'https://sendero.travel',
  help: 'https://help.sendero.travel',
  docs: 'https://docs.sendero.travel',
  edge: 'https://edge.sendero.travel',
};

export const AGENT_TOOL_CATALOG: LlmsItem[] = [
  {
    label: 'check_treasury',
    description: 'Read treasury balance and policy limits.',
  },
  {
    label: 'check_policy',
    description: 'Evaluate a proposed trip or payment against tenant travel policy.',
  },
  {
    label: 'rate_agent',
    description: 'Read ERC-8004-style reputation and agent identity signals.',
  },
  {
    label: 'log_agent_action',
    description: 'Emit an on-chain breadcrumb for an agent action against a claimed trip.',
  },
  {
    label: 'faucet_drip',
    description: 'Request test assets for local or testnet demos.',
  },
  {
    label: 'quote_fx',
    description: 'Quote indicative FX for travel spend and settlement reporting.',
  },
  {
    label: 'gateway_balance',
    description: 'Read Circle Gateway unified USDC liquidity across supported chains.',
  },
  {
    label: 'guest_claim_link',
    description: 'Convert a guest claim link into claim calldata for a traveler wallet.',
  },
  {
    label: 'search_flights',
    description: 'Search real Duffel flight inventory by route, date, cabin, and passenger count.',
  },
  {
    label: 'search_hotels',
    description: 'Search lodging inventory for the trip context.',
  },
  {
    label: 'geocode_trip_stop',
    description: 'Normalize an itinerary stop into a canonical address and coordinates.',
  },
  {
    label: 'trip_weather_brief',
    description: 'Read current weather conditions for a destination or trip stop.',
  },
  {
    label: 'air_quality_brief',
    description: 'Read AQI and health recommendations for a destination or route.',
  },
  {
    label: 'validate_travel_address',
    description: 'Validate and geocode travel-critical addresses such as hotels and pickups.',
  },
  {
    label: 'timezone_brief',
    description: 'Explain time zone, offsets, and local-time context for a trip stop.',
  },
  {
    label: 'elevation_risk_brief',
    description: 'Assess elevation and altitude sensitivity for a location.',
  },
  {
    label: 'travel_safety_aid',
    description:
      'Produce a single travel safety brief that combines weather, air quality, address confidence, timezone, and elevation.',
  },
  {
    label: 'recommend_restaurants',
    description: 'Recommend in-trip restaurants from traveler context and location.',
  },
  {
    label: 'export_route_map',
    description:
      'Export routes and itineraries into Google Maps and Apple Maps links with a shareable preview card.',
  },
  {
    label: 'restaurant_route_card',
    description:
      'Shortlist restaurants and export a route from the traveler to the top pick. One canonical concierge card for web, WhatsApp, and Slack.',
  },
  {
    label: 'airport_transfer_coordinator',
    description:
      'Plan an airport-to-destination ground leg with meeting point, primary transport, backup options, and route links.',
  },
  {
    label: 'airport_arrival_playbook',
    description:
      'Produce a one-screen arrival briefing: deplane to check-in steps, primary + backup transport, local timezone, and route.',
  },
  {
    label: 'trip_checkin_reminder',
    description:
      'Build the canonical check-in nudge: check-in window, airport transit note, leave-by time, and next action. Backs the sendero.check_in_reminder workflow.',
  },
  {
    label: 'trip_delay_replanner',
    description:
      'Rebuild a disrupted itinerary: replacement flights, overnight hotel fallback, airport-to-hotel route, and a traveler-ready share card.',
  },
  {
    label: 'ensure_duffel_customer',
    description:
      'Idempotently sync the traveler with Duffel identity (CustomerUser + CustomerUserGroup) and return the icu_… id. Unlocks Travel Support Assistant for future orders.',
  },
  {
    label: 'list_flight_ancillaries',
    description:
      'Return ancillary options on a Duffel offer — bags, cancel-for-any-reason, and seat map — ready to feed back into book_flight as services[].',
  },
  {
    label: 'find_airports_nearby',
    description:
      'Find Duffel-bookable airports within a radius of a lat/lng or matching a query. Useful when the traveler names a city that has no direct airport.',
  },
  {
    label: 'display_offer_conditions',
    description:
      'Canonical render of change/refund conditions for a Duffel offer: free / penalty / allowed-unknown-fee / not allowed / unknown, plus slice-level + private_fares + airline-credit applicability.',
  },
  {
    label: 'quote_stay',
    description:
      'Turn a Duffel Stays rate into a confirmed quote. Exposes cancellation timeline, payment type (pay_now/deposit/guarantee), and supported loyalty programme.',
  },
  {
    label: 'book_stay',
    description:
      'Book a Duffel Stays quote. Supports loyalty_programme_account_number + Customer User linkage to unlock Travel Support Assistant for the guest.',
  },
  {
    label: 'cancel_order_quote',
    description:
      'Create an unconfirmed Duffel order cancellation quote. Returns refund destination (original form of payment / airline_credits / voucher) + any credits to be issued.',
  },
  {
    label: 'confirm_cancel_order',
    description:
      'Confirm a previously created Duffel cancellation quote. Must run within the quote expiry. Returns final credit_code on each airline credit issued.',
  },
  {
    label: 'list_airline_credits',
    description:
      "List a traveler's Duffel airline credits (unused tickets, MCOs, vouchers) with availability state and totals by currency. Reads a Prisma cache (hydrated by webhooks) before hitting Duffel.",
  },
  {
    label: 'manage_stays_negotiated_rate',
    description:
      'CRUD for Duffel Stays negotiated rates (corporate RACs). action: create | update | delete.',
  },
  {
    label: 'scan_document',
    description:
      'Extract structured fields from a travel or finance document (invoice, receipt, boarding pass, or ID) via the @sendero/ocr multimodal pipeline. Accepts a public URL or inline base64; returns a typed object plus provider, model, and latency.',
  },
  {
    label: 'send_tokens',
    description: 'Transfer USDC on Arc.',
  },
  {
    label: 'gateway_transfer',
    description: 'Move USDC across Gateway chains with server-side treasury controls.',
  },
  {
    label: 'prefund_trip',
    description:
      'Create a prepaid guest escrow without storing private link fragments or claim codes.',
  },
  {
    label: 'reserve_booking',
    description: 'Reserve a proposed booking against a prefunded trip budget.',
  },
  {
    label: 'commit_booking',
    description: 'Commit the actual vendor amount and release unused escrow reserve.',
  },
  {
    label: 'confirm_duffel',
    description: 'Confirm a Duffel hold and attach booking metadata for settlement.',
  },
  {
    label: 'settle_booking',
    description: 'Finalize the booking ledger and invoice-safe trip settlement state.',
  },
  {
    label: 'cancel_booking',
    description: 'Cancel an unissued or refundable booking and sweep unspent escrow.',
  },
  {
    label: 'generate_booking_invoice',
    description: 'Render invoice data and PDF output for a tenant-scoped booking.',
  },
  {
    label: 'swap_tokens',
    description: 'Swap tokens on Arc.',
  },
  {
    label: 'bridge_to_arc',
    description: 'Bridge USDC into Arc with CCTP.',
  },
  {
    label: 'book_flight',
    description: 'Hold and pay a Duffel order from prefunded balance.',
  },
  {
    label: 'swap_and_bridge',
    description: 'Bridge into Arc and swap in one composed action.',
  },
  {
    label: 'settle_split',
    description: 'Atomically fan out commission across supplier, agency, rail, and validator legs.',
  },
];

export const AGENT_WORKFLOW_CATALOG: LlmsItem[] = [
  {
    label: 'sendero.book_flight',
    description:
      'Escrow-backed flight booking workflow: search, policy, reserve, hold, ticketing pause, settle, and invoice.',
  },
  {
    label: 'sendero.travel_safety_brief',
    description:
      'Parallel travel-safety workflow: geocode, weather, air quality, timezone, elevation, and optional address validation.',
  },
  {
    label: 'sendero.guest_prefund',
    description:
      'Create a prepaid traveler budget, send a claim link, wait for claim, then book against escrow.',
  },
  {
    label: 'sendero.agency_cohort',
    description:
      'Fund a cohort of prepaid traveler links for agencies, events, bootcamps, or team travel.',
  },
  {
    label: 'sendero.group_trip',
    description:
      'Coordinate multi-traveler search, approvals, holds, and settlement for a shared itinerary.',
  },
  {
    label: 'sendero.refund_booking',
    description:
      'Cancel or refund a booked trip while preserving policy, escrow, ledger, and invoice state.',
  },
  {
    label: 'sendero.check_in_reminder',
    description:
      'Geocode origin airport, read timezone, and deliver the canonical trip check-in reminder (check-in window, transit note, leave-by) before awaiting traveler reply.',
  },
  {
    label: 'sendero.trip_delay_replanner',
    description:
      'Disruption recovery: build a rebook plan with replacement flights, optional overnight hotel, and airport route. On approval, hold the chosen flight via book_flight.',
  },
  {
    label: 'sendero.book_with_ancillaries',
    description:
      'Sell-up flow: search flights, list ancillaries, pause for selection, then hold with bags/seats/CFAR attached. Unlocks Travel Support Assistant via ensure_duffel_customer.',
  },
  {
    label: 'sendero.cancellation_recovery',
    description:
      'Post-ticket recovery on order.cancelled / airline-initiated change webhooks. Rebook via trip_delay_replanner or cancel + refund.',
  },
  {
    label: 'sendero.book_stay_with_loyalty',
    description:
      'Stays: search → pause for pick → quote (with cancellation timeline) → pause for loyalty input → book with loyalty_programme_account_number.',
  },
  {
    label: 'sendero.cancel_order_with_credits',
    description:
      'Flight cancellation: quote → pause for approval (operator sees refund destination + credits) → confirm within expiry.',
  },
];

interface SurfaceOptions {
  appOrigin?: string;
  marketingOrigin?: string;
  helpOrigin?: string;
  docsOrigin?: string;
  edgeOrigin?: string;
}

function origins(options: SurfaceOptions = {}): Record<SenderoSurface, string> {
  return {
    app: options.appOrigin ?? defaultOrigins.app,
    marketing: options.marketingOrigin ?? defaultOrigins.marketing,
    help: options.helpOrigin ?? defaultOrigins.help,
    docs: options.docsOrigin ?? defaultOrigins.docs,
    edge: options.edgeOrigin ?? defaultOrigins.edge,
  };
}

function withOrigin(origin: string, items: LlmsItem[]): LlmsItem[] {
  return items.map(item => ({
    ...item,
    href: item.href ? absoluteUrl(origin, item.href) : undefined,
  }));
}

function crossSurfaceLinks(o: Record<SenderoSurface, string>, current: SenderoSurface): LlmsItem[] {
  return [
    {
      label: 'Product app llms.txt',
      href: absoluteUrl(o.app, '/llms.txt'),
      description:
        'Authenticated buyer console, MCP endpoint, webhooks, billing, and trip operations.',
    },
    {
      label: 'Website llms.txt',
      href: absoluteUrl(o.marketing, '/llms.txt'),
      description: 'Public positioning, pricing, audiences, and launch-state guidance.',
    },
    {
      label: 'Help llms.txt',
      href: absoluteUrl(o.help, '/llms.txt'),
      description: 'Human support articles and agent-safe troubleshooting paths.',
    },
    {
      label: 'Docs llms.txt',
      href: absoluteUrl(o.docs, '/llms.txt'),
      description: 'Developer docs, MCP integration, tool catalog, and x402 nanopayment protocol.',
    },
    {
      label: 'Edge llms.txt',
      href: absoluteUrl(o.edge, '/llms.txt'),
      description: 'Direct edge worker discovery for MCP and non-UI agent surfaces.',
    },
  ].filter(item => !item.href?.startsWith(`${o[current]}/llms.txt`));
}

const securityNotes = [
  'Treat Sendero as testnet beta until the relevant tenant, Clerk organization, wallet, and invoice state prove otherwise.',
  'Do not log or persist guest private-link fragments, plaintext claim codes, Clerk secrets, Circle secrets, webhook secrets, or user travel documents.',
  'Paid or on-chain tools must be idempotent. Reuse caller-supplied idempotency keys when present.',
  'Use tenant-scoped routes and Clerk organization context for buyer data. Never infer tenant access from an email domain alone.',
];

function productSection(): LlmsSection {
  return {
    heading: 'Product',
    body: 'Sendero is an agent-native travel platform. It gives every trip a persistent AI agent that can search, book, invoice, and settle travel flows over WhatsApp, Slack, email, web, and MCP.',
    items: [
      {
        label: 'Core network',
        description:
          'Circle Arc testnet with USDC-denominated settlement and Circle Gateway liquidity.',
      },
      {
        label: 'Inventory',
        description: 'Duffel flight booking and travel inventory integrations.',
      },
      {
        label: 'Buyer model',
        description:
          'Clerk organizations map to tenant-scoped wallets, invoices, trips, spend caps, and branding.',
      },
    ],
  };
}

function agentGuidanceSection(): LlmsSection {
  return {
    heading: 'Agent Guidance',
    items: [
      {
        label: 'Best first read',
        description:
          'Start with `/docs/quickstart`, then `/docs/agent-to-agent-booking`, then inspect `/docs/tools/overview` before calling paid tools.',
      },
      {
        label: 'Payment model',
        description:
          'Tool calls are metered in USDC. Failed tool execution should not capture payment.',
      },
      {
        label: 'User consent',
        description:
          'Ask the traveler before booking, paying, cancelling, or changing irreversible itinerary state.',
      },
      {
        label: 'Data minimization',
        description:
          'Persist itinerary metadata and receipts, not private invite fragments or plaintext secrets.',
      },
    ],
  };
}

function seoDiscoverySection(
  o: Record<SenderoSurface, string>,
  current: SenderoSurface
): LlmsSection {
  const currentOrigin = o[current];
  const publicAssetOrigin = current === 'edge' ? o.marketing : currentOrigin;
  const crawlOrigin = current === 'edge' ? o.marketing : currentOrigin;

  return {
    heading: 'SEO And AI Discovery',
    body: 'Crawler-safe discovery files and social preview assets for search engines, AI answer engines, and agent hosts.',
    items: [
      {
        label: 'Canonical llms.txt',
        href: absoluteUrl(currentOrigin, '/llms.txt'),
        description: 'Primary machine-readable summary for this Sendero surface.',
      },
      {
        label: 'Well-known llms.txt',
        href: absoluteUrl(currentOrigin, '/.well-known/llms.txt'),
        description: 'Standards-friendly alias for agent discovery.',
      },
      {
        label: current === 'edge' ? 'Website robots.txt' : 'Robots.txt',
        href: absoluteUrl(crawlOrigin, '/robots.txt'),
        description: 'Crawler policy with explicit LLM crawler allowances.',
      },
      {
        label: current === 'edge' ? 'Website sitemap.xml' : 'Sitemap.xml',
        href: absoluteUrl(crawlOrigin, '/sitemap.xml'),
        description: 'Canonical URLs, locale alternates, and public agent-discovery routes.',
      },
      {
        label: 'Open Graph image',
        href: absoluteUrl(publicAssetOrigin, '/brand/seo/open-graph-1200x630.png'),
        description: '1200x630 Sendero preview canvas for social sharing and link unfurls.',
      },
      {
        label: 'Google Discover image',
        href: absoluteUrl(publicAssetOrigin, '/brand/seo/google-discover-1600x900.png'),
        description: 'Large image asset eligible for rich search previews.',
      },
      {
        label: 'Schema logo',
        href: absoluteUrl(publicAssetOrigin, '/brand/seo/schema-logo-512.png'),
        description: '512x512 organization logo referenced by structured data.',
      },
    ],
  };
}

export function buildSenderoAppLlms(options: SurfaceOptions = {}): LlmsTxtConfig {
  const o = origins(options);
  return {
    title: 'Sendero App',
    summary:
      'Authenticated buyer and agent operations for Sendero: trips, invoices, MCP tools, tenant billing, webhooks, and Arc testnet settlement.',
    canonicalUrl: absoluteUrl(o.app, '/llms.txt'),
    sections: [
      productSection(),
      {
        heading: 'Primary Routes',
        items: withOrigin(o.app, [
          { label: 'Buyer dashboard', href: '/app', description: 'Protected tenant overview.' },
          { label: 'Trips', href: '/app/trips', description: 'Tenant trip list and detail pages.' },
          {
            label: 'Invoices',
            href: '/app/billing/invoices',
            description: 'Tenant invoice list, details, and authenticated PDF downloads.',
          },
          {
            label: 'Spend',
            href: '/app/spend',
            description: 'Spend dashboard and invoice rollups.',
          },
          { label: 'Caps', href: '/app/caps', description: 'Tenant spend and policy cap editor.' },
          {
            label: 'Settings',
            href: '/app/settings',
            description: 'Billing, branding, profile, and organization settings.',
          },
        ]),
      },
      {
        heading: 'Agent And API Entry Points',
        items: withOrigin(o.app, [
          {
            label: 'MCP endpoint',
            href: '/api/mcp',
            description:
              'Streamable HTTP MCP endpoint. Use JSON-RPC `initialize`, `tools/list`, and `tools/call`.',
          },
          {
            label: 'Agent runtime',
            href: '/api/agent/runtime',
            description: 'Live model and tool runtime catalog.',
          },
          {
            label: 'Agent identity',
            href: '/api/agent/identity',
            description: 'Public identity and reputation signals for the Sendero agent.',
          },
          {
            label: 'Treasury balance',
            href: '/api/treasury/balance',
            description: 'Arc testnet treasury balances.',
          },
          {
            label: 'Gateway balance',
            href: '/api/gateway/balance',
            description: 'Circle Gateway unified USDC balance.',
          },
          {
            label: 'Health check',
            href: '/api/health',
            description: 'Subsystem readiness, environment, webhook, and integration health.',
          },
        ]),
      },
      {
        heading: 'Inbound Webhooks',
        items: withOrigin(o.app, [
          {
            label: 'Clerk webhook',
            href: '/api/webhooks/clerk',
            description:
              'User, organization, and membership provisioning events. Verify with Clerk Svix headers.',
          },
          {
            label: 'Duffel webhook',
            href: '/api/webhooks/duffel',
            description:
              'Booking and provider state changes. Verify with Duffel webhook signature.',
          },
          {
            label: 'Resend webhook',
            href: '/api/webhooks/resend',
            description:
              'email.sent, email.delivered, email.bounced, and email.received events. Verify with Svix.',
          },
          {
            label: 'WhatsApp webhook',
            href: '/api/webhooks/whatsapp',
            description: 'Meta Cloud API inbound messages and status callbacks.',
          },
          {
            label: 'Slack events',
            href: '/api/webhooks/slack/events',
            description: 'Slack event delivery for corporate travel workflows.',
          },
        ]),
      },
      {
        heading: 'Managed Tool Catalog',
        body: 'The current tool registry is larger than the original hackathon list. Prefer `tools/list` from the MCP endpoint when exact JSON schemas are required.',
        items: AGENT_TOOL_CATALOG,
      },
      {
        heading: 'Managed Workflow Catalog',
        body: 'Workflows are named plans for agents that want Sendero to orchestrate multiple tool calls, external pauses, escrow transitions, and invoice generation.',
        items: AGENT_WORKFLOW_CATALOG,
      },
      agentGuidanceSection(),
      seoDiscoverySection(o, 'app'),
      {
        heading: 'Related Surfaces',
        items: crossSurfaceLinks(o, 'app'),
      },
    ],
    notes: securityNotes,
  };
}

export function buildSenderoMarketingLlms(options: SurfaceOptions = {}): LlmsTxtConfig {
  const o = origins(options);
  return {
    title: 'Sendero',
    summary:
      'Public product context for Sendero, the agent-native travel platform for travelers, agencies, corporate teams, and other AI agents.',
    canonicalUrl: absoluteUrl(o.marketing, '/llms.txt'),
    sections: [
      productSection(),
      {
        heading: 'Audience Routes',
        items: withOrigin(o.marketing, [
          {
            label: 'Home',
            href: '/',
            description: 'Current product positioning and waitlist entry.',
          },
          {
            label: 'For AI agents',
            href: '/for-agents',
            description: 'Agent and MCP positioning when live.',
          },
          {
            label: 'For agencies',
            href: '/for-agencies',
            description: 'White-label travel agency deployment path.',
          },
          {
            label: 'For corporate',
            href: '/for-corporate',
            description: 'Slack, policy, approvals, and CFO spend workflows.',
          },
          {
            label: 'Pricing',
            href: '/pricing',
            description: 'Nanopayment and tenant pricing model.',
          },
        ]),
      },
      {
        heading: 'Launch State',
        items: [
          {
            label: 'Testnet beta',
            description:
              'The product currently runs against Arc testnet and sandbox/provider test credentials.',
          },
          {
            label: 'Waitlist first',
            description:
              'Humans should join the waitlist for mainnet launch and production onboarding.',
          },
          {
            label: 'Agent integration',
            description:
              'Agents should read docs and MCP manifests before attempting paid booking or settlement flows.',
          },
        ],
      },
      {
        heading: 'High-Intent Links',
        items: [
          {
            label: 'App',
            href: o.app,
            description: 'Sign in, create trips, manage invoices, and configure tenant settings.',
          },
          {
            label: 'Docs',
            href: o.docs,
            description: 'Developer quickstart, x402 payment flow, and tool catalog.',
          },
          {
            label: 'Help',
            href: o.help,
            description:
              'Support articles for travelers, agencies, corporate teams, and AI agents.',
          },
          {
            label: 'Edge MCP',
            href: absoluteUrl(o.edge, '/mcp'),
            description: 'Direct agent-facing MCP surface.',
          },
        ],
      },
      agentGuidanceSection(),
      seoDiscoverySection(o, 'marketing'),
      {
        heading: 'Related llms.txt Files',
        items: crossSurfaceLinks(o, 'marketing'),
      },
    ],
    notes: securityNotes,
  };
}

export function buildSenderoHelpLlms(options: SurfaceOptions = {}): LlmsTxtConfig {
  const o = origins(options);
  return {
    title: 'Sendero Help',
    summary:
      'Support context for Sendero travelers, agencies, corporate teams, and AI agents. Use this surface for troubleshooting and non-secret operational guidance.',
    canonicalUrl: absoluteUrl(o.help, '/llms.txt'),
    sections: [
      productSection(),
      {
        heading: 'Help Categories',
        items: withOrigin(o.help, [
          {
            label: 'All help articles',
            href: '/',
            description: 'Human-readable help center index.',
          },
          {
            label: 'What is Sendero?',
            href: '/article/what-is-sendero',
            description: 'Product overview and core use cases.',
          },
          {
            label: 'How booking works',
            href: '/article/how-booking-works',
            description: 'Intent to PNR to settlement overview.',
          },
          {
            label: 'Legal documents and express consent',
            href: '/article/clerk-legal-express-consent',
            description:
              'Sendero-wide Terms/Privacy and consent on every surface; Clerk Dashboard only configures browser sign-up and hosted Account Portal (Core 2).',
          },
          {
            label: 'Sendero MCP tool catalog',
            href: '/article/mcp-tool-catalog',
            description: 'Agent-facing tool catalog explainer.',
          },
          {
            label: 'Connect another AI agent',
            href: '/article/connect-another-agent',
            description: 'Delegated booking, escrow, MCP, workflow, and invoice guidance.',
          },
          {
            label: 'Nanopayment pricing',
            href: '/article/nanopayment-pricing',
            description: 'USDC metering, caps, and settlement explanation.',
          },
        ]),
      },
      {
        heading: 'Support Boundaries',
        items: [
          {
            label: 'Do not expose secrets',
            description:
              'Never paste webhook secrets, Clerk secret keys, Circle API keys, or traveler documents into support chat.',
          },
          {
            label: 'Escalate paid operations',
            description:
              'Bookings, cancellations, refunds, and settlement retries require authenticated app context.',
          },
          {
            label: 'Use IDs, not fragments',
            description:
              'Reference trips, invoices, and tenants by safe IDs. Do not share private guest link fragments.',
          },
        ],
      },
      agentGuidanceSection(),
      seoDiscoverySection(o, 'help'),
      {
        heading: 'Related llms.txt Files',
        items: crossSurfaceLinks(o, 'help'),
      },
    ],
    notes: securityNotes,
  };
}

export function buildSenderoDocsLlms(options: SurfaceOptions = {}): LlmsTxtConfig {
  const o = origins(options);
  return {
    title: 'Sendero Developer Docs',
    summary:
      'Developer documentation for Sendero MCP tools, x402 nanopayments, Arc settlement, and agent integration paths.',
    canonicalUrl: absoluteUrl(o.docs, '/llms.txt'),
    sections: [
      productSection(),
      {
        heading: 'Read In Order',
        items: withOrigin(o.docs, [
          {
            label: 'Welcome',
            href: '/docs',
            description: 'What Sendero is and what agents can build.',
          },
          {
            label: 'Quickstart',
            href: '/docs/quickstart',
            description: 'Get an API key, fund a wallet, and call the first tool.',
          },
          {
            label: 'Agent-to-agent booking',
            href: '/docs/agent-to-agent-booking',
            description:
              'How another AI agent delegates search, escrow, booking, settlement, and invoices to Sendero.',
          },
          {
            label: 'Tool catalog',
            href: '/docs/tools/overview',
            description: 'Every tool, per-call USDC price, and tool envelope.',
          },
          {
            label: 'x402 nanopayments',
            href: '/docs/x402-nanopayments',
            description:
              'How payment-required responses and EIP-3009 signatures become paid tool calls.',
          },
          {
            label: 'MCP integration',
            href: '/docs/mcp-integration',
            description: 'Connect Sendero to Claude Desktop, Cursor, Zed, or custom MCP hosts.',
          },
        ]),
      },
      {
        heading: 'Canonical Agent Endpoints',
        items: [
          {
            label: 'Edge MCP',
            href: absoluteUrl(o.edge, '/mcp'),
            description: 'Primary non-UI MCP endpoint for agent hosts.',
          },
          {
            label: 'App MCP',
            href: absoluteUrl(o.app, '/api/mcp'),
            description: 'Next.js app-hosted MCP endpoint for local and buyer-console flows.',
          },
          {
            label: 'Paid HTTP tools',
            href: absoluteUrl(o.edge, '/tools'),
            description: 'x402-gated direct HTTP tool catalog for hosts that do not speak MCP.',
          },
        ],
      },
      {
        heading: 'Managed Tool Catalog',
        items: AGENT_TOOL_CATALOG,
      },
      {
        heading: 'Managed Workflow Catalog',
        items: AGENT_WORKFLOW_CATALOG,
      },
      agentGuidanceSection(),
      seoDiscoverySection(o, 'docs'),
      {
        heading: 'Related llms.txt Files',
        items: crossSurfaceLinks(o, 'docs'),
      },
    ],
    notes: securityNotes,
  };
}

export function buildSenderoEdgeLlms(options: SurfaceOptions = {}): LlmsTxtConfig {
  const o = origins(options);
  return {
    title: 'Sendero Edge',
    summary:
      'Direct agent surface for Sendero MCP tools, channel webhooks, paid tool calls, and non-UI integrations.',
    canonicalUrl: absoluteUrl(o.edge, '/llms.txt'),
    sections: [
      productSection(),
      {
        heading: 'Edge Routes',
        items: withOrigin(o.edge, [
          {
            label: 'Health and manifest',
            href: '/',
            description: 'Surface manifest and tool count.',
          },
          { label: 'MCP', href: '/mcp', description: 'Primary Streamable HTTP MCP endpoint.' },
          { label: 'WhatsApp', href: '/whatsapp', description: 'Meta Cloud API webhook adapter.' },
          { label: 'Slack', href: '/slack', description: 'Slack adapter surface.' },
          { label: 'Discord', href: '/discord', description: 'Discord interactions adapter.' },
          { label: 'Tools', href: '/tools', description: 'Paid tool adapter surface.' },
        ]),
      },
      {
        heading: 'Managed Tool Catalog',
        items: AGENT_TOOL_CATALOG,
      },
      {
        heading: 'Managed Workflow Catalog',
        items: AGENT_WORKFLOW_CATALOG,
      },
      agentGuidanceSection(),
      seoDiscoverySection(o, 'edge'),
      {
        heading: 'Related llms.txt Files',
        items: crossSurfaceLinks(o, 'edge'),
      },
    ],
    notes: securityNotes,
  };
}
