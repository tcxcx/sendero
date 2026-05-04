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
import { BridgeKit } from '@circle-fin/bridge-kit';
import * as bridgeChains from '@circle-fin/bridge-kit/chains';
import { createCircleWalletsAdapter } from '@circle-fin/adapter-circle-wallets';
import type { ViemAdapter } from '@circle-fin/adapter-viem-v2';
import bs58 from 'bs58';
import type { Address } from 'viem';

import { prisma } from '@sendero/database';
import { env } from '@sendero/env';

import { createAdapterForSigner, getTreasuryAddress, getTreasuryAdapter } from './app-kit';
import { GATEWAY_CHAINS, queryUnifiedBalance } from './gateway';

export type GatewayChainKey = keyof typeof GATEWAY_CHAINS;

// ── Kit singletons ────────────────────────────────────────────────

let _appKit: AppKit | null = null;
function appKit(): AppKit {
  _appKit ??= new AppKit();
  return _appKit;
}

let _bridgeKit: BridgeKit | null = null;
function bridgeKit(): BridgeKit {
  _bridgeKit ??= new BridgeKit();
  return _bridgeKit;
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
 *
 * Patches `getTokenDecimals` onto the returned adapter. Bridge Kit
 * requires this method on every adapter; the `HybridAdapter` base
 * from `@circle-fin/adapter-circle-wallets` doesn't implement it
 * (known SDK gap, see desk-v1 multisig-unified-balance-kit/packages/circle/src/bridging).
 * USDC and EURC are 6-decimal across every chain Sendero supports.
 */
export function circleWalletsPrincipal(args: {
  address: string;
  label?: string;
}): Principal | null {
  const apiKey = env.circleApiKey?.();
  const entitySecret = env.circleEntitySecret?.();
  if (!apiKey || !entitySecret) return null;
  const adapter = createCircleWalletsAdapter({ apiKey, entitySecret }) as ReturnType<
    typeof createCircleWalletsAdapter
  > & {
    getTokenDecimals?: (tokenAddress: string, chain: unknown) => Promise<number>;
  };
  if (typeof adapter.getTokenDecimals !== 'function') {
    adapter.getTokenDecimals = async () => 6;
  }
  return {
    kind: 'circle-wallets',
    adapter,
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
  await maybeTopUpSolanaGas(args.principal, args.chainKey);
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
  await maybeTopUpSolanaGas(args.principal, args.chainKey);
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
  // Top up SOL on every Solana source — `kit.unifiedBalance.spend`
  // burns on each source chain, and the Solana-side burn needs SOL
  // gas. JIT-funds in parallel, fail-soft.
  await Promise.all(
    args.sources.map(s => {
      const principal = s.principal;
      if (principal.kind !== 'circle-wallets') return Promise.resolve();
      // Heuristic: top up if the source chain key looks Solana-shaped
      // via the source allocation (when explicit allocations were
      // given) or principal address (Solana base58 vs EVM 0x-hex).
      const isSolanaPrincipal = !principal.address.startsWith('0x');
      if (!isSolanaPrincipal) return Promise.resolve();
      return ensureSolanaGas({ address: principal.address }).then(() => undefined);
    })
  );
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

// ── Solana gas abstraction (JIT top-up from platform wallet) ──────

/**
 * Whether a chain key targets the Solana cluster. Used to gate the
 * SOL-gas top-up before any Solana-side signing operation.
 */
export function isSolanaChainKey(chainKey: GatewayChainKey): boolean {
  return chainKey === 'Sol_Devnet' || chainKey === 'Sol';
}

export interface EnsureSolanaGasArgs {
  /** Base58 Solana pubkey of the DCW that will sign the next op. */
  address: string;
  /** Drip threshold in lamports. Below this we top up. */
  minLamports?: number;
  /** Top-up target in lamports. Default 0.01 SOL — enough for ~50 txs. */
  topUpLamports?: number;
}

export interface EnsureSolanaGasResult {
  topped: boolean;
  /** Final balance in lamports after any top-up. */
  lamports: number;
  /** Solana tx signature when a top-up actually happened. */
  txSignature?: string;
  /** When skipped, why. */
  reason?: 'sufficient' | 'platform_wallet_not_configured' | 'topup_failed';
  error?: string;
}

const DEFAULT_MIN_LAMPORTS = 5_000_000; // 0.005 SOL
const DEFAULT_TOPUP_LAMPORTS = 10_000_000; // 0.01 SOL
/** Default alert threshold for the platform hot wallet — 0.5 SOL. */
const DEFAULT_PLATFORM_LOW_LAMPORTS = 500_000_000;

/**
 * Alert callback fired AFTER a successful JIT top-up when the platform
 * wallet's remaining balance falls below the alert threshold. Apps
 * register this once at boot so unified-gateway stays decoupled from
 * notification infrastructure (Liveblocks, Slack, email, etc.).
 *
 * Default: no-op. Sendero registers a Liveblocks `agent:customer-support`
 * inbox notification in `apps/app/instrumentation.ts`, which fans out
 * to Slack + WhatsApp + the app inbox via the existing Liveblocks
 * webhook fanout.
 */
let _platformLowAlertCb:
  | ((info: {
      platformAddress: string;
      lamports: number;
      thresholdLamports: number;
    }) => Promise<void> | void)
  | null = null;

export function setSolanaPlatformLowAlertCallback(
  cb: NonNullable<typeof _platformLowAlertCb> | null
): void {
  _platformLowAlertCb = cb;
}

/**
 * Drip SOL into a DCW so it can pay fees on the next Gateway
 * deposit/spend/bridge transaction. Circle DCWs on Solana are
 * regular Solana accounts that must hold lamports — Circle Gas
 * Station is EVM-only. Without this, every Solana deposit fails
 * with "Insufficient SOL".
 *
 * Source of funds: `SENDERO_SOLANA_PLATFORM_PRIVATE_KEY` env (base58).
 * Same operational pattern as the EVM sponsor EOA we already run, just
 * scoped to Solana. desk-v1's UB-kit migration post-mortem #5 calls
 * out per-account gas funding as the right shape ("operationally
 * untenable at fleet scale" without it).
 *
 * Idempotent at the threshold check — already-funded wallets short-
 * circuit without an RPC write. Fail-soft: when the platform wallet
 * is unconfigured, returns `{ topped: false, reason: 'platform_wallet_not_configured' }`
 * so callers can log and let the SDK surface the real "Insufficient
 * SOL" error rather than crash this side-channel.
 */
export async function ensureSolanaGas(args: EnsureSolanaGasArgs): Promise<EnsureSolanaGasResult> {
  const minLamports = args.minLamports ?? DEFAULT_MIN_LAMPORTS;
  const topUpLamports = args.topUpLamports ?? DEFAULT_TOPUP_LAMPORTS;

  // Lazy import @solana/web3.js — keeps it out of the cold-path bundle
  // for callers that never touch Solana.
  const { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } =
    await import('@solana/web3.js');

  const rpcUrl = env.senderoSolanaRpcUrl?.() ?? 'https://api.devnet.solana.com';
  const conn = new Connection(rpcUrl, 'confirmed');
  const dcwPubkey = new PublicKey(args.address);
  const currentLamports = await conn.getBalance(dcwPubkey);

  if (currentLamports >= minLamports) {
    return { topped: false, lamports: currentLamports, reason: 'sufficient' };
  }

  const platformKey = env.senderoSolanaPlatformPrivateKey?.();
  if (!platformKey) {
    return {
      topped: false,
      lamports: currentLamports,
      reason: 'platform_wallet_not_configured',
    };
  }

  try {
    const platformKeypair = Keypair.fromSecretKey(bs58.decode(platformKey));
    const transferLamports = topUpLamports - currentLamports;
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: platformKeypair.publicKey,
        toPubkey: dcwPubkey,
        lamports: transferLamports,
      })
    );
    const signature = await sendAndConfirmTransaction(conn, tx, [platformKeypair]);
    const newBalance = await conn.getBalance(dcwPubkey);
    console.log('[unifiedGateway.ensureSolanaGas] topped up', {
      address: args.address,
      transferLamports,
      newBalance,
      txSignature: signature,
    });

    // Platform-wallet low-balance alert. Fires once per top-up that
    // crosses the threshold so ops sees a fresh signal instead of a
    // background cron drone. Fail-soft — alert errors must not poison
    // the deposit path that already succeeded.
    if (_platformLowAlertCb) {
      try {
        const platformLamports = await conn.getBalance(platformKeypair.publicKey);
        if (platformLamports < DEFAULT_PLATFORM_LOW_LAMPORTS) {
          await _platformLowAlertCb({
            platformAddress: platformKeypair.publicKey.toBase58(),
            lamports: platformLamports,
            thresholdLamports: DEFAULT_PLATFORM_LOW_LAMPORTS,
          });
        }
      } catch (alertErr) {
        console.warn('[unifiedGateway.ensureSolanaGas] low-balance alert failed (non-fatal)', {
          error: alertErr instanceof Error ? alertErr.message : String(alertErr),
        });
      }
    }

    return { topped: true, lamports: newBalance, txSignature: signature };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[unifiedGateway.ensureSolanaGas] top-up failed', {
      address: args.address,
      error: message,
    });
    return {
      topped: false,
      lamports: currentLamports,
      reason: 'topup_failed',
      error: message,
    };
  }
}

/**
 * Internal: run JIT gas top-up before a Solana-side op when the
 * principal is a Circle DCW. No-op for everything else.
 */
async function maybeTopUpSolanaGas(principal: Principal, chainKey: GatewayChainKey): Promise<void> {
  if (principal.kind !== 'circle-wallets') return;
  if (!isSolanaChainKey(chainKey)) return;
  const result = await ensureSolanaGas({ address: principal.address });
  if (result.reason === 'platform_wallet_not_configured') {
    console.warn(
      '[unifiedGateway] Solana platform wallet not configured — proceeding without JIT top-up; deposit may fail with "Insufficient SOL"',
      { address: principal.address }
    );
  }
}

// ── Bridge (CCTP cross-chain via Bridge Kit) ──────────────────────

/**
 * Sendero `GatewayChainKey` → Bridge Kit `ChainDefinition`. Bridge
 * Kit ships its own enum for chain identity (separate from App Kit's
 * `UnifiedBalanceChain`); the mapping is one-way. Only chains we
 * actually bridge to/from need entries here — extend as Sendero
 * supports more.
 */
function bridgeChainFor(chainKey: GatewayChainKey): unknown {
  const map: Record<string, unknown> = {
    Arc_Testnet: bridgeChains.ArcTestnet,
    Ethereum_Sepolia: bridgeChains.EthereumSepolia,
    Base_Sepolia: bridgeChains.BaseSepolia,
    Avalanche_Fuji: bridgeChains.AvalancheFuji,
    Optimism_Sepolia: bridgeChains.OptimismSepolia,
    Arbitrum_Sepolia: bridgeChains.ArbitrumSepolia,
    Polygon_Amoy: bridgeChains.PolygonAmoy,
    Sol_Devnet: bridgeChains.SolanaDevnet,
    Sol: bridgeChains.Solana,
  };
  const def = map[chainKey];
  if (!def) {
    throw new Error(`unifiedGateway.bridge: no Bridge Kit chain definition for ${chainKey}`);
  }
  return def;
}

export interface BridgeArgs {
  /** Source principal — signs the burn on the source chain. */
  principal: Principal;
  fromChainKey: GatewayChainKey;
  toChainKey: GatewayChainKey;
  /** Address that receives minted USDC on the destination chain. */
  recipient: string;
  /**
   * Adapter context address on the destination chain. The Circle
   * Wallets adapter is multi-wallet; `to.address` tells the SDK
   * which DCW to use as the destination signing context (typically
   * a Sendero-controlled DCW on the dest chain). Falls back to the
   * recipient when omitted, which works when the recipient itself
   * is a DCW we manage. Different from `recipientAddress` (which is
   * always the actual on-chain receiver).
   */
  toAddress?: string;
  amount: string;
  token?: SupportedToken;
}

export interface BridgeResult {
  txHash: string;
  explorerUrl?: string;
  raw: unknown;
}

/**
 * Cross-chain USDC transfer via Circle CCTP v2 (Bridge Kit). Burns
 * on `fromChainKey`, mints on `toChainKey`. Used for Solana → EVM
 * sweeps when keeping balance in-place isn't practical, and for any
 * other cross-chain move that doesn't fit the Gateway unified-balance
 * model.
 *
 * The source-side burn needs gas in the `principal`'s native token.
 * For Solana sources, JIT-tops up via `ensureSolanaGas` first.
 */
export async function bridge(args: BridgeArgs): Promise<BridgeResult> {
  await maybeTopUpSolanaGas(args.principal, args.fromChainKey);

  const fromChain = bridgeChainFor(args.fromChainKey);
  const toChain = bridgeChainFor(args.toChainKey);

  const result = (await bridgeKit().bridge({
    from: {
      adapter: args.principal.adapter,
      chain: fromChain,
      address: args.principal.address,
    },
    to: {
      adapter: args.principal.adapter,
      chain: toChain,
      address: args.toAddress ?? args.recipient,
      recipientAddress: args.recipient,
    },
    amount: args.amount,
    token: args.token ?? 'USDC',
  } as never)) as { txHash?: string; transactionHash?: string; explorerUrl?: string };

  const txHash = result.txHash ?? result.transactionHash;
  if (!txHash) throw new Error('unifiedGateway.bridge: SDK returned no txHash');
  return { txHash, explorerUrl: result.explorerUrl, raw: result };
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
