/**
 * eSIM Go provider — wholesale aggregator with REST API.
 * Public docs: https://docs.esim-go.com/api/v2_5/
 *
 * Auth: `X-API-Key: <key>` header. Sandbox + production share the same
 * shape; switch via `ESIM_GO_BASE_URL` env. The API key doubles as the
 * HMAC signing key for inbound usage callbacks (see
 * `apps/app/lib/esim-go-webhook-verify.ts`) — keep it scoped tightly.
 *
 * Order modes:
 *   - `transaction` — debits the org balance, assigns a real ICCID +
 *     SM-DP+ profile, ships the eSIM. Production behavior.
 *   - `validate`   — runs the full pipeline (bundle exists, profile
 *     compatible, traveler eligible) WITHOUT touching balance.
 *     Returns `{ valid, total, currency }`. Perfect for staging /
 *     preview e2e where we want real catalogue lookups + real
 *     validation feedback without burning $.
 *
 * Sendero owns the eSIM Go organisation; tenants resell our inventory
 * via `TenantPricingPolicy.markupConfig.esim`. So one API key, one
 * balance, one webhook path. See `packages/esim/src/pricing.ts` for
 * the resale-model rationale.
 */

import type { EsimProvider } from '../client';
import { EsimProviderError, type EsimPlan, type OrderArgs, type OrderResult, type QuoteArgs } from '../types';

interface EsimGoOpts {
  apiKey: string;
  /** Defaults to https://api.esim-go.com/v2.5 (production). */
  baseUrl?: string;
  /**
   * When `true`, `order()` sends `type: "validate"` instead of
   * `"transaction"`. The full pipeline runs (bundle existence,
   * compatibility, error responses) but no balance is deducted and
   * no real ICCID is minted. Returns a synthetic `LPA:` activation
   * code so downstream renderers + install page still paint a
   * complete card.
   */
  validateOnly?: boolean;
  /** Override fetch for tests. */
  fetchFn?: typeof fetch;
}

/**
 * Synthetic activation code minted in validate-only mode. Deterministic
 * per-(orderRef, idempotencyKey) so retries dedupe. The install page
 * detects this prefix and renders a "preview / not a real eSIM" banner
 * before attempting the LPA: redirect.
 */
const VALIDATE_LPA_HOST = 'smdp.validate.sendero.dev';

export function makeEsimGoProvider(opts: EsimGoOpts): EsimProvider {
  const baseUrl = (opts.baseUrl ?? 'https://api.esim-go.com/v2.5').replace(/\/$/, '');
  const fetchFn = opts.fetchFn ?? fetch;
  const validateOnly = opts.validateOnly === true;

  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const r = await fetchFn(`${baseUrl}${path}`, {
      ...init,
      headers: {
        'X-API-Key': opts.apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(init?.headers ?? {}),
      },
    });
    if (!r.ok) {
      throw new EsimProviderError(
        `http_${r.status}`,
        `esim-go ${path} failed: ${r.status} ${await r.text().catch(() => '')}`
      );
    }
    return (await r.json()) as T;
  }

  async function listPlans(args: QuoteArgs & { limit?: number }): Promise<EsimPlan[]> {
      // GET /catalogue?countries=JP&validity=7&page=1&perPage=20
      // eSIM Go's catalogue orders by price ascending. We DON'T pass a
      // strict `data=` filter — the catalogue ignores it on most queries
      // and we want the full ladder (1GB / 5GB / unlimited / etc.) so
      // the agent can curate. Server-side filtering happens after.
      const countries = args.countries.join(',');
      const validity = String(Math.max(1, Math.ceil(args.days)));
      const limit = Math.max(1, Math.min(args.limit ?? 20, 50));
      const params = new URLSearchParams({
        countries,
        validity,
        page: '1',
        perPage: String(limit),
      });
      type CatalogueResp = {
        bundles?: Array<{
          name: string;
          description?: string;
          countries?: Array<{ iso: string }>;
          dataAmount?: number; // MB
          duration?: number; // days
          price?: number; // USD float
          unlimited?: boolean;
        }>;
      };
      const resp = await call<CatalogueResp>(`/catalogue?${params.toString()}`);
      const bundles = resp.bundles ?? [];
      return bundles.map(bundle => {
        const dataMb = bundle.unlimited
          ? 1_000_000 // unlimited sentinel — large MB so callers don't trip "<= dataGb" checks
          : (bundle.dataAmount ?? 0);
        const wholesaleMicroUsdc = BigInt(Math.round((bundle.price ?? 0) * 1_000_000));
        return {
          planId: bundle.name,
          provider: 'esim-go',
          label: bundle.description ?? bundle.name,
          countries: (bundle.countries ?? []).map(c => c.iso),
          dataMb,
          validityDays: bundle.duration ?? args.days,
          wholesaleMicroUsdc,
        };
      });
    }

  return {
    slug: 'esim-go',

    async quote(args: QuoteArgs): Promise<EsimPlan | null> {
      const plans = await listPlans({ ...args, limit: 1 });
      return plans[0] ?? null;
    },

    listPlans,

    async order(args: OrderArgs): Promise<OrderResult> {
      // POST /orders — v2.5 schema. Fields: type, assign, order[].
      // Each order item: { type: 'bundle', quantity, item }.
      // `Idempotency-Key` header is honored across both modes so retries
      // dedupe at the provider edge regardless of validate vs transaction.
      type OrderResp = {
        // Validation response (type: 'validate')
        valid?: boolean;
        // Common
        total?: number;
        currency?: string;
        createdDate?: string;
        // Transaction response (type: 'transaction')
        orderReference?: string;
        order_id?: string;
        status?: string;
        statusMessage?: string;
        order?: Array<{
          type?: string;
          item?: string;
          quantity?: number;
          esims?: Array<{ iccid?: string; matchingId?: string; smdpAddress?: string }>;
          iccids?: string[];
        }>;
      };

      const body = {
        type: validateOnly ? 'validate' : 'transaction',
        assign: !validateOnly,
        order: [{ type: 'bundle', quantity: 1, item: args.planId }],
      };

      const resp = await call<OrderResp>('/orders', {
        method: 'POST',
        headers: { 'Idempotency-Key': args.idempotencyKey },
        body: JSON.stringify(body),
      });

      if (validateOnly) {
        // eSIM Go's validate response carries `valid: true` only when the
        // org could actually settle the order RIGHT NOW — that means
        // balance ≥ subTotal. Prepaid accounts at $0 balance return
        // `valid: false` for every bundle even when the order shape is
        // fine. For dogfooding / staging where the goal is exercising the
        // wire format (not confirming settlement), we treat any 200 with
        // a bundle echo as "validated" and mint the synthetic LPA.
        // The only hard rejection is when eSIM Go responds with no order
        // echo — that's an actual structural failure (bundle not found,
        // bad payload, etc.) and we surface it.
        const echoed = Array.isArray(resp.order) && resp.order.length > 0;
        if (!echoed) {
          throw new EsimProviderError(
            'validation_failed',
            `esim-go validate rejected order: ${resp.statusMessage ?? 'no order echo'}`
          );
        }
        if (resp.valid === false) {
          // Soft-warn — most common cause is org balance < subTotal, not
          // a real validation problem. Surfaces in agent logs without
          // failing the call.
          console.warn(
            '[@sendero/esim] eSIM Go validate returned valid:false; ' +
              'minting synthetic LPA anyway (validate-only mode). ' +
              `Likely cause: org balance below total ($${resp.total ?? '?'}).`
          );
        }
        // Mint a deterministic synthetic LPA so the renderer + install
        // page still paint an end-to-end card. The synthetic prefix
        // tells the install page this isn't a real provisioned eSIM.
        const seed = args.idempotencyKey.replace(/[^a-z0-9]/gi, '').slice(0, 16).toUpperCase();
        const activationCode = `VAL-${seed.padEnd(16, '0')}`;
        const orderRef = (resp as { orderReference?: string }).orderReference ?? `ord_validate_${seed}`;
        return {
          providerOrderId: orderRef,
          iccid: null, // No real ICCID is minted in validate mode.
          activationCode,
          lpaCode: `LPA:1$${VALIDATE_LPA_HOST}$${activationCode}`,
          expiresAt: null,
        };
      }

      const first = resp.order?.[0];
      const esim = first?.esims?.[0];
      const orderRef = resp.orderReference ?? resp.order_id;
      if (!orderRef || !esim?.matchingId || !esim?.smdpAddress) {
        throw new EsimProviderError(
          'incomplete_order',
          `esim-go returned incomplete order shape: ${JSON.stringify(resp).slice(0, 200)}`
        );
      }
      return {
        providerOrderId: orderRef,
        iccid: esim.iccid ?? null,
        activationCode: esim.matchingId,
        lpaCode: `LPA:1$${esim.smdpAddress}$${esim.matchingId}`,
        expiresAt: null,
      };
    },
  };
}
