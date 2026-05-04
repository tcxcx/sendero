/**
 * `moonpay_topup` — generate a fiat → USDC top-up flow for the traveler.
 *
 * Output covers three surfaces so the agent can choose the right one
 * per channel:
 *
 *   - `checkoutUrl`  — direct MoonPay checkout. Pre-fills amount,
 *                      destination wallet, externalCustomerId. Signed
 *                      with HMAC-SHA256 keyed by `MOONPAY_SIGNING_SECRET`
 *                      so the wallet address can't be tampered with.
 *                      Best surface for WhatsApp / SMS — traveler taps
 *                      the link, completes KYC + card capture in
 *                      MoonPay's hosted page.
 *   - `meWalletUrl`  — `/me/wallet?topup=usdc&amount=N` deep-link.
 *                      Auto-opens the embedded `<MoonPayBuyWidget>`
 *                      overlay. Best for Clerk-signed-in travelers.
 *   - `qrImageUrl`   — QR encoding the checkout URL. For desktop /
 *                      cross-device hand-off.
 *
 * Default rail: USDC on Base. MoonPay does not support Arc directly,
 * so we ramp to a Circle Gateway-supported chain (Base or Solana) and
 * let unified balance handle settlement on the booking chain. The
 * traveler never has to think about chains — see CLAUDE.md "Circle
 * wallet balances" / unified balance docs.
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
  amountUsd: z
    .number()
    .min(20)
    .max(10000)
    .default(100)
    .describe('USD amount the traveler wants to add. MoonPay min ~$20, max varies by KYC tier.'),
  currencyCode: z
    .enum(SUPPORTED_CURRENCIES)
    .default('usdc_base')
    .describe(
      "Crypto currency to receive. Default 'usdc_base' (USDC on Base) — Circle Gateway bridges to Arc on next booking."
    ),
  note: z
    .string()
    .max(140)
    .optional()
    .describe(
      "Optional one-line reason shown back to the agent for context (e.g. 'fund EZE→LIM ticket')."
    ),
});

type Input = z.infer<typeof inputSchema>;

export const moonpayTopupTool: ToolDef<Input> = {
  name: 'moonpay_topup',
  description:
    'Generate a MoonPay fiat→USDC top-up flow for the resolved traveler. Returns a signed checkout URL (best for WhatsApp/SMS), a /me/wallet deep-link (best for signed-in browser), and a QR image. Default rail: USDC on Base — Circle Gateway bridges to Arc on the next booking, so the traveler never has to think about chains. Call when the traveler asks to add funds, or after `book_flight` returns `insufficient_funds`.',
  inputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      amountUsd: {
        type: 'number',
        default: 100,
        description: 'USD amount to top up (min ~$20).',
      },
      currencyCode: {
        type: 'string',
        enum: [...SUPPORTED_CURRENCIES],
        default: 'usdc_base',
        description: 'Crypto currency to receive. Default usdc_base.',
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
          'MoonPay env vars not set on this environment. Set NEXT_PUBLIC_MOONPAY_API_KEY + MOONPAY_SIGNING_SECRET (test/sandbox keys for dev, live keys for prod) and retry.',
      };
    }

    // Wallet address — every EVM chain MoonPay supports uses the same
    // deterministic Circle DCW EVM address. Solana would need a
    // separate lookup, but `usdc_base` (default) is EVM, so we read
    // the gateway signer.
    const isSolana = input.currencyCode === 'usdc_sol';

    let walletAddress: string;
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
            'Solana DCW not yet provisioned for this traveler. Use `usdc_base` (default) instead, or wait for the agent-traveler-resolver to backfill.',
        };
      }
      walletAddress = sol.address;
    } else {
      const signer = await prisma.userGatewaySigner.findUnique({
        where: { userId },
        select: { address: true },
      });
      if (!signer?.address) {
        return {
          status: 'wallet_not_provisioned',
          message:
            "EVM Gateway signer not yet provisioned for this traveler. The agent-traveler-resolver mints these on first WhatsApp inbound — if you're seeing this, the resolver hasn't run yet.",
        };
      }
      walletAddress = signer.address;
    }

    const traveler = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });

    // Hosted checkout host — pk_test_ → sandbox, pk_live_ → prod.
    const isTest = apiKey.startsWith('pk_test_');
    const host = isTest ? 'buy-sandbox.moonpay.com' : 'buy.moonpay.com';

    // Build query in a stable order so the signature is reproducible.
    // MoonPay's signature scheme requires URL-encoding of all values
    // before HMAC; URLSearchParams handles that consistently.
    const params = new URLSearchParams();
    params.set('apiKey', apiKey);
    params.set('currencyCode', input.currencyCode);
    params.set('baseCurrencyCode', 'usd');
    params.set('baseCurrencyAmount', String(input.amountUsd));
    params.set('walletAddress', walletAddress);
    params.set('externalCustomerId', userId);
    params.set('showWalletAddressForm', 'false');
    if (traveler?.email) params.set('email', traveler.email);

    const search = `?${params.toString()}`;
    const signature = crypto.createHmac('sha256', signingSecret).update(search).digest('base64');
    params.set('signature', signature);

    const checkoutUrl = `https://${host}/?${params.toString()}`;
    const qrImageUrl = `https://quickchart.io/qr?text=${encodeURIComponent(checkoutUrl)}&size=400&margin=2`;

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3010';
    const meWalletUrl = `${baseUrl.replace(/\/$/, '')}/me/wallet?topup=usdc&amount=${input.amountUsd}`;

    // Sendero-branded Satori share card (1200×630). Renders amount,
    // brand frame, and the same Sendero × MoonPay visual family every
    // channel uses. Falls back to qrImageUrl when OG_SHARE_SIGNING_SECRET
    // isn't configured (local dev without it). Returned as `imageUrl`
    // so persona Story 4.5 step 3 sends a polished image instead of
    // the bare QR.
    const cardImageUrl = await buildSenderoShareCardUrl(baseUrl, {
      title: `Top up · $${input.amountUsd} USD`,
      body: `Pay with a card via MoonPay — funds land in your Sendero wallet in seconds.`,
      bullets: [
        `Receiving on ${input.currencyCode.replace('_', ' ').toUpperCase()}`,
        `Wallet ${walletAddress.slice(0, 8)}…${walletAddress.slice(-6)}`,
        `Settles via Circle Gateway across every chain`,
      ],
      ctaLabel: 'Tap to pay',
    });

    return {
      status: 'ready',
      checkoutUrl,
      qrImageUrl,
      imageUrl: cardImageUrl ?? qrImageUrl,
      meWalletUrl,
      amountUsd: input.amountUsd,
      currencyCode: input.currencyCode,
      walletAddress,
      environment: isTest ? 'sandbox' : 'production',
      note: input.note ?? null,
      message:
        `Top up *${input.amountUsd} USD* with MoonPay (sandbox).\n\n` +
        `Checkout: ${checkoutUrl}\n\n` +
        `Funds land as ${input.currencyCode.toUpperCase()} on \`${walletAddress.slice(0, 10)}…${walletAddress.slice(-6)}\`. Sendero's unified balance picks them up across every supported chain.`,
    };
  },
};

/**
 * Build a signed `/api/og/share?token=…` URL that renders a brand
 * Satori card. Mirrors `apps/app/lib/og/share-url.ts::signSharePayload`
 * inline because tools can't import from `apps/app`. Same wire format
 * (`<base64url(JSON)>.<base64url(HMAC-SHA256)>`) so the existing share
 * route verifies it.
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
  const sig = sigBuf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const token = `${body}.${sig}`;
  const origin = baseUrl.replace(/\/$/, '');
  return `${origin}/api/og/share?token=${encodeURIComponent(token)}`;
}
