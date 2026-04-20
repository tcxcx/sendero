/**
 * Hono middleware that gates a route behind a Circle Nanopayments
 * (x402-batched) payment.
 *
 * Flow per request:
 *   1. No `Payment-Signature` header → 402 Payment Required with a
 *      base64-encoded `PAYMENT-REQUIRED` header the buyer client can
 *      parse. Body includes human-readable details.
 *   2. Header present → decode, call `BatchFacilitatorClient.settle`.
 *      On success, attach `{ payer, txRef, amountUsdc }` to the Hono
 *      context and `next()` through to the handler.
 *   3. Settle rejected → 402 again with the error reason.
 *
 * Uses Circle's managed facilitator by default. Gateway batches
 * authorizations off-chain into one settled Arc tx — that's what
 * makes $0.0005 per call economically viable.
 */

import type { MiddlewareHandler } from 'hono';
import { BatchFacilitatorClient } from '@circle-fin/x402-batching/server';
import { priceFor, usdcAtomic } from '@sendero/tools/pricing';
import { logMeter } from '@sendero/tools/meter';

// Arc Testnet canonical values.
const ARC_TESTNET_CAIP2 = 'eip155:5042002';
const ARC_USDC = '0x3600000000000000000000000000000000000000';
const GATEWAY_WALLET_ARC = '0x0077777d7EBA4688BDeF3E311b846F25870A19B9';

const facilitator = new BatchFacilitatorClient();

export interface X402Context {
  payer: string;
  amountUsdc: string;
  settlementTx: string;
}

/** Seller address from env (the EOA receiving nanopayment settlement). */
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

/** Build the PaymentRequirements the buyer needs to sign against. */
function buildRequirements(toolName: string, priceUsdc: string) {
  return {
    scheme: 'exact',
    network: ARC_TESTNET_CAIP2,
    asset: ARC_USDC,
    amount: usdcAtomic(priceUsdc).toString(),
    payTo: sellerAddress(),
    maxTimeoutSeconds: 345_600, // 4 days — required for batched settlement
    description: `Sendero tool call: ${toolName}`,
    extra: {
      name: 'GatewayWalletBatched',
      version: '1',
      verifyingContract: GATEWAY_WALLET_ARC,
    },
  };
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
    const requirements = buildRequirements(toolName, priceUsdc);
    const header = c.req.header('Payment-Signature');

    // 1. No signature — respond 402 with the ask.
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
          accepts: [requirements],
        },
        402,
        { 'PAYMENT-REQUIRED': base64Encode({ x402Version: 2, accepts: [requirements] }) }
      );
    }

    // 2. Decode payload.
    let payload;
    try {
      payload = base64Decode<any>(header);
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

    // 3. Settle with the facilitator (verify + settle in one call).
    try {
      const settle = await facilitator.settle(payload, requirements);
      if (!settle.success) {
        logMeter({
          at: Date.now(),
          toolName,
          priceUsdc,
          status: 'rejected',
          payer: settle.payer,
          note: settle.errorReason ?? 'settle rejected',
        });
        return c.json(
          {
            error: 'payment_rejected',
            reason: settle.errorReason,
          },
          402
        );
      }

      const ctx: X402Context = {
        payer: settle.payer ?? 'unknown',
        amountUsdc: priceUsdc,
        settlementTx: settle.transaction,
      };
      c.set('x402', ctx);

      // 4. Log the paid event. Tool handler may add its own downstream
      // events (e.g. the onchain tx hash for settle_split).
      logMeter({
        at: Date.now(),
        toolName,
        priceUsdc,
        status: 'paid',
        payer: ctx.payer,
        settlementRef: ctx.settlementTx,
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
