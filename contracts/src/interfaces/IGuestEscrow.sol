// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title  IGuestEscrow
/// @notice Interface for `SenderoGuestEscrow` — the on-chain state machine
///         that pre-funds guest-link travel on Arc L2.
///
///         Surfaces types, errors, events, and the full public API so
///         consumers (the off-chain operator, the UI, downstream
///         contracts) can import a single file without taking a hard
///         dependency on the implementation.
interface IGuestEscrow {
    // ------------------------------------------------------------------
    // Types
    // ------------------------------------------------------------------

    /// @notice Status codes are stored as `uint8` on each `Booking`.
    ///         Values are intentionally stable across versions — never
    ///         renumber. `STATUS_RESERVED` stays 0 so a freshly-zeroed
    ///         slot reads as the initial state.
    enum BookingStatus {
        Reserved,   // 0
        Committed,  // 1
        Settled,    // 2
        Refunded    // 3
    }

    /// @dev Trip lifecycle record. `budget - reserved - spent` is the
    ///      funds still available for new bookings.
    struct Trip {
        address claimPubKey20;    // Peanut-style ephemeral claim address
        address buyer;            // corporate treasury (MSCA or Safe)
        address guestWallet;      // set on claim; guest's MSCA
        uint256 budget;
        uint256 reserved;
        uint256 spent;
        uint64  expiresAt;
        bool    cancelled;
        bool    swept;
        bytes32 metadataHash;     // keccak(plaintext || nonce)
        string  metadataCID;      // IPFS/Walrus CID (encrypted blob)
        uint256 agentTokenId;     // ERC-8004 IdentityRegistry token id
        bytes32 claimCodeHash;    // keccak of OTP preimage; 0 disables 2FA
    }

    /// @dev Booking lifecycle record. `amount` is the upper bound at
    ///      reserve time, shrinks to the actual at commit time.
    ///
    ///      Storage upgrade history:
    ///        v2.0.0 — fields up to and including `committedAt`.
    ///        v3.0.0 — appended `agencyAmount` and `agencyAddress` for
    ///                 atomic three-way split (vendor + agency + operator)
    ///                 used by the Sendero markup model. ERC-7201 namespaced
    ///                 storage + the mapping-value layout makes the append
    ///                 upgrade-safe: existing booking slots only extend at
    ///                 the tail; legacy bookings read the new fields as zero.
    struct Booking {
        bytes32 tripId;
        uint256 amount;           // upper bound at reserve, actual at commit
        uint256 actualAmount;     // set at commit
        uint256 fee;              // operator take rate portion of actualAmount
        address vendor;           // Duffel payout address (or splitter)
        bytes32 itineraryHash;    // keccak of encrypted itinerary blob
        string  itineraryCID;     // IPFS/Walrus CID
        bytes32 duffelOrderHash;  // operator-recorded GDS confirmation
        uint8   status;           // BookingStatus
        uint64  reservedAt;       // for RESERVE_TIMEOUT reclaim
        uint64  committedAt;      // for CONFIRM_TIMEOUT reclaim
        // ──── v3.0.0 additions — APPEND ONLY ────
        uint256 agencyAmount;     // tenant markup, in micro-USDC; zero on legacy bookings
        address agencyAddress;    // tenant treasury; zero on legacy bookings
    }

    /// @dev Calldata struct for `batchCreateTrip` — avoids Solidity's
    ///      stack-too-deep when passing 7+ parallel arrays.
    struct TripInput {
        bytes32 tripId;
        address claimPubKey20;
        uint256 budget;
        uint64  expiresAt;
        bytes32 metadataHash;
        string  metadataCID;
        uint256 agentTokenId;
        bytes32 claimCodeHash;
    }

    // ------------------------------------------------------------------
    // Events
    // ------------------------------------------------------------------

    event TripCreated(
        bytes32 indexed tripId,
        address indexed buyer,
        address         claimPubKey20,
        uint256         budget,
        uint64          expiresAt,
        bytes32         metadataHash,
        string          metadataCID,
        uint256         agentTokenId,
        bytes32         claimCodeHash
    );
    event TripClaimed(bytes32 indexed tripId, address indexed guestWallet);
    event TripCancelled(bytes32 indexed tripId);

    event BookingReserved(
        bytes32 indexed tripId,
        bytes32 indexed bookingId,
        uint256         upperBound
    );
    event BookingCommitted(
        bytes32 indexed bookingId,
        uint256         vendorAmount,
        uint256         fee,
        address         vendor,
        bytes32         itineraryHash,
        string          itineraryCID,
        uint256         slackReleased
    );
    /// @notice v3.0.0 — emitted by `commitBookingV2` instead of `BookingCommitted`.
    ///         Carries the agency leg so off-chain indexers see the full split.
    event BookingCommittedV2(
        bytes32 indexed bookingId,
        uint256         vendorAmount,
        uint256         fee,
        uint256         agencyAmount,
        address         vendor,
        address         agencyAddress,
        bytes32         itineraryHash,
        string          itineraryCID,
        uint256         slackReleased
    );
    event DuffelConfirmed(bytes32 indexed bookingId, bytes32 duffelOrderHash);
    event BookingSettled(
        bytes32 indexed bookingId,
        address         vendor,
        uint256         vendorAmount,
        uint256         feeAmount
    );
    /// @notice v3.0.0 — emitted by `settleBooking` when the booking has a
    ///         non-zero agency leg (committed via `commitBookingV2`).
    ///         Legacy bookings (committed via `commitBooking`) continue to
    ///         emit `BookingSettled`. Off-chain indexers should subscribe
    ///         to BOTH events during the transition window.
    event BookingSettledV2(
        bytes32 indexed bookingId,
        address         vendor,
        uint256         vendorAmount,
        address         agencyAddress,
        uint256         agencyAmount,
        uint256         feeAmount
    );
    event BookingRefunded(bytes32 indexed bookingId, uint256 amount);
    event BookingReclaimed(bytes32 indexed bookingId, uint256 amount, uint8 priorStatus);

    event Swept(bytes32 indexed tripId, uint256 returned);
    event AgentActionLogged(
        bytes32 indexed tripId,
        uint256 indexed agentTokenId,
        uint8           actionType,
        uint256         feeMicro
    );

    event OperatorUpdated(address indexed newOperator);

    /// @notice v3.0.0 — emitted on every failed `claimTrip` attempt
    ///         (wrong code) before the lockout threshold. Off-chain
    ///         indexers can use this to trend rising attempt counts and
    ///         alert the buyer earlier than the lockout itself.
    event ClaimAttemptFailed(bytes32 indexed tripId, uint8 attemptCount);

    /// @notice v3.0.0 — emitted when consecutive failed `claimTrip`
    ///         attempts hit `MAX_CLAIM_ATTEMPTS`. Off-chain indexers
    ///         MUST react with a high-priority notification to the
    ///         trip's buyer so they can cancel + sweep the funds. The
    ///         existing `cancelTrip` + `sweepUnspent` flow handles the
    ///         on-chain reclaim — no new function is needed because a
    ///         locked trip has `reserved == 0` by definition.
    event ClaimLockoutTriggered(bytes32 indexed tripId, uint64 lockedUntil);

    /// @notice v3.0.0 — emitted when the operator rotates the on-chain
    ///         claim-code hash (e.g., guest requested a resend). Off-
    ///         chain indexers track this to invalidate caches of the
    ///         old hash.
    event ClaimCodeRotated(bytes32 indexed tripId, bytes32 oldCodeHash, bytes32 newCodeHash);

    // ------------------------------------------------------------------
    // Errors
    // ------------------------------------------------------------------

    error NotAuthorized();
    error TripExists();
    error TripNotFound();
    error TripIsCancelled();
    error TripExpired();
    error AlreadyClaimed();
    error InvalidSignature();
    /// @notice DEPRECATED in v3.0.0. Wrong-code claim attempts no longer
    ///         revert with this error — they emit `ClaimAttemptFailed`
    ///         (or `ClaimLockoutTriggered` on the threshold attempt)
    ///         and return early without setting `guestWallet`. Callers
    ///         must read the tx receipt to distinguish success (TripClaimed)
    ///         from failure (ClaimAttemptFailed / ClaimLockoutTriggered).
    ///         Kept in the ABI so v2 indexers continue to compile; never
    ///         actually thrown by v3.0.0+.
    error InvalidClaimCode();
    error BookingExists();
    error BookingBadStatus();
    error BookingAlreadyConfirmed();
    error InsufficientBudget();
    error AmountExceedsUpperBound();
    error NothingToSweep();
    error StillActive();
    error ReservationsOutstanding();
    error ZeroAddress();
    error ZeroValue();
    error NotYetReclaimable();
    error InvalidActionType();
    error AgentFeeTooHigh();
    /// @notice v3.0.0 — claimTrip rejected because the trip is in a
    ///         post-failed-attempts cooldown window. See `claimLockoutUntil`.
    error ClaimLocked();

    // ------------------------------------------------------------------
    // Trip creation
    // ------------------------------------------------------------------

    function createTrip(
        bytes32 tripId,
        address claimPubKey20,
        uint256 budget,
        uint64  expiresAt,
        bytes32 metadataHash,
        string calldata metadataCID,
        uint256 agentTokenId,
        bytes32 claimCodeHash
    ) external;

    function batchCreateTrip(TripInput[] calldata inputs) external;

    // ------------------------------------------------------------------
    // Claim → enroll guest wallet
    // ------------------------------------------------------------------

    function claimTrip(
        bytes32 tripId,
        address guestWallet,
        bytes calldata signature,
        bytes calldata claimCodePreimage
    ) external;

    // ------------------------------------------------------------------
    // Booking lifecycle
    // ------------------------------------------------------------------

    function reserveForBooking(bytes32 tripId, bytes32 bookingId, uint256 upperBound) external;

    function commitBooking(
        bytes32 bookingId,
        uint256 vendorAmount,
        uint256 feeAmount,
        address vendor,
        bytes32 itineraryHash,
        string calldata itineraryCID
    ) external;

    /// @notice v3.0.0 — three-recipient commit. Sum of (vendorAmount +
    ///         feeAmount + agencyAmount) becomes the booking's actualAmount.
    ///         If `agencyAmount > 0` then `agencyAddress` MUST be non-zero;
    ///         this is enforced at commit time so settlement can never
    ///         silently drop the agency leg or burn USDC to address(0).
    ///         Pass `agencyAmount=0, agencyAddress=address(0)` to behave
    ///         like the legacy `commitBooking` while still emitting the
    ///         richer `BookingCommittedV2` event.
    function commitBookingV2(
        bytes32 bookingId,
        uint256 vendorAmount,
        uint256 feeAmount,
        uint256 agencyAmount,
        address vendor,
        address agencyAddress,
        bytes32 itineraryHash,
        string calldata itineraryCID
    ) external;

    function confirmDuffel(bytes32 bookingId, bytes32 duffelOrderHash) external;

    /// @notice v3.0.0 — operator-only OTP rotation, used when the guest
    ///         requests a resend. Atomically replaces the on-chain hash
    ///         and resets the consecutive-failed-attempts counter for
    ///         the trip. The lockout (if any) is NOT cleared — that's
    ///         the brute-force cooldown and should outlive a rotation.
    ///
    ///         Locked-down preconditions:
    ///           • trip exists, not yet claimed, not cancelled, not expired
    ///           • newCodeHash != bytes32(0) (would silently disable 2FA)
    ///           • caller == operator (enforces server-side rate limits)
    function setClaimCodeHash(bytes32 tripId, bytes32 newCodeHash) external;
    function settleBooking(bytes32 bookingId) external;
    function refundBooking(bytes32 bookingId) external;

    // ------------------------------------------------------------------
    // Admin reclaim paths
    // ------------------------------------------------------------------

    function reclaimStuckBooking(bytes32 bookingId) external;
    function cancelTrip(bytes32 tripId) external;
    function sweepUnspent(bytes32 tripId) external;

    // ------------------------------------------------------------------
    // Metering (x402)
    // ------------------------------------------------------------------

    function logAgentAction(bytes32 tripId, uint8 actionType, uint256 feeMicro) external;

    // ------------------------------------------------------------------
    // Admin
    // ------------------------------------------------------------------

    function setOperator(address newOperator) external;
    function pause() external;
    function unpause() external;

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    function operator() external view returns (address);
    function trips(bytes32 tripId) external view returns (Trip memory);
    function bookings(bytes32 bookingId) external view returns (Booking memory);
    function available(bytes32 tripId) external view returns (uint256);
    function claimMessageHash(bytes32 tripId, address guestWallet) external view returns (bytes32);

    // ------------------------------------------------------------------
    // Constants exposed as view selectors (so consumers can read without
    // pinning against an impl version)
    // ------------------------------------------------------------------

    function SENDERO_SALT() external view returns (bytes32);
    function RESERVE_TIMEOUT() external view returns (uint64);
    function CONFIRM_TIMEOUT() external view returns (uint64);
    function ACTION_TYPE_MAX() external view returns (uint8);
    function AGENT_FEE_MAX() external view returns (uint256);
}
