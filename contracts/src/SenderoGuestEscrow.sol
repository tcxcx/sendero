// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

import {Initializable}            from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable}          from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable}       from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {PausableUpgradeable}      from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

import {IGuestEscrow} from "./interfaces/IGuestEscrow.sol";

/// @title  SenderoGuestEscrow
/// @custom:version 2.0.0
/// @notice Pre-funded guest-link travel escrow on Circle Arc.
///
///         Corporate buyer pre-funds USDC for a named guest. Guest claims
///         the trip via a Peanut-Protocol-style ephemeral keypair
///         (recipient-bound signature) plus an out-of-band OTP second
///         factor. Bookings reserve up to an upper bound (to absorb GDS
///         price drift), commit with the actual quoted price, and settle
///         to vendor payout addresses after the operator records the
///         Duffel order confirmation. Unused funds sweep back to the
///         buyer on expiry or cancellation.
///
///         Upgradeable via UUPS. State lives at a deterministic
///         ERC-7201 storage slot — safe across implementation upgrades.
///
/// @dev    Reputation attestation is NOT performed by this contract.
///         Per ERC-8004, agent owners cannot attest their own agents —
///         the guest's MSCA calls `ReputationRegistry.giveFeedback`
///         directly in a separate userOp after settlement.
contract SenderoGuestEscrow is
    IGuestEscrow,
    Initializable,
    UUPSUpgradeable,
    OwnableUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // ------------------------------------------------------------------
    // Constants (inlined at compile time — safe for upgradeable contracts)
    // ------------------------------------------------------------------

    /// @notice Human-readable label shown on block explorers.
    string public constant NAME = "SenderoGuestEscrow";

    /// @notice Domain separator baked into claim signatures. Combined
    ///         with chainid + contract address for cross-chain safety.
    bytes32 public constant SENDERO_SALT = keccak256("SENDERO_V1_GUEST_CLAIM");

    uint8 public constant STATUS_RESERVED  = uint8(BookingStatus.Reserved);
    uint8 public constant STATUS_COMMITTED = uint8(BookingStatus.Committed);
    uint8 public constant STATUS_SETTLED   = uint8(BookingStatus.Settled);
    uint8 public constant STATUS_REFUNDED  = uint8(BookingStatus.Refunded);

    /// @notice Buyer can force-refund a RESERVED booking this long
    ///         after reservation if the operator never progresses it.
    uint64 public constant RESERVE_TIMEOUT = 1 hours;

    /// @notice Buyer can force-refund a COMMITTED booking this long
    ///         after commit if Duffel confirmation never lands.
    uint64 public constant CONFIRM_TIMEOUT = 30 minutes;

    /// @notice Max accepted action type value for `logAgentAction`.
    ///         Matches the off-chain `AGENT_ACTION.OTHER = 99` convention.
    uint8 public constant ACTION_TYPE_MAX = 99;

    /// @notice Max fee (micro-USDC) reportable per agent action event.
    ///         Caps the blast radius of a compromised operator emitting
    ///         pollution events at 1 USDC per log.
    uint256 public constant AGENT_FEE_MAX = 1_000_000;

    // ------------------------------------------------------------------
    // ERC-7201 namespaced storage
    // ------------------------------------------------------------------

    /// @custom:storage-location erc7201:sendero.storage.GuestEscrow
    struct GuestEscrowStorage {
        IERC20                     usdc;      // Circle USDC on Arc
        address                    operator;  // Sendero backend signer
        mapping(bytes32 => Trip)    trips;
        mapping(bytes32 => Booking) bookings;
    }

    /// @dev keccak256(abi.encode(uint256(keccak256("sendero.storage.GuestEscrow")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant GUEST_ESCROW_STORAGE_LOCATION =
        0xa9cfe6f5e0f5b2fdaa8858fdcb832ee6b68d009df1ba4ebe8d1646ab2d682700;

    function _getStorage() private pure returns (GuestEscrowStorage storage $) {
        assembly {
            $.slot := GUEST_ESCROW_STORAGE_LOCATION
        }
    }

    // ------------------------------------------------------------------
    // Constructor + initializer
    // ------------------------------------------------------------------

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initialize the proxy. Call once immediately after deploy.
    /// @param  usdc_      Address of the USDC token on the target chain.
    /// @param  operator_  Sendero backend signer (EOA or Safe).
    /// @param  owner_     Upgrade authority. Recommend a Safe multisig.
    function initialize(address usdc_, address operator_, address owner_) external initializer {
        if (usdc_ == address(0) || operator_ == address(0) || owner_ == address(0)) {
            revert ZeroAddress();
        }

        __Ownable_init(owner_);
        __Pausable_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        GuestEscrowStorage storage $ = _getStorage();
        $.usdc = IERC20(usdc_);
        $.operator = operator_;
    }

    /// @dev UUPS upgrade gate. Only the owner (Safe) can ship a new
    ///      implementation.
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    // ------------------------------------------------------------------
    // Modifiers
    // ------------------------------------------------------------------

    modifier onlyOperator() {
        if (msg.sender != _getStorage().operator) revert NotAuthorized();
        _;
    }

    // ------------------------------------------------------------------
    // Trip creation
    // ------------------------------------------------------------------

    /// @inheritdoc IGuestEscrow
    function createTrip(
        bytes32 tripId,
        address claimPubKey20,
        uint256 budget,
        uint64  expiresAt,
        bytes32 metadataHash,
        string calldata metadataCID,
        uint256 agentTokenId,
        bytes32 claimCodeHash
    ) external nonReentrant whenNotPaused {
        _createTrip(
            tripId, claimPubKey20, budget, expiresAt,
            metadataHash, metadataCID, agentTokenId, claimCodeHash
        );
        _getStorage().usdc.safeTransferFrom(msg.sender, address(this), budget);
    }

    /// @inheritdoc IGuestEscrow
    function batchCreateTrip(TripInput[] calldata inputs)
        external
        nonReentrant
        whenNotPaused
    {
        uint256 total;
        for (uint256 i; i < inputs.length; ++i) {
            total += inputs[i].budget;
            _createTrip(
                inputs[i].tripId,
                inputs[i].claimPubKey20,
                inputs[i].budget,
                inputs[i].expiresAt,
                inputs[i].metadataHash,
                inputs[i].metadataCID,
                inputs[i].agentTokenId,
                inputs[i].claimCodeHash
            );
        }
        _getStorage().usdc.safeTransferFrom(msg.sender, address(this), total);
    }

    function _createTrip(
        bytes32 tripId,
        address claimPubKey20,
        uint256 budget,
        uint64  expiresAt,
        bytes32 metadataHash,
        string calldata metadataCID,
        uint256 agentTokenId,
        bytes32 claimCodeHash
    ) internal {
        GuestEscrowStorage storage $ = _getStorage();
        if ($.trips[tripId].buyer != address(0)) revert TripExists();
        if (claimPubKey20 == address(0))         revert ZeroAddress();
        if (budget == 0)                         revert ZeroValue();
        if (expiresAt <= block.timestamp)        revert TripExpired();

        $.trips[tripId] = Trip({
            claimPubKey20:  claimPubKey20,
            buyer:          msg.sender,
            guestWallet:    address(0),
            budget:         budget,
            reserved:       0,
            spent:          0,
            expiresAt:      expiresAt,
            cancelled:      false,
            swept:          false,
            metadataHash:   metadataHash,
            metadataCID:    metadataCID,
            agentTokenId:   agentTokenId,
            claimCodeHash:  claimCodeHash
        });

        emit TripCreated(
            tripId, msg.sender, claimPubKey20, budget, expiresAt,
            metadataHash, metadataCID, agentTokenId, claimCodeHash
        );
    }

    // ------------------------------------------------------------------
    // Peanut-style claim → guest wallet enrollment
    // ------------------------------------------------------------------

    /// @inheritdoc IGuestEscrow
    function claimTrip(
        bytes32 tripId,
        address guestWallet,
        bytes calldata signature,
        bytes calldata claimCodePreimage
    ) external nonReentrant whenNotPaused {
        Trip storage t = _getStorage().trips[tripId];
        if (t.buyer == address(0))          revert TripNotFound();
        if (t.guestWallet != address(0))    revert AlreadyClaimed();
        if (t.cancelled)                    revert TripIsCancelled();
        if (block.timestamp >= t.expiresAt) revert TripExpired();
        if (guestWallet == address(0))      revert ZeroAddress();

        if (t.claimCodeHash != bytes32(0)) {
            if (keccak256(claimCodePreimage) != t.claimCodeHash) revert InvalidClaimCode();
        }

        bytes32 hash = _claimHash(tripId, guestWallet);
        address signer = hash.recover(signature);
        if (signer != t.claimPubKey20) revert InvalidSignature();

        t.guestWallet = guestWallet;
        emit TripClaimed(tripId, guestWallet);
    }

    function _claimHash(bytes32 tripId, address guestWallet) private view returns (bytes32) {
        return keccak256(abi.encodePacked(
            SENDERO_SALT,
            block.chainid,
            address(this),
            tripId,
            guestWallet
        )).toEthSignedMessageHash();
    }

    // ------------------------------------------------------------------
    // Booking lifecycle
    // ------------------------------------------------------------------

    /// @inheritdoc IGuestEscrow
    function reserveForBooking(
        bytes32 tripId,
        bytes32 bookingId,
        uint256 upperBound
    ) external nonReentrant whenNotPaused {
        GuestEscrowStorage storage $ = _getStorage();
        Trip storage t = $.trips[tripId];

        if (t.buyer == address(0))                                  revert TripNotFound();
        if (msg.sender != t.guestWallet && msg.sender != $.operator) revert NotAuthorized();
        if (t.cancelled)                                            revert TripIsCancelled();
        if (block.timestamp >= t.expiresAt)                         revert TripExpired();
        if (upperBound == 0)                                        revert ZeroValue();
        if ($.bookings[bookingId].tripId != bytes32(0))             revert BookingExists();
        if (t.budget - t.reserved - t.spent < upperBound)           revert InsufficientBudget();

        t.reserved += upperBound;
        $.bookings[bookingId] = Booking({
            tripId:          tripId,
            amount:          upperBound,
            actualAmount:    0,
            fee:             0,
            vendor:          address(0),
            itineraryHash:   bytes32(0),
            itineraryCID:    "",
            duffelOrderHash: bytes32(0),
            status:          STATUS_RESERVED,
            reservedAt:      uint64(block.timestamp),
            committedAt:     0
        });

        emit BookingReserved(tripId, bookingId, upperBound);
    }

    /// @inheritdoc IGuestEscrow
    /// @dev Guest-only. The commit fixes the vendor and the payable
    ///      amount — it must be an explicit guest authorization. A
    ///      compromised operator cannot commit on the guest's behalf.
    function commitBooking(
        bytes32 bookingId,
        uint256 vendorAmount,
        uint256 feeAmount,
        address vendor,
        bytes32 itineraryHash,
        string calldata itineraryCID
    ) external nonReentrant whenNotPaused {
        GuestEscrowStorage storage $ = _getStorage();
        Booking storage b = $.bookings[bookingId];

        if (b.tripId == bytes32(0))      revert BookingBadStatus();
        if (b.status != STATUS_RESERVED) revert BookingBadStatus();
        if (vendor == address(0))        revert ZeroAddress();

        uint256 actual = vendorAmount + feeAmount;
        if (actual == 0)        revert ZeroValue();
        if (actual > b.amount)  revert AmountExceedsUpperBound();

        Trip storage t = $.trips[b.tripId];
        if (msg.sender != t.guestWallet) revert NotAuthorized();

        uint256 slack = b.amount - actual;
        if (slack > 0) {
            t.reserved -= slack;
            b.amount = actual;
        }

        b.actualAmount  = actual;
        b.fee           = feeAmount;
        b.vendor        = vendor;
        b.itineraryHash = itineraryHash;
        b.itineraryCID  = itineraryCID;
        b.status        = STATUS_COMMITTED;
        b.committedAt   = uint64(block.timestamp);

        emit BookingCommitted(bookingId, vendorAmount, feeAmount, vendor, itineraryHash, itineraryCID, slack);
    }

    /// @inheritdoc IGuestEscrow
    function confirmDuffel(bytes32 bookingId, bytes32 duffelOrderHash)
        external
        onlyOperator
        whenNotPaused
    {
        Booking storage b = _getStorage().bookings[bookingId];
        if (b.status != STATUS_COMMITTED)     revert BookingBadStatus();
        if (b.duffelOrderHash != bytes32(0))  revert BookingAlreadyConfirmed();
        if (duffelOrderHash == bytes32(0))    revert ZeroValue();

        b.duffelOrderHash = duffelOrderHash;
        emit DuffelConfirmed(bookingId, duffelOrderHash);
    }

    /// @inheritdoc IGuestEscrow
    function settleBooking(bytes32 bookingId)
        external
        nonReentrant
        onlyOperator
        whenNotPaused
    {
        GuestEscrowStorage storage $ = _getStorage();
        Booking storage b = $.bookings[bookingId];

        if (b.status != STATUS_COMMITTED)     revert BookingBadStatus();
        if (b.duffelOrderHash == bytes32(0))  revert BookingBadStatus();

        Trip storage t = $.trips[b.tripId];
        uint256 vendorAmount = b.actualAmount - b.fee;
        uint256 settleAmount = b.actualAmount;
        uint256 feeAmount = b.fee;
        address vendor = b.vendor;

        // Effects
        t.reserved -= settleAmount;
        t.spent    += settleAmount;
        b.status    = STATUS_SETTLED;

        // Interactions
        $.usdc.safeTransfer(vendor, vendorAmount);
        if (feeAmount > 0) $.usdc.safeTransfer($.operator, feeAmount);

        emit BookingSettled(bookingId, vendor, vendorAmount, feeAmount);
    }

    /// @inheritdoc IGuestEscrow
    function refundBooking(bytes32 bookingId)
        external
        nonReentrant
        onlyOperator
        whenNotPaused
    {
        GuestEscrowStorage storage $ = _getStorage();
        Booking storage b = $.bookings[bookingId];
        if (b.status != STATUS_RESERVED && b.status != STATUS_COMMITTED) revert BookingBadStatus();

        uint256 amt = b.amount;
        $.trips[b.tripId].reserved -= amt;
        b.status = STATUS_REFUNDED;
        emit BookingRefunded(bookingId, amt);
    }

    // ------------------------------------------------------------------
    // Admin reclaim paths
    // ------------------------------------------------------------------

    /// @inheritdoc IGuestEscrow
    function reclaimStuckBooking(bytes32 bookingId) external nonReentrant {
        GuestEscrowStorage storage $ = _getStorage();
        Booking storage b = $.bookings[bookingId];
        if (b.tripId == bytes32(0)) revert BookingBadStatus();

        Trip storage t = $.trips[b.tripId];
        if (msg.sender != t.buyer) revert NotAuthorized();

        uint8 priorStatus = b.status;

        if (priorStatus == STATUS_RESERVED) {
            if (block.timestamp <= b.reservedAt + RESERVE_TIMEOUT) revert NotYetReclaimable();
        } else if (priorStatus == STATUS_COMMITTED) {
            if (b.duffelOrderHash != bytes32(0))                    revert BookingAlreadyConfirmed();
            if (block.timestamp <= b.committedAt + CONFIRM_TIMEOUT) revert NotYetReclaimable();
        } else {
            revert BookingBadStatus();
        }

        uint256 amt = b.amount;
        t.reserved -= amt;
        b.status = STATUS_REFUNDED;
        emit BookingReclaimed(bookingId, amt, priorStatus);
    }

    /// @inheritdoc IGuestEscrow
    function cancelTrip(bytes32 tripId) external nonReentrant {
        GuestEscrowStorage storage $ = _getStorage();
        Trip storage t = $.trips[tripId];
        if (t.buyer == address(0))                            revert TripNotFound();
        if (msg.sender != t.buyer && msg.sender != $.operator) revert NotAuthorized();
        if (t.cancelled)                                      revert TripIsCancelled();
        if (t.reserved != 0)                                  revert ReservationsOutstanding();
        t.cancelled = true;
        emit TripCancelled(tripId);
    }

    /// @inheritdoc IGuestEscrow
    function sweepUnspent(bytes32 tripId) external nonReentrant {
        GuestEscrowStorage storage $ = _getStorage();
        Trip storage t = $.trips[tripId];
        if (t.buyer == address(0))                            revert TripNotFound();
        if (msg.sender != t.buyer && msg.sender != $.operator) revert NotAuthorized();
        if (!t.cancelled && block.timestamp <= t.expiresAt)   revert StillActive();
        if (t.swept)                                          revert NothingToSweep();
        if (t.reserved != 0)                                  revert ReservationsOutstanding();

        uint256 returnable = t.budget - t.spent;
        if (returnable == 0) revert NothingToSweep();

        t.swept = true;
        $.usdc.safeTransfer(t.buyer, returnable);
        emit Swept(tripId, returnable);
    }

    // ------------------------------------------------------------------
    // Agent action metering (x402)
    // ------------------------------------------------------------------

    /// @inheritdoc IGuestEscrow
    function logAgentAction(
        bytes32 tripId,
        uint8   actionType,
        uint256 feeMicro
    ) external onlyOperator {
        Trip storage t = _getStorage().trips[tripId];
        if (t.buyer == address(0))          revert TripNotFound();
        if (actionType > ACTION_TYPE_MAX)   revert InvalidActionType();
        if (feeMicro > AGENT_FEE_MAX)       revert AgentFeeTooHigh();
        emit AgentActionLogged(tripId, t.agentTokenId, actionType, feeMicro);
    }

    // ------------------------------------------------------------------
    // Admin
    // ------------------------------------------------------------------

    /// @inheritdoc IGuestEscrow
    function setOperator(address newOperator) external onlyOwner {
        if (newOperator == address(0)) revert ZeroAddress();
        _getStorage().operator = newOperator;
        emit OperatorUpdated(newOperator);
    }

    /// @inheritdoc IGuestEscrow
    function pause() external onlyOwner {
        _pause();
    }

    /// @inheritdoc IGuestEscrow
    function unpause() external onlyOwner {
        _unpause();
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    /// @inheritdoc IGuestEscrow
    function operator() external view returns (address) {
        return _getStorage().operator;
    }

    /// @notice The USDC token the escrow holds. View kept for external
    ///         consumers that previously relied on a public immutable.
    function USDC() external view returns (IERC20) {
        return _getStorage().usdc;
    }

    /// @inheritdoc IGuestEscrow
    function trips(bytes32 tripId) external view returns (Trip memory) {
        return _getStorage().trips[tripId];
    }

    /// @inheritdoc IGuestEscrow
    function bookings(bytes32 bookingId) external view returns (Booking memory) {
        return _getStorage().bookings[bookingId];
    }

    /// @inheritdoc IGuestEscrow
    function available(bytes32 tripId) external view returns (uint256) {
        Trip storage t = _getStorage().trips[tripId];
        if (t.buyer == address(0) || t.cancelled || block.timestamp >= t.expiresAt) return 0;
        return t.budget - t.reserved - t.spent;
    }

    /// @inheritdoc IGuestEscrow
    function claimMessageHash(bytes32 tripId, address guestWallet)
        external
        view
        returns (bytes32)
    {
        return _claimHash(tripId, guestWallet);
    }

    /// @notice Current implementation version string.
    function version() external pure returns (string memory) {
        return "2.0.0";
    }
}
