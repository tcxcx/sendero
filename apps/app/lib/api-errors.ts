/**
 * Shared error envelope per the DX D2 spec. Returned by every JSON API
 * route in this app so consumers (and the agent SDK) can surface a
 * consistent shape.
 *
 * Shape:
 *   { code, message, details?, docsUrl?, agentInstruction?, traceId }
 *
 * - `code`              — machine-readable string, snake_case.
 *                         Stable across versions; new codes are additive.
 * - `message`           — human-readable, terse, no PII.
 * - `details`           — free-form JSON, useful for validation issues.
 * - `docsUrl`           — link to the failure mode in /docs/api.
 * - `agentInstruction`  — short hint the agent SDK can use to recover
 *                         (e.g., "retry with smaller pageSize").
 * - `traceId`           — request-scoped id for log correlation.
 *                         Pulled from the inbound `x-sendero-trace-id`
 *                         header if present; otherwise a fresh UUID.
 *
 * Consumers create errors via `apiError(...)` and convert to a Response
 * via `apiErrorResponse(...)`. Don't return ad-hoc shapes; use these.
 */

import { NextResponse } from 'next/server';

export interface ApiErrorPayload {
  code: string;
  message: string;
  details?: unknown;
  docsUrl?: string;
  agentInstruction?: string;
  traceId: string;
}

export interface ApiErrorOptions {
  status: number;
  code: string;
  message: string;
  details?: unknown;
  docsUrl?: string;
  agentInstruction?: string;
  traceId?: string;
}

function newTraceId(): string {
  // crypto.randomUUID is available in Node 19+ and the Edge runtime.
  // Falling back to Math.random would defeat the purpose of trace
  // correlation, so just use crypto.
  return crypto.randomUUID();
}

/** Build the envelope without wrapping it in a NextResponse. */
export function apiError(opts: ApiErrorOptions): ApiErrorPayload {
  const payload: ApiErrorPayload = {
    code: opts.code,
    message: opts.message,
    traceId: opts.traceId ?? newTraceId(),
  };
  if (opts.details !== undefined) payload.details = opts.details;
  if (opts.docsUrl) payload.docsUrl = opts.docsUrl;
  if (opts.agentInstruction) payload.agentInstruction = opts.agentInstruction;
  return payload;
}

/** Build a `NextResponse` carrying an envelope + the originating status. */
export function apiErrorResponse(opts: ApiErrorOptions): NextResponse {
  const payload = apiError(opts);
  return NextResponse.json(payload, {
    status: opts.status,
    headers: { 'x-sendero-trace-id': payload.traceId },
  });
}

const DOCS_BASE = process.env.NEXT_PUBLIC_DOCS_URL ?? 'https://docs.sendero.travel';

/**
 * Pre-baked builders for the markup + tenant pricing family.
 * Keeps callers consistent — every route raising one of these emits
 * the same code/message/docs/instruction triple. New error families
 * should add their own factory cluster here so the catalog stays
 * grep-able.
 */
export const ApiErrors = {
  unauthorized: (opts: Partial<ApiErrorOptions> = {}) =>
    apiErrorResponse({
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'Authentication required.',
      ...opts,
    }),
  forbidden: (
    message = 'You do not have permission for this action.',
    opts: Partial<ApiErrorOptions> = {}
  ) =>
    apiErrorResponse({
      status: 403,
      code: 'FORBIDDEN',
      message,
      ...opts,
    }),
  policyInactive: (opts: Partial<ApiErrorOptions> = {}) =>
    apiErrorResponse({
      status: 409,
      code: 'POLICY_INACTIVE',
      message: "This tenant's pricing policy is not activated yet.",
      docsUrl: `${DOCS_BASE}/pricing/markup#activation`,
      agentInstruction:
        'Tell the human to activate their pricing policy at https://app.sendero.travel/dashboard/settings/pricing before retrying this booking.',
      ...opts,
    }),
  policyNotInitialized: (opts: Partial<ApiErrorOptions> = {}) =>
    apiErrorResponse({
      status: 404,
      code: 'POLICY_NOT_INITIALIZED',
      message: 'No pricing policy exists for this tenant. POST one first.',
      docsUrl: `${DOCS_BASE}/pricing/markup#activation`,
      ...opts,
    }),
  treasuryNotProvisioned: (opts: Partial<ApiErrorOptions> = {}) =>
    apiErrorResponse({
      status: 409,
      code: 'TREASURY_NOT_PROVISIONED',
      message: 'Cannot activate pricing policy until your treasury wallet is provisioned.',
      docsUrl: `${DOCS_BASE}/wallet/provisioning`,
      agentInstruction:
        'Tell the human their treasury wallet is still being set up. They should wait a minute and retry, or check the wallet status page.',
      ...opts,
    }),
  markupConfigInvalid: (zodIssues: unknown, opts: Partial<ApiErrorOptions> = {}) =>
    apiErrorResponse({
      status: 422,
      code: 'MARKUP_CONFIG_INVALID',
      message: 'The markup configuration failed validation.',
      details: { zodIssues },
      docsUrl: `${DOCS_BASE}/pricing/markup-error-codes#markup-config-invalid`,
      ...opts,
    }),
};
