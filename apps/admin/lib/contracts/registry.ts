/**
 * Single source of truth for every Sendero contract / program a
 * superadmin manages.
 *
 * Update this list whenever a deploy lands. Three things that depend
 * on it:
 *   - `/dashboard/contracts` page renders rows from this registry.
 *   - `scripts/verify-deployments.ts` audit (re-uses the Arc subset).
 *   - Future ops automation (alerting, drift detection) that wants to
 *     fan out across "all Sendero contracts".
 *
 * The shape is deliberately chain-agnostic at the discriminator
 * level — `chain: 'arc' | 'sol'` flips the address format and the
 * audit fn that runs against it. Common metadata (label, role,
 * explorer URL builder, deploy doc) lives at the top level so the UI
 * can render a unified table.
 */

export type ContractChain = 'arc' | 'sol';

export type ArcVerificationModel =
  /** Full Solidity source uploaded to Arcscan, must be verified. */
  | 'full-source'
  /** EIP-1167 minimal proxy — Arcscan auto-detects via `proxy_type`,
   *  `is_verified: false` is expected; verification lives on the impl. */
  | 'eip1167-proxy'
  /** ERC-1967 upgradeable proxy — both proxy + impl verified separately. */
  | 'erc1967-proxy';

export interface ArcContractEntry {
  chain: 'arc';
  /** Canonical hex address (any case — we lowercase before fetch). */
  address: string;
  /** Short human label. */
  label: string;
  /** What this contract does (1 sentence). */
  role: string;
  /** Verification model the audit checks. */
  expect: ArcVerificationModel;
  /** When `expect: 'eip1167-proxy'` or `'erc1967-proxy'`, the impl
   *  Arcscan should also verify. */
  implAddress?: string;
  /** Network — Arc has no mainnet yet, but tag for future. */
  network: 'arc-testnet' | 'arc-mainnet';
  /** Optional CLAUDE.md anchor for the deploy runbook. */
  runbook?: string;
}

export interface SolanaContractEntry {
  chain: 'sol';
  /** Base58 program id. */
  address: string;
  label: string;
  role: string;
  network: 'sol-devnet' | 'sol-mainnet';
  /** Who owns the deploy. `sendero` = we built + maintain the program;
   *  `external` = upstream Metaplex / SPL program our flows depend on
   *  (we don't authority-check those — drift would be Metaplex's
   *  problem to ship a redeploy). */
  ownership: 'sendero' | 'external';
  /** Authority pubkey expected on the deployed ProgramData account.
   *  Required when `ownership === 'sendero'`; ignored for external
   *  programs since their authority is Metaplex / Solana Foundation. */
  expectedAuthority?: string;
  runbook?: string;
}

export type ContractEntry = ArcContractEntry | SolanaContractEntry;

/**
 * Active deployments. Mirror of the SenderoStamps + GuestEscrow
 * runbook sections in CLAUDE.md.
 */
export const CONTRACTS_REGISTRY: ReadonlyArray<ContractEntry> = [
  // ── Arc Testnet — settlement + identity stack ─────────────────
  {
    chain: 'arc',
    address: '0x640e15B2B7cBa421c93dA1514f8E6Ba3e11f8515',
    label: 'SenderoGuestEscrow',
    role: 'Pre-funded guest-link travel escrow (prefund / claim / reserve / commit / settle / refund / sweep).',
    expect: 'full-source',
    network: 'arc-testnet',
    runbook: 'SenderoStamps deployment runbook',
  },
  {
    chain: 'arc',
    address: '0xcc0fa83535675a856d773cfbc71232c3d7b71a03',
    label: 'SenderoStamps proxy',
    role: 'Trip-lifecycle NFT collection (Circle SCP minimal proxy → thirdweb TokenERC1155 impl).',
    expect: 'eip1167-proxy',
    implAddress: '0xCCf28A443e35F8bD982b8E8651bE9f6caFEd4672',
    network: 'arc-testnet',
    runbook: 'SenderoStamps deployment runbook',
  },
  {
    chain: 'arc',
    address: '0xCCf28A443e35F8bD982b8E8651bE9f6caFEd4672',
    label: 'SenderoStamps impl',
    role: 'thirdweb TokenERC1155 implementation behind the SenderoStamps proxy.',
    expect: 'full-source',
    network: 'arc-testnet',
  },
  {
    chain: 'arc',
    address: '0x8004A818BFB912233c491871b3d84c89A494BD9e',
    label: 'ERC-8004 IdentityRegistry',
    role: 'Agent identity registry (upstream Arc/Circle, Sendero is a consumer).',
    expect: 'full-source',
    network: 'arc-testnet',
  },
  {
    chain: 'arc',
    address: '0x8004B663056A597Dffe9eCcC1965A193B7388713',
    label: 'ERC-8004 ReputationRegistry',
    role: 'Cross-agent reputation — Sendero writes feedback rows here on every settled trip.',
    expect: 'full-source',
    network: 'arc-testnet',
  },
  {
    chain: 'arc',
    address: '0x8004Cb1BF31DAf7788923b405b754f57acEB4272',
    label: 'ERC-8004 ValidationRegistry',
    role: 'Validation attestations for agent claims.',
    expect: 'full-source',
    network: 'arc-testnet',
  },

  // ── Solana Devnet — Sendero-owned Anchor programs ─────────────
  {
    chain: 'sol',
    address: '9NHw47GifDKsPDggQeQd53sNrAsBWeSayzvvSr2tjUL8',
    label: 'sendero_guest_escrow',
    role: 'Solana port of SenderoGuestEscrow.sol — full lifecycle parity for Solana-primary tenants.',
    network: 'sol-devnet',
    ownership: 'sendero',
    expectedAuthority: '4EZgQyZN36gQsyzVUU7itVEmLzxcjTKkYtcZxEaVuP9W',
    runbook: 'Solana Anchor program deployment runbook',
  },
  {
    chain: 'sol',
    address: '4dvtCnTgoJpnmjc9zqBTgEdCiGyHkBHFtDquMgXE1PR9',
    label: 'agentic_commerce',
    role: 'AI-agent job lifecycle (create/fund/complete/refund) — Solana-native.',
    network: 'sol-devnet',
    ownership: 'sendero',
    expectedAuthority: '4EZgQyZN36gQsyzVUU7itVEmLzxcjTKkYtcZxEaVuP9W',
    runbook: 'Solana Anchor program deployment runbook',
  },

  // ── Solana — external Metaplex programs we integrate against ──
  // Sendero doesn't deploy these. They're the canonical Metaplex
  // programs Solana-primary tenants flow through. Listed so superadmin
  // can confirm they're live + at the expected program IDs (a Metaplex
  // re-deploy at a new ID would silently break our integration).
  {
    chain: 'sol',
    address: 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d',
    label: 'Metaplex Core',
    role: 'Trip-stamp NFT minting (Metaplex Core asset) — Solana parity for SenderoStamps. Sendero calls `mintCoreTripStamp` against this program for every BoardingPass / SettlementReceipt / TripPassport on sol-primary tenants.',
    network: 'sol-devnet',
    ownership: 'external',
  },
  {
    chain: 'sol',
    address: '1DREGFgysWYxLnRnKQnwrxnJQeSMk2HmGaC6whw2B2p',
    label: 'Metaplex Agent Registry',
    role: 'Solana equivalent of ERC-8004 Identity + Reputation + Validation registries (Solana consolidates the three into one program backed by an MPL Core agent-identity asset). `provision-identity` mints the org agent here on tenant create.',
    network: 'sol-devnet',
    ownership: 'external',
  },
];

/** Build the explorer URL for a given contract entry. */
export function explorerUrlFor(entry: ContractEntry): string {
  if (entry.chain === 'arc') {
    const base =
      entry.network === 'arc-mainnet' ? 'https://arcscan.app' : 'https://testnet.arcscan.app';
    return `${base}/address/${entry.address}`;
  }
  const cluster = entry.network === 'sol-mainnet' ? 'mainnet-beta' : 'devnet';
  return `https://explorer.solana.com/address/${entry.address}?cluster=${cluster}`;
}
