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
      // Architecture flip (2026-05-04): refund destination is the
      // Circle DCW EVM address — same Circle-watched destination MoonPay
      // funds land in. Cancelled-flow refunds bounce back into a wallet
      // we already track. Same address works across all EVM chains
      // (deterministic Circle DCW) regardless of which chain we
      // happen to persist a Wallet row for.
      const SOL_DEVNET_CHAIN_ID = 5;
      const dcw = await prisma.wallet.findFirst({
        where: { userId, provisioner: 'dcw', NOT: { chainId: SOL_DEVNET_CHAIN_ID } },
        orderBy: { createdAt: 'asc' },
        select: { address: true },
      });
      if (!dcw?.address) {
        return {
          status: 'wallet_not_provisioned',
          message:
            "EVM DCW not yet provisioned. The agent-traveler-resolver mints these on first WhatsApp inbound — if you're seeing this, the resolver hasn't run yet.",
        };
      }
      refundWalletAddress = dcw.address;
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

    // Sendero-branded Satori share card. See moonpay-topup.ts for
    // the inline signer rationale.
    const cardImageUrl = await buildSenderoShareCardUrl(baseUrl, {
      title: `Cash out · ${input.amountUsdc} USDC`,
      body: `Sell USDC for fiat via MoonPay — funds land in your bank in 1-2 business days.`,
      bullets: [
        `Selling from ${input.currencyCode.replace('_', ' ').toUpperCase()}`,
        `Refund to ${refundWalletAddress.slice(0, 8)}…${refundWalletAddress.slice(-6)} if cancelled`,
        `Powered by Circle Gateway unified balance`,
      ],
      ctaLabel: 'Tap to sell',
    });

    // Sendero-branded short link — same pattern as moonpay_topup.
    const shortUrl = await mintShortLink({
      baseUrl,
      targetUrl: checkoutUrl,
      userId,
      purpose: 'moonpay_offramp',
      expiresInSeconds: 60 * 60 * 24,
    });

    return {
      status: 'ready',
      checkoutUrl,
      shortUrl: shortUrl ?? checkoutUrl,
      qrImageUrl,
      imageUrl: cardImageUrl ?? qrImageUrl,
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

/**
 * Build a signed `/api/og/share?token=…` URL. Mirrors the inline signer
 * in moonpay-topup.ts — duplicated here rather than shared because tools
 * can't import from apps/app's lib and we want zero new packages tonight.
 */
async function buildSenderoShareCardUrl(
  baseUrl: string,
  payload: {
    title: string;
    body: string;
    bullets?: string[];
    ctaLabel?: string;
    kicker?: string;
    footer?: string;
  }
): Promise<string | null> {
  const secret = process.env.OG_SHARE_SIGNING_SECRET;
  if (!secret || secret.length < 16) return null;
  const json = JSON.stringify(payload);
  const body = Buffer.from(json, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const sigBuf = crypto.createHmac('sha256', secret).update(body).digest();
  const sig = sigBuf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const token = `${body}.${sig}`;
  const origin = baseUrl.replace(/\/$/, '');
  return `${origin}/api/og/share?token=${encodeURIComponent(token)}`;
}

/** Mirror of moonpay-topup.ts::mintShortLink — see that comment. */
async function mintShortLink(args: {
  baseUrl: string;
  targetUrl: string;
  userId?: string;
  purpose: string;
  expiresInSeconds?: number;
}): Promise<string | null> {
  const dispatchSecret = process.env.AGENT_DISPATCH_SECRET ?? process.env.CRON_SECRET;
  if (!dispatchSecret) return null;
  try {
    const origin = args.baseUrl.replace(/\/$/, '');
    const res = await fetch(`${origin}/api/short-links`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-sendero-dispatch-secret': dispatchSecret,
      },
      body: JSON.stringify({
        targetUrl: args.targetUrl,
        userId: args.userId,
        purpose: args.purpose,
        expiresInSeconds: args.expiresInSeconds,
      }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { shortUrl?: string };
    return body.shortUrl ?? null;
  } catch (err) {
    console.warn('[moonpay-offramp] mintShortLink failed (non-fatal)', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
