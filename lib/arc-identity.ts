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

import {
  decodeEventLog,
  keccak256,
  parseAbiItem,
  toHex,
  type Address,
  type Hex,
} from 'viem';
import { getCircle } from './circle';
import { getArcClient } from './arc';

export const IDENTITY_REGISTRY =
  '0x8004A818BFB912233c491871b3d84c89A494BD9e' as const;
export const REPUTATION_REGISTRY =
  '0x8004B663056A597Dffe9eCcC1965A193B7388713' as const;
export const VALIDATION_REGISTRY =
  '0x8004Cb1BF31DAf7788923b405b754f57acEB4272' as const;

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
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
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

async function waitForCircleTx(
  txId: string,
  label: string,
  timeoutMs = 120_000,
): Promise<Hex> {
  const circle = getCircle();
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const tx = await circle.getTransaction({ id: txId });
    const data: any = tx.data?.transaction;
    if (data?.state === 'COMPLETE' && data.txHash) return data.txHash as Hex;
    if (data?.state === 'FAILED') {
      throw new Error(`Circle tx "${label}" failed on-chain (id=${txId})`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Circle tx "${label}" timed out (id=${txId})`);
}

async function execContract(params: {
  walletAddress: string;
  contractAddress: Address;
  abiFunctionSignature: string;
  abiParameters: unknown[];
  label: string;
}): Promise<{ txId: string; txHash: Hex }> {
  const circle = getCircle();
  const response = await circle.createContractExecutionTransaction({
    walletAddress: params.walletAddress,
    blockchain: 'ARC-TESTNET' as any,
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
    walletAddress: params.ownerWalletAddress,
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
    if (
      log.address.toLowerCase() !== IDENTITY_REGISTRY.toLowerCase()
    ) continue;
    try {
      const logAny = log as any;
      const decoded = decodeEventLog({
        abi: [TRANSFER_EVENT],
        data: logAny.data,
        topics: logAny.topics,
      }) as any;
      if (decoded.eventName === 'Transfer') {
        const { to, tokenId } = decoded.args as any;
        if (
          (to as string).toLowerCase() === params.ownerAddress.toLowerCase()
        ) {
          return { agentId: tokenId as bigint, txHash: result.txHash };
        }
      }
    } catch {
      continue;
    }
  }
  throw new Error(`No Transfer event to owner found in tx ${result.txHash}`);
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
      signal: AbortSignal.timeout(5000),
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
    walletAddress: params.validatorWalletAddress,
    contractAddress: REPUTATION_REGISTRY,
    abiFunctionSignature:
      'giveFeedback(uint256,int128,uint8,string,string,string,string,bytes32)',
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
export async function getReputation(
  agentId: bigint,
): Promise<ReputationSummary> {
  const key = agentId.toString();
  const now = Date.now();
  const cached = REPUTATION_CACHE.get(key);
  if (cached && now - cached.cachedAt < REPUTATION_TTL_MS) {
    return cached.summary;
  }

  const publicClient = getArcClient();
  const latest = await publicClient.getBlockNumber();
  const fromBlock = latest > 10_000n ? latest - 10_000n : 0n;

  // Filter by topic0 (event sig) + topic1 (agentId padded to 32 bytes).
  // We don't decode the full event — we just pull score from data[32:64] and
  // validator from topics[2]. That's all the aggregation needs.
  const agentIdPadded = ('0x' +
    agentId.toString(16).padStart(64, '0')) as `0x${string}`;
  const logs = await publicClient.getLogs({
    address: REPUTATION_REGISTRY,
    fromBlock,
    toBlock: latest,
    topics: [FEEDBACK_EVENT_TOPIC0, agentIdPadded] as any,
  } as any);

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
  const meanScore =
    count > 0 ? scores.reduce((a, b) => a + b, 0) / count : 0;
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
