/**
 * POST /api/tools/[name]
 *
 * Single-tool execution endpoint. Sendero's canonical tool catalog
 * exposed as a thin HTTP surface so external agent runtimes (Kapso
 * workflow agent nodes, MCP clients on other channels) can call the
 * same tools the in-app agent uses, without duplicating logic.
 *
 * Architecture (path B — the hybrid):
 *   - Kapso runtime owns the WhatsApp conversation (durability,
 *     pause/resume, presence, conversation memory — all free).
 *   - Sendero owns the tool catalog, share-card render, on-chain
 *     settlement, tenant boundaries — what we're uniquely good at.
 *   - Kapso's agent node calls a thin Cloudflare proxy function
 *     which forwards to this endpoint with the tenant API key.
 *
 * Auth: `X-API-Key: ak_…` (Bearer also accepted) → tenant resolved
 * via `resolveTenantFromApiKey`. Caller scope determines which tools
 * are reachable: internal tools (channel provisioning, escalation,
 * template send) require `*` scope; public tools follow the granted
 * subset. Same gating as `/api/agent/dispatch`.
 *
 * Response: `200 { result }` on success, `4xx { error, message }` on
 * auth / scope / validation failure, `5xx { error }` on tool throw.
 *
 * Rationale for one endpoint per tool (vs one /api/tool with a
 * `name` body field): cleaner observability — every Kapso function
 * invocation is named in audit logs; rate-limit + scope gates can be
 * applied per-tool; and the URL maps directly to the function name
 * Kapso's agent node sees.
 */

import { type NextRequest, NextResponse } from 'next/server';

import { tools as toolMap, filterPublicTools, toolList } from '@sendero/tools';
import type { ToolContext } from '@sendero/tools/types';

import { resolveTenantFromApiKey } from '@/lib/api-key-auth';
import { filterToolsByScopes } from '@/lib/dispatch-scopes';
import { resolveTravelerByPhone } from '@/lib/agent-traveler-resolver';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface ToolBody {
  /** Tool input. Validated by the tool's own zod schema in its handler. */
  input?: Record<string, unknown>;
  /** Optional traveler phone for tools that gate on it (e.g. handoff anchoring). */
  travelerPhone?: string;
  /** Optional active trip id — channel adapters pass this for ledger writes. */
  tripId?: string;
  /** Optional ChannelIdentity row id — channel adapters pass this for handoff anchoring. */
  channelIdentityId?: string;
  /**
   * Required when authenticating via shared secret (Kapso proxy
   * function path). Ignored when an `X-API-Key` is provided since
   * the key resolves to its own tenant.
   */
  tenantId?: string;
  /**
   * Phase G — Slack-binding shortcut. When the caller is the Slack
   * interactions handler reacting to a button tap (no phone available
   * but a verified `SlackUserBinding` exists), it stamps the
   * `senderoUserId` directly so the tool's `ctx.traveler.userId` lands
   * without going through `resolveTravelerByPhone`. The handler is
   * already auth-gated by the shared dispatch secret so the binding
   * was authoritative before this hop.
   */
  _slackSenderoUserId?: string;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;

  // 1. auth — accept either a tenant API key OR the shared dispatch
  //    secret. API key path is the production model (Kapso function
  //    holds a per-tenant Clerk-minted key). Shared-secret path is the
  //    same one `/api/agent/dispatch` already uses for internal
  //    webhooks; it requires `tenantId` in the body since the secret
  //    isn't tenant-scoped on its own.
  const apiKey = await resolveTenantFromApiKey(req);
  let tenantId: string | null = apiKey?.tenantId ?? null;
  let scopes: ReturnType<typeof Array.from> | readonly string[] = apiKey?.scopes ?? [];
  let keyType = apiKey?.keyType ?? 'sandbox';
  let effectiveKeyType = apiKey?.effectiveKeyType ?? 'sandbox';
  let keyId = apiKey?.keyId ?? '';

  if (!apiKey) {
    const sharedSecret =
      req.headers.get('x-sendero-dispatch-secret') ?? req.headers.get('x-sendero-internal-secret');
    const expected = process.env.AGENT_DISPATCH_SECRET ?? process.env.CRON_SECRET ?? '';
    if (!sharedSecret || !expected || sharedSecret !== expected) {
      return NextResponse.json(
        {
          error: 'unauthorized',
          message:
            'X-API-Key header required (Bearer ak_… or shared dispatch secret with tenantId in body).',
        },
        { status: 401 }
      );
    }
    // Shared-secret callers are trusted internal — full scope, sandbox
    // key type, tenant resolved from body. Read tenantId before scope
    // gate so the rest of the handler sees a populated value.
    let earlyBody: ToolBody = {};
    try {
      earlyBody = (await req.clone().json()) as ToolBody;
    } catch {
      /* fall through; tenant-required check below */
    }
    if (!earlyBody.tenantId) {
      return NextResponse.json(
        { error: 'tenant_id_required', message: 'Shared-secret auth requires `tenantId` in body.' },
        { status: 400 }
      );
    }
    tenantId = earlyBody.tenantId;
    scopes = ['*'];
    keyType = 'sandbox';
    effectiveKeyType = 'sandbox';
    keyId = 'shared-secret';
  }

  // 2. tool lookup
  const def = toolMap[name];
  if (!def) {
    return NextResponse.json(
      { error: 'unknown_tool', message: `No tool registered with name '${name}'.` },
      { status: 404 }
    );
  }

  // 3. scope gate — internal tools require `*` scope; public tools
  //    follow the key's granted subset. Same model `/api/agent/dispatch`
  //    uses so MCP clients / external keys can't reach internal tools
  //    via this surface.
  const grantedScopes = scopes as readonly Parameters<typeof filterToolsByScopes>[1][number][];
  const allowInternal = grantedScopes.includes('*');
  const surfaced = allowInternal ? toolList : filterPublicTools(toolList);
  const reachable = filterToolsByScopes(surfaced, grantedScopes);
  if (!reachable.some(t => t.name === name)) {
    return NextResponse.json(
      {
        error: 'scope_denied',
        message: `Tool '${name}' is not in the granted scope set for this API key.`,
      },
      { status: 403 }
    );
  }

  // 4. parse body
  let body: ToolBody;
  try {
    body = (await req.json()) as ToolBody;
  } catch {
    return NextResponse.json(
      { error: 'invalid_json', message: 'Request body must be JSON.' },
      { status: 400 }
    );
  }

  // 5. resolve traveler — when the caller passed `travelerPhone`
  //    (Kapso WhatsApp proxy always does), upsert the
  //    ChannelIdentity, auto-provision a Sendero User, and
  //    fire-and-forget the wallet ensure on Arc + Solana. Idempotent
  //    on (tenantId, phone). Tools that need a real userId for
  //    settlement / handoff / meter attribution see one here instead
  //    of the `svc:<keyId>` placeholder. See plan D1.
  //
  //    Slack-binding shortcut (Phase G): when the caller is the Slack
  //    interactions handler reacting to a button tap, no phone is
  //    available but the binding row already authoritatively maps the
  //    Slack user to a Sendero User. Stamp directly. The shared-secret
  //    auth on this route already gated the caller, so the binding
  //    can be trusted as-is.
  let resolvedUserId: string | null = null;
  let resolvedChannelIdentityId: string | null = body.channelIdentityId ?? null;
  let resolvedIsPlaceholder: boolean | undefined;
  if (body.travelerPhone) {
    try {
      const traveler = await resolveTravelerByPhone({
        tenantId: tenantId!,
        phoneE164: body.travelerPhone,
      });
      resolvedUserId = traveler.userId;
      resolvedChannelIdentityId = traveler.channelIdentityId;
      resolvedIsPlaceholder = traveler.isPlaceholder;
    } catch (err) {
      console.warn('[api/tools] traveler resolve failed (non-fatal)', {
        phone: body.travelerPhone,
        tenantId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  } else if (body._slackSenderoUserId) {
    resolvedUserId = body._slackSenderoUserId;
  }

  // 6. build context — same shape `/api/agent/dispatch` uses so the
  //    handler experience is identical regardless of caller.
  //
  //    For shared-secret callers we OMIT `caller` (matches dispatch +
  //    chat). Tools that gate on `caller.effectiveKeyType` (e.g.
  //    `confirm_booking`'s testnet-beta downgrade) already fail-closed
  //    to sandbox semantics on absent caller, so the safety net stays.
  //    Tools that need to spend Sendero treasury on third-party APIs
  //    (e.g. `track_flight` via x402) treat absent caller as trusted
  //    internal infra. See `packages/tools/src/x402-fetch.ts` gate.
  const ctx: ToolContext = {
    traveler: {
      tenantId: tenantId!,
      // Real user id when the phone resolved; falls back to the
      // service-account placeholder otherwise.
      userId: resolvedUserId ?? `svc:${keyId}`,
      ...(body.travelerPhone ? { phone: body.travelerPhone } : {}),
      ...(resolvedIsPlaceholder !== undefined ? { isPlaceholder: resolvedIsPlaceholder } : {}),
    },
    ...(resolvedChannelIdentityId ? { channelIdentityId: resolvedChannelIdentityId } : {}),
    ...(apiKey
      ? {
          caller: {
            scopes: grantedScopes,
            keyType,
            effectiveKeyType,
          },
        }
      : {}),
  };

  // 7. validate input via the tool's zod schema BEFORE invoking the
  //    handler. Applies defaults (e.g. `unitsSystem: 'METRIC'`) so the
  //    agent doesn't have to know about every optional field. Each
  //    tool's handler typed signature already assumes Zod-parsed shape.
  let parsedInput: unknown;
  try {
    parsedInput = def.inputSchema.parse(body.input ?? {});
  } catch (err) {
    const issues =
      (err as { issues?: Array<{ path: (string | number)[]; message: string }> })?.issues ?? [];
    return NextResponse.json(
      {
        error: 'invalid_input',
        tool: name,
        message:
          issues.length > 0
            ? issues.map(i => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
            : 'Input failed schema validation.',
      },
      { status: 400 }
    );
  }

  // 8. run — handler returns the result. Throw becomes a 500 with the
  //    message so the caller (Kapso function) can surface it to the
  //    agent.
  try {
    const result = await def.handler(parsedInput, ctx);
    return NextResponse.json({ result });
  } catch (err) {
    const errName = err instanceof Error ? err.name : typeof err;
    const baseMessage = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack?.split('\n').slice(0, 6).join('\n') : null;
    const code = (err as { code?: string } | null)?.code ?? null;
    // Duffel SDK errors arrive with `.errors[]` and an empty `.message`.
    // Serialize the errors array so the trace shows what Duffel said
    // instead of the empty string surface.
    const duffelErrors = (err as { errors?: unknown } | null)?.errors;
    const message =
      baseMessage ||
      (Array.isArray(duffelErrors)
        ? duffelErrors
            .map(e => {
              const ee = e as { code?: string; message?: string; title?: string };
              return ee.code || ee.title
                ? `${ee.code ?? ee.title}: ${ee.message ?? ''}`
                : JSON.stringify(e);
            })
            .join(' | ')
        : '') ||
      'unknown error';
    console.error('[api/tools] handler threw', {
      tool: name,
      errName,
      code,
      message,
      duffelErrors,
      stack,
    });
    return NextResponse.json(
      { error: 'tool_failed', tool: name, errName, code, message },
      { status: 500 }
    );
  }
}

/**
 * GET /api/tools/[name]
 *
 * Returns the tool's JSON schema + description so external agent
 * runtimes can discover the contract programmatically. No auth — the
 * schema is non-sensitive and matches what the OpenAPI doc exposes
 * publicly.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const def = toolMap[name];
  if (!def) {
    return NextResponse.json({ error: 'unknown_tool' }, { status: 404 });
  }
  return NextResponse.json({
    name: def.name,
    description: def.description,
    internal: def.internal === true,
    inputSchema: def.jsonSchema,
  });
}
