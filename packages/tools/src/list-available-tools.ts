/**
 * list_available_tools — agent introspection.
 *
 * The other half of the demand-driven loop: when the agent doesn't
 * know which tool to call, it asks. Reads the canonical `toolList`,
 * filters by the caller's scopes (so a sandbox agent can't see
 * privileged tools it can't actually invoke), optionally narrows by
 * keyword, and returns the canonical name + description + how to
 * invoke (direct vs `call_sendero` wrapper).
 *
 * **Dev/sandbox mode only.** Same gating as `report_knowledge_gap`.
 * Production agents stick to the prompt slab — exposing a "what
 * tools do you have?" surface to leaked production keys leaks
 * capability inventory to attackers.
 *
 * What it solves (real bug from tonight): the agent went
 * `scan_document` → `scan_document_auto` → `create_passenger` → `book_flight({passengers: [...]})`
 * before finding `scan_passport_inline`. With `list_available_tools({ keyword: 'passport' })`,
 * one call finds the right tool with the right description.
 */

import { z } from 'zod';

import { hasScope, toolToScope, type KeyScope } from './scopes';
import type { ToolContext, ToolDef, JsonSchemaObject } from './types';

// Scope values the caller can pass as a filter — '*' is the implicit
// wildcard granted to sandbox keys, not a meaningful filter target.
const SCOPE_FILTER_VALUES = [
  'search',
  'bookings',
  'settlement',
  'treasury',
  'documents',
  'compliance',
  'trip_assistance',
  'utilities',
] as const satisfies ReadonlyArray<Exclude<KeyScope, '*'>>;

const inputSchema = z.object({
  keyword: z
    .string()
    .min(1)
    .max(120)
    .optional()
    .describe(
      "Substring match against tool name + description (case-insensitive). E.g. 'passport' matches scan_passport_inline + check_visa_requirements."
    ),
  scope: z
    .enum(SCOPE_FILTER_VALUES)
    .optional()
    .describe(
      'Filter to tools in this scope. Omit to see everything the caller can invoke. Pass when you already know the family ("treasury", "trip_assistance") and want a focused list.'
    ),
  /** Cap result count so the response stays tight on small models. */
  limit: z.number().int().min(1).max(50).default(15),
});

export type ListAvailableToolsInput = z.infer<typeof inputSchema>;

export interface ListedTool {
  name: string;
  scope: KeyScope;
  description: string;
  /**
   * How to invoke from a Kapso agent runtime:
   *   - 'call_sendero': wrap via call_sendero({ toolName, input })
   *   - 'direct': it's a Kapso default tool, call directly
   * Sendero tools are always 'call_sendero'.
   */
  callMode: 'call_sendero' | 'direct';
  internal: boolean;
  /** Required input fields lifted from jsonSchema for quick reference. */
  requiredInputs: string[];
  /** Optional fields (top 5) to nudge the agent toward common patterns. */
  optionalInputs: string[];
}

export interface ListAvailableToolsResult {
  status: 'ok' | 'production_refused';
  message?: string;
  tools: ListedTool[];
  total: number;
  truncated: boolean;
}

// ── Caller mode gate ─────────────────────────────────────────────────

/**
 * Strict dev-only gate. Same shape as `report_knowledge_gap`'s gate:
 *   - Environment must NOT be production+(production|preview Vercel).
 *   - Production-typed prod-keys are refused regardless of env.
 *   - `SENDERO_GAPS_ALLOW_NONDEV=1` re-enables for the operator-side
 *     dashboard. Never wire that into the agent runtime.
 */
function isCallerAllowed(
  ctx: ToolContext | undefined
): { allowed: true } | { allowed: false; reason: string } {
  if (process.env.SENDERO_GAPS_ALLOW_NONDEV !== '1') {
    const nodeEnv = process.env.NODE_ENV ?? 'development';
    const vercelEnv = process.env.VERCEL_ENV;
    const isProdEnv =
      nodeEnv === 'production' && (vercelEnv === 'production' || vercelEnv === 'preview');
    if (isProdEnv) {
      return {
        allowed: false,
        reason:
          'list_available_tools is dev-only. Production agents stick to the prompt slab — exposing the catalog in production would leak capability inventory.',
      };
    }
  }
  if (!ctx?.caller) return { allowed: true };
  if (ctx.caller.effectiveKeyType === 'sandbox') return { allowed: true };
  return {
    allowed: false,
    reason:
      'list_available_tools is dev/sandbox only. Production prod-keys are refused regardless of environment.',
  };
}

// ── DI for tests — inject the catalog ───────────────────────────────

export interface ListAvailableToolsDeps {
  /** Pulled from `toolList` at runtime. Inject for tests. */
  catalog: ReadonlyArray<ToolDef>;
}

// ── Orchestrator ─────────────────────────────────────────────────────

function pickInputFields(jsonSchema: JsonSchemaObject): {
  required: string[];
  optional: string[];
} {
  const required = Array.isArray(jsonSchema.required) ? jsonSchema.required : [];
  const props = jsonSchema.properties ?? {};
  const allFields = Object.keys(props);
  const optional = allFields.filter(f => !required.includes(f)).slice(0, 5);
  return { required, optional };
}

export async function runListAvailableTools(
  input: ListAvailableToolsInput,
  ctx: ToolContext | undefined,
  deps: ListAvailableToolsDeps
): Promise<ListAvailableToolsResult> {
  const gate = isCallerAllowed(ctx);
  if (gate.allowed === false) {
    return {
      status: 'production_refused',
      message: gate.reason,
      tools: [],
      total: 0,
      truncated: false,
    };
  }

  // Caller-scope filter. Sandbox keys (and operator-console with no
  // caller object) get the wildcard scope; user-minted prod keys get
  // their explicit scope set.
  const grantedScopes: readonly KeyScope[] =
    ctx?.caller?.scopes && ctx.caller.scopes.length > 0
      ? (ctx.caller.scopes as readonly KeyScope[])
      : ['*'];

  const keyword = input.keyword?.toLowerCase() ?? null;
  const scopeFilter = input.scope ?? null;

  const matched: ListedTool[] = [];

  for (const def of deps.catalog) {
    if (def.internal) continue; // hide internals from the agent — these aren't intended for prompt-driven calls
    const toolScope = toolToScope(def.name);
    if (!hasScope(grantedScopes, toolScope)) continue;
    if (scopeFilter && toolScope !== scopeFilter) continue;
    if (keyword) {
      const haystack = `${def.name} ${def.description}`.toLowerCase();
      if (!haystack.includes(keyword)) continue;
    }

    const { required, optional } = pickInputFields(def.jsonSchema);
    matched.push({
      name: def.name,
      scope: toolScope,
      description: def.description,
      // Every Sendero tool is invoked through call_sendero in Kapso.
      // If we ever ship Kapso default tools through this catalog,
      // flip this based on a marker.
      callMode: 'call_sendero',
      internal: Boolean(def.internal),
      requiredInputs: required,
      optionalInputs: optional,
    });
  }

  const total = matched.length;
  const truncated = total > input.limit;
  return {
    status: 'ok',
    tools: matched.slice(0, input.limit),
    total,
    truncated,
  };
}

// ── Tool registration ────────────────────────────────────────────────

// The catalog is bound lazily so this module doesn't pull in the full
// toolList circularly. The default lookup grabs `toolList` at handler
// time via dynamic import.
let cachedDefaultCatalog: ReadonlyArray<ToolDef> | null = null;
async function defaultCatalog(): Promise<ReadonlyArray<ToolDef>> {
  if (cachedDefaultCatalog) return cachedDefaultCatalog;
  const { toolList } = await import('./index');
  cachedDefaultCatalog = toolList;
  return cachedDefaultCatalog;
}

export const listAvailableToolsTool: ToolDef<ListAvailableToolsInput, ListAvailableToolsResult> = {
  name: 'list_available_tools',
  internal: true,
  description:
    "Discover available Sendero tools when the prompt slab didn't tell you which one to use. Pass `keyword` to narrow (e.g. 'passport' → scan_passport_inline + check_visa_requirements). Returns name + scope + description + how to invoke (call_sendero wrapper) + required/optional inputs. **Dev/sandbox only.** Don't call this in production turns — escalate via request_human_handoff instead.",
  inputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      keyword: {
        type: 'string',
        minLength: 1,
        maxLength: 120,
        description: 'Substring match against tool name + description.',
      },
      scope: {
        type: 'string',
        enum: [...SCOPE_FILTER_VALUES],
        description: 'Filter to a specific scope family.',
      },
      limit: { type: 'integer', minimum: 1, maximum: 50, default: 15 },
    },
  },
  async handler(input, ctx) {
    const catalog = await defaultCatalog();
    return runListAvailableTools(input, ctx, { catalog });
  },
};
