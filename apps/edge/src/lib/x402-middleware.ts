/**
 * Hono middleware that gates a route behind a Circle Gateway nanopayment.
 *
 * Flow per request:
 *   1. No `Payment-Signature` header → 402 with multi-accept envelope
 *      built from Circle's `/v1/x402/supported` discovery. Every network
 *      the facilitator supports is advertised; the buyer picks one.
 *   2. Header present → decode, match buyer's chosen requirements against
 *      our advertised list (anti-tampering), settle via the facilitator.
 *   3. Settle rejected → 402 with the error reason.
 *
 * Single env var (`CIRCLE_GATEWAY_FACILITATOR_URL`) flips testnet → mainnet.
 * No hardcoded chain constants: network, asset, verifyingContract, and the
 * 7-day `minValiditySeconds` floor all come from discovery.
 *
 * Seller address is one EVM EOA reused across every supported chain
 * (same private key → same address on every EVM network). Buyers from any
 * chain's Gateway pool can pay; settlement lands on whichever chain the
 * buyer chose.
 */

import { BatchFacilitatorClient } from '@circle-fin/x402-batching/server';
import type { MiddlewareHandler } from 'hono';

import { logMeter } from '@sendero/tools/meter';
import { priceFor, usdcAtomic } from '@sendero/tools/pricing';

import { getSupportedKinds, type X402SupportedKind } from './x402-discovery';

const CIRCLE_GATEWAY_FACILITATOR_URL =
  process.env.CIRCLE_GATEWAY_FACILITATOR_URL ?? 'https://gateway-api-testnet.circle.com';

const facilitator = new BatchFacilitatorClient({ url: CIRCLE_GATEWAY_FACILITATOR_URL });

export interface X402Context {
  payer: string;
  amountUsdc: string;
  settlementTx: string;
  network: string;
}

interface PaymentRequirements {
  scheme: 'exact';
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  description: string;
  extra: {
    name: string;
    version: string;
    verifyingContract: string;
  };
}

/**
 * Buyer-submitted payload. Shape mirrors the SDK's `PaymentPayload`
 * (required `x402Version` + `payload`, optional `accepted` carrying the
 * requirements the buyer signed against). We only inspect `accepted`
 * here and hand the rest to the facilitator unchanged.
 */
interface DecodedPaymentPayload {
  x402Version: number;
  payload: Record<string, unknown>;
  accepted?: PaymentRequirements;
  resource?: { url: string; description: string; mimeType: string };
  extensions?: Record<string, unknown>;
}

/**
 * Seller EOA. One address, reused across every supported EVM chain since
 * the same private key controls the same address everywhere. Resolution
 * order mirrors what the rest of the codebase already uses.
 */
function sellerAddress(): string {
  const a =
    process.env.SENDERO_SELLER_ADDRESS ||
    process.env.TREASURY_VIEM_ADDRESS ||
    process.env.SENDERO_PROVIDER_ADDRESS;
  if (!a) {
    throw new Error(
      'SENDERO_SELLER_ADDRESS (or TREASURY_VIEM_ADDRESS) required on the edge worker.'
    );
  }
  return a;
}

/** Convert one discovery kind into a PaymentRequirements for the given tool + price. */
function kindToRequirements(
  kind: X402SupportedKind,
  toolName: string,
  priceUsdc: string,
  seller: string
): PaymentRequirements {
  const usdc = kind.extra.assets.find(a => a.symbol === 'USDC') ?? kind.extra.assets[0];
  return {
    scheme: 'exact',
    network: kind.network,
    asset: usdc.address,
    amount: usdcAtomic(priceUsdc).toString(),
    payTo: seller,
    // Clear the discovery-advertised floor with a buffer so the buyer's
    // `validBefore` is still in-window when the batch settles.
    maxTimeoutSeconds: Math.max(kind.extra.minValiditySeconds + 100, 604_900),
    description: `Sendero tool call: ${toolName}`,
    extra: {
      name: kind.extra.name,
      version: kind.extra.version,
      verifyingContract: kind.extra.verifyingContract,
    },
  };
}

/** Build the full accepts[] array — one entry per supported network. */
async function buildAccepts(toolName: string, priceUsdc: string): Promise<PaymentRequirements[]> {
  const kinds = await getSupportedKinds(CIRCLE_GATEWAY_FACILITATOR_URL);
  const seller = sellerAddress();
  return kinds.map(k => kindToRequirements(k, toolName, priceUsdc, seller));
}

/** Find the advertised requirements the buyer claims to be paying against. */
function matchAccepted(
  advertised: PaymentRequirements[],
  accepted: PaymentRequirements | undefined
): PaymentRequirements | null {
  if (!accepted) return null;
  return (
    advertised.find(
      r =>
        r.network === accepted.network &&
        r.asset.toLowerCase() === accepted.asset?.toLowerCase() &&
        r.amount === accepted.amount &&
        r.payTo.toLowerCase() === accepted.payTo?.toLowerCase() &&
        r.extra.verifyingContract.toLowerCase() === accepted.extra?.verifyingContract?.toLowerCase()
    ) ?? null
  );
}

function base64Encode(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64');
}

function base64Decode<T>(s: string): T {
  return JSON.parse(Buffer.from(s, 'base64').toString('utf-8')) as T;
}

/**
 * Creates a Hono middleware that requires payment for `toolName`.
 * The tool price is looked up from `TOOL_PRICING` in @sendero/tools.
 */
export function requirePayment(toolName: string): MiddlewareHandler {
  return async (c, next) => {
    const priceUsdc = priceFor(toolName);

    // Free tier short-circuit. Tools without an explicit `TOOL_PRICING`
    // entry resolve to '0' via the default-free policy. They still need
    // an audit row in the meter, but no EIP-3009 settlement happens. Skip
    // the 402 dance and run the handler directly. See codex consult
    // 2026-05-08: every tool needs a pricing *policy*, most should be $0.
    if (priceUsdc === '0') {
      logMeter({
        at: Date.now(),
        toolName,
        priceUsdc,
        status: 'paid',
        note: 'free-tier (no TOOL_PRICING entry)',
      });
      return next();
    }

    let advertised: PaymentRequirements[];
    try {
      advertised = await buildAccepts(toolName, priceUsdc);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logMeter({
        at: Date.now(),
        toolName,
        priceUsdc,
        status: 'rejected',
        note: `discovery failed: ${message}`,
      });
      return c.json({ error: 'discovery_unavailable', message }, 503);
    }

    const header = c.req.header('Payment-Signature');

    // 1. No signature — respond 402 with the multi-accept ask.
    if (!header) {
      logMeter({
        at: Date.now(),
        toolName,
        priceUsdc,
        status: 'rejected',
        note: 'no payment header',
      });
      return c.json(
        {
          error: 'payment_required',
          message: `This endpoint costs ${priceUsdc} USDC. Sign an EIP-3009 authorization and retry.`,
          x402Version: 2,
          accepts: advertised,
        },
        402,
        { 'PAYMENT-REQUIRED': base64Encode({ x402Version: 2, accepts: advertised }) }
      );
    }

    // 2. Decode payload + verify the buyer's chosen requirements are one we advertised.
    let payload: DecodedPaymentPayload;
    try {
      payload = base64Decode(header);
    } catch {
      logMeter({
        at: Date.now(),
        toolName,
        priceUsdc,
        status: 'rejected',
        note: 'invalid base64',
      });
      return c.json({ error: 'invalid_payment_payload' }, 402);
    }

    const matched = matchAccepted(advertised, payload.accepted);
    if (!matched) {
      logMeter({
        at: Date.now(),
        toolName,
        priceUsdc,
        status: 'rejected',
        note: 'payment_requirements_mismatch',
      });
      return c.json(
        { error: 'payment_requirements_mismatch', hint: 'buyer.accepted not in advertised set' },
        402
      );
    }

    // 3. Settle with the facilitator against the matched requirements.
    //    Cast through `unknown` because the SDK types `accepted` as
    //    `Record<string, unknown>`; we've already validated the shape via
    //    `matchAccepted` above so the facilitator sees the exact bytes the
    //    buyer signed.
    try {
      const settle = await facilitator.settle(
        payload as unknown as Parameters<typeof facilitator.settle>[0],
        matched
      );
      if (!settle.success) {
        logMeter({
          at: Date.now(),
          toolName,
          priceUsdc,
          status: 'rejected',
          payer: settle.payer,
          note: settle.errorReason ?? 'settle rejected',
        });
        return c.json({ error: 'payment_rejected', reason: settle.errorReason }, 402);
      }

      const ctx: X402Context = {
        payer: settle.payer ?? 'unknown',
        amountUsdc: priceUsdc,
        settlementTx: settle.transaction,
        network: matched.network,
      };
      c.set('x402', ctx);

      logMeter({
        at: Date.now(),
        toolName,
        priceUsdc,
        status: 'paid',
        payer: ctx.payer,
        settlementRef: ctx.settlementTx,
        note: `network=${matched.network}`,
      });

      await next();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logMeter({
        at: Date.now(),
        toolName,
        priceUsdc,
        status: 'rejected',
        note: `settle threw: ${message}`,
      });
      return c.json({ error: 'settle_failed', message }, 500);
    }
  };
}
