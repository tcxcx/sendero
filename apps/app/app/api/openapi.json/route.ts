/**
 * GET /api/openapi.json
 *
 * OpenAPI 3.1 document for the Sendero tool registry.  Served as
 * `application/json` so Scalar, Redoc, Postman, Insomnia, and curl
 * can consume it without negotiation.  Generated from the canonical
 * tool registry in `@sendero/tools` — there is no hand-maintained
 * spec.  One source of truth keeps drift impossible.
 *
 * DX rationale:
 *   - Agents and human developers discover every callable surface
 *     with one URL.
 *   - The docs site embeds Scalar against this URL so reviewers have
 *     a try-it-out surface without a second backend.
 *   - llms.txt links this doc so agent crawlers pull it as-is.
 *
 * Public — no auth required to read the spec itself. Per-tool auth is
 * a Clerk API key on the actual `/api/agent/dispatch` call.
 */

import { buildOpenApiDoc, toolList } from '@sendero/tools';
import { resolvePublicOrigin } from '@sendero/seo';
import { NextResponse } from 'next/server';

import { buildBoundExternalWorkflowTools } from '@/lib/external-workflow-tools';

export const runtime = 'nodejs';
export const dynamic = 'force-static';
export const revalidate = 3600;

export function GET() {
  const origin = resolvePublicOrigin(process.env.NEXT_PUBLIC_APP_URL, 'https://app.sendero.travel');
  const doc = buildOpenApiDoc({
    // Bumped 2026-04-25 with the tenant-markup v1 release. Adds
    // `confirm_booking` (extended), `get_tenant_pricing_policy`, and
    // `activate_tenant_pricing_policy`. The previous shape is pinned at
    // `/openapi/v1.0.0.json` on the docs site so phased SDK rollouts can
    // target it during the transition.
    title: 'Sendero Agent Tools',
    version: '1.2.0',
    serverUrl: origin,
    // Workflow tools (`sendero_*` + `resume_workflow`) are bound to a
    // null api key here — the doc only consumes name/description/schema,
    // never the handler. Dispatch + MCP rebind per-request.
    tools: [...toolList, ...buildBoundExternalWorkflowTools({})],
  });
  return NextResponse.json(doc, {
    headers: {
      'cache-control': 'public, max-age=3600, s-maxage=3600',
      'access-control-allow-origin': '*',
    },
  });
}
