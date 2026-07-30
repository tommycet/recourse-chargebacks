// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/RecourseEscrow.sol";

// ---------------------------------------------------------------------------
// Minimal mock USDC for invariant testing
// ---------------------------------------------------------------------------
contract InvariantMockUSDC {
    string public name    = "USD Coin";
    string public symbol  = "USDC";
    uint8  public decimals = 6;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function transfer(address to, uint256 amount) external virtual returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external virtual returns (bool) {
        require(balanceOf[from] >= amount, "insufficient");
        require(allowance[from][msg.sender] >= amount, "allowance");
        balanceOf[from]  -= amount;
        balanceOf[to]    += amount;
        allowance[from][msg.sender] -= amount;
        return true;
    }

    function approve(address spender, uint256 amount) external virtual returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply  += amount;
    }
}

// ---------------------------------------------------------------------------
// Handler: drives random sequences of escrow lifecycle actions
// ---------------------------------------------------------------------------
contract EscrowHandler is Test {
    RecourseEscrow public escrow;
    InvariantMockUSDC public usdc;

    address constant BUYER   = address(0xBEEF);
    address constant SELLER  = address(0xCAFE);
    address constant ARBITER = address(0xABCD);

    uint256[] public escrowIds;
    uint256 public totalFeesCollected; // monotonically-tracked fee accumulator

    constructor() {
        usdc   = new InvariantMockUSDC();
        escrow = new RecourseEscrow(address(usdc), ARBITER);

        usdc.mint(BUYER, 1_000_000e6);
        vm.startPrank(BUYER);
        usdc.approve(address(escrow), type(uint256).max);
        vm.stopPrank();
    }

    // --- actions -----------------------------------------------------------

    function createEscrow(uint256 amount) external {
        amount = bound(amount, 1e6, 10_000e6);
        if (usdc.balanceOf(BUYER) < amount) {
            usdc.mint(BUYER, amount * 2);
        }
        vm.prank(BUYER);
        uint256 id = escrow.createEscrow(
            BUYER,
            SELLER,
            amount,
            bytes32(uint256(uint160(BUYER))),
            bytes32(0)
        );
        escrowIds.push(id);
    }

    function confirmDelivery(uint256 idx) external {
        if (escrowIds.length == 0) return;
        idx = bound(idx, 0, escrowIds.length - 1);
        uint256 id = escrowIds[idx];

        // Read raw flags — only confirm if not yet disputed or resolved
        (, , , , , , , bool d, bool r, ,) = escrow.escrows(id);
        if (d || r) return;

        vm.prank(BUYER);
        escrow.confirmDelivery(id, bytes32(uint256(uint160(id))));
        _updateFees();
    }

    function raiseDispute(uint256 idx) external {
        if (escrowIds.length == 0) return;
        idx = bound(idx, 0, escrowIds.length - 1);
        uint256 id = escrowIds[idx];

        (, , , , , , , bool d, bool r, ,) = escrow.escrows(id);
        if (d || r) return;

        vm.prank(BUYER);
        escrow.raiseDispute(id, bytes32(uint256(uint160(id))));
    }

    function resolveDispute(uint256 idx, bool buyerWins) external {
        if (escrowIds.length == 0) return;
        idx = bound(idx, 0, escrowIds.length - 1);
        uint256 id = escrowIds[idx];

        (address b, , , , , , , bool d, bool r, ,) = escrow.escrows(id);
        if (r || !d) return;

        address payoutTo = buyerWins ? b : SELLER;
        vm.prank(ARBITER);
        escrow.resolveDispute(id, buyerWins, payoutTo);
        _updateFees();
    }

    /// @dev autoRefund requires 14-day timeout; use try/catch so we never revert.
    function autoRefund(uint256 idx) external {
        if (escrowIds.length == 0) return;
        idx = bound(idx, 0, escrowIds.length - 1);
        uint256 id = escrowIds[idx];

        (, , , , , , , bool d, bool r, ,) = escrow.escrows(id);
        if (r || !d) return;

        try escrow.autoRefund(id) {} catch {}
    }

    /// @dev forceResolve requires 7-day dispute expiry; use try/catch.
    function forceResolve(uint256 idx) external {
        if (escrowIds.length == 0) return;
        idx = bound(idx, 0, escrowIds.length - 1);
        uint256 id = escrowIds[idx];

        (, , , , , , , bool d, bool r, ,) = escrow.escrows(id);
        if (r || !d) return;

        try escrow.forceResolve(id) {} catch {}
    }

    /// @dev Advance time randomly — enables timeout / expiry paths.
    function warpForward(uint256 days_) external {
        uint256 d = bound(days_, 1, 30);
        vm.warp(block.timestamp + d * 1 days);
    }

    // --- internal ----------------------------------------------------------

    function _updateFees() internal {
        uint256 ownerBal = usdc.balanceOf(address(this));
        if (ownerBal > totalFeesCollected) {
            totalFeesCollected = ownerBal;
        }
    }
}

// ---------------------------------------------------------------------------
// Property-invariant tests for RecourseEscrow
// ---------------------------------------------------------------------------
contract RecourseEscrowInvariant is Test {
    EscrowHandler handler;
    RecourseEscrow escrow;
    InvariantMockUSDC usdc;

    function setUp() public {
        handler = new EscrowHandler();
        escrow  = handler.escrow();
        usdc    = handler.usdc();

        targetContract(address(handler));
    }

    // =======================================================================
    // INVARIANT 1
    // No escrow can be in two terminal states simultaneously.
    // Specifically: if `resolved == true`, statusOf must return Resolved
    // (never Refunded).  And payoutTo is always zero, buyer, or seller.
    // =======================================================================
    function invariant_noDualTerminalState() public view {
        uint256 end = escrow.nextId();
        for (uint256 i = 1; i < end; i++) {
            (address b, address s, , , , , , , bool resolved, , address payoutTo) =
                escrow.escrows(i);

            if (resolved) {
                assertEq(
                    uint(escrow.statusOf(i)),
                    uint(RecourseEscrow.Status.Resolved),
                    "resolved escrow must have Resolved status, not Refunded"
                );
            }

            assertTrue(
                payoutTo == address(0) || payoutTo == b || payoutTo == s,
                "payoutTo must be zero, buyer, or seller - no dual terminal"
            );
        }
    }

    // =======================================================================
    // INVARIANT 2
    // Total USDC held by the escrow contract == sum of amounts for every
    // escrow that is NOT yet Resolved (i.e. funds have not been released).
    // No money is created or destroyed.
    // =======================================================================
    function invariant_noMoneyLost() public view {
        uint256 contractBalance = usdc.balanceOf(address(escrow));
        uint256 sumHeld = 0;
        uint256 end = escrow.nextId();

        for (uint256 i = 1; i < end; i++) {
            RecourseEscrow.Status s = escrow.statusOf(i);
            if (s != RecourseEscrow.Status.Resolved) {
                (, , uint256 amt, , , , , , , ,) = escrow.escrows(i);
                sumHeld += amt;
            }
        }

        assertEq(contractBalance, sumHeld, "USDC balance must equal sum of unreleased escrow amounts");
    }

    // =======================================================================
    // INVARIANT 3
    // Payout exclusivity: for every resolved escrow, payoutTo is set to
    // exactly one of buyer or seller — never both, never zero.
    // =======================================================================
    function invariant_payoutExclusivity() public view {
        uint256 end = escrow.nextId();
        for (uint256 i = 1; i < end; i++) {
            (address b, address s, , , , , , , bool resolved, , address payoutTo) =
                escrow.escrows(i);

            if (resolved) {
                assertTrue(
                    payoutTo == b || payoutTo == s,
                    "resolved escrow must have payoutTo as buyer or seller"
                );
                // Cannot be both (structural — payoutTo is a single address)
                assertTrue(payoutTo != address(0), "resolved escrow must have non-zero payoutTo");
            }
        }
    }

    // =======================================================================
    // INVARIANT 4
    // Fee accumulator is monotonic — the owner's fee balance never decreases
    // and the tracked maximum never exceeds the actual balance.
    // =======================================================================
    function invariant_feeMonotonic() public view {
        uint256 ownerBal = usdc.balanceOf(address(handler));
        assertGe(
            ownerBal,
            handler.totalFeesCollected(),
            "owner USDC balance must be >= recorded fee maximum (monotonic)"
        );
    }

    // =======================================================================
    // INVARIANT 5
    // After any resolution path (resolveDispute / autoRefund / forceResolve),
    // the escrow status is always 'Resolved' — never left in an ambiguous
    // intermediate state.
    // =======================================================================
    function invariant_resolvedAlwaysResolved() public view {
        uint256 end = escrow.nextId();
        for (uint256 i = 1; i < end; i++) {
            (, , , , , , , , bool resolved, ,) = escrow.escrows(i);

            if (resolved) {
                assertEq(
                    uint(escrow.statusOf(i)),
                    uint(RecourseEscrow.Status.Resolved),
                    "once resolved flag is set, statusOf must always be Resolved"
                );
            }
        }
    }
}
