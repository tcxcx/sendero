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

export type Corridor =
  /** USD (USA) ↔ USD (Ecuador) — Pasillo's flagship lane. */
  'usd_us_to_usd_ec' | 'usd_ec_to_usd_us' | 'usd_to_usdc' | 'usdc_to_usd';

export type RampDirection = 'usd-to-usdc' | 'usdc-to-usd';

/** CAIP-2 destination chain identifier, e.g. `eip155:5042002` (Arc Testnet). */
export type DestinationChain = string;

export interface QuoteRequest {
  /** Atomic-string amount in the source unit (USDC = 6 decimals). */
  amount: string;
  corridor: Corridor;
  direction: RampDirection;
  destinationChain?: DestinationChain;
  /** Optional developer fee in basis points (0-500 = 0%-5%). */
  developerFee?: number;
}

export interface QuoteResponse {
  quoteId: string;
  /** Atomic-string. Source amount the buyer commits. */
  fromAmount: string;
  /** Atomic-string. Destination amount the buyer receives, net of fees. */
  toAmount: string;
  feeBps: number;
  expiresAt: string;
  corridor: Corridor;
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
