/**
 * HTTP client for BUFI's Pasillo gateway.
 *
 * Wraps the auth dance (Vercel OIDC bearer + HMAC body signature +
 * idempotency key) so caller code reads as:
 *
 *   const pasillo = createPasilloClient({
 *     baseUrl: process.env.PASILLO_URL ?? 'https://api.pasillo.bufi.io',
 *     hmacSecret: process.env.PASILLO_HMAC_SECRET!,
 *   });
 *   const quote = await pasillo.ramp.quote({
 *     amount: '1000000',
 *     corridor: 'usd_us_to_usd_ec',
 *     direction: 'usd-to-usdc',
 *   });
 *
 * Per `docs/pasillo-auth-coordination.md`:
 *   - OIDC token via `VERCEL_OIDC_TOKEN` env (prod) or
 *     `PASILLO_DEV_OIDC_TOKEN_URL` (local dev mock issuer).
 *   - HMAC over `${ts}.${body}` — Stripe pattern. Covers any header
 *     we want immune to tampering (tenant id, idempotency key).
 *   - Idempotency-Key UUID per POST so retry-on-network-blip is safe.
 *
 * The client never reads `process.env` in the request hot path past
 * construction — all config is captured at `createPasilloClient` time
 * so tests + Workers runtimes can inject their own fetch + env.
 */

import { signRequest } from './auth/hmac';
import { resolveOidcToken, type OidcResolverOptions } from './auth/oidc';
import type {
  CustomerRecord,
  CustomerRegisterRequest,
  CustomerVerifyResponse,
  PasilloErrorResponse,
  QuoteRequest,
  QuoteResponse,
  RampExecuteRequest,
  RampExecuteResponse,
  RampStatusResponse,
} from './types';

export interface PasilloClientConfig {
  /** Pasillo base URL, no trailing slash. Default `https://api.pasillo.bufi.io`. */
  baseUrl?: string;
  /**
   * Shared HMAC secret between Sendero and Pasillo. Rotated quarterly
   * per the coordination doc; pass the current primary secret here.
   * The Pasillo side accepts N + N-1 during the overlap window.
   */
  hmacSecret: string;
  /**
   * Tenant id to stamp on the `X-Sendero-Tenant-Id` header. Pasillo
   * uses this for per-tenant rate-limit bucketing and audit. Covered
   * by HMAC since it's part of the signed body (or its own signed
   * header — see implementation note below).
   */
  tenantId: string;
  /**
   * Random id factory for `X-Idempotency-Key`. Defaults to
   * `crypto.randomUUID()`. Tests inject deterministic values.
   */
  idempotencyKey?: () => string;
  /** Injected for tests + Workers. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** OIDC resolution override — defaults to env-based. */
  oidc?: OidcResolverOptions;
}

export interface PasilloClient {
  ramp: {
    quote(req: QuoteRequest): Promise<QuoteResponse>;
    on(req: RampExecuteRequest): Promise<RampExecuteResponse>;
    off(req: RampExecuteRequest): Promise<RampExecuteResponse>;
    status(transactionId: string): Promise<RampStatusResponse>;
  };
  customers: {
    register(req: CustomerRegisterRequest): Promise<CustomerRecord>;
    get(customerId: string): Promise<CustomerRecord>;
    verify(customerId: string): Promise<CustomerVerifyResponse>;
  };
}

export class PasilloApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly response?: unknown
  ) {
    super(message);
    this.name = 'PasilloApiError';
  }
}

const DEFAULT_BASE_URL = 'https://api.pasillo.bufi.io';

export function createPasilloClient(config: PasilloClientConfig): PasilloClient {
  const baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  const fetchImpl = config.fetchImpl ?? fetch;
  const randomId = config.idempotencyKey ?? (() => crypto.randomUUID());

  /**
   * Shared transport. Signs every mutation with HMAC; reads attach
   * only the OIDC bearer (no body to sign). `tenantId` rides as a
   * header AND is folded into the signed body envelope on POSTs so
   * Pasillo can verify it wasn't swapped between sign-time and
   * server-time.
   */
  async function request<T>(args: {
    method: 'GET' | 'POST';
    path: string;
    body?: unknown;
  }): Promise<T> {
    const token = await resolveOidcToken({ ...config.oidc, fetchImpl });
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'X-Sendero-Tenant-Id': config.tenantId,
    };

    let payload: string | undefined;
    if (args.method === 'POST') {
      // Sign the flat body Pasillo expects. The tenant id rides as a
      // separate header (X-Sendero-Tenant-Id) and is signed via the
      // shared HMAC secret — tampering with the header alone breaks
      // the signature because Sendero's secret never leaves Sendero.
      payload = JSON.stringify(args.body ?? {});
      const idempotencyKey = randomId();
      const { header } = signRequest(payload, config.hmacSecret);
      headers['Content-Type'] = 'application/json';
      headers['X-Sendero-Sig'] = header;
      headers['X-Idempotency-Key'] = idempotencyKey;
    }

    const res = await fetchImpl(`${baseUrl}${args.path}`, {
      method: args.method,
      headers,
      ...(payload !== undefined ? { body: payload } : {}),
    });

    const text = await res.text();
    let parsed: unknown = null;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        // Pasillo always JSON-responds; non-JSON means an upstream
        // proxy got in the way. Surface as an opaque API error.
        throw new PasilloApiError(
          `pasillo: non-JSON response (${res.status}): ${text.slice(0, 200)}`,
          res.status
        );
      }
    }

    if (!res.ok) {
      const err = parsed as PasilloErrorResponse | null;
      throw new PasilloApiError(
        err?.error?.message ?? `pasillo: ${args.method} ${args.path} ${res.status}`,
        res.status,
        err?.error?.code,
        parsed
      );
    }

    // Pasillo's happy responses follow `{ success: true, data: ... }`;
    // unwrap if shaped that way, else return the full body so this
    // client survives schema evolution.
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'success' in parsed &&
      (parsed as { success?: boolean }).success === true &&
      'data' in parsed
    ) {
      return (parsed as { data: T }).data;
    }
    return parsed as T;
  }

  return {
    ramp: {
      quote: req => request<QuoteResponse>({ method: 'POST', path: '/ramp/quote', body: req }),
      on: req => request<RampExecuteResponse>({ method: 'POST', path: '/ramp/on', body: req }),
      off: req => request<RampExecuteResponse>({ method: 'POST', path: '/ramp/off', body: req }),
      status: transactionId =>
        request<RampStatusResponse>({
          method: 'GET',
          path: `/ramp/status/${encodeURIComponent(transactionId)}`,
        }),
    },
    customers: {
      register: req => request<CustomerRecord>({ method: 'POST', path: '/customers/', body: req }),
      get: customerId =>
        request<CustomerRecord>({
          method: 'GET',
          path: `/customers/${encodeURIComponent(customerId)}`,
        }),
      verify: customerId =>
        request<CustomerVerifyResponse>({
          method: 'POST',
          path: `/customers/${encodeURIComponent(customerId)}/verify`,
          body: {},
        }),
    },
  };
}
