/**
 * ERC-8004 Agent Identity + Reputation client.
 *
 * IdentityRegistry: mints an agent NFT with metadata URI (IPFS or HTTP).
 * ReputationRegistry: records feedback events from any external wallet.
 * ValidationRegistry: two-step validation request/response (not used in MVP).
 *
 * Note: per ERC-8004, agent owners CANNOT record reputation for their own agents.
 * We use separate validator wallets (demo-client + 2 aux past-client wallets).
 *
 * Contracts on Arc Testnet:
 *   IdentityRegistry   0x8004A818BFB912233c491871b3d84c89A494BD9e
 *   ReputationRegistry 0x8004B663056A597Dffe9eCcC1965A193B7388713
 *   ValidationRegistry 0x8004Cb1BF31DAf7788923b405b754f57acEB4272
 */

import { decodeEventLog, keccak256, parseAbiItem, toHex, type Address, type Hex } from 'viem';
import { getCircle } from '@sendero/circle/wallets';
import { getArcClient } from './chain';

export const IDENTITY_REGISTRY = '0x8004A818BFB912233c491871b3d84c89A494BD9e' as const;
export const REPUTATION_REGISTRY = '0x8004B663056A597Dffe9eCcC1965A193B7388713' as const;
export const VALIDATION_REGISTRY = '0x8004Cb1BF31DAf7788923b405b754f57acEB4272' as const;

const IDENTITY_ABI = [
  {
    name: 'ownerOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'tokenURI',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'string' }],
  },
] as const;

const TRANSFER_EVENT = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)'
);

/**
 * FeedbackGiven event — emitted by ReputationRegistry on `giveFeedback`.
 * Matches the minimal shape we need for aggregation.
 */
/**
 * Event topic0 discovered empirically from Arc Testnet ReputationRegistry.
 * Full signature unknown but the on-chain structure is:
 *   topics: [topic0, agentId, validator, feedbackHash]
 *   data: [index(uint256), score(int128 padded to uint256), status, ...strings]
 *
 * We don't try to decode the full event — we just parse score from data[32:64]
 * and read validator from topics[2]. That's all the aggregation needs.
 */
const FEEDBACK_EVENT_TOPIC0 =
  '0x6a4a61743519c9d648a14e6493f47dbe3ff1aa29e7785c96c8326a205e58febc' as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function waitForCircleTx(txId: string, label: string, timeoutMs = 120_000): Promise<Hex> {
  const circle = getCircle();
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const tx = await circle.getTransaction({ id: txId });
    const data: any = tx.data?.transaction;
    if (data?.state === 'COMPLETE' && data.txHash) return data.txHash as Hex;
    if (data?.state === 'FAILED') {
      throw new Error(`Circle tx "${label}" failed on-chain (id=${txId})`);
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error(`Circle tx "${label}" timed out (id=${txId})`);
}

async function execContract(params: {
  walletId: string;
  contractAddress: Address;
  abiFunctionSignature: string;
  abiParameters: unknown[];
  label: string;
}): Promise<{ txId: string; txHash: Hex }> {
  const circle = getCircle();
  // Circle's `createContractExecutionTransaction` accepts EITHER `walletId`
  // (UUID, requires no `blockchain`) OR `walletAddress` (0x… on-chain address,
  // requires `blockchain`). We pass UUIDs everywhere — sending a UUID into
  // `walletAddress` produces "Cannot find target wallet" (code 156001).
  const response = await circle.createContractExecutionTransaction({
    walletId: params.walletId,
    contractAddress: params.contractAddress,
    abiFunctionSignature: params.abiFunctionSignature,
    abiParameters: params.abiParameters as any,
    fee: { type: 'level', config: { feeLevel: 'MEDIUM' as any } },
  } as any);
  const txId = (response.data as any)?.id;
  if (!txId) throw new Error(`Circle returned no tx id for ${params.label}`);
  const txHash = await waitForCircleTx(txId, params.label);
  return { txId, txHash };
}

// ─── ERC-8004 Identity ───────────────────────────────────────────────────────

/**
 * Mint an agent identity NFT. The owner wallet becomes the agent controller.
 * Parses the Transfer event from the tx receipt to extract the tokenId (agentId).
 */
export async function registerAgent(params: {
  ownerWalletAddress: string;
  ownerAddress: Address;
  metadataURI: string;
}): Promise<{ agentId: bigint; txHash: Hex }> {
  const result = await execContract({
    walletId: params.ownerWalletAddress,
    contractAddress: IDENTITY_REGISTRY,
    abiFunctionSignature: 'register(string)',
    abiParameters: [params.metadataURI],
    label: 'registerAgent',
  });

  const publicClient = getArcClient();
  const receipt = await publicClient.getTransactionReceipt({
    hash: result.txHash,
  });

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== IDENTITY_REGISTRY.toLowerCase()) continue;
    try {
      const logAny = log as any;
      const decoded = decodeEventLog({
        abi: [TRANSFER_EVENT],
        data: logAny.data,
        topics: logAny.topics,
      }) as any;
      if (decoded.eventName === 'Transfer') {
        const { to, tokenId } = decoded.args as any;
        if ((to as string).toLowerCase() === params.ownerAddress.toLowerCase()) {
          return { agentId: tokenId as bigint, txHash: result.txHash };
        }
      }
    } catch {
      continue;
    }
  }
  throw new Error(`No Transfer event to owner found in tx ${result.txHash}`);
}

// ─── SenderoStamps (ERC-1155 souvenirs via Circle SCP template) ─────────────

/// Sentinel: thirdweb's TokenERC1155.mintTo accepts type(uint256).max as a
/// "create new tokenId" signal — the contract auto-increments and emits the
/// real assigned tokenId on the TokensMinted event. Any other value must
/// be an existing tokenId (`< nextTokenIdToMint`) for "add quantity to
/// existing class id" semantics (used for group TripPassport — N units to N
/// distinct recipients of the same class id).
export const STAMP_NEW_TOKEN_ID = (1n << 256n) - 1n;

/**
 * Topic0 of TokensMinted(address indexed mintedTo, uint256 indexed tokenIdMinted, string uri, uint256 quantityMinted).
 * Used by mint_stamp to extract the assigned tokenId from the deployment
 * tx receipt when the sentinel was passed.
 */
const TOKENS_MINTED_EVENT = {
  type: 'event',
  name: 'TokensMinted',
  inputs: [
    { indexed: true, name: 'mintedTo', type: 'address' },
    { indexed: true, name: 'tokenIdMinted', type: 'uint256' },
    { indexed: false, name: 'uri', type: 'string' },
    { indexed: false, name: 'quantityMinted', type: 'uint256' },
  ],
} as const;

/**
 * Mint into the SenderoStamps ERC-1155 collection (Circle SCP template,
 * thirdweb TokenERC1155 implementation). Treasury wallet signs; gas is
 * sponsored by Circle Gas Station per the project policy.
 *
 *   - Pass `tokenId = STAMP_NEW_TOKEN_ID` for a fresh class id (the
 *     contract auto-increments and the real id is parsed from the
 *     TokensMinted event).
 *   - Pass an existing `tokenId` to add `amount` units to that class
 *     (used for group TripPassport — same passport id distributed to
 *     multiple traveler DCWs via repeated mintTo calls).
 *
 * Returns `{ tokenId, txHash, txId }` where `tokenId` is the canonical
 * class id (assigned or echoed back).
 */
export async function mintStamp(params: {
  treasuryWalletId: string;
  contractAddress: Address;
  to: Address;
  tokenId: bigint;
  uri: string;
  amount: bigint;
}): Promise<{ tokenId: bigint; txHash: Hex; txId: string }> {
  const result = await execContract({
    walletId: params.treasuryWalletId,
    contractAddress: params.contractAddress,
    abiFunctionSignature: 'mintTo(address,uint256,string,uint256)',
    abiParameters: [params.to, params.tokenId.toString(), params.uri, params.amount.toString()],
    label: `mintStamp:${params.tokenId === STAMP_NEW_TOKEN_ID ? 'new' : params.tokenId.toString()}`,
  });

  // For "add quantity to existing tokenId", we already know the id —
  // skip the receipt parse.
  if (params.tokenId !== STAMP_NEW_TOKEN_ID) {
    return { tokenId: params.tokenId, txHash: result.txHash, txId: result.txId };
  }

  // Sentinel mint — read the assigned tokenId off the TokensMinted event.
  const publicClient = getArcClient();
  const receipt = await publicClient.getTransactionReceipt({ hash: result.txHash });
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== params.contractAddress.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({
        abi: [TOKENS_MINTED_EVENT],
        data: (log as any).data,
        topics: (log as any).topics,
      }) as any;
      if (decoded.eventName === 'TokensMinted') {
        const { mintedTo, tokenIdMinted } = decoded.args as {
          mintedTo: Address;
          tokenIdMinted: bigint;
        };
        if (mintedTo.toLowerCase() === params.to.toLowerCase()) {
          return { tokenId: tokenIdMinted, txHash: result.txHash, txId: result.txId };
        }
      }
    } catch {
      continue;
    }
  }
  throw new Error(`mintStamp: no TokensMinted event found in tx ${result.txHash}`);
}

/**
 * Update the tokenURI for an existing SenderoStamps class id. Used by
 * the ItineraryMap kind as new flight legs are added — the same class
 * id stays, the IPFS manifest CID changes.
 */
export async function refreshStampUri(params: {
  treasuryWalletId: string;
  contractAddress: Address;
  tokenId: bigint;
  newUri: string;
}): Promise<{ txHash: Hex; txId: string }> {
  const result = await execContract({
    walletId: params.treasuryWalletId,
    contractAddress: params.contractAddress,
    abiFunctionSignature: 'setTokenURI(uint256,string)',
    abiParameters: [params.tokenId.toString(), params.newUri],
    label: `refreshStampUri:${params.tokenId.toString()}`,
  });
  return { txHash: result.txHash, txId: result.txId };
}

/**
 * Read agent identity from the registry + fetch metadata from URI.
 */
export async function getAgentIdentity(agentId: bigint): Promise<{
  owner: Address;
  tokenURI: string;
  metadata: Record<string, unknown> | null;
}> {
  const publicClient = getArcClient();
  const [owner, tokenURI] = await Promise.all([
    publicClient.readContract({
      address: IDENTITY_REGISTRY,
      abi: IDENTITY_ABI,
      functionName: 'ownerOf',
      args: [agentId],
    } as any) as Promise<Address>,
    publicClient.readContract({
      address: IDENTITY_REGISTRY,
      abi: IDENTITY_ABI,
      functionName: 'tokenURI',
      args: [agentId],
    } as any) as Promise<string>,
  ]);

  let metadata: Record<string, unknown> | null = null;
  try {
    // Convert ipfs:// to an HTTP gateway for fetching
    const fetchUrl = tokenURI.startsWith('ipfs://')
      ? `https://ipfs.io/ipfs/${tokenURI.slice(7)}`
      : tokenURI;
    const res = await fetch(fetchUrl, {
      signal: AbortSignal.timeout(1500),
    });
    if (res.ok) metadata = await res.json();
  } catch {
    /* metadata optional */
  }

  return { owner, tokenURI, metadata };
}

// ─── Reputation ──────────────────────────────────────────────────────────────

/**
 * Record positive feedback for an agent. Validator wallet must NOT be the
 * agent owner (per ERC-8004). Score range: 0-100 (int128 in contract).
 *
 * Quickstart-verified signature:
 *   giveFeedback(uint256 subject, int128 score, uint8 status, string tag,
 *                string title, string description, string uri, bytes32 feedbackHash)
 */
export async function giveFeedback(params: {
  validatorWalletAddress: string;
  agentId: bigint;
  score: number;
  tag: string;
}): Promise<{ txId: string; txHash: Hex }> {
  const feedbackHash = keccak256(toHex(params.tag));
  return execContract({
    walletId: params.validatorWalletAddress,
    contractAddress: REPUTATION_REGISTRY,
    abiFunctionSignature: 'giveFeedback(uint256,int128,uint8,string,string,string,string,bytes32)',
    abiParameters: [
      params.agentId.toString(),
      params.score.toString(),
      '0', // status = 0 (positive)
      params.tag,
      '', // title
      '', // description
      '', // uri
      feedbackHash,
    ],
    label: 'giveFeedback',
  });
}

// ─── Reputation aggregation (cached) ─────────────────────────────────────────

export interface ReputationSummary {
  /** Star rating, 0-5. */
  stars: number;
  /** Mean score across all feedback events, 0-100. */
  meanScore: number;
  /** Number of feedback events. */
  count: number;
  /** Number of distinct validators (diversity indicator). */
  validators: number;
  /** Last aggregation timestamp (ms). */
  updatedAt: number;
}

interface CacheEntry {
  agentId: string;
  summary: ReputationSummary;
  cachedAt: number;
}

const REPUTATION_CACHE = new Map<string, CacheEntry>();
const REPUTATION_TTL_MS = 5 * 60 * 1000;

/**
 * Aggregate reputation for an agent. Scans FeedbackGiven events in the last
 * ~10k blocks (RPC limit), computes mean + distinct-validator count.
 *
 * Cached 5 min per agentId.
 */
export async function getReputation(agentId: bigint): Promise<ReputationSummary> {
  const key = agentId.toString();
  const now = Date.now();
  const cached = REPUTATION_CACHE.get(key);
  if (cached && now - cached.cachedAt < REPUTATION_TTL_MS) {
    return cached.summary;
  }

  const publicClient = getArcClient();
  const latest = await publicClient.getBlockNumber();

  // Filter by topic0 (event sig) + topic1 (agentId padded to 32 bytes).
  // We don't decode the full event — we just pull score from data[32:64] and
  // validator from topics[2]. That's all the aggregation needs.
  const agentIdPadded = ('0x' + agentId.toString(16).padStart(64, '0')) as `0x${string}`;

  // Scan recent history in chunks and short-circuit once we've gathered
  // enough events. Arc Testnet has ~1s blocks so 150k blocks ≈ 1.7 days,
  // which comfortably covers a fresh bootstrap run + some drift.
  const CHUNK = 10_000n;
  const MAX_CHUNKS = 30;
  const EARLY_EXIT_AT = 30;
  const logs: any[] = [];
  let to = latest;
  for (let i = 0; i < MAX_CHUNKS; i++) {
    const from = to > CHUNK ? to - CHUNK : 0n;
    try {
      const chunk = (await publicClient.getLogs({
        address: REPUTATION_REGISTRY,
        fromBlock: from,
        toBlock: to,
        topics: [FEEDBACK_EVENT_TOPIC0, agentIdPadded] as any,
      } as any)) as any[];
      logs.push(...chunk);
      if (logs.length >= EARLY_EXIT_AT) break;
    } catch {
      break;
    }
    if (from === 0n) break;
    to = from - 1n;
  }

  const scores: number[] = [];
  const validators = new Set<string>();
  for (const log of logs) {
    const l = log as any;
    try {
      // topics[2] = validator address (last 20 bytes of the 32-byte topic)
      const validatorTopic = l.topics?.[2] as string | undefined;
      if (validatorTopic) {
        validators.add('0x' + validatorTopic.slice(-40).toLowerCase());
      }
      // data[32:64] = score as int128 (right-padded to 32 bytes). data is
      // '0x' + 64 chars per 32-byte word.
      const data = l.data as string;
      if (data && data.length >= 130) {
        const scoreHex = '0x' + data.slice(66, 130);
        const score = Number(BigInt(scoreHex));
        if (score > 0 && score <= 127) scores.push(score);
      }
    } catch {
      continue;
    }
  }

  const count = scores.length;
  const meanScore = count > 0 ? scores.reduce((a, b) => a + b, 0) / count : 0;
  // Star rating: score is 0-100, maps to 0-5 stars.
  const stars = count > 0 ? meanScore / 20 : 0;

  const summary: ReputationSummary = {
    stars,
    meanScore,
    count,
    validators: validators.size,
    updatedAt: now,
  };

  REPUTATION_CACHE.set(key, { agentId: key, summary, cachedAt: now });
  return summary;
}

/**
 * Invalidate the reputation cache for a specific agent (or all agents).
 * Call after giveFeedback() so the UI reflects the new score on next read.
 */
export function invalidateReputationCache(agentId?: bigint): void {
  if (agentId === undefined) {
    REPUTATION_CACHE.clear();
  } else {
    REPUTATION_CACHE.delete(agentId.toString());
  }
}

// ─── ERC-8004 ValidationRegistry ─────────────────────────────────────────────

const VALIDATION_ABI = [
  {
    name: 'getValidationStatus',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'requestHash', type: 'bytes32' }],
    outputs: [
      { name: 'validatorAddress', type: 'address' },
      { name: 'agentId', type: 'uint256' },
      { name: 'response', type: 'uint8' },
      { name: 'responseHash', type: 'bytes32' },
      { name: 'tag', type: 'string' },
      { name: 'lastUpdate', type: 'uint256' },
    ],
  },
] as const;

/**
 * Two-step validation flow per the ERC-8004 quickstart.
 *
 *   - Owner (any wallet) calls validationRequest(validator, agentId, requestURI, requestHash).
 *   - Validator wallet replies with validationResponse(requestHash, response, responseURI,
 *     responseHash, tag). 100 = passed, 0 = failed.
 *
 * Used for KYC/KYB checks today; the same primitive can carry suitability, eligibility,
 * or any "this counterparty was validated by X" claim.
 */
export async function requestValidation(params: {
  ownerWalletAddress: string;
  validatorAddress: Address;
  agentId: bigint;
  requestURI: string;
  requestHash: Hex;
}): Promise<{ txId: string; txHash: Hex }> {
  return execContract({
    walletId: params.ownerWalletAddress,
    contractAddress: VALIDATION_REGISTRY,
    abiFunctionSignature: 'validationRequest(address,uint256,string,bytes32)',
    abiParameters: [
      params.validatorAddress,
      params.agentId.toString(),
      params.requestURI,
      params.requestHash,
    ],
    label: 'validationRequest',
  });
}

export async function submitValidationResponse(params: {
  validatorWalletAddress: string;
  requestHash: Hex;
  /** 100 = passed, 0 = failed. */
  response: 0 | 100;
  tag: string;
  responseURI?: string;
}): Promise<{ txId: string; txHash: Hex }> {
  return execContract({
    walletId: params.validatorWalletAddress,
    contractAddress: VALIDATION_REGISTRY,
    abiFunctionSignature: 'validationResponse(bytes32,uint8,string,bytes32,string)',
    abiParameters: [
      params.requestHash,
      params.response.toString(),
      params.responseURI ?? '',
      `0x${'0'.repeat(64)}`,
      params.tag,
    ],
    label: 'validationResponse',
  });
}

export interface ValidationStatus {
  validatorAddress: Address;
  agentId: bigint;
  response: number;
  responseHash: Hex;
  tag: string;
  lastUpdate: bigint;
}

export async function getValidationStatus(requestHash: Hex): Promise<ValidationStatus | null> {
  const publicClient = getArcClient();
  try {
    // viem 2.x typings now require an authorizationList field; cast
    // through any to keep the call shape compatible across versions.
    const result = (await (publicClient.readContract as any)({
      address: VALIDATION_REGISTRY,
      abi: VALIDATION_ABI,
      functionName: 'getValidationStatus',
      args: [requestHash],
    })) as readonly [Address, bigint, number, Hex, string, bigint];
    return {
      validatorAddress: result[0],
      agentId: result[1],
      response: result[2],
      responseHash: result[3],
      tag: result[4],
      lastUpdate: result[5],
    };
  } catch {
    return null;
  }
}

/**
 * Compute a deterministic requestHash for a validation flow. Mirrors the
 * pattern in Circle's quickstart: keccak(`<tag>_request_agent_<agentId>`).
 * Callers can override by passing a custom seed to keep multiple
 * validations for the same agent distinct.
 */
export function computeValidationRequestHash(args: {
  agentId: bigint;
  tag: string;
  seed?: string;
}): Hex {
  const seed = args.seed ?? Date.now().toString(36);
  return keccak256(toHex(`${args.tag}_request_agent_${args.agentId}_${seed}`));
}
