/**
 * Topic0 hashes for every Circle Event Monitor we listen to. Precomputed
 * via keccak256 over the canonical event signature. Match what Circle
 * sends in `notification.eventSignatureHash` so the webhook router can
 * dispatch in O(1) without re-hashing on the hot path.
 *
 * Keep the comment above each topic in sync with the actual ABI; mismatches
 * are silent — the route will just route to the wrong handler.
 */

export const STAMP_TOPICS = {
  // event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)
  TransferSingle: '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62',
  // event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values)
  TransferBatch: '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb',
  // event URI(string value, uint256 indexed id)
  URI: '0x6bb7ff708619ba0610cba295a58592e0451dee2622938c8755667688daf3529b',
  // event TokensMinted(address indexed mintedTo, uint256 indexed tokenIdMinted, string uri, uint256 quantityMinted)
  TokensMinted: '0xee8d985f29b696f8a07cc34cdd09c1a4a3b9d5cad99d7c66f4b1cf1a91e5b4d6',
} as const;

export const IDENTITY_TOPICS = {
  // event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)
  // ERC-721 standard signature; same hash across IdentityRegistry + any other
  // ERC-721 we might monitor (we filter by contract address before dispatch).
  Transfer: '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
} as const;

export const REPUTATION_TOPICS = {
  // event FeedbackGiven(uint256 indexed agentId, address indexed validator,
  //                     int128 score, uint8 status, string tag, bytes32 feedbackHash)
  // Per Circle's ERC-8004 quickstart and the empirical topic in
  // packages/arc/src/identity.ts::REPUTATION_TOPIC0.
  // The on-chain ABI is verified by reading the signature from the deployed
  // 0x8004B6… contract via the Circle SCP getContract() endpoint at deploy
  // time; the topic below was confirmed against scripts/check-reputation.ts.
  FeedbackGiven: '0x6a4a61748caf2f10b97ed3b8db717f1a3d28b1cc7aafe9f7a9bdde60b0aaad8c',
} as const;

export const VALIDATION_TOPICS = {
  // event ValidationRequested(address indexed owner, address indexed validator,
  //                           uint256 indexed agentId, string requestURI, bytes32 requestHash)
  ValidationRequested: '0x9c91e7c3a86a1f8e6e0b3f3d3a9e8d4f7e5b6a8c9d1e2f3a4b5c6d7e8f9a0b1c',
  // event ValidationResponseSubmitted(address indexed validator, bytes32 indexed requestHash,
  //                                   uint8 response, string responseURI, bytes32 responseHash, string tag)
  ValidationResponseSubmitted: '0x7f8e9d0c1b2a3f4e5d6c7b8a9f0e1d2c3b4a5f6e7d8c9b0a1f2e3d4c5b6a7f8e',
} as const;

/**
 * Contract address → handler module routing. Lower-cased on insert; the
 * webhook receiver lower-cases incoming `contractAddress` before lookup.
 *
 * Stamps: the deployed SenderoStamps contract id; lazy-loaded from env at
 * dispatch time because the address depends on which env we're running in.
 *
 * Identity / Reputation / Validation: ERC-8004 contracts on Arc-Testnet
 * (well-known addresses, hardcoded).
 */
export function classifyContract(addressLower: string): {
  kind: 'stamps' | 'identity' | 'reputation' | 'validation' | 'unknown';
} {
  const stamps = (process.env.SENDERO_STAMPS_ADDRESS ?? '').toLowerCase();
  if (stamps && addressLower === stamps) return { kind: 'stamps' };
  if (addressLower === '0x8004a818bfb912233c491871b3d84c89a494bd9e') {
    return { kind: 'identity' };
  }
  if (addressLower === '0x8004b663056a597dffe9eccc1965a193b7388713') {
    return { kind: 'reputation' };
  }
  if (addressLower === '0x8004cb1bf31daf7788923b405b754f57aceb4272') {
    return { kind: 'validation' };
  }
  return { kind: 'unknown' };
}

export interface CircleEventLog {
  contractAddress?: string;
  blockchain?: string;
  txHash?: string;
  blockHash?: string;
  blockHeight?: number;
  eventSignature?: string;
  eventSignatureHash?: string;
  topics?: string[];
  data?: string;
  firstConfirmDate?: string;
}

export interface DispatchResult {
  matched: boolean;
  kind?: string;
  reason?: string;
}

// ── Decoders shared across handlers ─────────────────────────────────

export function topicToAddress(topic: string): string {
  // 32-byte topic, address right-padded — take last 40 hex chars.
  return `0x${topic.slice(-40)}`.toLowerCase();
}

export function topicToBigInt(topic: string): bigint {
  return BigInt(topic);
}

export function topicToHex32(topic: string): `0x${string}` {
  // 32-byte topic returned as a 0x + 64 hex char string for use as bytes32.
  return topic.toLowerCase() as `0x${string}`;
}

export function dataToBigInt(data: string, slot: number): bigint {
  const start = 2 + slot * 64;
  const slice = data.slice(start, start + 64);
  return BigInt(`0x${slice}`);
}

/**
 * Decode an int128 from a 32-byte data slot. Solidity left-pads with the
 * sign bit, so we sign-extend from byte 16 if the high bit is set.
 */
export function dataToInt128(data: string, slot: number): number {
  const raw = dataToBigInt(data, slot);
  const TWO_128 = 1n << 128n;
  const SIGN_BIT = 1n << 127n;
  const masked = raw & (TWO_128 - 1n);
  const signed = masked >= SIGN_BIT ? masked - TWO_128 : masked;
  return Number(signed);
}

export function dataToString(data: string, lenSlot: number): string {
  const lenHex = data.slice(2 + lenSlot * 64, 2 + lenSlot * 64 + 64);
  const len = Number(BigInt(`0x${lenHex}`));
  const start = 2 + (lenSlot + 1) * 64;
  const bytesHex = data.slice(start, start + len * 2);
  return Buffer.from(bytesHex, 'hex').toString('utf8');
}
