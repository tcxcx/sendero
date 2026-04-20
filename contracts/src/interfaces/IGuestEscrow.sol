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
    event DuffelConfirmed(bytes32 indexed bookingId, bytes32 duffelOrderHash);
    event BookingSettled(
        bytes32 indexed bookingId,
        address         vendor,
        uint256         vendorAmount,
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

    function confirmDuffel(bytes32 bookingId, bytes32 duffelOrderHash) external;
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
