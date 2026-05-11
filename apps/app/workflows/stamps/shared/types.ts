/**
 * Stamp workflow types — shared by every stamp generator + the HTTP
 * route + the WDK progress stream consumers (StampCard skeletons in UI).
 *
 * `StampKind` is the on-chain class discriminator. All four classes
 * mint into the same SenderoStamps ERC-1155 collection — the `kind`
 * is denormalized onto NftStamp so off-chain queries don't need to
 * reach the contract for category filtering.
 */

export type StampKind = 'BoardingPass' | 'SettlementReceipt' | 'ItineraryMap' | 'TripPassport';

export interface StampTenantBrand {
  /** Sendero Tenant.id — needed by the post-mint notify step to look up the WhatsApp install + channel identity. */
  tenantId: string;
  slug: string;
  displayName: string;
  /** Primary/secondary brand colors as `oklch(...)` strings. */
  primary?: string;
  secondary?: string;
  /** Logo URL for the manifest's `image` overlay (optional). */
  logoUrl?: string;
}

export interface StampTraveler {
  /** Sendero User.id — mirrors NftStamp.travelerId. */
  userId: string;
  /**
   * DCW recipient address for the StampContext.chain — `0x…40` for
   * arc, base58 pubkey for sol. Picked by `loadStampContext` based
   * on `tenant.primaryChain` so downstream steps never have to chain-
   * switch.
   */
  address: string;
  /** Display name for the manifest. */
  displayName: string | null;
}

/**
 * Minimal trip projection consumed by every stamp prompt. Loaded once
 * per workflow start by `loadStampContext` so each step doesn't have
 * to re-query Postgres.
 */
export interface StampTripContext {
  tripId: string;
  origin: string | null;
  destination: string | null;
  startDate: string | null;
  endDate: string | null;
  purpose: string | null;
}

export interface StampBookingContext {
  bookingId: string;
  /** Carrier IATA when known (BA, IB, AM…). */
  carrier: string | null;
  /** Cabin class / room type / hire kind label. */
  cabin: string | null;
  /** Booking reference / PNR / confirmation code. */
  ref: string | null;
  /** Total in USD as a plain number — display-only, not settlement. */
  totalUsd: number | null;
}

/**
 * Aggregated context passed into the stamp generator workflows. Each
 * `kind`-specific generator decides which slices to use (BoardingPass
 * needs trip + booking; ItineraryMap needs trip only; etc.).
 */
export interface StampContext {
  kind: StampKind;
  tenant: StampTenantBrand;
  trip: StampTripContext;
  booking: StampBookingContext | null;
  travelers: StampTraveler[];
  /** Idempotency anchor: bookingId for BoardingPass / Receipt, tripId for ItineraryMap / TripPassport. */
  primaryKey: string;
  /** ipfs://<manifestCid> source-of-truth URI; computed mid-workflow. */
  uri?: string;
  /**
   * Tenant.primaryChain — picked once at loadStampContext, threaded
   * through every stamp step so `mint_stamp` routes to the right
   * chain (`arc` → SenderoStamps ERC-1155 / `sol` → Metaplex Core).
   * `travelers[].address` is the matching chain's wallet (EVM 0x for
   * arc, base58 for sol).
   */
  chain: 'arc' | 'sol';
}

/**
 * ERC-1155 metadata schema (OpenSea-compatible) emitted to IPFS as
 * the manifest payload. The `image_https` non-standard tag mirrors
 * the canonical IPFS pointer through the Pinata HTTPS gateway so
 * unfurl bots (Slack, WhatsApp) and OG meta pickers can render the
 * art without an IPFS-aware client.
 */
export interface StampManifest {
  name: string;
  description: string;
  /** `ipfs://<imageCid>` — canonical, deterministic. */
  image: string;
  /** Pinata gateway URL mirror — `https://<gateway>/ipfs/<imageCid>`. */
  image_https: string;
  external_url: string;
  attributes: Array<{ trait_type: string; value: string | number }>;
}

/**
 * Progress events streamed via `getReadable<StampProgressEvent>()`.
 * Consumed by the StampCard skeleton in the dashboard while the
 * workflow runs (or by `/api/workflows/stamps/[kind]/[runId]/stream`
 * for direct polling).
 */
export type StampProgressEvent =
  | {
      type: 'progress';
      step: 'generate-image';
      status: 'in_progress' | 'completed';
      image?: string;
    }
  | {
      type: 'progress';
      step: 'generate-caption';
      status: 'in_progress' | 'completed';
      caption?: string;
    }
  | {
      type: 'progress';
      step: 'gateway-url';
      status: 'in_progress' | 'completed';
      gatewayUrl?: string;
    }
  | { type: 'progress'; step: 'pin-image'; status: 'in_progress' | 'completed'; imageCid?: string }
  | {
      type: 'progress';
      step: 'pin-manifest';
      status: 'in_progress' | 'completed';
      manifestCid?: string;
    }
  | {
      type: 'progress';
      step: 'mint';
      status: 'in_progress' | 'completed';
      tokenId?: string;
      txHash?: string;
    }
  | { type: 'error'; message: string };

export interface StampWorkflowResult {
  kind: StampKind;
  primaryKey: string;
  tokenId: string;
  contract: string;
  txHash: string | null;
  /** Pinata HTTPS gateway URL — what the OG / dashboard renders. */
  gatewayUrl: string;
  /** `ipfs://<manifestCid>` — the on-chain tokenURI. */
  ipfsUri: string;
  caption: string;
}
