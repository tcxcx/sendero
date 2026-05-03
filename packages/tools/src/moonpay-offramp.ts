/**
 * `moonpay_offramp` — generate a USDC → fiat sell flow for the traveler.
 *
 * Mirror of `moonpay_topup` but on MoonPay's sell host. The traveler's
 * Circle DCW EVM address is the source-of-funds; MoonPay quotes the
 * fiat payout, the traveler signs the deposit on-chain via the embedded
 * widget, MoonPay disburses to a bank/card on file. Refund destination
 * defaults to the same wallet so cancellations land back where they
 * came from.
 *
 * Default rail: USDC on Base. Solana available for EUR-corridor users
 * (`usdc_sol`). MoonPay does not support Arc, so the traveler bridges
 * via Circle Gateway before the sell.
 */

import crypto from 'node:crypto';

import { z } from 'zod';

import { prisma } from '@sendero/database';

import type { ToolContext, ToolDef } from './types';

const SUPPORTED_CURRENCIES = [
  'usdc_base',
  'usdc_sol',
  'usdc_polygon',
  'usdc_arbitrum',
  'usdc_optimism',
] as const;

const inputSchema = z.object({
  amountUsdc: z
    .number()
    .min(20)
    .max(10000)
    .default(100)
    .describe('USDC amount the traveler wants to sell. MoonPay min ~$20.'),
  currencyCode: z
    .enum(SUPPORTED_CURRENCIES)
    .default('usdc_base')
    .describe(
      "Crypto being sold. Default 'usdc_base' (USDC on Base) — Circle Gateway sourced from unified balance."
    ),
  note: z
    .string()
    .max(140)
    .optional()
    .describe(
      "Optional one-line reason shown back to the agent for context (e.g. 'cash-out post-trip remainder')."
    ),
});

type Input = z.infer<typeof inputSchema>;

export const moonpayOfframpTool: ToolDef<Input> = {
  name: 'moonpay_offramp',
  description:
    "Generate a MoonPay USDC→fiat sell (cash-out) flow for the resolved traveler. Returns a signed sell-widget URL (best for WhatsApp/SMS), a /me/wallet?cashout deep-link, and a QR. Default rail: USDC on Base. Call when the traveler asks to cash out, withdraw, 'retirar plata', 'sacar', or 'pasar a dólares en mi cuenta'. NEVER hand-edit the URL — the signature is per-URL; if the amount changes, call this tool again.",
  inputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      amountUsdc: {
        type: 'number',
        default: 100,
        description: 'USDC amount to sell (min ~$20).',
      },
      currencyCode: {
        type: 'string',
        enum: [...SUPPORTED_CURRENCIES],
        default: 'usdc_base',
        description: 'Crypto currency to sell. Default usdc_base.',
      },
      note: { type: 'string', description: 'Optional human-readable reason.' },
    },
  },
  async handler(input: Input, ctx?: ToolContext) {
    const userId = ctx?.traveler?.userId;
    if (!userId || userId.startsWith('svc:')) {
      return {
        status: 'no_traveler',
        message:
          'No resolved traveler on this turn. Pass `travelerPhone` on `call_sendero` so the resolver can stamp a real user id.',
      };
    }

    const apiKey = process.env.NEXT_PUBLIC_MOONPAY_API_KEY;
    const signingSecret = process.env.MOONPAY_SIGNING_SECRET;
    if (!apiKey || !signingSecret) {
      return {
        status: 'unconfigured',
        message:
          'MoonPay env vars not set on this environment. Set NEXT_PUBLIC_MOONPAY_API_KEY + MOONPAY_SIGNING_SECRET (test keys for dev, live keys for prod) and retry.',
      };
    }

    const isSolana = input.currencyCode === 'usdc_sol';

    let refundWalletAddress: string;
    if (isSolana) {
      const SOL_DEVNET_CHAIN_ID = 5;
      const sol = await prisma.wallet.findFirst({
        where: { userId, provisioner: 'dcw', chainId: SOL_DEVNET_CHAIN_ID },
        select: { address: true },
      });
      if (!sol?.address) {
        return {
          status: 'wallet_not_provisioned',
          message:
            'Solana DCW not yet provisioned. Use `usdc_base` (default) instead, or wait for the agent-traveler-resolver to backfill.',
        };
      }
      refundWalletAddress = sol.address;
    } else {
      const signer = await prisma.userGatewaySigner.findUnique({
        where: { userId },
        select: { address: true },
      });
      if (!signer?.address) {
        return {
          status: 'wallet_not_provisioned',
          message:
            "EVM Gateway signer not yet provisioned. The agent-traveler-resolver mints these on first WhatsApp inbound — if you're seeing this, the resolver hasn't run yet.",
        };
      }
      refundWalletAddress = signer.address;
    }

    const traveler = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });

    const isTest = apiKey.startsWith('pk_test_');
    const host = isTest ? 'sell-sandbox.moonpay.com' : 'sell.moonpay.com';

    // MoonPay sell widget query shape:
    //   baseCurrencyCode = crypto being sold
    //   baseCurrencyAmount = crypto amount
    //   quoteCurrencyCode = fiat to receive
    //   refundWalletAddress = where to send funds back if cancelled
    const params = new URLSearchParams();
    params.set('apiKey', apiKey);
    params.set('baseCurrencyCode', input.currencyCode);
    params.set('baseCurrencyAmount', String(input.amountUsdc));
    params.set('quoteCurrencyCode', 'usd');
    params.set('refundWalletAddress', refundWalletAddress);
    params.set('externalCustomerId', userId);
    if (traveler?.email) params.set('email', traveler.email);

    const search = `?${params.toString()}`;
    const signature = crypto.createHmac('sha256', signingSecret).update(search).digest('base64');
    params.set('signature', signature);

    const checkoutUrl = `https://${host}/?${params.toString()}`;
    const qrImageUrl = `https://quickchart.io/qr?text=${encodeURIComponent(checkoutUrl)}&size=400&margin=2`;

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3010';
    const meWalletUrl = `${baseUrl.replace(/\/$/, '')}/me/wallet?cashout=usdc&amount=${input.amountUsdc}`;

    return {
      status: 'ready',
      checkoutUrl,
      qrImageUrl,
      meWalletUrl,
      amountUsdc: input.amountUsdc,
      currencyCode: input.currencyCode,
      refundWalletAddress,
      environment: isTest ? 'sandbox' : 'production',
      note: input.note ?? null,
      message:
        `Cash out *${input.amountUsdc} ${input.currencyCode.toUpperCase()}* to fiat with MoonPay (sandbox).\n\n` +
        `Sell widget: ${checkoutUrl}\n\n` +
        `If you cancel mid-flow, funds return to \`${refundWalletAddress.slice(0, 10)}…${refundWalletAddress.slice(-6)}\`.`,
    };
  },
};
