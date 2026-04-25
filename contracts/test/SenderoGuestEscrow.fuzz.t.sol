// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {SenderoGuestEscrow} from "../src/SenderoGuestEscrow.sol";
import {IGuestEscrow} from "../src/interfaces/IGuestEscrow.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract FuzzMockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/// @notice Property-based tests for the amount math in SenderoGuestEscrow.
///         Focus: slack release, settlement conservation, reclaim
///         invariants. These catch off-by-one and edge cases around
///         price drift that unit tests miss.
contract SenderoGuestEscrowFuzzTest is Test {
    using MessageHashUtils for bytes32;

    SenderoGuestEscrow internal escrow;
    FuzzMockUSDC internal usdc;

    address internal owner    = address(0xA11CE);
    address internal operator = address(0x0FE7);
    address internal buyer    = address(0xB10B);
    address internal vendor   = address(0xBEEF);
    address internal guest    = address(0xCAFE);

    uint256 internal claimPrivKey = 0xA11CECAFE;
    address internal claimPubKey20;

    // Practical bounds to keep fuzz tractable and realistic.
    // USDC has 6 decimals. Max budget: $10M (10^13 units). Min: $0.01.
    uint256 internal constant MIN_BUDGET = 10_000;              // $0.01
    uint256 internal constant MAX_BUDGET = 10_000_000_000_000;  // $10M
    uint64  internal constant MAX_EXPIRY = 365 days;

    function setUp() public {
        claimPubKey20 = vm.addr(claimPrivKey);
        usdc = new FuzzMockUSDC();

        vm.startPrank(owner);
        SenderoGuestEscrow impl = new SenderoGuestEscrow();
        bytes memory initData = abi.encodeCall(
            SenderoGuestEscrow.initialize,
            (address(usdc), operator, owner)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        escrow = SenderoGuestEscrow(address(proxy));
        vm.stopPrank();

        usdc.mint(buyer, MAX_BUDGET * 1000);
        vm.prank(buyer);
        usdc.approve(address(escrow), type(uint256).max);
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    function _createTrip(bytes32 tripId, uint256 budget, uint64 expiry) internal {
        vm.prank(buyer);
        escrow.createTrip(
            tripId,
            claimPubKey20,
            budget,
            uint64(block.timestamp) + expiry,
            keccak256("meta"),
            "ipfs://Qm",
            1,
            bytes32(0)           // no OTP for fuzz
        );
    }

    function _signClaim(bytes32 tripId, address wallet) internal view returns (bytes memory) {
        bytes32 hash = keccak256(abi.encodePacked(
            escrow.SENDERO_SALT(), block.chainid, address(escrow), tripId, wallet
        )).toEthSignedMessageHash();
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(claimPrivKey, hash);
        return abi.encodePacked(r, s, v);
    }

    function _claim(bytes32 tripId, address wallet) internal {
        bytes memory sig = _signClaim(tripId, wallet);
        escrow.claimTrip(tripId, wallet, sig, "");
    }

    function _tripSummary(bytes32 tripId)
        internal view
        returns (uint256 budget, uint256 reserved, uint256 spent)
    {
        IGuestEscrow.Trip memory _tt = escrow.trips(tripId); budget = _tt.budget; reserved = _tt.reserved; spent = _tt.spent;
    }

    // ------------------------------------------------------------------
    // Invariant: slack release is exact
    // ------------------------------------------------------------------

    /// @notice For any reserve/commit pair within budget, the amount of
    ///         USDC released back from `reserved` equals (upperBound - actual).
    function testFuzz_slackRelease_isExact(
        uint256 budget,
        uint256 upperBound,
        uint256 actual
    ) public {
        budget     = bound(budget, MIN_BUDGET, MAX_BUDGET);
        upperBound = bound(upperBound, MIN_BUDGET, budget);
        actual     = bound(actual, 1, upperBound);

        bytes32 tripId = keccak256(abi.encode("fuzz-slack", budget, upperBound, actual));
        bytes32 bookingId = keccak256(abi.encode("b", tripId));

        _createTrip(tripId, budget, 30 days);
        _claim(tripId, guest);

        vm.prank(guest);
        escrow.reserveForBooking(tripId, bookingId, upperBound);

        (, uint256 reservedAfter, ) = _tripSummary(tripId);
        assertEq(reservedAfter, upperBound, "reserved after reserve");

        // Split actual into vendor + fee with fee = actual/10 (10% fee)
        uint256 fee = actual / 10;
        uint256 vendorAmt = actual - fee;

        vm.prank(guest);
        escrow.commitBooking(bookingId, vendorAmt, fee, vendor, keccak256("itin"), "");

        (, uint256 reservedFinal, ) = _tripSummary(tripId);

        // Invariant: reserved decreased exactly by the slack
        uint256 expectedSlack = upperBound - actual;
        assertEq(reservedAfter - reservedFinal, expectedSlack, "slack release exact");
        assertEq(reservedFinal, actual, "reserved equals actual after commit");
    }

    /// @notice Committing exactly at upperBound releases zero slack.
    function testFuzz_commitAtUpperBound_releasesZeroSlack(
        uint256 budget,
        uint256 upperBound
    ) public {
        budget     = bound(budget, MIN_BUDGET, MAX_BUDGET);
        upperBound = bound(upperBound, MIN_BUDGET, budget);

        bytes32 tripId = keccak256(abi.encode("fuzz-noslack", budget, upperBound));
        bytes32 bookingId = keccak256(abi.encode("b", tripId));

        _createTrip(tripId, budget, 30 days);
        _claim(tripId, guest);

        vm.prank(guest);
        escrow.reserveForBooking(tripId, bookingId, upperBound);

        vm.prank(guest);
        escrow.commitBooking(bookingId, upperBound, 0, vendor, bytes32(0), "");

        (, uint256 reserved, ) = _tripSummary(tripId);
        assertEq(reserved, upperBound, "no slack released when committing at bound");
    }

    // ------------------------------------------------------------------
    // Invariant: settlement conservation
    // ------------------------------------------------------------------

    /// @notice For any settled booking, sum of transfers out equals the
    ///         booking's actual amount. Nothing minted, nothing burned.
    function testFuzz_settlement_conserves(
        uint256 budget,
        uint256 upperBound,
        uint256 actualAmount,
        uint256 feeBps
    ) public {
        budget       = bound(budget, MIN_BUDGET * 10, MAX_BUDGET);
        upperBound   = bound(upperBound, MIN_BUDGET, budget);
        actualAmount = bound(actualAmount, 1, upperBound);
        feeBps       = bound(feeBps, 0, 10_000);  // 0-100%

        bytes32 tripId    = keccak256(abi.encode("fuzz-settle", budget, actualAmount));
        bytes32 bookingId = keccak256(abi.encode("b", tripId));

        _createTrip(tripId, budget, 30 days);
        _claim(tripId, guest);

        vm.prank(guest);
        escrow.reserveForBooking(tripId, bookingId, upperBound);

        uint256 fee = (actualAmount * feeBps) / 10_000;
        // Guard against pathological splits
        if (fee >= actualAmount) fee = actualAmount - 1;
        uint256 vendorAmt = actualAmount - fee;

        vm.prank(guest);
        escrow.commitBooking(bookingId, vendorAmt, fee, vendor, bytes32(0), "");

        vm.prank(operator);
        escrow.confirmDuffel(bookingId, keccak256("duffel"));

        uint256 escrowBefore   = usdc.balanceOf(address(escrow));
        uint256 vendorBefore   = usdc.balanceOf(vendor);
        uint256 operatorBefore = usdc.balanceOf(operator);

        vm.prank(operator);
        escrow.settleBooking(bookingId);

        uint256 escrowDelta   = escrowBefore   - usdc.balanceOf(address(escrow));
        uint256 vendorDelta   = usdc.balanceOf(vendor)   - vendorBefore;
        uint256 operatorDelta = usdc.balanceOf(operator) - operatorBefore;

        assertEq(vendorDelta, vendorAmt, "vendor received exact");
        assertEq(operatorDelta, fee, "operator received exact fee");
        assertEq(vendorDelta + operatorDelta, actualAmount, "sum equals actual");
        assertEq(escrowDelta, actualAmount, "escrow decreased by exactly actual");

        // Trip spent increased by actual, reserved went to zero
        (uint256 tripBudget, uint256 tripReserved, uint256 tripSpent) = _tripSummary(tripId);
        assertEq(tripBudget, budget, "budget unchanged");
        assertEq(tripReserved, 0, "reserved back to zero");
        assertEq(tripSpent, actualAmount, "spent equals actual");
    }

    // ------------------------------------------------------------------
    // Invariant: multi-booking accounting
    // ------------------------------------------------------------------

    /// @notice Sum of reserved + spent never exceeds budget across any
    ///         sequence of reservations within budget.
    function testFuzz_multiBooking_neverOverspends(
        uint256 budget,
        uint256 a1,
        uint256 a2,
        uint256 a3
    ) public {
        budget = bound(budget, MIN_BUDGET * 100, MAX_BUDGET);
        a1 = bound(a1, 1, budget / 3);
        a2 = bound(a2, 1, budget / 3);
        a3 = bound(a3, 1, budget / 3);

        bytes32 tripId = keccak256(abi.encode("fuzz-multi", budget, a1, a2, a3));
        _createTrip(tripId, budget, 30 days);
        _claim(tripId, guest);

        vm.startPrank(guest);
        escrow.reserveForBooking(tripId, keccak256("b1"), a1);
        escrow.reserveForBooking(tripId, keccak256("b2"), a2);
        escrow.reserveForBooking(tripId, keccak256("b3"), a3);
        vm.stopPrank();

        (uint256 b, uint256 r, uint256 s) = _tripSummary(tripId);
        assertEq(r + s, a1 + a2 + a3, "reserved sum matches inputs");
        assertLe(r + s, b, "reserved + spent never exceeds budget");
    }

    // ------------------------------------------------------------------
    // Invariant: reclaim restores exact amount
    // ------------------------------------------------------------------

    function testFuzz_reclaim_restoresExact(uint256 budget, uint256 reserveAmt) public {
        budget     = bound(budget, MIN_BUDGET, MAX_BUDGET);
        reserveAmt = bound(reserveAmt, 1, budget);

        bytes32 tripId    = keccak256(abi.encode("fuzz-reclaim", budget, reserveAmt));
        bytes32 bookingId = keccak256(abi.encode("b", tripId));

        _createTrip(tripId, budget, 30 days);
        _claim(tripId, guest);

        vm.prank(guest);
        escrow.reserveForBooking(tripId, bookingId, reserveAmt);

        vm.warp(block.timestamp + escrow.RESERVE_TIMEOUT() + 1);
        vm.prank(buyer);
        escrow.reclaimStuckBooking(bookingId);

        assertEq(escrow.available(tripId), budget, "available restored to full budget");
        (, uint256 reserved, uint256 spent) = _tripSummary(tripId);
        assertEq(reserved, 0, "reserved zeroed");
        assertEq(spent, 0, "spent untouched");
    }

    // ------------------------------------------------------------------
    // Invariant: sweep returns exactly the unused remainder
    // ------------------------------------------------------------------

    function testFuzz_sweep_returnsExactRemainder(
        uint256 budget,
        uint256 consumedAmount
    ) public {
        budget         = bound(budget, MIN_BUDGET * 10, MAX_BUDGET);
        consumedAmount = bound(consumedAmount, 1, budget - 1);

        bytes32 tripId    = keccak256(abi.encode("fuzz-sweep", budget, consumedAmount));
        bytes32 bookingId = keccak256(abi.encode("b", tripId));

        _createTrip(tripId, budget, 30 days);
        _claim(tripId, guest);

        vm.prank(guest);
        escrow.reserveForBooking(tripId, bookingId, consumedAmount);
        vm.prank(guest);
        escrow.commitBooking(bookingId, consumedAmount, 0, vendor, bytes32(0), "");
        vm.prank(operator);
        escrow.confirmDuffel(bookingId, keccak256("d"));
        vm.prank(operator);
        escrow.settleBooking(bookingId);

        // Trip expires
        vm.warp(block.timestamp + 30 days + 1);

        uint256 before = usdc.balanceOf(buyer);
        vm.prank(buyer);
        escrow.sweepUnspent(tripId);
        uint256 after_ = usdc.balanceOf(buyer);

        assertEq(after_ - before, budget - consumedAmount, "sweep returns exact remainder");
    }

    // ------------------------------------------------------------------
    // Invariant: batch create sums correctly
    // ------------------------------------------------------------------

    function testFuzz_batchCreate_sumsExact(uint8 n, uint256 seed) public {
        n = uint8(bound(uint256(n), 1, 20));
        IGuestEscrow.TripInput[] memory inputs = new IGuestEscrow.TripInput[](n);

        uint256 total;
        for (uint256 i; i < n; ++i) {
            uint256 b = bound(uint256(keccak256(abi.encode(seed, i))), MIN_BUDGET, MAX_BUDGET / 100);
            total += b;
            inputs[i] = IGuestEscrow.TripInput({
                tripId: keccak256(abi.encode("fuzz-batch", seed, i)),
                claimPubKey20: claimPubKey20,
                budget: b,
                expiresAt: uint64(block.timestamp + 30 days),
                metadataHash: bytes32(0),
                metadataCID: "",
                agentTokenId: 1,
                claimCodeHash: bytes32(0)
            });
        }

        uint256 escrowBefore = usdc.balanceOf(address(escrow));
        vm.prank(buyer);
        escrow.batchCreateTrip(inputs);
        uint256 escrowAfter = usdc.balanceOf(address(escrow));

        assertEq(escrowAfter - escrowBefore, total, "escrow received exact sum");
    }

    // ------------------------------------------------------------------
    // Invariant: no-op on zero-budget operations reverts cleanly
    // ------------------------------------------------------------------

    function testFuzz_reserve_rejectsZero(uint256 budget) public {
        budget = bound(budget, MIN_BUDGET, MAX_BUDGET);
        bytes32 tripId = keccak256(abi.encode("fuzz-zero", budget));
        _createTrip(tripId, budget, 30 days);
        _claim(tripId, guest);

        vm.prank(guest);
        vm.expectRevert(IGuestEscrow.ZeroValue.selector);
        escrow.reserveForBooking(tripId, keccak256("b"), 0);
    }

    function testFuzz_reserve_rejectsOverBudget(uint256 budget, uint256 excess) public {
        budget = bound(budget, MIN_BUDGET, MAX_BUDGET / 2);
        excess = bound(excess, 1, MAX_BUDGET / 2);

        bytes32 tripId = keccak256(abi.encode("fuzz-over", budget, excess));
        _createTrip(tripId, budget, 30 days);
        _claim(tripId, guest);

        vm.prank(guest);
        vm.expectRevert(IGuestEscrow.InsufficientBudget.selector);
        escrow.reserveForBooking(tripId, keccak256("b"), budget + excess);
    }

    // ------------------------------------------------------------------
    // v3.0.0 — three-way conservation invariant
    // ------------------------------------------------------------------

    address internal agency = address(0xA6E47);

    /// @notice Conservation under arbitrary 3-way splits: for any
    ///         (vendorAmount, feeAmount, agencyAmount) summing to ≤ upperBound
    ///         the sum of on-chain transfers must equal actualAmount, no
    ///         USDC minted, none burned. This is the single most important
    ///         invariant in the v3 upgrade — it proves the new agency leg
    ///         doesn't break the legacy conservation guarantee.
    function testFuzz_settlementV2_conservesAcrossArbitrarySplits(
        uint256 budget,
        uint256 upperBound,
        uint256 vendorAmt,
        uint256 feeAmt,
        uint256 agencyAmt
    ) public {
        budget     = bound(budget,     MIN_BUDGET * 10, MAX_BUDGET);
        upperBound = bound(upperBound, MIN_BUDGET,      budget);
        // Each leg up to a third of upperBound — guarantees the sum can't
        // overflow the upper bound but still produces meaningful spreads.
        vendorAmt  = bound(vendorAmt, 1, upperBound / 3);
        feeAmt     = bound(feeAmt,    0, upperBound / 3);
        agencyAmt  = bound(agencyAmt, 0, upperBound / 3);

        uint256 actual = vendorAmt + feeAmt + agencyAmt;
        // Edge case: if all three got bounded to zero or the sum is zero,
        // commitBookingV2 reverts ZeroValue — skip that draw.
        vm.assume(actual >= 1);
        vm.assume(actual <= upperBound);

        bytes32 tripId    = keccak256(abi.encode("fuzz-v2", budget, vendorAmt, feeAmt, agencyAmt));
        bytes32 bookingId = keccak256(abi.encode("b", tripId));

        _createTrip(tripId, budget, 30 days);
        _claim(tripId, guest);

        vm.prank(guest);
        escrow.reserveForBooking(tripId, bookingId, upperBound);

        // commitBookingV2 enforces agencyAddress != 0 when agencyAmount > 0.
        // Use a sentinel zero address for the zero-agency case so we exercise
        // that branch too.
        address agencyAddr = agencyAmt > 0 ? agency : address(0);

        vm.prank(guest);
        escrow.commitBookingV2(
            bookingId, vendorAmt, feeAmt, agencyAmt, vendor, agencyAddr, bytes32(0), ""
        );

        vm.prank(operator);
        escrow.confirmDuffel(bookingId, keccak256("d-v2"));

        uint256 escrowBefore   = usdc.balanceOf(address(escrow));
        uint256 vendorBefore   = usdc.balanceOf(vendor);
        uint256 agencyBefore   = usdc.balanceOf(agency);
        uint256 operatorBefore = usdc.balanceOf(operator);

        vm.prank(operator);
        escrow.settleBooking(bookingId);

        uint256 escrowDelta   = escrowBefore - usdc.balanceOf(address(escrow));
        uint256 vendorDelta   = usdc.balanceOf(vendor)   - vendorBefore;
        uint256 agencyDelta   = usdc.balanceOf(agency)   - agencyBefore;
        uint256 operatorDelta = usdc.balanceOf(operator) - operatorBefore;

        // Each recipient got exactly what was committed for them.
        assertEq(vendorDelta,   vendorAmt, "vendor exact");
        assertEq(agencyDelta,   agencyAmt, "agency exact");
        assertEq(operatorDelta, feeAmt,    "operator exact");

        // Conservation: sum of outflows == escrow delta == actualAmount.
        assertEq(vendorDelta + agencyDelta + operatorDelta, actual, "sum equals actual");
        assertEq(escrowDelta, actual, "escrow drained by exactly actual");

        // Trip accounting: spent moved by actual, reserved drained.
        (uint256 tripBudget, uint256 tripReserved, uint256 tripSpent) = _tripSummary(tripId);
        assertEq(tripBudget,   budget, "budget unchanged");
        assertEq(tripReserved, 0,      "reserved drained");
        assertEq(tripSpent,    actual, "spent equals actual");
    }

    /// @notice Storage append-safety under fuzz: legacy v1 commit + v2
    ///         commit on different bookings within the same trip never
    ///         collide. The mapping(bytes32 => Booking) layout is keyed
    ///         on bookingId, so two commits to different ids must persist
    ///         independently — and the v3 fields on the v1 booking must
    ///         remain zero across the second write.
    function testFuzz_storageAppend_v1AndV2BookingsCoexist(
        uint256 budget,
        uint256 v1Actual,
        uint256 v2Vendor,
        uint256 v2Fee,
        uint256 v2Agency,
        bytes32 idSeed
    ) public {
        budget   = bound(budget, MIN_BUDGET * 100, MAX_BUDGET);
        v1Actual = bound(v1Actual, 1, budget / 4);
        v2Vendor = bound(v2Vendor, 1, budget / 8);
        v2Fee    = bound(v2Fee,    0, budget / 8);
        v2Agency = bound(v2Agency, 0, budget / 8);

        uint256 v2Actual = v2Vendor + v2Fee + v2Agency;
        vm.assume(v2Actual >= 1);

        bytes32 tripId = keccak256(abi.encode("fuzz-coexist", idSeed, budget));
        bytes32 b1     = keccak256(abi.encode("legacy", idSeed));
        bytes32 b2     = keccak256(abi.encode("v2",     idSeed));

        _createTrip(tripId, budget, 30 days);
        _claim(tripId, guest);

        // Legacy v1 commit (no agency).
        vm.prank(guest);
        escrow.reserveForBooking(tripId, b1, v1Actual);
        vm.prank(guest);
        escrow.commitBooking(b1, v1Actual, 0, vendor, bytes32(0), "");

        // v3 commit on a different booking (with or without agency).
        vm.prank(guest);
        escrow.reserveForBooking(tripId, b2, v2Actual);
        address aAddr = v2Agency > 0 ? agency : address(0);
        vm.prank(guest);
        escrow.commitBookingV2(b2, v2Vendor, v2Fee, v2Agency, vendor, aAddr, bytes32(0), "");

        // Read both bookings back. Legacy must still have zero agency
        // fields; v3 must have the agency fields exactly as written.
        IGuestEscrow.Booking memory leg = escrow.bookings(b1);
        IGuestEscrow.Booking memory n3  = escrow.bookings(b2);

        assertEq(leg.actualAmount,  v1Actual,    "legacy actual preserved");
        assertEq(leg.fee,           0,           "legacy fee preserved");
        assertEq(leg.agencyAmount,  0,           "legacy agencyAmount stays zero");
        assertEq(leg.agencyAddress, address(0),  "legacy agencyAddress stays zero");

        assertEq(n3.actualAmount,   v2Actual,    "v3 actual matches sum");
        assertEq(n3.fee,            v2Fee,       "v3 fee preserved");
        assertEq(n3.agencyAmount,   v2Agency,    "v3 agencyAmount preserved");
        assertEq(n3.agencyAddress,  aAddr,       "v3 agencyAddress preserved");
    }
}
