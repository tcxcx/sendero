// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {SenderoGuestEscrow} from "../src/SenderoGuestEscrow.sol";
import {IGuestEscrow} from "../src/interfaces/IGuestEscrow.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract SenderoGuestEscrowTest is Test {
    using MessageHashUtils for bytes32;

    SenderoGuestEscrow internal escrow;
    MockUSDC internal usdc;

    address internal owner       = address(0xA11CE);
    address internal operator    = address(0x0FE7);
    address internal buyer       = address(0xB10B);
    address internal vendor      = address(0xBEEF);
    address internal guestWallet = address(0xCAFE);
    address internal attacker    = address(0xDEAD);

    // Peanut-style ephemeral claim keypair (deterministic for tests)
    uint256 internal claimPrivKey = 0xA11CECAFE;
    address internal claimPubKey20;

    uint256 internal constant BUDGET = 2_000_000_000;  // 2,000 USDC (6 decimals)
    uint64  internal constant EXPIRY_OFFSET = 30 days;

    function setUp() public {
        claimPubKey20 = vm.addr(claimPrivKey);

        usdc = new MockUSDC();

        // Deploy implementation + UUPS proxy, initialize
        vm.startPrank(owner);
        SenderoGuestEscrow impl = new SenderoGuestEscrow();
        bytes memory initData = abi.encodeCall(
            SenderoGuestEscrow.initialize,
            (address(usdc), operator, owner)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        escrow = SenderoGuestEscrow(address(proxy));
        vm.stopPrank();

        // Fund the buyer and approve escrow
        usdc.mint(buyer, BUDGET * 10);
        vm.prank(buyer);
        usdc.approve(address(escrow), type(uint256).max);
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    function _createTrip(bytes32 tripId) internal returns (uint64 expiresAt) {
        return _createTripWithCode(tripId, bytes32(0));
    }

    function _createTripWithCode(bytes32 tripId, bytes32 claimCodeHash)
        internal returns (uint64 expiresAt)
    {
        expiresAt = uint64(block.timestamp + EXPIRY_OFFSET);
        vm.prank(buyer);
        escrow.createTrip(
            tripId,
            claimPubKey20,
            BUDGET,
            expiresAt,
            keccak256("meta"),
            "ipfs://QmMeta",
            12345,               // agentTokenId
            claimCodeHash
        );
    }

    function _signClaim(bytes32 tripId, address wallet) internal view returns (bytes memory) {
        bytes32 hash = keccak256(abi.encodePacked(
            escrow.SENDERO_SALT(),
            block.chainid,
            address(escrow),
            tripId,
            wallet
        )).toEthSignedMessageHash();
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(claimPrivKey, hash);
        return abi.encodePacked(r, s, v);
    }

    function _claim(bytes32 tripId, address wallet) internal {
        bytes memory sig = _signClaim(tripId, wallet);
        escrow.claimTrip(tripId, wallet, sig, "");
    }

    function _claimWithCode(bytes32 tripId, address wallet, bytes memory preimage) internal {
        bytes memory sig = _signClaim(tripId, wallet);
        escrow.claimTrip(tripId, wallet, sig, preimage);
    }

    // ------------------------------------------------------------------
    // createTrip
    // ------------------------------------------------------------------

    function test_createTrip_happy() public {
        bytes32 tripId = keccak256("T1");
        _createTrip(tripId);

        IGuestEscrow.Trip memory t = escrow.trips(tripId);
        assertEq(t.claimPubKey20, claimPubKey20);
        assertEq(t.buyer, buyer);
        assertEq(t.guestWallet, address(0));
        assertEq(t.budget, BUDGET);
        assertEq(t.reserved, 0);
        assertEq(t.spent, 0);
        assertGt(t.expiresAt, block.timestamp);
        assertFalse(t.cancelled);
        assertFalse(t.swept);
        assertEq(t.metadataHash, keccak256("meta"));
        assertEq(t.metadataCID, "ipfs://QmMeta");
        assertEq(t.agentTokenId, 12345);
        assertEq(t.claimCodeHash, bytes32(0));
        assertEq(usdc.balanceOf(address(escrow)), BUDGET);
    }

    function test_createTrip_rejectsDuplicate() public {
        bytes32 tripId = keccak256("T1");
        _createTrip(tripId);

        uint64 expiresAt = uint64(block.timestamp + EXPIRY_OFFSET);
        vm.prank(buyer);
        vm.expectRevert(IGuestEscrow.TripExists.selector);
        escrow.createTrip(tripId, claimPubKey20, BUDGET, expiresAt, bytes32(0), "", 0, bytes32(0));
    }

    function test_createTrip_rejectsZeroBudget() public {
        uint64 expiresAt = uint64(block.timestamp + EXPIRY_OFFSET);
        vm.prank(buyer);
        vm.expectRevert(IGuestEscrow.ZeroValue.selector);
        escrow.createTrip(keccak256("T"), claimPubKey20, 0, expiresAt, bytes32(0), "", 0, bytes32(0));
    }

    function test_createTrip_rejectsPastExpiry() public {
        vm.prank(buyer);
        vm.expectRevert(IGuestEscrow.TripExpired.selector);
        escrow.createTrip(keccak256("T"), claimPubKey20, BUDGET, uint64(block.timestamp), bytes32(0), "", 0, bytes32(0));
    }

    function test_batchCreateTrip_sumsCorrectly() public {
        IGuestEscrow.TripInput[] memory inputs = new IGuestEscrow.TripInput[](3);
        for (uint256 i; i < 3; ++i) {
            inputs[i] = IGuestEscrow.TripInput({
                tripId: keccak256(abi.encode("T", i)),
                claimPubKey20: claimPubKey20,
                budget: 500_000_000,
                expiresAt: uint64(block.timestamp + EXPIRY_OFFSET),
                metadataHash: keccak256("meta"),
                metadataCID: "ipfs://",
                agentTokenId: 111,
                claimCodeHash: bytes32(0)
            });
        }

        uint256 balBefore = usdc.balanceOf(address(escrow));
        vm.prank(buyer);
        escrow.batchCreateTrip(inputs);
        assertEq(usdc.balanceOf(address(escrow)) - balBefore, 1_500_000_000);
    }

    // ------------------------------------------------------------------
    // claimTrip (Peanut-style)
    // ------------------------------------------------------------------

    function test_claimTrip_validSig() public {
        bytes32 tripId = keccak256("T1");
        _createTrip(tripId);

        _claim(tripId, guestWallet);

        address g = escrow.trips(tripId).guestWallet;
        assertEq(g, guestWallet);
    }

    function test_claimTrip_rejectsWrongSig() public {
        bytes32 tripId = keccak256("T1");
        _createTrip(tripId);

        // Sign with a DIFFERENT private key
        uint256 badKey = 0xBADBADBAD;
        bytes32 hash = keccak256(abi.encodePacked(
            escrow.SENDERO_SALT(), block.chainid, address(escrow), tripId, guestWallet
        )).toEthSignedMessageHash();
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(badKey, hash);
        bytes memory badSig = abi.encodePacked(r, s, v);

        vm.expectRevert(IGuestEscrow.InvalidSignature.selector);
        escrow.claimTrip(tripId, guestWallet, badSig, "");
    }

    /// @notice THE front-running test: a valid sig for guestWallet A cannot
    ///         be replayed by attacker substituting their own address B.
    function test_claimTrip_rejectsFrontrun() public {
        bytes32 tripId = keccak256("T1");
        _createTrip(tripId);

        // Legitimate guest signs for their wallet
        bytes memory validSig = _signClaim(tripId, guestWallet);

        // Attacker tries to claim with SAME signature but THEIR address
        vm.expectRevert(IGuestEscrow.InvalidSignature.selector);
        escrow.claimTrip(tripId, attacker, validSig, "");
    }

    function test_claimTrip_rejectsDoubleClaim() public {
        bytes32 tripId = keccak256("T1");
        _createTrip(tripId);
        _claim(tripId, guestWallet);

        bytes memory sig = _signClaim(tripId, attacker);
        vm.expectRevert(IGuestEscrow.AlreadyClaimed.selector);
        escrow.claimTrip(tripId, attacker, sig, "");
    }

    // ------------------------------------------------------------------
    // Claim code (OTP 2FA)
    // ------------------------------------------------------------------

    function test_claimTrip_requiresCode_happyPath() public {
        bytes32 tripId = keccak256("T1");
        bytes memory preimage = bytes("123456|some-nonce-0xabc");
        bytes32 codeHash = keccak256(preimage);

        _createTripWithCode(tripId, codeHash);
        _claimWithCode(tripId, guestWallet, preimage);

        address g = escrow.trips(tripId).guestWallet;
        assertEq(g, guestWallet);
    }

    /// @notice v3.0.0 — wrong code no longer reverts. Instead the call
    ///         emits `ClaimAttemptFailed` (or `ClaimLockoutTriggered` on
    ///         the threshold attempt), persists the failed-attempt
    ///         counter, and returns early without setting `guestWallet`.
    ///         See contracts/src/SenderoGuestEscrow.sol::claimTrip for
    ///         the rationale (revert would undo the counter persistence).
    function test_claimTrip_rejectsWrongCode_emitsAttemptFailedAndDoesNotClaim() public {
        bytes32 tripId = keccak256("T1");
        bytes32 codeHash = keccak256("correct-preimage");

        _createTripWithCode(tripId, codeHash);
        bytes memory sig = _signClaim(tripId, guestWallet);

        vm.expectEmit(true, false, false, true, address(escrow));
        emit IGuestEscrow.ClaimAttemptFailed(tripId, 1);
        escrow.claimTrip(tripId, guestWallet, sig, bytes("wrong-preimage"));

        // Trip remains unclaimed.
        assertEq(escrow.trips(tripId).guestWallet, address(0), "trip stays unclaimed");
    }

    function test_claimTrip_rejectsEmptyCodeWhenRequired() public {
        bytes32 tripId = keccak256("T1");
        _createTripWithCode(tripId, keccak256("something"));

        bytes memory sig = _signClaim(tripId, guestWallet);

        vm.expectEmit(true, false, false, true, address(escrow));
        emit IGuestEscrow.ClaimAttemptFailed(tripId, 1);
        escrow.claimTrip(tripId, guestWallet, sig, "");

        // Trip remains unclaimed.
        assertEq(escrow.trips(tripId).guestWallet, address(0), "trip stays unclaimed");
    }

    function test_claimTrip_ignoresCodeWhenDisabled() public {
        bytes32 tripId = keccak256("T1");
        _createTripWithCode(tripId, bytes32(0));

        // Passing arbitrary preimage with hash=0 trip should still work
        bytes memory sig = _signClaim(tripId, guestWallet);
        escrow.claimTrip(tripId, guestWallet, sig, bytes("whatever"));
        address g = escrow.trips(tripId).guestWallet;
        assertEq(g, guestWallet);
    }

    function test_claimTrip_rejectsExpired() public {
        bytes32 tripId = keccak256("T1");
        _createTrip(tripId);

        vm.warp(block.timestamp + EXPIRY_OFFSET + 1);

        bytes memory sig = _signClaim(tripId, guestWallet);
        vm.expectRevert(IGuestEscrow.TripExpired.selector);
        escrow.claimTrip(tripId, guestWallet, sig, "");
    }

    function test_claimTrip_rejectsCancelled() public {
        bytes32 tripId = keccak256("T1");
        _createTrip(tripId);

        vm.prank(buyer);
        escrow.cancelTrip(tripId);

        bytes memory sig = _signClaim(tripId, guestWallet);
        vm.expectRevert(IGuestEscrow.TripIsCancelled.selector);
        escrow.claimTrip(tripId, guestWallet, sig, "");
    }

    // ------------------------------------------------------------------
    // reserveForBooking
    // ------------------------------------------------------------------

    function test_reserveForBooking_happy() public {
        bytes32 tripId = keccak256("T1");
        _createTrip(tripId);
        _claim(tripId, guestWallet);

        bytes32 bookingId = keccak256("B1");
        vm.prank(guestWallet);
        escrow.reserveForBooking(tripId, bookingId, 1_310_000_000);  // upper bound

        assertEq(escrow.available(tripId), BUDGET - 1_310_000_000);
    }

    function test_reserveForBooking_operatorCanReserve() public {
        bytes32 tripId = keccak256("T1");
        _createTrip(tripId);
        _claim(tripId, guestWallet);

        vm.prank(operator);
        escrow.reserveForBooking(tripId, keccak256("B1"), 500_000_000);
    }

    function test_reserveForBooking_rejectsOverBudget() public {
        bytes32 tripId = keccak256("T1");
        _createTrip(tripId);
        _claim(tripId, guestWallet);

        vm.prank(guestWallet);
        vm.expectRevert(IGuestEscrow.InsufficientBudget.selector);
        escrow.reserveForBooking(tripId, keccak256("B1"), BUDGET + 1);
    }

    function test_reserveForBooking_rejectsUnauthorized() public {
        bytes32 tripId = keccak256("T1");
        _createTrip(tripId);
        _claim(tripId, guestWallet);

        vm.prank(attacker);
        vm.expectRevert(IGuestEscrow.NotAuthorized.selector);
        escrow.reserveForBooking(tripId, keccak256("B1"), 500_000_000);
    }

    // ------------------------------------------------------------------
    // commitBooking — price drift handling
    // ------------------------------------------------------------------

    function test_commitBooking_releasesSlackOnPriceDrop() public {
        bytes32 tripId    = keccak256("T1");
        bytes32 bookingId = keccak256("B1");
        _createTrip(tripId);
        _claim(tripId, guestWallet);

        vm.prank(guestWallet);
        escrow.reserveForBooking(tripId, bookingId, 1_310_000_000);  // upper bound

        // Actual Duffel price came in lower
        vm.prank(guestWallet);
        escrow.commitBooking(
            bookingId,
            1_241_000_000,   // vendor
            6_000_000,       // fee
            vendor,
            keccak256("itinerary"),
            "ipfs://Itin"
        );

        // Slack should have returned to available budget
        assertEq(escrow.available(tripId), BUDGET - 1_247_000_000);

        // Booking amount shrinks to actual
        IGuestEscrow.Booking memory b = escrow.bookings(bookingId);
        assertEq(b.amount, 1_247_000_000);
        assertEq(b.actualAmount, 1_247_000_000);
        assertEq(b.fee, 6_000_000);
        assertEq(b.vendor, vendor);
        assertEq(b.status, 1);  // STATUS_COMMITTED
    }

    function test_commitBooking_rejectsOverUpperBound() public {
        bytes32 tripId    = keccak256("T1");
        bytes32 bookingId = keccak256("B1");
        _createTrip(tripId);
        _claim(tripId, guestWallet);

        vm.prank(guestWallet);
        escrow.reserveForBooking(tripId, bookingId, 1_247_000_000);

        vm.prank(guestWallet);
        vm.expectRevert(IGuestEscrow.AmountExceedsUpperBound.selector);
        escrow.commitBooking(
            bookingId,
            1_290_000_000,   // price spiked beyond upper bound
            6_000_000,
            vendor,
            bytes32(0),
            ""
        );
    }

    function test_commitBooking_rejectsNotReserved() public {
        bytes32 bookingId = keccak256("B1");
        vm.prank(guestWallet);
        vm.expectRevert(IGuestEscrow.BookingBadStatus.selector);
        escrow.commitBooking(bookingId, 1, 0, vendor, bytes32(0), "");
    }

    function test_commitBooking_rejectsOperator() public {
        bytes32 tripId    = keccak256("T1");
        bytes32 bookingId = keccak256("B1");
        _createTrip(tripId);
        _claim(tripId, guestWallet);

        vm.prank(operator);
        escrow.reserveForBooking(tripId, bookingId, 1_000_000_000);

        // Operator can reserve but must NOT be able to commit.
        vm.prank(operator);
        vm.expectRevert(IGuestEscrow.NotAuthorized.selector);
        escrow.commitBooking(bookingId, 900_000_000, 50_000_000, vendor, bytes32(0), "");
    }

    function test_commitBooking_rejectsAttacker() public {
        bytes32 tripId    = keccak256("T1");
        bytes32 bookingId = keccak256("B1");
        _createTrip(tripId);
        _claim(tripId, guestWallet);
        vm.prank(guestWallet);
        escrow.reserveForBooking(tripId, bookingId, 1_000_000_000);

        vm.prank(attacker);
        vm.expectRevert(IGuestEscrow.NotAuthorized.selector);
        escrow.commitBooking(bookingId, 900_000_000, 50_000_000, vendor, bytes32(0), "");
    }

    // ------------------------------------------------------------------
    // confirmDuffel + settleBooking
    // ------------------------------------------------------------------

    function test_settleBooking_requiresDuffelConfirm() public {
        bytes32 tripId    = keccak256("T1");
        bytes32 bookingId = keccak256("B1");
        _createTrip(tripId);
        _claim(tripId, guestWallet);

        vm.prank(guestWallet);
        escrow.reserveForBooking(tripId, bookingId, 1_310_000_000);
        vm.prank(guestWallet);
        escrow.commitBooking(bookingId, 1_241_000_000, 6_000_000, vendor, bytes32(0), "");

        // Settle before confirm should fail
        vm.prank(operator);
        vm.expectRevert(IGuestEscrow.BookingBadStatus.selector);
        escrow.settleBooking(bookingId);
    }

    function test_settleBooking_paysVendorAndFee() public {
        bytes32 tripId    = keccak256("T1");
        bytes32 bookingId = keccak256("B1");
        _createTrip(tripId);
        _claim(tripId, guestWallet);

        vm.prank(guestWallet);
        escrow.reserveForBooking(tripId, bookingId, 1_310_000_000);
        vm.prank(guestWallet);
        escrow.commitBooking(bookingId, 1_241_000_000, 6_000_000, vendor, bytes32(0), "");

        vm.prank(operator);
        escrow.confirmDuffel(bookingId, keccak256("DUFFEL-ORD-X"));

        uint256 vendorBefore   = usdc.balanceOf(vendor);
        uint256 operatorBefore = usdc.balanceOf(operator);

        vm.prank(operator);
        escrow.settleBooking(bookingId);

        assertEq(usdc.balanceOf(vendor)   - vendorBefore,   1_241_000_000);
        assertEq(usdc.balanceOf(operator) - operatorBefore, 6_000_000);

        (uint256 tripBudget, uint256 tripReserved, uint256 tripSpent) = _tripSummary(tripId);
        assertEq(tripSpent, 1_247_000_000);
        assertEq(tripReserved, 0);
        assertEq(tripBudget, BUDGET);
    }

    function _tripSummary(bytes32 tripId)
        internal view
        returns (uint256 budget, uint256 reserved, uint256 spent)
    {
        IGuestEscrow.Trip memory _tt = escrow.trips(tripId); budget = _tt.budget; reserved = _tt.reserved; spent = _tt.spent;
    }

    function test_settleBooking_onlyOperator() public {
        bytes32 tripId    = keccak256("T1");
        bytes32 bookingId = keccak256("B1");
        _createTrip(tripId);
        _claim(tripId, guestWallet);
        vm.prank(guestWallet);
        escrow.reserveForBooking(tripId, bookingId, 1_310_000_000);
        vm.prank(guestWallet);
        escrow.commitBooking(bookingId, 1_241_000_000, 6_000_000, vendor, bytes32(0), "");
        vm.prank(operator);
        escrow.confirmDuffel(bookingId, keccak256("DUFFEL-ORD-X"));

        vm.prank(attacker);
        vm.expectRevert(IGuestEscrow.NotAuthorized.selector);
        escrow.settleBooking(bookingId);
    }

    // ------------------------------------------------------------------
    // refundBooking
    // ------------------------------------------------------------------

    function test_refundBooking_restoresBudget() public {
        bytes32 tripId    = keccak256("T1");
        bytes32 bookingId = keccak256("B1");
        _createTrip(tripId);
        _claim(tripId, guestWallet);
        vm.prank(guestWallet);
        escrow.reserveForBooking(tripId, bookingId, 1_000_000_000);

        vm.prank(operator);
        escrow.refundBooking(bookingId);

        assertEq(escrow.available(tripId), BUDGET);
    }

    // ------------------------------------------------------------------
    // reclaimStuckBooking (Peanut-style admin reclaim)
    // ------------------------------------------------------------------

    function test_reclaimStuckBooking_reservedTimeout() public {
        bytes32 tripId    = keccak256("T1");
        bytes32 bookingId = keccak256("B1");
        _createTrip(tripId);
        _claim(tripId, guestWallet);

        vm.prank(guestWallet);
        escrow.reserveForBooking(tripId, bookingId, 1_000_000_000);

        // Before timeout — should revert
        vm.prank(buyer);
        vm.expectRevert(IGuestEscrow.NotYetReclaimable.selector);
        escrow.reclaimStuckBooking(bookingId);

        // Past RESERVE_TIMEOUT
        vm.warp(block.timestamp + escrow.RESERVE_TIMEOUT() + 1);
        vm.prank(buyer);
        escrow.reclaimStuckBooking(bookingId);

        assertEq(escrow.available(tripId), BUDGET);
        assertEq(_bookingStatus(bookingId), 3);  // STATUS_REFUNDED
    }

    function _bookingStatus(bytes32 bookingId) internal view returns (uint8) {
        return escrow.bookings(bookingId).status;
    }

    function test_reclaimStuckBooking_committedWithoutDuffel() public {
        bytes32 tripId    = keccak256("T1");
        bytes32 bookingId = keccak256("B1");
        _createTrip(tripId);
        _claim(tripId, guestWallet);
        vm.prank(guestWallet);
        escrow.reserveForBooking(tripId, bookingId, 1_000_000_000);
        vm.prank(guestWallet);
        escrow.commitBooking(bookingId, 950_000_000, 50_000_000, vendor, bytes32(0), "");
        // Operator never calls confirmDuffel

        // Before timeout — revert
        vm.prank(buyer);
        vm.expectRevert(IGuestEscrow.NotYetReclaimable.selector);
        escrow.reclaimStuckBooking(bookingId);

        // Past CONFIRM_TIMEOUT
        vm.warp(block.timestamp + escrow.CONFIRM_TIMEOUT() + 1);
        vm.prank(buyer);
        escrow.reclaimStuckBooking(bookingId);

        assertEq(escrow.available(tripId), BUDGET);
    }

    function test_reclaimStuckBooking_rejectsConfirmedBooking() public {
        bytes32 tripId    = keccak256("T1");
        bytes32 bookingId = keccak256("B1");
        _createTrip(tripId);
        _claim(tripId, guestWallet);
        vm.prank(guestWallet);
        escrow.reserveForBooking(tripId, bookingId, 1_000_000_000);
        vm.prank(guestWallet);
        escrow.commitBooking(bookingId, 950_000_000, 50_000_000, vendor, bytes32(0), "");
        vm.prank(operator);
        escrow.confirmDuffel(bookingId, keccak256("DUFFEL-ORD-X"));

        vm.warp(block.timestamp + 10 days);  // way past timeout
        vm.prank(buyer);
        vm.expectRevert(IGuestEscrow.BookingAlreadyConfirmed.selector);
        escrow.reclaimStuckBooking(bookingId);
    }

    function test_reclaimStuckBooking_onlyBuyer() public {
        bytes32 tripId    = keccak256("T1");
        bytes32 bookingId = keccak256("B1");
        _createTrip(tripId);
        _claim(tripId, guestWallet);
        vm.prank(guestWallet);
        escrow.reserveForBooking(tripId, bookingId, 1_000_000_000);

        vm.warp(block.timestamp + escrow.RESERVE_TIMEOUT() + 1);
        vm.prank(attacker);
        vm.expectRevert(IGuestEscrow.NotAuthorized.selector);
        escrow.reclaimStuckBooking(bookingId);
    }

    // ------------------------------------------------------------------
    // sweepUnspent
    // ------------------------------------------------------------------

    function test_sweepUnspent_onExpiry() public {
        bytes32 tripId = keccak256("T1");
        _createTrip(tripId);

        vm.warp(block.timestamp + EXPIRY_OFFSET + 1);

        uint256 balBefore = usdc.balanceOf(buyer);
        vm.prank(buyer);
        escrow.sweepUnspent(tripId);
        assertEq(usdc.balanceOf(buyer) - balBefore, BUDGET);
    }

    function test_sweepUnspent_onCancel() public {
        bytes32 tripId = keccak256("T1");
        _createTrip(tripId);

        vm.prank(buyer);
        escrow.cancelTrip(tripId);

        uint256 balBefore = usdc.balanceOf(buyer);
        vm.prank(buyer);
        escrow.sweepUnspent(tripId);
        assertEq(usdc.balanceOf(buyer) - balBefore, BUDGET);
    }

    function test_sweepUnspent_rejectsPendingReservations() public {
        bytes32 tripId = keccak256("T1");
        _createTrip(tripId);
        _claim(tripId, guestWallet);
        vm.prank(guestWallet);
        escrow.reserveForBooking(tripId, keccak256("B1"), 500_000_000);

        vm.warp(block.timestamp + EXPIRY_OFFSET + 1);
        vm.prank(buyer);
        vm.expectRevert(IGuestEscrow.ReservationsOutstanding.selector);
        escrow.sweepUnspent(tripId);
    }

    function test_sweepUnspent_rejectsWhileActive() public {
        bytes32 tripId = keccak256("T1");
        _createTrip(tripId);

        vm.prank(buyer);
        vm.expectRevert(IGuestEscrow.StillActive.selector);
        escrow.sweepUnspent(tripId);
    }

    function test_sweepUnspent_returnsOnlyRemainder() public {
        bytes32 tripId    = keccak256("T1");
        bytes32 bookingId = keccak256("B1");
        _createTrip(tripId);
        _claim(tripId, guestWallet);

        vm.prank(guestWallet);
        escrow.reserveForBooking(tripId, bookingId, 1_310_000_000);
        vm.prank(guestWallet);
        escrow.commitBooking(bookingId, 1_241_000_000, 6_000_000, vendor, bytes32(0), "");
        vm.prank(operator);
        escrow.confirmDuffel(bookingId, keccak256("D"));
        vm.prank(operator);
        escrow.settleBooking(bookingId);

        vm.warp(block.timestamp + EXPIRY_OFFSET + 1);

        uint256 balBefore = usdc.balanceOf(buyer);
        vm.prank(buyer);
        escrow.sweepUnspent(tripId);
        assertEq(usdc.balanceOf(buyer) - balBefore, BUDGET - 1_247_000_000);
    }

    function test_cancelTrip_rejectsWithReservations() public {
        bytes32 tripId = keccak256("T1");
        _createTrip(tripId);
        _claim(tripId, guestWallet);
        vm.prank(guestWallet);
        escrow.reserveForBooking(tripId, keccak256("B1"), 500_000_000);

        vm.prank(buyer);
        vm.expectRevert(IGuestEscrow.ReservationsOutstanding.selector);
        escrow.cancelTrip(tripId);
    }

    // ------------------------------------------------------------------
    // logAgentAction
    // ------------------------------------------------------------------

    function test_logAgentAction_emitsEvent() public {
        bytes32 tripId = keccak256("T1");
        _createTrip(tripId);

        vm.expectEmit(true, true, false, true, address(escrow));
        emit IGuestEscrow.AgentActionLogged(tripId, 12345, 1, 20_000);
        vm.prank(operator);
        escrow.logAgentAction(tripId, 1, 20_000);
    }

    function test_logAgentAction_onlyOperator() public {
        bytes32 tripId = keccak256("T1");
        _createTrip(tripId);
        vm.prank(attacker);
        vm.expectRevert(IGuestEscrow.NotAuthorized.selector);
        escrow.logAgentAction(tripId, 1, 20_000);
    }

    function test_logAgentAction_rejectsOutOfRangeActionType() public {
        bytes32 tripId = keccak256("T1");
        _createTrip(tripId);
        vm.prank(operator);
        vm.expectRevert(IGuestEscrow.InvalidActionType.selector);
        escrow.logAgentAction(tripId, 100, 20_000);  // > ACTION_TYPE_MAX (99)
    }

    function test_logAgentAction_rejectsExcessiveFee() public {
        bytes32 tripId = keccak256("T1");
        _createTrip(tripId);
        vm.prank(operator);
        vm.expectRevert(IGuestEscrow.AgentFeeTooHigh.selector);
        escrow.logAgentAction(tripId, 1, 1_000_001);  // > AGENT_FEE_MAX (1 USDC)
    }

    function test_logAgentAction_acceptsBoundaryValues() public {
        bytes32 tripId = keccak256("T1");
        _createTrip(tripId);
        uint8 maxType = escrow.ACTION_TYPE_MAX();
        uint256 maxFee = escrow.AGENT_FEE_MAX();
        vm.prank(operator);
        escrow.logAgentAction(tripId, maxType, maxFee);
    }

    // ------------------------------------------------------------------
    // Admin
    // ------------------------------------------------------------------

    function test_setOperator() public {
        address newOp = address(0x0CEE);
        vm.prank(owner);
        escrow.setOperator(newOp);
        assertEq(escrow.operator(), newOp);
    }

    function test_setOperator_onlyOwner() public {
        vm.prank(attacker);
        vm.expectRevert();  // OZ v5 Ownable uses OwnableUnauthorizedAccount
        escrow.setOperator(address(0xBEEF));
    }

    function test_pause_blocksCreateTrip() public {
        vm.prank(owner);
        escrow.pause();

        uint64 expiresAt = uint64(block.timestamp + EXPIRY_OFFSET);
        vm.prank(buyer);
        vm.expectRevert();  // Pausable reverts with EnforcedPause
        escrow.createTrip(keccak256("T"), claimPubKey20, BUDGET, expiresAt, bytes32(0), "", 0, bytes32(0));
    }

    // ------------------------------------------------------------------
    // v3.0.0 — commitBookingV2 + three-recipient settle (Sendero markup)
    // ------------------------------------------------------------------
    //
    // The Sendero markup model adds a tenant agency leg between the
    // supplier (vendor) and the operator (Sendero). commitBookingV2
    // persists the agency amount + address in the Booking struct;
    // settleBooking branches on agency presence so legacy bookings
    // (committed via the v1 path) keep their 2-way split exactly as
    // before. These tests cover both paths plus the validation rules.

    address internal agencyTreasury = address(0xA6E47);

    /// @notice Happy path: commitBookingV2 persists agency leg, settle
    ///         fans out to all three recipients in one tx, conservation
    ///         invariant holds (vendor + agency + fee == actualAmount).
    function test_commitBookingV2_threeWaySplit_succeeds() public {
        bytes32 tripId    = keccak256("V2-T1");
        bytes32 bookingId = keccak256("V2-B1");
        _createTrip(tripId);
        _claim(tripId, guestWallet);

        // Reserve at upper bound = 1.310 USDC (any cushion above actual).
        vm.prank(guestWallet);
        escrow.reserveForBooking(tripId, bookingId, 1_310_000_000);

        // 3-way commit: cost 1.000, markup 0.110, fee 0.005 → actual 1.115.
        vm.prank(guestWallet);
        escrow.commitBookingV2(
            bookingId,
            1_000_000_000,   // vendorAmount (supplier cost)
            5_000_000,       // feeAmount (Sendero take)
            110_000_000,     // agencyAmount (tenant markup)
            vendor,
            agencyTreasury,
            keccak256("itinV2"),
            "ipfs://ItinV2"
        );

        // Verify the Booking row carries the agency leg.
        IGuestEscrow.Booking memory b = escrow.bookings(bookingId);
        assertEq(b.actualAmount,  1_115_000_000, "actual = vendor + fee + agency");
        assertEq(b.fee,             5_000_000,   "fee persisted");
        assertEq(b.agencyAmount,   110_000_000,  "agency persisted");
        assertEq(b.agencyAddress,  agencyTreasury, "agency address persisted");

        // Slack release: upperBound 1.310 - actual 1.115 = 0.195 returned.
        assertEq(escrow.available(tripId), BUDGET - 1_115_000_000, "available reflects slack");

        // Settle and assert all three recipients got paid in one tx.
        vm.prank(operator);
        escrow.confirmDuffel(bookingId, keccak256("DUFFEL-V2"));

        uint256 vendorBefore   = usdc.balanceOf(vendor);
        uint256 agencyBefore   = usdc.balanceOf(agencyTreasury);
        uint256 operatorBefore = usdc.balanceOf(operator);

        vm.prank(operator);
        escrow.settleBooking(bookingId);

        assertEq(usdc.balanceOf(vendor)         - vendorBefore,   1_000_000_000, "vendor exact");
        assertEq(usdc.balanceOf(agencyTreasury) - agencyBefore,     110_000_000, "agency exact");
        assertEq(usdc.balanceOf(operator)       - operatorBefore,     5_000_000, "operator exact");
    }

    /// @notice Reverts when vendor + fee + agency > the upper bound.
    function test_commitBookingV2_sumExceedsUpperBound_reverts() public {
        bytes32 tripId    = keccak256("V2-T2");
        bytes32 bookingId = keccak256("V2-B2");
        _createTrip(tripId);
        _claim(tripId, guestWallet);

        vm.prank(guestWallet);
        escrow.reserveForBooking(tripId, bookingId, 1_000_000_000);  // upper bound 1.000

        vm.prank(guestWallet);
        vm.expectRevert(IGuestEscrow.AmountExceedsUpperBound.selector);
        escrow.commitBookingV2(
            bookingId,
            900_000_000,   // vendor
            50_000_000,    // fee
            100_000_000,   // agency — sum 1.050 > 1.000 upperBound
            vendor,
            agencyTreasury,
            bytes32(0),
            ""
        );
    }

    /// @notice Zero-agency commit via V2 falls back to legacy 2-way settle
    ///         behavior — the V2 path is a strict superset of V1 semantics.
    function test_commitBookingV2_zeroAgency_fallsBackToV1Behavior() public {
        bytes32 tripId    = keccak256("V2-T3");
        bytes32 bookingId = keccak256("V2-B3");
        _createTrip(tripId);
        _claim(tripId, guestWallet);

        vm.prank(guestWallet);
        escrow.reserveForBooking(tripId, bookingId, 1_310_000_000);

        vm.prank(guestWallet);
        escrow.commitBookingV2(
            bookingId,
            1_241_000_000,   // vendor
            6_000_000,       // fee
            0,               // agencyAmount = 0 → legacy behavior
            vendor,
            address(0),      // agencyAddress can be zero when agencyAmount = 0
            bytes32(0),
            ""
        );

        // Settle should NOT touch the agency address (it's zero).
        vm.prank(operator);
        escrow.confirmDuffel(bookingId, keccak256("D-V2-3"));

        uint256 vendorBefore   = usdc.balanceOf(vendor);
        uint256 operatorBefore = usdc.balanceOf(operator);

        vm.prank(operator);
        escrow.settleBooking(bookingId);

        // Identical to legacy 2-way split.
        assertEq(usdc.balanceOf(vendor)   - vendorBefore,   1_241_000_000, "vendor");
        assertEq(usdc.balanceOf(operator) - operatorBefore,     6_000_000, "operator");
    }

    /// @notice Defense-in-depth: `agencyAmount > 0 && agencyAddress == 0`
    ///         must revert at commit time so settle can never accidentally
    ///         burn USDC to address(0). Pairs with the same defensive
    ///         check inside settleBooking.
    function test_commitBookingV2_zeroAddressWithAgency_reverts() public {
        bytes32 tripId    = keccak256("V2-T4");
        bytes32 bookingId = keccak256("V2-B4");
        _createTrip(tripId);
        _claim(tripId, guestWallet);

        vm.prank(guestWallet);
        escrow.reserveForBooking(tripId, bookingId, 1_310_000_000);

        vm.prank(guestWallet);
        vm.expectRevert(IGuestEscrow.ZeroAddress.selector);
        escrow.commitBookingV2(
            bookingId,
            1_000_000_000,
            5_000_000,
            110_000_000,     // agencyAmount > 0
            vendor,
            address(0),      // BUT agencyAddress = 0 → must revert
            bytes32(0),
            ""
        );
    }

    /// @notice settleBooking emits BookingSettledV2 (NOT BookingSettled)
    ///         when the booking has a non-zero agency leg. Off-chain
    ///         indexers subscribe to both events during the v2/v3
    ///         transition window; the right event must fire on each path.
    function test_settleBookingV2_emitsV2Event() public {
        bytes32 tripId    = keccak256("V2-T5");
        bytes32 bookingId = keccak256("V2-B5");
        _createTrip(tripId);
        _claim(tripId, guestWallet);

        vm.prank(guestWallet);
        escrow.reserveForBooking(tripId, bookingId, 1_310_000_000);
        vm.prank(guestWallet);
        escrow.commitBookingV2(
            bookingId, 1_000_000_000, 5_000_000, 110_000_000,
            vendor, agencyTreasury, bytes32(0), ""
        );
        vm.prank(operator);
        escrow.confirmDuffel(bookingId, keccak256("D-V2-5"));

        vm.expectEmit(true, false, false, true, address(escrow));
        emit IGuestEscrow.BookingSettledV2(
            bookingId, vendor, 1_000_000_000, agencyTreasury, 110_000_000, 5_000_000
        );
        vm.prank(operator);
        escrow.settleBooking(bookingId);
    }

    /// @notice Legacy bookings (committed via v1 commitBooking) emit the
    ///         original BookingSettled event on settle, NOT V2. Backward-
    ///         compatible indexers must keep working after the upgrade.
    function test_settleBooking_legacyBooking_emitsV1Event() public {
        bytes32 tripId    = keccak256("V2-T6");
        bytes32 bookingId = keccak256("V2-B6");
        _createTrip(tripId);
        _claim(tripId, guestWallet);

        vm.prank(guestWallet);
        escrow.reserveForBooking(tripId, bookingId, 1_310_000_000);
        // V1 commit path — no agency leg
        vm.prank(guestWallet);
        escrow.commitBooking(bookingId, 1_241_000_000, 6_000_000, vendor, bytes32(0), "");
        vm.prank(operator);
        escrow.confirmDuffel(bookingId, keccak256("D-V2-6"));

        vm.expectEmit(true, false, false, true, address(escrow));
        emit IGuestEscrow.BookingSettled(bookingId, vendor, 1_241_000_000, 6_000_000);
        vm.prank(operator);
        escrow.settleBooking(bookingId);
    }

    /// @notice Storage append-safety: a booking committed via the legacy
    ///         v1 path reads the new v3.0.0 agency fields as zero and the
    ///         existing v1 fields as written. Proves the struct extension
    ///         did not corrupt or shift any pre-existing slot.
    function test_storage_append_legacyBookingHasZeroAgencyFields() public {
        bytes32 tripId    = keccak256("V2-T7");
        bytes32 bookingId = keccak256("V2-B7");
        _createTrip(tripId);
        _claim(tripId, guestWallet);

        vm.prank(guestWallet);
        escrow.reserveForBooking(tripId, bookingId, 1_310_000_000);
        vm.prank(guestWallet);
        escrow.commitBooking(
            bookingId,
            1_241_000_000,
            6_000_000,
            vendor,
            keccak256("legacyItin"),
            "ipfs://Legacy"
        );

        IGuestEscrow.Booking memory b = escrow.bookings(bookingId);

        // Legacy v1 fields still readable + correct after the v3 deploy.
        assertEq(b.tripId,        tripId,                  "tripId preserved");
        assertEq(b.actualAmount,  1_247_000_000,           "actualAmount preserved");
        assertEq(b.fee,             6_000_000,             "fee preserved");
        assertEq(b.vendor,        vendor,                  "vendor preserved");
        assertEq(b.itineraryHash, keccak256("legacyItin"), "itineraryHash preserved");
        assertEq(b.itineraryCID,  "ipfs://Legacy",         "itineraryCID preserved");
        assertEq(b.status,        1,                       "status (COMMITTED) preserved");

        // v3.0.0 additions read as zero on bookings written via v1 commit.
        assertEq(b.agencyAmount,  0,           "agencyAmount zero on legacy commit");
        assertEq(b.agencyAddress, address(0),  "agencyAddress zero on legacy commit");
    }

    /// @notice commitBookingV2 is guest-only (same auth model as v1
    ///         commitBooking). A compromised operator must not be able
    ///         to inject an arbitrary agency address.
    function test_commitBookingV2_rejectsOperator() public {
        bytes32 tripId    = keccak256("V2-T8");
        bytes32 bookingId = keccak256("V2-B8");
        _createTrip(tripId);
        _claim(tripId, guestWallet);

        vm.prank(operator);
        escrow.reserveForBooking(tripId, bookingId, 1_310_000_000);

        vm.prank(operator);
        vm.expectRevert(IGuestEscrow.NotAuthorized.selector);
        escrow.commitBookingV2(
            bookingId,
            1_000_000_000,
            5_000_000,
            110_000_000,
            vendor,
            agencyTreasury,
            bytes32(0),
            ""
        );
    }

    /// @notice version() string bumped to 3.0.0 — sanity check so an
    ///         off-chain consumer can detect the upgrade landed.
    function test_version_isV3() public view {
        assertEq(escrow.version(), "3.0.0");
    }

    // ------------------------------------------------------------------
    // v3.0.0 — OTP brute-force protection (lockout + rotation)
    // ------------------------------------------------------------------
    //
    // The Peanut-style claim flow is two-factor: link (privkey in URL
    // fragment) + OTP (preimage delivered out-of-band). Without an
    // on-chain rate limit, an attacker holding a leaked link could brute
    // the OTP cheaply on Arc. v3.0.0 adds:
    //   - 3-strikes-and-lockout for 15 minutes (MAX_CLAIM_ATTEMPTS / CLAIM_LOCKOUT_DURATION)
    //   - operator-only setClaimCodeHash for resend rotation
    //   - new events the off-chain alert pipeline subscribes to:
    //       ClaimAttemptFailed, ClaimLockoutTriggered, ClaimCodeRotated
    //
    // The lockout's primary defense is brute-force economics; its
    // secondary value is the alert event that lets the off-chain
    // pipeline notify the buyer to cancel + sweep the funds.
    //
    // NB: a locked trip has reserved == 0 by definition (no claim → no
    // reservation), so the existing cancelTrip + sweepUnspent flow is
    // already the buyer's fast-path. No new contract function needed.

    bytes internal constant CORRECT_PREIMAGE = bytes("good-otp-preimage");
    bytes internal constant WRONG_PREIMAGE   = bytes("wrong-otp-preimage");

    function _createOtpTrip(bytes32 tripId) internal {
        bytes32 codeHash = keccak256(CORRECT_PREIMAGE);
        _createTripWithCode(tripId, codeHash);
    }

    function _attemptClaimWithCode(bytes32 tripId, address wallet, bytes memory preimage) internal {
        bytes memory sig = _signClaim(tripId, wallet);
        escrow.claimTrip(tripId, wallet, sig, preimage);
    }

    /// @notice First wrong attempt increments counter to 1, emits
    ///         ClaimAttemptFailed, does NOT lock out, does NOT claim.
    ///         v3.0.0 semantics: wrong-code calls do NOT revert (revert
    ///         would undo the counter persistence). Caller distinguishes
    ///         success from failure via receipt events.
    function test_claimTrip_failedAttemptIncrementsCounter() public {
        bytes32 tripId = keccak256("OTP-T1");
        _createOtpTrip(tripId);

        vm.expectEmit(true, false, false, true, address(escrow));
        emit IGuestEscrow.ClaimAttemptFailed(tripId, 1);
        _attemptClaimWithCode(tripId, guestWallet, WRONG_PREIMAGE);

        assertEq(escrow.trips(tripId).guestWallet, address(0), "trip stays unclaimed");
    }

    /// @notice Two consecutive failures emit ClaimAttemptFailed at 1 then 2.
    function test_claimTrip_twoFailsDoNotLockYet() public {
        bytes32 tripId = keccak256("OTP-T2");
        _createOtpTrip(tripId);

        vm.expectEmit(true, false, false, true, address(escrow));
        emit IGuestEscrow.ClaimAttemptFailed(tripId, 1);
        _attemptClaimWithCode(tripId, guestWallet, WRONG_PREIMAGE);

        vm.expectEmit(true, false, false, true, address(escrow));
        emit IGuestEscrow.ClaimAttemptFailed(tripId, 2);
        _attemptClaimWithCode(tripId, guestWallet, WRONG_PREIMAGE);

        // Trip still unclaimed, no lockout active (verified by next
        // attempt with correct code succeeding — see lockoutExpires
        // test for the symmetric case).
        assertEq(escrow.trips(tripId).guestWallet, address(0));
    }

    /// @notice Third failure triggers lockout: counter resets, lockout
    ///         set, ClaimLockoutTriggered emitted (NOT ClaimAttemptFailed).
    function test_claimTrip_threeFailuresTriggersLockout() public {
        bytes32 tripId = keccak256("OTP-T3");
        _createOtpTrip(tripId);

        _attemptClaimWithCode(tripId, guestWallet, WRONG_PREIMAGE);  // 1
        _attemptClaimWithCode(tripId, guestWallet, WRONG_PREIMAGE);  // 2

        uint64 expectedLockedUntil = uint64(block.timestamp) + escrow.CLAIM_LOCKOUT_DURATION();
        vm.expectEmit(true, false, false, true, address(escrow));
        emit IGuestEscrow.ClaimLockoutTriggered(tripId, expectedLockedUntil);
        _attemptClaimWithCode(tripId, guestWallet, WRONG_PREIMAGE);  // 3 → lockout

        assertEq(escrow.trips(tripId).guestWallet, address(0));
    }

    /// @notice The CRITICAL invariant: once locked, even the CORRECT
    ///         code is rejected. Prevents an attacker who finally
    ///         guesses right from claiming inside the cooldown window.
    ///         The lockout precondition IS a revert because the call
    ///         hasn't tried yet — no per-attempt state to persist.
    function test_claimTrip_lockedTripRejectsCorrectCode() public {
        bytes32 tripId = keccak256("OTP-T4");
        _createOtpTrip(tripId);

        for (uint256 i; i < 3; ++i) {
            _attemptClaimWithCode(tripId, guestWallet, WRONG_PREIMAGE);
        }

        // Now locked. Pre-compute the signature so vm.expectRevert
        // targets the claimTrip call, not the SENDERO_SALT() view.
        bytes memory sig = _signClaim(tripId, guestWallet);
        vm.expectRevert(IGuestEscrow.ClaimLocked.selector);
        escrow.claimTrip(tripId, guestWallet, sig, CORRECT_PREIMAGE);
    }

    /// @notice Lockout expires at `claimLockoutUntil`. After cooldown
    ///         the legitimate guest claims with the correct code.
    function test_claimTrip_lockoutExpiresAndCorrectCodeWorks() public {
        bytes32 tripId = keccak256("OTP-T5");
        _createOtpTrip(tripId);

        for (uint256 i; i < 3; ++i) {
            _attemptClaimWithCode(tripId, guestWallet, WRONG_PREIMAGE);
        }

        vm.warp(block.timestamp + escrow.CLAIM_LOCKOUT_DURATION() + 1);

        _attemptClaimWithCode(tripId, guestWallet, CORRECT_PREIMAGE);
        assertEq(escrow.trips(tripId).guestWallet, guestWallet);
    }

    /// @notice A successful claim resets the failed-attempt counter.
    ///         The behavioral proof: the claim succeeds even after
    ///         prior failures, and the trip is now claimed. (We can't
    ///         directly observe the storage counter without a getter,
    ///         but we'd see a non-zero counter via the next call's
    ///         emit if it weren't reset — and the next call would be
    ///         AlreadyClaimed anyway.)
    function test_claimTrip_successfulClaimAfterFailsClaims() public {
        bytes32 tripId = keccak256("OTP-T6");
        _createOtpTrip(tripId);

        for (uint256 i; i < 2; ++i) {
            _attemptClaimWithCode(tripId, guestWallet, WRONG_PREIMAGE);
        }

        _attemptClaimWithCode(tripId, guestWallet, CORRECT_PREIMAGE);
        assertEq(escrow.trips(tripId).guestWallet, guestWallet);
    }

    /// @notice Operator can rotate the claim code (resend flow).
    ///         Counter resets, ClaimCodeRotated emitted, new code works.
    function test_setClaimCodeHash_rotatesAndAcceptsNewCode() public {
        bytes32 tripId = keccak256("OTP-T7");
        _createOtpTrip(tripId);

        // Two failed attempts
        for (uint256 i; i < 2; ++i) {
            _attemptClaimWithCode(tripId, guestWallet, WRONG_PREIMAGE);
        }

        bytes memory newPreimage = bytes("rotated-otp-preimage");
        bytes32 oldHash = keccak256(CORRECT_PREIMAGE);
        bytes32 newHash = keccak256(newPreimage);

        vm.expectEmit(true, false, false, true, address(escrow));
        emit IGuestEscrow.ClaimCodeRotated(tripId, oldHash, newHash);
        vm.prank(operator);
        escrow.setClaimCodeHash(tripId, newHash);

        // Old code now rejected — emits ClaimAttemptFailed at count 1
        // because the rotation reset the counter.
        vm.expectEmit(true, false, false, true, address(escrow));
        emit IGuestEscrow.ClaimAttemptFailed(tripId, 1);
        _attemptClaimWithCode(tripId, guestWallet, CORRECT_PREIMAGE);

        // New code accepted.
        _attemptClaimWithCode(tripId, guestWallet, newPreimage);
        assertEq(escrow.trips(tripId).guestWallet, guestWallet);
    }

    /// @notice Lockout SURVIVES a rotation by design — rotation refreshes
    ///         the OTP for the legitimate guest but does not unlock the
    ///         brute-force cooldown. Otherwise an attacker who triggered
    ///         a lockout could phish a resend and immediately retry.
    function test_setClaimCodeHash_doesNotClearLockout() public {
        bytes32 tripId = keccak256("OTP-T8");
        _createOtpTrip(tripId);

        // Trigger lockout
        for (uint256 i; i < 3; ++i) {
            _attemptClaimWithCode(tripId, guestWallet, WRONG_PREIMAGE);
        }

        // Operator rotates mid-lockout
        bytes memory newPreimage = bytes("rotated-otp-preimage");
        bytes32 newHash = keccak256(newPreimage);
        vm.prank(operator);
        escrow.setClaimCodeHash(tripId, newHash);

        // Lockout still active — even with rotated correct code, ClaimLocked revert.
        // Pre-compute sig so vm.expectRevert targets the claimTrip call.
        bytes memory sig = _signClaim(tripId, guestWallet);
        vm.expectRevert(IGuestEscrow.ClaimLocked.selector);
        escrow.claimTrip(tripId, guestWallet, sig, newPreimage);

        // After cooldown, the new code claims.
        vm.warp(block.timestamp + escrow.CLAIM_LOCKOUT_DURATION() + 1);
        _attemptClaimWithCode(tripId, guestWallet, newPreimage);
        assertEq(escrow.trips(tripId).guestWallet, guestWallet);
    }

    /// @notice Rotating to bytes32(0) would silently disable 2FA —
    ///         must revert. ZeroValue (not ZeroAddress, since codeHash
    ///         is a hash, not an address).
    function test_setClaimCodeHash_rejectsZero() public {
        bytes32 tripId = keccak256("OTP-T9");
        _createOtpTrip(tripId);

        vm.prank(operator);
        vm.expectRevert(IGuestEscrow.ZeroValue.selector);
        escrow.setClaimCodeHash(tripId, bytes32(0));
    }

    /// @notice Cannot rotate after the guest has already claimed —
    ///         post-claim there's no OTP flow to refresh.
    function test_setClaimCodeHash_rejectsAlreadyClaimed() public {
        bytes32 tripId = keccak256("OTP-T10");
        _createOtpTrip(tripId);

        _attemptClaimWithCode(tripId, guestWallet, CORRECT_PREIMAGE);

        vm.prank(operator);
        vm.expectRevert(IGuestEscrow.AlreadyClaimed.selector);
        escrow.setClaimCodeHash(tripId, keccak256("anything"));
    }

    /// @notice Cannot rotate a cancelled trip — terminal state.
    function test_setClaimCodeHash_rejectsCancelled() public {
        bytes32 tripId = keccak256("OTP-T11");
        _createOtpTrip(tripId);

        vm.prank(buyer);
        escrow.cancelTrip(tripId);

        vm.prank(operator);
        vm.expectRevert(IGuestEscrow.TripIsCancelled.selector);
        escrow.setClaimCodeHash(tripId, keccak256("anything"));
    }

    /// @notice Cannot rotate after expiry — claim window is closed.
    function test_setClaimCodeHash_rejectsExpired() public {
        bytes32 tripId = keccak256("OTP-T12");
        _createOtpTrip(tripId);

        vm.warp(block.timestamp + EXPIRY_OFFSET + 1);

        vm.prank(operator);
        vm.expectRevert(IGuestEscrow.TripExpired.selector);
        escrow.setClaimCodeHash(tripId, keccak256("anything"));
    }

    /// @notice Only operator can rotate — buyer, guest, attacker rejected.
    function test_setClaimCodeHash_onlyOperator() public {
        bytes32 tripId = keccak256("OTP-T13");
        _createOtpTrip(tripId);

        bytes32 newHash = keccak256("rotated");

        vm.prank(buyer);
        vm.expectRevert(IGuestEscrow.NotAuthorized.selector);
        escrow.setClaimCodeHash(tripId, newHash);

        vm.prank(guestWallet);
        vm.expectRevert(IGuestEscrow.NotAuthorized.selector);
        escrow.setClaimCodeHash(tripId, newHash);

        vm.prank(attacker);
        vm.expectRevert(IGuestEscrow.NotAuthorized.selector);
        escrow.setClaimCodeHash(tripId, newHash);
    }

    /// @notice setClaimCodeHash on an unknown trip reverts TripNotFound.
    function test_setClaimCodeHash_rejectsUnknownTrip() public {
        vm.prank(operator);
        vm.expectRevert(IGuestEscrow.TripNotFound.selector);
        escrow.setClaimCodeHash(keccak256("never-existed"), keccak256("h"));
    }

    /// @notice Storage append-safety for the lockout state: a trip
    ///         that never had a failed attempt (the common case)
    ///         claims successfully without any lockout-related revert.
    ///         Proves the new mappings default to zero on legacy trips.
    function test_storage_append_legacyTripsHaveZeroLockoutState() public {
        bytes32 tripId = keccak256("OTP-T14");
        _createTrip(tripId);  // No claim code → claimCodeHash == 0

        // Claim succeeds with empty preimage on a no-OTP trip — the
        // lockout check ran first and saw zero, then the claimCodeHash
        // == 0 branch skipped the OTP check entirely. Successful claim.
        _claim(tripId, guestWallet);
        assertEq(escrow.trips(tripId).guestWallet, guestWallet);
    }

    /// @notice The lockout-then-cancel-then-sweep flow that the
    ///         off-chain alert pipeline points the buyer toward.
    ///         Validates the on-chain story for the user's "send a
    ///         notification to the creator to claim back the funds"
    ///         requirement: locked trip → buyer cancels → buyer
    ///         sweeps → full budget back in buyer's wallet.
    function test_lockoutTriggeredTrip_buyerCanCancelAndSweep() public {
        bytes32 tripId = keccak256("OTP-T15");
        _createOtpTrip(tripId);

        // Trigger lockout (simulates the brute-force attack — wrong-code
        // calls return without reverting per v3.0.0 semantics).
        for (uint256 i; i < 3; ++i) {
            _attemptClaimWithCode(tripId, guestWallet, WRONG_PREIMAGE);
        }

        // Off-chain alert pipeline now fires (out of test scope).
        // The buyer's UI surface offers "cancel + reclaim funds."

        // Step 1: buyer cancels the trip. A locked-but-unclaimed trip
        // has reserved == 0 by definition, so cancelTrip succeeds
        // without any new on-chain function.
        vm.prank(buyer);
        escrow.cancelTrip(tripId);
        assertTrue(escrow.trips(tripId).cancelled, "cancellation flag set");

        // Step 2: buyer sweeps the unspent budget. Full BUDGET back.
        uint256 buyerBalBefore = usdc.balanceOf(buyer);
        vm.prank(buyer);
        escrow.sweepUnspent(tripId);
        assertEq(usdc.balanceOf(buyer) - buyerBalBefore, BUDGET, "full budget reclaimed");
    }
}
