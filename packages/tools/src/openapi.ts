/**
 * OpenAPI 3.1 export for the Sendero tool registry.
 *
 * Every tool in `toolList` becomes one POST endpoint at
 * `/api/agent/dispatch` with the tool name in the request body.  That
 * matches how the HTTP dispatch path actually works — one shape, one
 * URL, one auth boundary (Clerk API key) — and it mirrors how the MCP
 * server exposes the same tools to agent runtimes.
 *
 * The generated doc is served at `/api/openapi.json` in the app and
 * linked from the docs site, Stripe/Sherpa-style.  Scalar, Redoc,
 * Postman, and Insomnia can all consume it as-is.
 *
 * Why OpenAPI + not just the MCP tools manifest?
 *   - HTTP clients (curl, Node fetch, Go, Python requests) expect
 *     OpenAPI.  MCP is agent-native, not HTTP-native.
 *   - Scalar / Redoc render OpenAPI into a try-it-out UI.  No MCP
 *     viewer has equivalent UX today.
 *   - Sendero already exposes MCP at /api/mcp; OpenAPI is the parallel
 *     surface for non-agent integrations.
 */

import type { ToolDef } from './types';

export interface OpenApiDocInput {
  title: string;
  version: string;
  serverUrl: string;
  tools: readonly ToolDef[];
  /** Optional preamble section for the API description. Markdown OK. */
  description?: string;
}

/**
 * Build an OpenAPI 3.1 document describing every tool as a POST
 * endpoint.  The request body is `{ tool: <name>, args: <jsonSchema> }`
 * and the auth scheme is `Authorization: Bearer ak_…` (Clerk API key).
 */
export function buildOpenApiDoc(input: OpenApiDocInput): Record<string, unknown> {
  const paths: Record<string, unknown> = {};
  const schemas: Record<string, unknown> = {};

  for (const tool of input.tools) {
    const schemaName = toSchemaName(tool.name);
    schemas[schemaName] = tool.jsonSchema;

    paths[`/api/agent/dispatch#${tool.name}`] = {
      post: {
        operationId: tool.name,
        summary: summarize(tool.description),
        description: tool.description,
        tags: [categorize(tool.name)],
        security: [{ ClerkApiKey: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['tenantId', 'tool', 'args'],
                properties: {
                  tenantId: {
                    type: 'string',
                    description: "The calling tenant's id (tenant_...).",
                  },
                  userId: {
                    type: 'string',
                    description:
                      'Optional subject for the call; omitted in service-account mode (we use svc:${keyId} automatically).',
                  },
                  tool: {
                    type: 'string',
                    enum: [tool.name],
                    description: 'Must be exactly `' + tool.name + '` for this operation.',
                  },
                  args: { $ref: `#/components/schemas/${schemaName}` },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Tool executed successfully.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean' },
                    result: { type: 'object', additionalProperties: true },
                    latencyMs: { type: 'number' },
                    priceMicroUsdc: { type: 'string' },
                  },
                },
              },
            },
          },
          '401': { description: 'Missing or invalid API key.' },
          '402': { description: 'Tenant spend cap exceeded.' },
          '404': { description: 'Tool or tenant not found.' },
          '500': { description: 'Tool execution failed.' },
        },
      },
    };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: input.title,
      version: input.version,
      description:
        input.description ??
        [
          'The Sendero tool registry — a single surface for travel booking, treasury rebalancing, OCR, trip-document verification, and guest-escrow settlement.',
          '',
          '## Authentication',
          '',
          'Every call is authenticated with a Clerk-issued API key (`Authorization: Bearer ak_…`). Mint one at [`/dashboard/settings/api-keys`](https://www.sendero.travel/dashboard/settings/api-keys). Keys are tenant-scoped; the server derives both `tenantId` and the service-account `userId` from the key.',
          '',
          '## Dispatch shape',
          '',
          'Every tool is callable via `POST /api/agent/dispatch` with `{ tool, args, tenantId }` in the body. The same tools are also exposed via MCP at `/api/mcp` for agent runtimes that prefer the MCP protocol.',
          '',
          '## Pricing',
          '',
          'Each call bills a per-tool nanopayment in micro-USDC via x402. See [`packages/tools/src/pricing.ts`](https://github.com/tcxcx/sendero/blob/main/packages/tools/src/pricing.ts) for the catalog. SaaS plan tiers grant a discount on the nanopayment rate.',
        ].join('\n'),
      contact: {
        name: 'Sendero Developer Experience',
        url: 'https://docs.sendero.travel',
      },
    },
    servers: [
      { url: input.serverUrl, description: 'Production' },
      { url: 'https://preview.sendero.travel', description: 'Preview' },
    ],
    components: {
      securitySchemes: {
        ClerkApiKey: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'ak_… (Clerk-issued)',
          description:
            "Mint a production key at /dashboard/settings/api-keys. Sandbox keys are auto-issued on tenant creation and don't move real USDC.",
        },
      },
      schemas,
    },
    tags: Array.from(new Set(input.tools.map(t => categorize(t.name)))).map(name => ({ name })),
    paths,
  };
}

/** Short summary: first sentence of the description, capped. */
function summarize(description: string): string {
  const firstSentence = description.split(/(?<=\.)\s/)[0] ?? description;
  return firstSentence.length > 140 ? firstSentence.slice(0, 137) + '…' : firstSentence;
}

/**
 * Group tools into OpenAPI tags so Scalar renders a sidebar per
 * family.  Keep **letter-for-letter** in sync with `toolToScope()` in
 * @sendero/auth/dispatch-auth — drift between them means a public tag
 * disagrees with a runtime enforcement scope, which is a lie to the
 * developer.  The openapi.test.ts 'tag ↔ scope consistency' test
 * catches any drift the moment it's introduced.
 */
function categorize(toolName: string): string {
  return SCOPE_TO_TAG[scopeOf(toolName)];
}

/** Same classification tree as @sendero/auth/dispatch-auth toolToScope. */
function scopeOf(toolName: string): keyof typeof SCOPE_TO_TAG {
  if (toolName.startsWith('search_') || toolName.startsWith('find_')) return 'search';
  if (toolName.startsWith('book_') || toolName.startsWith('hold_')) return 'bookings';
  if (
    toolName === 'reserve_booking' ||
    toolName === 'commit_booking' ||
    toolName === 'prefund_trip' ||
    toolName === 'settle_booking' ||
    toolName === 'settle_split' ||
    toolName === 'guest_claim_link' ||
    toolName === 'confirm_flight' ||
    toolName.includes('cancel')
  )
    return 'settlement';
  if (
    toolName === 'check_treasury' ||
    toolName === 'swap_tokens' ||
    toolName === 'send_tokens' ||
    toolName === 'bridge_to_arc' ||
    toolName === 'swap_and_bridge' ||
    toolName === 'gateway_balance' ||
    toolName === 'gateway_transfer'
  )
    return 'treasury';
  if (toolName === 'scan_document' || toolName === 'generate_booking_invoice') return 'documents';
  if (toolName === 'check_travel_eligibility') return 'compliance';
  if (
    toolName.startsWith('airport_') ||
    toolName.startsWith('trip_') ||
    toolName === 'restaurant_route_card' ||
    toolName === 'recommend_restaurants' ||
    toolName === 'travel_safety_aid' ||
    toolName === 'elevation_risk_brief' ||
    toolName === 'air_quality_brief' ||
    toolName === 'timezone_brief' ||
    toolName === 'export_route_map' ||
    toolName === 'geocode_trip_stop' ||
    toolName === 'validate_travel_address'
  )
    return 'trip_assistance';
  return 'utilities';
}

const SCOPE_TO_TAG = {
  search: 'Search',
  bookings: 'Bookings',
  settlement: 'Settlement',
  treasury: 'Treasury',
  documents: 'Documents',
  compliance: 'Compliance',
  trip_assistance: 'Trip assistance',
  utilities: 'Utilities',
} as const;

/** `scan_document` → `ScanDocumentInput`. */
function toSchemaName(toolName: string): string {
  return (
    toolName
      .split('_')
      .map(s => s.charAt(0).toUpperCase() + s.slice(1))
      .join('') + 'Input'
  );
}
