/**
 * Provider-agnostic eSIM types. Mirrors the shape every supported
 * wholesale aggregator (eSIM Go, Airalo, Maya, BNESIM) returns once
 * normalized — the per-provider clients map their native payloads onto
 * these. Keeping the surface stable here is what lets `book_esim` swap
 * providers via env config without touching the tool handler.
 */

import { z } from 'zod';

/** Plan catalog entry — what the provider offers. */
export interface EsimPlan {
  /** Provider's plan id (passed back at order time). */
  planId: string;
  /** Provider slug (`esim-go` | `airalo` | `mock`). */
  provider: string;
  /** Human label — "5 GB · 30 days · Japan + Korea". */
  label: string;
  /** ISO-3166-1 alpha-2 codes the plan covers. */
  countries: string[];
  /** Total data quota in MB. Unlimited plans use a sentinel (e.g. 1_000_000). */
  dataMb: number;
  /** Validity in days from activation. */
  validityDays: number;
  /** Wholesale cost in micro-USDC — what Sendero pays the provider. */
  wholesaleMicroUsdc: bigint;
}

export interface QuoteArgs {
  /** ISO-3166-1 alpha-2 destinations. */
  countries: string[];
  /** Trip duration in days — picks plans validityDays >= this. */
  days: number;
  /** Estimated data need in GB — picks plans dataMb >= this × 1024. */
  dataGb: number;
}

/** Order primitive — placed against a provider after a quote. */
export interface OrderArgs {
  planId: string;
  /** Idempotency key — typically a `book_esim:<turnId>` hash. */
  idempotencyKey: string;
}

export interface OrderResult {
  /** Provider order id — UNIQUE on `(provider, providerOrderId)`. */
  providerOrderId: string;
  /** ICCID, if the provider returns it synchronously. */
  iccid: string | null;
  /** SM-DP+ matching id (the secret half of the LPA string). */
  activationCode: string;
  /** Full LPA: install string. */
  lpaCode: string;
  /** When the plan expires (clock starts at install for some providers). */
  expiresAt: Date | null;
}

/** Webhook payload shape — provider notifies of install / usage / expiry. */
export const EsimWebhookEventSchema = z.object({
  iccid: z.string(),
  event: z.enum(['ready', 'installed', 'active', 'usage', 'expiring', 'expired']),
  usageMb: z.number().int().nonnegative().optional(),
  occurredAt: z.string().datetime(),
});

export type EsimWebhookEvent = z.infer<typeof EsimWebhookEventSchema>;

export class EsimProviderError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'EsimProviderError';
  }
}
