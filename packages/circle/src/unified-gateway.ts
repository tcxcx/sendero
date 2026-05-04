/**
 * `@sendero/circle/unified-gateway` — single canonical surface for
 * everything Circle Gateway / Unified Balance.
 *
 * Verified against the Arc/Circle docs (App Kit 1.4):
 *   - Deposit:      https://docs.arc.network/app-kit/quickstarts/unified-balance-deposit-and-spend
 *   - DepositFor:   https://docs.arc.network/app-kit/quickstarts/unified-balance-delegate-deposit-and-spend
 *   - Balances:     https://docs.arc.network/app-kit/tutorials/unified-balance/check-unified-balance
 *   - RemoveFund:   https://docs.arc.network/app-kit/tutorials/unified-balance/remove-funds-trustlessly
 *   - Fees:         https://docs.arc.network/app-kit/concepts/unified-balance-fees
 *
 * Every Gateway operation funnels through one `AppKit` instance — App
 * Kit 1.4's `kit.unifiedBalance.*` namespace exposes deposit,
 * depositFor, spend, estimateSpend, getBalances, addDelegate,
 * removeDelegate, getDelegateStatus, initiateRemoveFund, removeFund.
 * No `UnifiedBalanceKit` import — App Kit subsumes it.
 *
 * ## Mental model
 *
 *   Principal — *who is signing the on-chain action*
 *     viem            → EOA private key (tenant treasury, UB delegate,
 *                       per-tenant gateway signer)
 *     circle-wallets  → Circle DCW resolved by address (traveler,
 *                       ops sweep, Circle delegate)
 *
 *   Operation — *what the principal is doing*
 *     deposit         → credit principal's own Gateway balance
 *     depositFor      → principal pays, balance credited to a third address
 *     spend           → burn one or more sources, mint elsewhere
 *     estimateSpend   → preview fees + allocations without signing
 *     getBalances     → read SDK balances (by adapter or address)
 *     queryDepositorBalances → REST fallback when no adapter is on hand
 *     addDelegate / removeDelegate / getDelegateStatus
 *     initiateRemoveFund / removeFund — trustless escape hatch
 *
 * KISS: one file, flat exports, no class hierarchy. DRY: every kit
 * instantiation, every chain-name mapping, every adapter factory call
 * goes through here.
 */

import { AppKit } from '@circle-fin/app-kit';
import { createCircleWalletsAdapter } from '@circle-fin/adapter-circle-wallets';
import type { ViemAdapter } from '@circle-fin/adapter-viem-v2';
import type { Address } from 'viem';

import { prisma } from '@sendero/database';
import { env } from '@sendero/env';

import { createAdapterForSigner, getTreasuryAddress, getTreasuryAdapter } from './app-kit';
import { GATEWAY_CHAINS, queryUnifiedBalance } from './gateway';

export type GatewayChainKey = keyof typeof GATEWAY_CHAINS;

// ── Kit singleton ─────────────────────────────────────────────────

let _appKit: AppKit | null = null;
function appKit(): AppKit {
  _appKit ??= new AppKit();
  return _appKit;
}

/**
 * Direct access to the underlying AppKit — escape hatch for code that
 * needs `bridge`, `swap`, `send` (top-level CCTP / DEX), or any
 * `kit.unifiedBalance.*` method this module hasn't wrapped yet.
 */
export function getAppKitInstance(): AppKit {
  return appKit();
}

/**
 * Direct access to the unified-balance namespace — convenient for the
 * few advanced flows (`transfer-spend/execute` multi-source fan-out)
 * that build raw spend params. Same singleton, no second instance.
 */
export function getUnifiedBalanceNamespace() {
  return appKit().unifiedBalance;
}

// ── Chain-name normalization (single source of truth) ──────────────

/**
 * Map a Sendero `GATEWAY_CHAINS` key to the chain identifier App Kit's
 * `UnifiedBalanceChain` enum expects. Solana entries diverge: Sendero
 * stores `Sol_Devnet` / `Sol`; App Kit wants `Solana_Devnet` / `Solana`.
 * EVM entries pass through.
 */
export function unifiedBalanceChainName(chainKey: GatewayChainKey): string {
  if (chainKey === 'Sol_Devnet') return 'Solana_Devnet';
  if (chainKey === 'Sol') return 'Solana';
  return GATEWAY_CHAINS[chainKey].kitName;
}

// ── Principals ────────────────────────────────────────────────────

/**
 * Discriminated union over the two adapter shapes Sendero uses.
 *
 * - `viem` — single-wallet adapter; the address is derived from the
 *   private key. Passing `address` in the SDK call is harmless because
 *   the adapter validates it matches.
 * - `circle-wallets` — multi-wallet "fleet" adapter; one adapter
 *   handles all DCWs for an entity. Address is REQUIRED on every SDK
 *   call to disambiguate which DCW signs.
 */
export type Principal =
  | { kind: 'viem'; adapter: ViemAdapter; address: Address; label: string }
  | {
      kind: 'circle-wallets';
      adapter: ReturnType<typeof createCircleWalletsAdapter>;
      address: string;
      label: string;
    };

/** Per-tenant gateway signer EOA (`UserGatewaySigner` row). */
export function viemPrincipal(args: {
  privateKey: `0x${string}`;
  address: Address;
  label?: string;
}): Principal {
  return {
    kind: 'viem',
    adapter: createAdapterForSigner(args.privateKey),
    address: args.address,
    label: args.label ?? `viem:${args.address}`,
  };
}

/** Platform treasury (`TREASURY_PRIVATE_KEY`). Returns null when env unset. */
export function treasuryPrincipal(): Principal | null {
  let adapter: ViemAdapter;
  let address: string;
  try {
    adapter = getTreasuryAdapter();
    address = getTreasuryAddress();
  } catch {
    return null;
  }
  return {
    kind: 'viem',
    adapter,
    address: address as Address,
    label: `treasury:${address}`,
  };
}

/** Unified Balance delegate EOA (`SENDERO_UB_DELEGATE_PRIVATE_KEY`). */
export function delegateViemPrincipal(): Principal | null {
  const key = env.unifiedBalanceDelegateKey?.();
  if (!key) return null;
  const normalized = (key.startsWith('0x') ? key : `0x${key}`) as `0x${string}`;
  return {
    kind: 'viem',
    adapter: createAdapterForSigner(normalized),
    // The viem adapter derives its address from the private key. We
    // surface the zero address only as a placeholder for the
    // discriminated union; spend calls pass `sourceAccount` to point
    // at the user's balance.
    address: '0x0000000000000000000000000000000000000000' as Address,
    label: 'ub-delegate-viem',
  };
}

/**
 * Circle DCW principal — needs the wallet's address to disambiguate
 * within the multi-wallet adapter. Returns null when Circle creds are
 * missing.
 */
export function circleWalletsPrincipal(args: {
  address: string;
  label?: string;
}): Principal | null {
  const apiKey = env.circleApiKey?.();
  const entitySecret = env.circleEntitySecret?.();
  if (!apiKey || !entitySecret) return null;
  return {
    kind: 'circle-wallets',
    adapter: createCircleWalletsAdapter({ apiKey, entitySecret }),
    address: args.address,
    label: args.label ?? `dcw:${args.address}`,
  };
}

/**
 * Resolve a traveler's DCW principal for a given chain. EVM chains
 * share one DCW row (`provisioner='dcw'`); Solana uses its own row
 * (`chainId=5` for Sol Devnet).
 */
export async function resolveTravelerPrincipal(args: {
  userId: string;
  chainKey: GatewayChainKey;
}): Promise<Principal | null> {
  const SOL_DEVNET_CHAIN_ID = 5;
  const isSol = args.chainKey === 'Sol_Devnet' || args.chainKey === 'Sol';
  const wallet = await prisma.wallet.findFirst({
    where: isSol
      ? { userId: args.userId, provisioner: 'dcw', chainId: SOL_DEVNET_CHAIN_ID }
      : { userId: args.userId, provisioner: 'dcw', NOT: { chainId: SOL_DEVNET_CHAIN_ID } },
    orderBy: { createdAt: 'asc' },
    select: { address: true },
  });
  if (!wallet?.address) return null;
  return circleWalletsPrincipal({
    address: wallet.address,
    label: `traveler:${args.userId}:${args.chainKey}`,
  });
}

// ── Operations ─────────────────────────────────────────────────────

export type SupportedToken = 'USDC' | 'EURC';

/**
 * Build the App Kit `from` adapter context for a deposit / depositFor.
 * For viem adapters the docs omit `address` (the adapter knows it from
 * the private key); for Circle Wallets the address is required.
 */
function depositFromContext(principal: Principal, chainKey: GatewayChainKey) {
  if (principal.kind === 'viem') {
    return {
      adapter: principal.adapter,
      chain: unifiedBalanceChainName(chainKey),
    } as const;
  }
  return {
    adapter: principal.adapter,
    chain: unifiedBalanceChainName(chainKey),
    address: principal.address,
  } as const;
}

export interface DepositArgs {
  principal: Principal;
  chainKey: GatewayChainKey;
  amount: string;
  token?: SupportedToken;
}

export interface DepositResult {
  txHash: string;
  explorerUrl?: string;
  raw: unknown;
}

/**
 * Self-deposit — principal funds and credits its own Gateway balance.
 * Mirrors the docs' `kit.unifiedBalance.deposit({ from, amount, token })`.
 */
export async function deposit(args: DepositArgs): Promise<DepositResult> {
  const result = await appKit().unifiedBalance.deposit({
    from: depositFromContext(args.principal, args.chainKey),
    amount: args.amount,
    token: args.token ?? 'USDC',
  } as never);
  const r = result as { txHash?: string; explorerUrl?: string };
  if (!r.txHash) throw new Error('unifiedGateway.deposit: SDK returned no txHash');
  return { txHash: r.txHash, explorerUrl: r.explorerUrl, raw: result };
}

export interface DepositForArgs extends DepositArgs {
  /** Address whose Gateway balance gets credited (≠ principal.address). */
  depositAccount: string;
}

/**
 * Cross-account deposit — principal pays, `depositAccount` is credited.
 * Permissionless on Gateway. Mirrors the docs' delegate-deposit example.
 */
export async function depositFor(args: DepositForArgs): Promise<DepositResult> {
  const result = await appKit().unifiedBalance.depositFor({
    from: depositFromContext(args.principal, args.chainKey),
    amount: args.amount,
    token: args.token ?? 'USDC',
    depositAccount: args.depositAccount,
  } as never);
  const r = result as { txHash?: string; explorerUrl?: string };
  if (!r.txHash) throw new Error('unifiedGateway.depositFor: SDK returned no txHash');
  return { txHash: r.txHash, explorerUrl: r.explorerUrl, raw: result };
}

// ── Spend ──────────────────────────────────────────────────────────

/**
 * One source for a multi-chain spend. Mirrors the docs' `from: [...]`
 * shape — pass an adapter and (optionally) a `sourceAccount` when
 * spending from someone else's balance via delegation.
 */
export interface SpendSource {
  principal: Principal;
  /** When set, spend FROM this address using `principal.adapter` as the
   *  signer — the delegate model. Omit for self-spend. */
  sourceAccount?: string;
}

/**
 * Custom fee — App Kit carves this from the spend amount and routes
 * 90% to `recipientAddress`, 10% to Arc. `recipientAddress` should be
 * on the SOURCE blockchain, not the destination (per docs best
 * practices). Omit to skip fee collection entirely (default).
 *
 * See https://docs.arc.network/app-kit/tutorials/unified-balance/collect-custom-spend-fees
 * and https://docs.arc.network/app-kit/concepts/unified-balance-fees
 * for the full fee breakdown.
 */
export interface CustomFee {
  /** Human-decimal amount carved from the spend (e.g. "0.01" for 1¢). */
  value: string;
  /** Where the 90% recipient share lands. Should live on the source chain. */
  recipientAddress: string;
}

export interface SpendArgs {
  /**
   * Sources to burn from. Pass one for single-chain spends; multiple
   * for unified-balance fan-out. The SDK selects allocations
   * automatically unless `allocations` is supplied.
   */
  sources: SpendSource[];
  /** Destination chain. */
  toChainKey: GatewayChainKey;
  /** Adapter that signs the destination mint. Defaults to `sources[0].principal.adapter`. */
  toAdapter?: SpendSource['principal']['adapter'];
  /** Recipient on the destination chain. */
  recipient: string;
  /** Human-decimal amount (e.g. "10.50"). */
  amount: string;
  token?: SupportedToken;
  /** Explicit chain allocations; SDK auto-allocates when omitted. */
  allocations?: Array<{ amount: string; chain: string }>;
  /** Optional custom fee carved from the spend. Defaults to "no fee". */
  customFee?: CustomFee;
}

export interface SpendResult {
  txHash: string;
  explorerUrl?: string;
  allocations?: Array<{ amount: string; chain: string }>;
  raw: unknown;
}

function buildSpendFrom(args: SpendArgs) {
  if (args.allocations && args.sources[0]) {
    // Allocations override per-source: SDK accepts a single from with
    // allocations + the signer's adapter.
    return {
      adapter: args.sources[0].principal.adapter,
      allocations: args.allocations,
    } as const;
  }
  return args.sources.map(s => {
    const base: { adapter: SpendSource['principal']['adapter']; sourceAccount?: string } = {
      adapter: s.principal.adapter,
    };
    if (s.sourceAccount) base.sourceAccount = s.sourceAccount;
    else if (s.principal.kind === 'circle-wallets') base.sourceAccount = s.principal.address;
    return base;
  });
}

function buildSpendParams(args: SpendArgs) {
  if (args.sources.length === 0) {
    throw new Error('unifiedGateway.spend: at least one source is required.');
  }
  const toAdapter = args.toAdapter ?? args.sources[0].principal.adapter;
  const params: Record<string, unknown> = {
    from: buildSpendFrom(args),
    to: {
      adapter: toAdapter,
      chain: unifiedBalanceChainName(args.toChainKey),
      recipientAddress: args.recipient,
    },
    amount: args.amount,
    token: args.token ?? 'USDC',
  };
  if (args.customFee) {
    params.config = {
      customFee: {
        value: args.customFee.value,
        recipientAddress: args.customFee.recipientAddress,
      },
    };
  }
  return params;
}

export async function spend(args: SpendArgs): Promise<SpendResult> {
  const result = (await appKit().unifiedBalance.spend(buildSpendParams(args) as never)) as {
    txHash: string;
    explorerUrl?: string;
    allocations?: SpendResult['allocations'];
  };
  return {
    txHash: result.txHash,
    explorerUrl: result.explorerUrl,
    allocations: result.allocations,
    raw: result,
  };
}

/**
 * Preview a spend — returns fees + allocations without signing or
 * broadcasting. Use to show the user the fee breakdown before they
 * confirm (see Circle's "fees breakdown" doc). Same `customFee` opt-in
 * as `spend`.
 */
export async function estimateSpend(args: SpendArgs) {
  return appKit().unifiedBalance.estimateSpend(buildSpendParams(args) as never);
}

// ── Balances ──────────────────────────────────────────────────────

export type GetBalancesArgs =
  | {
      kind?: 'principal';
      principal: Principal;
      token?: SupportedToken;
      includePending?: boolean;
    }
  | {
      kind: 'principals';
      principals: Principal[];
      token?: SupportedToken;
      includePending?: boolean;
    }
  | {
      /**
       * Adapter-less balance read by depositor address — the docs'
       * `sources: { address }` form. Useful when the server only knows
       * the user's wallet (delegate scenario, wallet UI, etc.).
       */
      kind: 'address';
      address: string;
      token?: SupportedToken;
      includePending?: boolean;
    };

export async function getBalances(args: GetBalancesArgs) {
  const includePending = args.includePending ?? true;
  const token = args.token ?? 'USDC';
  if (args.kind === 'address') {
    return appKit().unifiedBalance.getBalances({
      sources: { address: args.address },
      token,
      includePending,
      networkType: 'testnet',
    } as never);
  }
  const principals = args.kind === 'principals' ? args.principals : [args.principal];
  return appKit().unifiedBalance.getBalances({
    sources: principals.map(p => ({ adapter: p.adapter })),
    token,
    includePending,
    networkType: 'testnet',
  } as never);
}

/**
 * REST fallback: read any depositor's unified balance without an
 * adapter. Useful for the wallet UI / pollers that watch arbitrary
 * addresses across chains.
 */
export const queryDepositorBalances = queryUnifiedBalance;

// ── Delegates ─────────────────────────────────────────────────────

export interface DelegateArgs {
  /** USER principal — the one whose balance the delegate will spend. */
  principal: Principal;
  chainKey: GatewayChainKey;
  delegateAddress: string;
}

function delegateFromContext(principal: Principal, chainKey: GatewayChainKey) {
  return {
    adapter: principal.adapter,
    chain: unifiedBalanceChainName(chainKey),
  } as const;
}

export async function addDelegate(args: DelegateArgs) {
  return appKit().unifiedBalance.addDelegate({
    from: delegateFromContext(args.principal, args.chainKey),
    delegateAddress: args.delegateAddress,
  } as never);
}

export async function removeDelegate(args: DelegateArgs) {
  return appKit().unifiedBalance.removeDelegate({
    from: delegateFromContext(args.principal, args.chainKey),
    delegateAddress: args.delegateAddress,
  } as never);
}

/** Returns `'none' | 'pending' | 'ready'` per the docs. */
export async function getDelegateStatus(args: DelegateArgs) {
  return appKit().unifiedBalance.getDelegateStatus({
    from: delegateFromContext(args.principal, args.chainKey),
    delegateAddress: args.delegateAddress,
  } as never);
}

// ── EVM-address divergence detection ──────────────────────────────

/**
 * Cross-chain EVM address audit for a single principal (a traveler, a
 * tenant treasury, etc.).
 *
 * Background: Circle Developer-Controlled Wallets (DCW) are usually
 * address-identical across every EVM chain because Circle derives the
 * address deterministically from a counterfactual SCA. Sendero's
 * customer-facing flows (the WhatsApp wallet card) take advantage of
 * this — they print one address with a list of chains it's valid on.
 *
 * That assumption is unsafe when:
 *   - A tenant has BOTH a `treasury` and `operations` CircleWallet on
 *     the same chain (they may diverge).
 *   - A wallet was provisioned via a different path (manual, MSCA
 *     migration) and ended up with a per-chain SCA.
 *   - Future Circle rollouts produce per-chain addresses.
 *
 * If we surface a divergent address as "valid for all EVM chains", a
 * user can deposit to a chain that doesn't actually hold their wallet
 * — and the funds strand. Detect divergence at the data layer and
 * push it out to renderers.
 *
 * @returns canonical address (single) when every entry shares the same
 *   address; otherwise null + the full per-chain map and a divergent
 *   flag the renderer should branch on.
 */
export interface EvmAddressByChain {
  chainKey: GatewayChainKey;
  /** Sendero `GATEWAY_CHAINS[chainKey].label` for human display. */
  label: string;
  address: string;
}

export interface EvmAddressAudit {
  /** Single safe address — populated only when EVERY chain uses the same address. */
  canonical: string | null;
  /** True when at least two chains have different addresses. */
  divergent: boolean;
  /** Per-chain breakdown — always populated, even when canonical is set. */
  perChain: EvmAddressByChain[];
}

export function auditEvmAddresses(
  rows: Array<{ chainKey: GatewayChainKey; address: string }>
): EvmAddressAudit {
  const perChain: EvmAddressByChain[] = rows.map(r => ({
    chainKey: r.chainKey,
    label: GATEWAY_CHAINS[r.chainKey]?.label ?? r.chainKey,
    address: r.address,
  }));
  if (perChain.length === 0) {
    return { canonical: null, divergent: false, perChain };
  }
  const first = perChain[0].address.toLowerCase();
  const divergent = perChain.some(p => p.address.toLowerCase() !== first);
  return {
    canonical: divergent ? null : perChain[0].address,
    divergent,
    perChain,
  };
}

// ── Trustless removal (escape hatch) ──────────────────────────────

export interface RemoveFundArgs {
  principal: Principal;
  chainKey: GatewayChainKey;
}

export interface InitiateRemoveFundArgs extends RemoveFundArgs {
  amount: string;
  token?: SupportedToken;
}

/**
 * Step 1 of the trustless escape hatch — record the removal request
 * and start the 7-day waiting window on EVM (immediate on Solana).
 * See https://docs.arc.network/app-kit/tutorials/unified-balance/remove-funds-trustlessly
 */
export async function initiateRemoveFund(args: InitiateRemoveFundArgs) {
  return appKit().unifiedBalance.initiateRemoveFund({
    from: delegateFromContext(args.principal, args.chainKey),
    amount: args.amount,
    token: args.token ?? 'USDC',
  } as never);
}

/**
 * Step 2 of the trustless escape hatch — withdraw the funds back to
 * the wallet for the adapter on the specified chain. EVM requires the
 * 7-day window to elapse first.
 */
export async function removeFund(args: RemoveFundArgs) {
  return appKit().unifiedBalance.removeFund({
    from: delegateFromContext(args.principal, args.chainKey),
  } as never);
}
