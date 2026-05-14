/**
 * Pasillo request/response shapes.
 *
 * Mirrors the schemas in `desk-v1/apps/pasillo/src/common/schema.ts`
 * (Hono + zod-openapi). We re-declare here rather than importing so
 * Sendero doesn't take a runtime dep on BUFI's worker package — the
 * client only talks over HTTP and the shapes are stable per the
 * coordination doc (`docs/pasillo-auth-coordination.md`).
 *
 * When BUFI adds or evolves a field, update here. The Pasillo response
 * still passes through as JSON if there's drift; callers that rely on
 * a new field can extend the type locally without blocking on a
 * Sendero release.
 */

/**
 * Pasillo corridor codes, mirroring `corridorSchema` in
 * `desk-v1/apps/pasillo/src/common/schema.ts`. ISO-3166 alpha-2 pairs:
 *   - ES-EC = Spain ↔ Ecuador
 *   - US-EC = United States ↔ Ecuador
 *   - EC-EC = Ecuador internal lane
 */
export type Corridor = 'ES-EC' | 'US-EC' | 'EC-EC';

/** USDC ↔ fiat lane direction. Mirrors `directionSchema`. */
export type RampDirection = 'on-ramp' | 'off-ramp';

/** CAIP-2 destination chain identifier, e.g. `eip155:5042002` (Arc Testnet). */
export type DestinationChain = string;

/**
 * Developer-fee structure. Optional on the wire — when present, Pasillo
 * routes the bps cut to the supplied EVM address on top of its own
 * platform fee. Bps must be 1-500 (0.01%-5%).
 */
export interface DeveloperFee {
  developerFeeBps: number;
  developerFeeRecipientAddress: `0x${string}`;
}

export interface QuoteRequest {
  /** Atomic integer amount in source unit (6-decimal USDC). Pasillo caps at 10_000_000 ($100k). */
  amount: number;
  corridor: Corridor;
  direction: RampDirection;
  destinationChain?: DestinationChain;
  /** Optional EVM destination wallet for on-ramp settlements. */
  walletAddress?: `0x${string}`;
  developerFee?: DeveloperFee;
}

export interface QuoteResponse {
  quoteId: string;
  amount: number;
  grossFee: number;
  developerFee: number;
  developerFeeBps?: number;
  developerFeeRecipientAddress?: string;
  totalFee: number;
  netAmount: number;
  corridor: Corridor;
  direction: RampDirection;
  destinationChain?: DestinationChain;
  expiresAt: string;
}

export interface RampExecuteRequest {
  quoteId: string;
  /** Override the destinationChain on the original quote. */
  destinationChain?: DestinationChain;
  /** Idempotency key; client populates automatically per-request. */
  idempotencyKey?: string;
}

export interface RampExecuteResponse {
  transactionId: string;
  status: 'pending' | 'submitted' | 'settled' | 'failed';
  estimatedSettlementSeconds?: number;
}

export interface RampStatusResponse {
  transactionId: string;
  status: 'pending' | 'submitted' | 'settled' | 'failed';
  updatedAt: string;
  failureReason?: string;
}

export interface CustomerRegisterRequest {
  email: string;
  type: 'individual' | 'business';
}

export interface CustomerRecord {
  id: string;
  email: string;
  type: 'individual' | 'business';
  kycStatus: 'pending' | 'in_progress' | 'approved' | 'rejected';
  createdAt: string;
}

export interface CustomerVerifyResponse {
  customerId: string;
  /** Persona-hosted inquiry URL — the customer completes KYC here. */
  inquiryUrl: string;
  expiresAt: string;
}

/** Generic JSON-shaped error response. Pasillo returns one of these on every 4xx/5xx. */
export interface PasilloErrorResponse {
  success: false;
  error: {
    message: string;
    code?: string;
  };
}
