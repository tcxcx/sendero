import { absoluteUrl, type LlmsItem, type LlmsSection, type LlmsTxtConfig } from './next';

export type SenderoSurface = 'app' | 'marketing' | 'help' | 'docs' | 'edge';

export const defaultOrigins: Record<SenderoSurface, string> = {
  app: 'https://app.sendero.travel',
  marketing: 'https://sendero.travel',
  help: 'https://help.sendero.travel',
  docs: 'https://docs.sendero.travel',
  edge: 'https://edge.sendero.travel',
};

export const AGENT_TOOL_CATALOG: LlmsItem[] = [
  {
    label: 'search_flights',
    description: 'Search real Duffel flight inventory by route, date, cabin, and passenger count.',
  },
  {
    label: 'book_flight',
    description: 'Issue a booked itinerary and return the PNR plus metered settlement receipt.',
  },
  {
    label: 'search_hotels',
    description: 'Search lodging inventory for the trip context.',
  },
  {
    label: 'prefund_trip',
    description:
      'Create a prepaid guest escrow without storing private link fragments or claim codes.',
  },
  {
    label: 'guest_claim_link',
    description: 'Generate a traveler-safe claim link from an already prefunded escrow.',
  },
  {
    label: 'reserve_booking',
    description: 'Reserve a proposed booking against a prefunded trip budget.',
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
    label: 'check_policy',
    description: 'Evaluate a proposed trip or payment against tenant travel policy.',
  },
  {
    label: 'check_treasury',
    description: 'Read the Sendero treasury balance on Arc testnet.',
  },
  {
    label: 'gateway_balance',
    description: 'Read Circle Gateway unified USDC liquidity across supported chains.',
  },
  {
    label: 'gateway_transfer',
    description: 'Move USDC across Gateway chains with server-side treasury controls.',
  },
  {
    label: 'settle_split',
    description: 'Atomically fan out commission across supplier, agency, rail, and validator legs.',
  },
  {
    label: 'quote_fx',
    description: 'Quote indicative FX for travel spend and settlement reporting.',
  },
  {
    label: 'rate_agent',
    description: 'Read ERC-8004-style reputation and agent identity signals.',
  },
  {
    label: 'recommend_restaurants',
    description: 'Recommend in-trip restaurants from traveler context and location.',
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
  ].filter(item => !item.href?.startsWith(o[current] + '/llms.txt'));
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
          'Start with `/docs/quickstart`, then inspect `/docs/tools/overview` before calling paid tools.',
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
      agentGuidanceSection(),
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
            label: 'Sendero MCP tool catalog',
            href: '/article/mcp-tool-catalog',
            description: 'Agent-facing tool catalog explainer.',
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
            description:
              'Connect Sendero to Claude Desktop, ChatGPT Apps, Cursor, Zed, or custom MCP hosts.',
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
            label: 'Edge OpenAPI',
            href: absoluteUrl(o.edge, '/apps/openapi.json'),
            description: 'OpenAPI shim for app hosts that do not speak MCP directly.',
          },
        ],
      },
      {
        heading: 'Managed Tool Catalog',
        items: AGENT_TOOL_CATALOG,
      },
      agentGuidanceSection(),
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
      agentGuidanceSection(),
      {
        heading: 'Related llms.txt Files',
        items: crossSurfaceLinks(o, 'edge'),
      },
    ],
    notes: securityNotes,
  };
}
