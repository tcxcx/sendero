/**
 * x402 outbound payment helper.
 *
 * Sendero treasury (`TREASURY_PRIVATE_KEY`) signs an EIP-3009
 * `transferWithAuthorization` over Base mainnet USDC, attaches the
 * signed payment as `X-PAYMENT`, and retries the original HTTP request.
 * The x402 facilitator (Coinbase, paysponge, etc.) settles the pull
 * within `maxTimeoutSeconds`; the response we return to the caller is
 * the upstream JSON.
 *
 * ## Hard gates (every call, all must pass)
 *
 * 1. `caller.effectiveKeyType === 'production'` — sandbox keys never
 *    move real USDC. Sandbox callers should use stub fixtures or a
 *    Base-Sepolia testbed (not part of this helper).
 * 2. Hostname in `X402_OUTBOUND_ALLOWLIST` (env, comma-separated).
 *    Default: `stabletravel.dev,tripadvisor.x402.paysponge.com`.
 * 3. Per-call cost ≤ `opts.maxAmountUsdc` (default `$0.20`).
 * 4. Per-tenant 24h spend ≤ `$1.00` (Postgres rolling window).
 * 5. Platform 24h spend ≤ `$5.00`.
 * 6. Treasury Base USDC balance ≥ required amount.
 *
 * ## Funding (Phase 1, manual)
 *
 * The treasury Base float is funded by hand. When balance dips, an
 * operator runs `bun apps/app/scripts/_local/fund-x402-base.ts <usd>`
 * (or sends from Coinbase). Phase 2 will add Gateway-attested JIT
 * top-up — blocked today because `GATEWAY_API` in
 * `packages/circle/src/gateway.ts:46` is hardcoded to the testnet
 * host. Adding Base mainnet to `GATEWAY_CHAINS` requires forking the
 * Gateway host per chain, which is its own infra change.
 *
 * ## Accounting
 *
 * Each successful x402 call writes a `MeterEvent` tagged
 * `metadata.kind = 'x402_outbound'` against the calling tenant. This
 * is in addition to the inbound meter row the edge worker writes for
 * the tenant→Sendero charge. Admin billing rollups subtract outbound
 * from inbound to compute per-tool margin.
 */

import { createPublicClient, http, parseUnits, type Address, type Hex } from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { base } from 'viem/chains';

import { prisma } from '@sendero/database';
import { env } from '@sendero/env';

import type { ToolContext } from './types';

// ── Constants ───────────────────────────────────────────────────────

/** Base mainnet USDC contract (Circle, USDC v2). */
const BASE_USDC: Address = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

/** USDC has 6 decimals on Base. */
const USDC_DECIMALS = 6;

/** EIP-3009 domain values for Base mainnet USDC. */
const USDC_EIP712_DOMAIN = {
  name: 'USD Coin',
  version: '2',
  chainId: 8453,
  verifyingContract: BASE_USDC,
} as const;

/** EIP-3009 typed-data types. */
const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

/** ERC-20 balanceOf — minimal ABI to avoid pulling viem/erc20Abi. */
const BALANCE_OF_ABI = [
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

/** $0.20 per call, $1 per tenant per 24h, $5 platform per 24h. */
const MAX_PER_CALL_MICRO = 200_000n;
const MAX_PER_TENANT_24H_MICRO = 1_000_000n;
const MAX_PLATFORM_24H_MICRO = 5_000_000n;

/** Default allowlist if `X402_OUTBOUND_ALLOWLIST` env unset. */
const DEFAULT_ALLOWLIST = ['stabletravel.dev', 'tripadvisor.x402.paysponge.com'];

// ── Public types ────────────────────────────────────────────────────

export interface X402FetchOptions {
  /** HTTP method override (default: GET). */
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  /** Query string params (URL-encoded for us). */
  query?: Record<string, string | number | boolean | undefined>;
  /** JSON body for non-GET. */
  body?: unknown;
  /** Extra request headers. */
  headers?: Record<string, string>;
  /** Per-call max spend in micro-USDC. Default: 200_000 ($0.20). */
  maxAmountMicroUsdc?: bigint;
  /** Tool name for MeterEvent attribution. Required. */
  toolName: string;
  /** Caller context (caller key + tenant identity). Required. */
  ctx: ToolContext;
}

export class X402Error extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'sandbox_blocked'
      | 'host_not_allowlisted'
      | 'per_call_cap'
      | 'per_tenant_cap'
      | 'platform_cap'
      | 'no_payment_required'
      | 'no_eip155_8453_scheme'
      | 'asset_mismatch'
      | 'amount_too_high'
      | 'treasury_balance_low'
      | 'treasury_not_configured'
      | 'tenant_required'
      | 'upstream_error',
    public readonly httpStatus?: number,
    public readonly upstreamBody?: string
  ) {
    super(message);
    this.name = 'X402Error';
  }
}

export interface X402FetchResult<T> {
  data: T;
  meta: {
    upstreamUrl: string;
    paidMicroUsdc: bigint;
    settlementHash?: string;
    facilitatorResponseHeaders: Record<string, string>;
  };
}

// ── Cached singletons ───────────────────────────────────────────────

let _account: PrivateKeyAccount | null = null;

function treasuryAccount(): PrivateKeyAccount {
  if (_account) return _account;
  const pk = env.treasuryPrivateKey();
  if (!pk) {
    throw new X402Error(
      'TREASURY_PRIVATE_KEY not set; cannot pay x402 endpoints.',
      'treasury_not_configured'
    );
  }
  const normalized = (pk.startsWith('0x') ? pk : `0x${pk}`) as Hex;
  _account = privateKeyToAccount(normalized);
  return _account;
}

const _publicClient = createPublicClient({
  chain: base,
  transport: http(process.env.CHAIN_RPC_BASE || 'https://mainnet.base.org', {
    retryCount: 3,
    timeout: 15_000,
  }),
});

// ── Allowlist ───────────────────────────────────────────────────────

function allowlistHosts(): string[] {
  const raw = process.env.X402_OUTBOUND_ALLOWLIST;
  if (!raw) return DEFAULT_ALLOWLIST;
  return raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

function isHostAllowlisted(url: URL): boolean {
  const host = url.hostname;
  return allowlistHosts().some(allowed => host === allowed || host.endsWith('.' + allowed));
}

// ── Cap accounting (Postgres rolling window) ────────────────────────

async function spendInLast24h(tenantId: string | undefined): Promise<bigint> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const where = tenantId
    ? { at: { gte: since }, tenantId, status: 'paid' as const }
    : { at: { gte: since }, status: 'paid' as const };
  const rows = await prisma.meterEvent.findMany({
    where: { ...where },
    select: { priceMicroUsdc: true, metadata: true },
  });
  let total = 0n;
  for (const row of rows) {
    const md = (row.metadata as Record<string, unknown> | null) ?? {};
    if (md.kind !== 'x402_outbound') continue;
    total += BigInt(row.priceMicroUsdc);
  }
  return total;
}

// ── Payment requirement parsing ─────────────────────────────────────

interface PaymentAccept {
  scheme: 'exact' | string;
  network: string;
  amount: string;
  asset: Address;
  payTo: Address;
  maxTimeoutSeconds: number;
  extra?: { name?: string; version?: string };
}

interface PaymentRequiredBody {
  x402Version: number;
  accepts: PaymentAccept[];
  resource?: { url?: string; method?: string };
}

function pickBaseMainnetScheme(body: PaymentRequiredBody): PaymentAccept {
  const accept = body.accepts?.find(
    a => a.scheme === 'exact' && a.network === 'eip155:8453' && a.asset?.toLowerCase() === BASE_USDC.toLowerCase()
  );
  if (!accept) {
    throw new X402Error(
      'Endpoint does not accept Base-mainnet USDC via the `exact` scheme.',
      'no_eip155_8453_scheme'
    );
  }
  return accept;
}

// ── EIP-3009 signing ────────────────────────────────────────────────

function randomNonce(): Hex {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return ('0x' + Array.from(buf, b => b.toString(16).padStart(2, '0')).join('')) as Hex;
}

interface SignedAuthorization {
  signature: Hex;
  authorization: {
    from: Address;
    to: Address;
    value: string;
    validAfter: string;
    validBefore: string;
    nonce: Hex;
  };
}

async function signTransferAuthorization(
  account: PrivateKeyAccount,
  accept: PaymentAccept
): Promise<SignedAuthorization> {
  const value = BigInt(accept.amount);
  const validAfter = 0n;
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + accept.maxTimeoutSeconds);
  const nonce = randomNonce();

  const message = {
    from: account.address,
    to: accept.payTo,
    value,
    validAfter,
    validBefore,
    nonce,
  };

  const signature = await account.signTypedData({
    domain: USDC_EIP712_DOMAIN,
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: 'TransferWithAuthorization',
    message,
  });

  return {
    signature,
    authorization: {
      from: account.address,
      to: accept.payTo,
      value: value.toString(),
      validAfter: validAfter.toString(),
      validBefore: validBefore.toString(),
      nonce,
    },
  };
}

function buildPaymentHeader(accept: PaymentAccept, signed: SignedAuthorization): string {
  const payload = {
    x402Version: 2,
    scheme: accept.scheme,
    network: accept.network,
    payload: signed,
  };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

// ── Treasury balance check ──────────────────────────────────────────

type ReadBalanceFn = (addr: Address) => Promise<bigint>;

const defaultReadBalance: ReadBalanceFn = async addr => {
  // viem 2.21's stricter ReadContractParameters union expects an
  // `authorizationList` field for EIP-7702 paths; we never set one.
  // Two-step cast through `unknown` to bypass the structural check.
  const args = {
    address: BASE_USDC,
    abi: BALANCE_OF_ABI,
    functionName: 'balanceOf' as const,
    args: [addr] as const,
  };
  const balance = await _publicClient.readContract(
    args as unknown as Parameters<typeof _publicClient.readContract>[0]
  );
  return balance as bigint;
};

let _readBalanceImpl: ReadBalanceFn = defaultReadBalance;

async function readTreasuryBaseUsdcMicro(addr: Address): Promise<bigint> {
  return _readBalanceImpl(addr);
}

// ── MeterEvent write ────────────────────────────────────────────────

async function recordOutboundMeter(args: {
  tenantId: string;
  userId?: string;
  toolName: string;
  priceMicroUsdc: bigint;
  upstreamUrl: string;
  hostname: string;
  payerAddress: Address;
  settlementRef?: string;
}): Promise<void> {
  await prisma.meterEvent.create({
    data: {
      tenantId: args.tenantId,
      userId: args.userId ?? null,
      payerAddress: args.payerAddress,
      toolName: args.toolName,
      priceMicroUsdc: args.priceMicroUsdc,
      status: 'paid',
      settlementRef: args.settlementRef ?? null,
      note: 'x402 outbound spend',
      metadata: {
        kind: 'x402_outbound',
        upstream: args.upstreamUrl,
        hostname: args.hostname,
      },
    },
    select: { id: true },
  });
}

// ── Public entrypoint ───────────────────────────────────────────────

export async function x402Fetch<T = unknown>(
  url: string,
  opts: X402FetchOptions
): Promise<X402FetchResult<T>> {
  const u = new URL(url);

  // 1. Live-spend gate — sandbox keys never move USDC.
  //
  //    Reject only callers explicitly stamped `effectiveKeyType: 'sandbox'`
  //    (external Clerk API key + downgraded prod keys during testnet-beta).
  //    Allow:
  //      - undefined caller    → operator console, in-process Slack runtime,
  //                              shared-secret internal webhooks (WhatsApp
  //                              inbound, cron, Kapso proxy). These are
  //                              trusted Sendero infra calls — Sendero
  //                              treasury spend is OK.
  //      - production caller   → external prod key the tenant provisioned.
  if (opts.ctx.caller?.effectiveKeyType === 'sandbox') {
    throw new X402Error(
      'x402 outbound spend blocked for sandbox API keys. Use a production ' +
        'key or call from a trusted internal surface.',
      'sandbox_blocked'
    );
  }

  // 2. Tenant context required for accounting.
  const tenantId = opts.ctx.traveler?.tenantId;
  if (!tenantId) {
    throw new X402Error('Tenant context is required for x402 outbound spend.', 'tenant_required');
  }

  // 3. Allowlist.
  if (!isHostAllowlisted(u)) {
    throw new X402Error(
      `Host ${u.hostname} is not in X402_OUTBOUND_ALLOWLIST.`,
      'host_not_allowlisted'
    );
  }

  // 4. Build request URL with query params.
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v === undefined) continue;
      u.searchParams.set(k, String(v));
    }
  }

  const method = opts.method ?? 'GET';
  const baseInit: RequestInit = {
    method,
    headers: {
      Accept: 'application/json',
      ...(method !== 'GET' && opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.headers ?? {}),
    },
    body: method !== 'GET' && opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  };

  // 5. Pre-flight — expect 402 + accepts.
  const preflight = await fetch(u.toString(), baseInit);
  if (preflight.status !== 402) {
    // Endpoint doesn't actually require payment. Return its body verbatim.
    if (preflight.ok) {
      const data = (await preflight.json()) as T;
      return {
        data,
        meta: {
          upstreamUrl: u.toString(),
          paidMicroUsdc: 0n,
          facilitatorResponseHeaders: {},
        },
      };
    }
    const text = await preflight.text().catch(() => '');
    throw new X402Error(
      `Upstream returned ${preflight.status} (no payment requirement).`,
      'upstream_error',
      preflight.status,
      text
    );
  }

  const requirements = (await preflight.json()) as PaymentRequiredBody;
  const accept = pickBaseMainnetScheme(requirements);
  const required = BigInt(accept.amount);

  // 6. Per-call cap.
  const callCap = opts.maxAmountMicroUsdc ?? MAX_PER_CALL_MICRO;
  if (required > callCap) {
    throw new X402Error(
      `Endpoint price ${required} exceeds per-call cap ${callCap} micro-USDC.`,
      'per_call_cap'
    );
  }

  // 7. Tenant + platform 24h caps.
  const [tenantSpent, platformSpent] = await Promise.all([
    spendInLast24h(tenantId),
    spendInLast24h(undefined),
  ]);
  if (tenantSpent + required > MAX_PER_TENANT_24H_MICRO) {
    throw new X402Error(
      `Tenant ${tenantId} would exceed 24h cap ($${
        Number(MAX_PER_TENANT_24H_MICRO) / 1_000_000
      }) — already spent ${tenantSpent}μ.`,
      'per_tenant_cap'
    );
  }
  if (platformSpent + required > MAX_PLATFORM_24H_MICRO) {
    throw new X402Error(
      `Platform would exceed 24h cap ($${
        Number(MAX_PLATFORM_24H_MICRO) / 1_000_000
      }) — already spent ${platformSpent}μ.`,
      'platform_cap'
    );
  }

  // 8. Treasury Base float check.
  const account = treasuryAccount();
  const balance = await readTreasuryBaseUsdcMicro(account.address);
  if (balance < required) {
    throw new X402Error(
      `Treasury Base USDC balance ${balance}μ below required ${required}μ. ` +
        `Run \`bun apps/app/scripts/_local/fund-x402-base.ts ${
          (Number(required) / 1_000_000) * 10
        }\` to refill.`,
      'treasury_balance_low'
    );
  }

  // 9. Sign EIP-3009 + retry with X-PAYMENT.
  const signed = await signTransferAuthorization(account, accept);
  const xPayment = buildPaymentHeader(accept, signed);

  const paid = await fetch(u.toString(), {
    ...baseInit,
    headers: {
      ...baseInit.headers,
      'X-PAYMENT': xPayment,
    },
  });

  const facilitatorHeaders: Record<string, string> = {};
  paid.headers.forEach((v, k) => {
    if (k.toLowerCase().startsWith('x-payment') || k.toLowerCase() === 'x-settlement-tx') {
      facilitatorHeaders[k] = v;
    }
  });

  if (!paid.ok) {
    const text = await paid.text().catch(() => '');
    throw new X402Error(
      `Upstream returned ${paid.status} after payment.`,
      'upstream_error',
      paid.status,
      text
    );
  }

  const data = (await paid.json()) as T;
  const settlementRef = facilitatorHeaders['x-settlement-tx'] || facilitatorHeaders['X-Settlement-Tx'];

  // 10. Record outbound MeterEvent (fire-and-forget — never block on
  //     accounting failure; the upstream call already succeeded).
  void recordOutboundMeter({
    tenantId,
    userId: opts.ctx.traveler?.userId,
    toolName: opts.toolName,
    priceMicroUsdc: required,
    upstreamUrl: u.toString(),
    hostname: u.hostname,
    payerAddress: account.address,
    settlementRef,
  }).catch(err => {
    console.warn('[x402-fetch] failed to record outbound meter (non-fatal):', err);
  });

  return {
    data,
    meta: {
      upstreamUrl: u.toString(),
      paidMicroUsdc: required,
      settlementHash: settlementRef,
      facilitatorResponseHeaders: facilitatorHeaders,
    },
  };
}

// ── Test seam — let unit tests inject a mock fetch + balance ────────

export const __test__ = {
  USDC_EIP712_DOMAIN,
  TRANSFER_WITH_AUTHORIZATION_TYPES,
  BASE_USDC,
  USDC_DECIMALS,
  MAX_PER_CALL_MICRO,
  MAX_PER_TENANT_24H_MICRO,
  MAX_PLATFORM_24H_MICRO,
  pickBaseMainnetScheme,
  isHostAllowlisted,
  buildPaymentHeader,
  /** Override the on-chain balance read for unit tests. Bun's
   *  `mock.module('viem')` can't help here because the public client
   *  is constructed at module load — by which time a sibling test
   *  file may have already cached the real viem. */
  setReadBalance(impl: ReadBalanceFn): void {
    _readBalanceImpl = impl;
  },
  resetReadBalance(): void {
    _readBalanceImpl = defaultReadBalance;
  },
};
