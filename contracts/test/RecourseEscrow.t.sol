// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/RecourseEscrow.sol";

// ---------------------------------------------------------------------------
// Minimal mock USDC (ERC-20 with mintable supply)
// ---------------------------------------------------------------------------
contract MockUSDC {
    string public name = "USD Coin";
    string public symbol = "USDC";
    uint8 public decimals = 6;
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
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        allowance[from][msg.sender] -= amount;
        return true;
    }

    function approve(address spender, uint256 amount) external virtual returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }
}

// ---------------------------------------------------------------------------
// Reverting ERC20 mock — transfer/transferFrom always revert
// ---------------------------------------------------------------------------
contract RevertingERC20 is MockUSDC {
    function transfer(address /*to*/, uint256 /*amount*/) external pure override returns (bool) {
        revert("USDC: blacklisted");
    }

    function transferFrom(address /*from*/, address /*to*/, uint256 /*amount*/) external pure override returns (bool) {
        revert("USDC: blacklisted");
    }
}

// ---------------------------------------------------------------------------
// Reentrancy attacker — tries to re-enter autoRefund/resolveDispute via receive
// ---------------------------------------------------------------------------
contract ReentrancyAttacker {
    RecourseEscrow public target;
    uint256 public attackEscrowId;
    bool public attackMode;
    uint256 public reentryCount;

    constructor(RecourseEscrow _target) {
        target = _target;
    }

    receive() external payable {
        if (attackMode && reentryCount < 3) {
            reentryCount++;
            try target.autoRefund(attackEscrowId) {} catch {}
            try target.resolveDispute(attackEscrowId, true, address(this)) {} catch {}
        }
    }

    function startAttack(uint256 escrowId) external {
        // Caller must first set up the reentrant receive() to be called during transfer
        attackMode = true;
        reentryCount = 0;
        attackEscrowId = escrowId;
    }

    function stopAttack() external {
        attackMode = false;
    }

    // Forward USDC back to escrow from receive fallback (won't work because autoRefund
    // checks alreadyResolved — but it's worth testing that the check holds)
    function resolveAttack(uint256 escrowId, bool buyerWins) external {
        // This tries the arbiter path — only works if caller IS arbiter
        try target.resolveDispute(escrowId, buyerWins, address(this)) {} catch {}
    }
}

// ---------------------------------------------------------------------------
// Test suite for the real RecourseEscrow (with 1% fee, forceResolve, setArbiter)
// ---------------------------------------------------------------------------
contract RecourseEscrowTest is Test {
    RecourseEscrow escrow;
    MockUSDC usdc;

    address owner   = address(this);          // deployer is owner
    address buyer   = address(0xBEEF);
    address seller  = address(0xCAFE);
    address arbiter = address(0xABCD);
    address stranger = address(0x1234);

    uint256 constant AMOUNT = 100e6;  // 100 USDC
    uint256 constant FEE    = 1e6;    // 1% of 100 USDC
    uint256 constant NET    = 99e6;   // 99 USDC after fee

    bytes32 constant TASK_ID   = keccak256("task-001");
    bytes32 constant EVIDENCE  = keccak256("evidence-001");

    function setUp() public {
        usdc   = new MockUSDC();
        escrow = new RecourseEscrow(address(usdc), arbiter);

        // Fund buyer and pre-approve
        usdc.mint(buyer, 10_000e6);
        vm.prank(buyer);
        usdc.approve(address(escrow), type(uint256).max);
    }

    // -----------------------------------------------------------------------
    // Helper
    // -----------------------------------------------------------------------
    function _create() internal returns (uint256 id) {
        vm.prank(buyer);
        id = escrow.createEscrow(buyer, seller, AMOUNT, TASK_ID, EVIDENCE);
    }

    function _createAndDispute() internal returns (uint256 id) {
        id = _create();
        vm.prank(buyer);
        escrow.raiseDispute(id, keccak256("dispute-evidence"));
    }

    // -----------------------------------------------------------------------
    // createEscrow
    // -----------------------------------------------------------------------
    function test_createEscrow_happy() public {
        uint256 buyerBefore = usdc.balanceOf(buyer);
        uint256 id = _create();

        assertEq(id, 1, "first escrow id should be 1");
        assertEq(usdc.balanceOf(buyer), buyerBefore - AMOUNT, "buyer deducted");
        assertEq(usdc.balanceOf(address(escrow)), AMOUNT, "escrow holds funds");
        assertEq(uint(escrow.statusOf(id)), uint(RecourseEscrow.Status.Active), "status Active");

        (address b, address s, uint256 amt,,,,,,,, ) = escrow.escrows(id);
        assertEq(b, buyer,  "buyer stored");
        assertEq(s, seller, "seller stored");
        assertEq(amt, AMOUNT, "amount stored");
    }

    function test_createEscrow_zeroAmountReverts() public {
        vm.prank(buyer);
        vm.expectRevert("zero amount");
        escrow.createEscrow(buyer, seller, 0, TASK_ID, EVIDENCE);
    }

    function test_createEscrow_zeroAddressReverts() public {
        vm.prank(buyer);
        vm.expectRevert("zero address");
        escrow.createEscrow(buyer, address(0), AMOUNT, TASK_ID, EVIDENCE);

        vm.prank(buyer);
        vm.expectRevert("zero address");
        escrow.createEscrow(address(0), seller, AMOUNT, TASK_ID, EVIDENCE);
    }

    // -----------------------------------------------------------------------
    // confirmDelivery — fee deducted verified
    // -----------------------------------------------------------------------
    function test_confirmDelivery_feeDeductedAndSellerPaid() public {
        uint256 id = _create();

        uint256 ownerBefore  = usdc.balanceOf(owner);
        uint256 sellerBefore = usdc.balanceOf(seller);

        vm.prank(buyer);
        escrow.confirmDelivery(id, keccak256("confirm-ev"));

        assertEq(usdc.balanceOf(owner),  ownerBefore  + FEE, "owner receives 1% fee");
        assertEq(usdc.balanceOf(seller), sellerBefore + NET, "seller receives net");
        assertEq(usdc.balanceOf(address(escrow)), 0,         "escrow drained");
        assertEq(uint(escrow.statusOf(id)), uint(RecourseEscrow.Status.Resolved), "Resolved");
    }

    function test_confirmDelivery_onlyBuyer() public {
        uint256 id = _create();
        vm.prank(stranger);
        vm.expectRevert("not buyer");
        escrow.confirmDelivery(id, EVIDENCE);
    }

    function test_confirmDelivery_afterDisputeReverts() public {
        uint256 id = _createAndDispute();
        vm.prank(buyer);
        vm.expectRevert("disputed/resolved");
        escrow.confirmDelivery(id, EVIDENCE);
    }

    // -----------------------------------------------------------------------
    // raiseDispute
    // -----------------------------------------------------------------------
    function test_raiseDispute_setsDisputedStatus() public {
        uint256 id = _create();
        vm.prank(buyer);
        escrow.raiseDispute(id, keccak256("d-ev"));
        assertEq(uint(escrow.statusOf(id)), uint(RecourseEscrow.Status.Disputed), "Disputed status");
    }

    function test_raiseDispute_onlyBuyer() public {
        uint256 id = _create();
        vm.prank(stranger);
        vm.expectRevert("not buyer");
        escrow.raiseDispute(id, keccak256("d-ev"));
    }

    function test_raiseDispute_doubleDisputeReverts() public {
        uint256 id = _createAndDispute();
        vm.prank(buyer);
        vm.expectRevert("not in progress");
        escrow.raiseDispute(id, keccak256("d-ev-2"));
    }

    // -----------------------------------------------------------------------
    // resolveDispute — buyer wins, fee deducted
    // -----------------------------------------------------------------------
    function test_resolveDispute_buyerWins_feeDeducted() public {
        uint256 id = _createAndDispute();

        uint256 ownerBefore = usdc.balanceOf(owner);
        uint256 buyerBefore = usdc.balanceOf(buyer);

        vm.prank(arbiter);
        escrow.resolveDispute(id, true, buyer);

        assertEq(usdc.balanceOf(owner), ownerBefore + FEE, "owner receives 1% fee");
        assertEq(usdc.balanceOf(buyer), buyerBefore + NET, "buyer receives net");
        assertEq(usdc.balanceOf(address(escrow)), 0,       "escrow drained");
        assertEq(uint(escrow.statusOf(id)), uint(RecourseEscrow.Status.Resolved), "Resolved");
    }

    // -----------------------------------------------------------------------
    // resolveDispute — seller wins, fee deducted
    // -----------------------------------------------------------------------
    function test_resolveDispute_sellerWins_feeDeducted() public {
        uint256 id = _createAndDispute();

        uint256 ownerBefore  = usdc.balanceOf(owner);
        uint256 sellerBefore = usdc.balanceOf(seller);

        vm.prank(arbiter);
        escrow.resolveDispute(id, false, seller);

        assertEq(usdc.balanceOf(owner),  ownerBefore  + FEE, "owner receives 1% fee");
        assertEq(usdc.balanceOf(seller), sellerBefore + NET, "seller receives net");
        assertEq(usdc.balanceOf(address(escrow)), 0,          "escrow drained");
        assertEq(uint(escrow.statusOf(id)), uint(RecourseEscrow.Status.Resolved), "Resolved");
    }

    // -----------------------------------------------------------------------
    // resolveDispute — unauthorized arbiter revert
    // -----------------------------------------------------------------------
    function test_resolveDispute_unauthorizedReverts() public {
        uint256 id = _createAndDispute();
        vm.prank(stranger);
        vm.expectRevert("not arbiter");
        escrow.resolveDispute(id, true, buyer);
    }

    // -----------------------------------------------------------------------
    // resolveDispute — already resolved revert
    // -----------------------------------------------------------------------
    function test_resolveDispute_alreadyResolvedReverts() public {
        uint256 id = _createAndDispute();
        vm.prank(arbiter);
        escrow.resolveDispute(id, true, buyer);

        vm.prank(arbiter);
        vm.expectRevert("already resolved");
        escrow.resolveDispute(id, true, buyer);
    }

    // -----------------------------------------------------------------------
    // resolveDispute — invalid payout (mismatch) revert
    // -----------------------------------------------------------------------
    function test_resolveDispute_buyerWinsMismatchReverts() public {
        uint256 id = _createAndDispute();
        vm.prank(arbiter);
        vm.expectRevert("buyerWins mismatch");
        escrow.resolveDispute(id, true, seller);
    }

    function test_resolveDispute_sellerWinsMismatchReverts() public {
        uint256 id = _createAndDispute();
        vm.prank(arbiter);
        vm.expectRevert("sellerWins mismatch");
        escrow.resolveDispute(id, false, buyer);
    }

    // -----------------------------------------------------------------------
    // forceResolve after 7-day DISPUTE_EXPIRY (vm.warp)
    // -----------------------------------------------------------------------
    function test_forceResolve_after7Days_refundsBuyer() public {
        uint256 id = _createAndDispute();

        // Warp just past DISPUTE_EXPIRY (7 days)
        vm.warp(block.timestamp + 7 days + 1);

        uint256 buyerBefore = usdc.balanceOf(buyer);

        // Anyone can call forceResolve
        vm.prank(stranger);
        escrow.forceResolve(id);

        // forceResolve does NOT deduct fee (full refund to buyer)
        assertEq(usdc.balanceOf(buyer), buyerBefore + AMOUNT, "buyer refunded in full");
        assertEq(usdc.balanceOf(address(escrow)), 0,          "escrow drained");
        assertEq(uint(escrow.statusOf(id)), uint(RecourseEscrow.Status.Resolved), "Resolved");
    }

    function test_forceResolve_before7Days_reverts() public {
        uint256 id = _createAndDispute();

        vm.warp(block.timestamp + 6 days);

        vm.expectRevert("dispute expiry not reached");
        escrow.forceResolve(id);
    }

    function test_forceResolve_notDisputedReverts() public {
        uint256 id = _create();
        vm.warp(block.timestamp + 8 days);
        vm.expectRevert("not disputed");
        escrow.forceResolve(id);
    }

    // -----------------------------------------------------------------------
    // autoRefund after TIMEOUT (14 days)
    // -----------------------------------------------------------------------
    function test_autoRefund_after14Days_fullRefund() public {
        uint256 id = _createAndDispute();

        vm.warp(block.timestamp + 14 days + 1);

        uint256 buyerBefore = usdc.balanceOf(buyer);

        escrow.autoRefund(id);

        // autoRefund does NOT deduct fee
        assertEq(usdc.balanceOf(buyer), buyerBefore + AMOUNT, "buyer fully refunded");
        assertEq(usdc.balanceOf(address(escrow)), 0,           "escrow drained");
        assertEq(uint(escrow.statusOf(id)), uint(RecourseEscrow.Status.Resolved), "Resolved");
    }

    function test_autoRefund_before14Days_reverts() public {
        uint256 id = _createAndDispute();
        vm.warp(block.timestamp + 13 days);
        vm.expectRevert("timeout not reached");
        escrow.autoRefund(id);
    }

    function test_autoRefund_notDisputedReverts() public {
        uint256 id = _create();
        vm.warp(block.timestamp + 15 days);
        vm.expectRevert("not disputed");
        escrow.autoRefund(id);
    }

    // -----------------------------------------------------------------------
    // setArbiter
    // -----------------------------------------------------------------------
    function test_setArbiter_ownerCanChange() public {
        address newArbiter = address(0xDEAD);
        // owner is address(this), no prank needed
        escrow.setArbiter(newArbiter);
        assertEq(escrow.arbiter(), newArbiter, "arbiter updated");
    }

    function test_setArbiter_nonOwnerReverts() public {
        vm.prank(stranger);
        vm.expectRevert("not owner");
        escrow.setArbiter(address(0xDEAD));
    }

    function test_setArbiter_zeroAddressReverts() public {
        vm.expectRevert("zero address");
        escrow.setArbiter(address(0));
    }

    // -----------------------------------------------------------------------
    // Fee recipient balance check across multiple escrows
    // -----------------------------------------------------------------------
    function test_feeRecipient_accumulatesAcrossEscrows() public {
        uint256 ownerBefore = usdc.balanceOf(owner);

        // Create + confirm 3 escrows
        for (uint256 i = 0; i < 3; i++) {
            uint256 id = _create();
            vm.prank(buyer);
            escrow.confirmDelivery(id, keccak256(abi.encode("ev", i)));
        }

        // Each escrow: 1% of 100e6 = 1e6 fee
        assertEq(usdc.balanceOf(owner), ownerBefore + 3 * FEE, "owner accumulated 3x fee");
    }

    function test_feeRecipient_fromResolveDispute() public {
        uint256 ownerBefore = usdc.balanceOf(owner);
        uint256 id = _createAndDispute();

        vm.prank(arbiter);
        escrow.resolveDispute(id, false, seller);

        assertEq(usdc.balanceOf(owner), ownerBefore + FEE, "fee to owner from dispute resolution");
    }

    // -----------------------------------------------------------------------
    // statusOf for non-existent escrow
    // -----------------------------------------------------------------------
    function test_statusOf_nonExistentReverts() public {
        vm.expectRevert("no escrow");
        escrow.statusOf(999);
    }

    // -----------------------------------------------------------------------
    // Disputed status transitions correctly to Refunded in statusOf after TIMEOUT
    // -----------------------------------------------------------------------
    function test_statusOf_refundedAfterTimeout() public {
        uint256 id = _createAndDispute();
        vm.warp(block.timestamp + 15 days);
        assertEq(uint(escrow.statusOf(id)), uint(RecourseEscrow.Status.Refunded), "Refunded status");
    }

    // ===================================================================
    // EDGE-CASE TESTS — targeting production-grade coverage (29–58+)
    // ===================================================================

    // -------------------------------------------------------------------
    // createEscrow — additional edge cases
    // -------------------------------------------------------------------

    function test_createEscrow_emitsCorrectEvent() public {
        vm.prank(buyer);
        vm.expectEmit(true, true, false, true);
        emit RecourseEscrow.EscrowCreated(1, buyer, seller, AMOUNT, TASK_ID, EVIDENCE);
        escrow.createEscrow(buyer, seller, AMOUNT, TASK_ID, EVIDENCE);
    }

    function test_createEscrow_incrementsNextId() public {
        _create();
        assertEq(escrow.nextId(), 2, "nextId incremented to 2");
        _create();
        assertEq(escrow.nextId(), 3, "nextId incremented to 3");
    }

    function test_createEscrow_hashesTaskIdAndEvidenceStored() public {
        uint256 id = _create();
        (, , , bytes32 taskId, bytes32 evHash, , , , , , ) = escrow.escrows(id);
        assertEq(taskId, TASK_ID, "taskId stored");
        assertEq(evHash, EVIDENCE, "evidence bundle hash stored");
    }

    function test_createEscrow_setsTimestamp() public {
        vm.warp(1_000_000);
        uint256 id = _create();
        (, , , , , uint256 createdAt, , , , , ) = escrow.escrows(id);
        assertEq(createdAt, 1_000_000, "createdAt matches block.timestamp");
    }

    function test_createEscrow_insufficientAllowanceReverts() public {
        // new buyer with no approval
        address buyer2 = address(0xFACE);
        usdc.mint(buyer2, AMOUNT * 2);
        vm.prank(buyer2);
        vm.expectRevert();
        escrow.createEscrow(buyer2, seller, AMOUNT, TASK_ID, EVIDENCE);
    }

    function test_createEscrow_insufficientBalanceReverts() public {
        address buyer2 = address(0xFACE);
        // no balance
        vm.startPrank(buyer2);
        usdc.approve(address(escrow), type(uint256).max);
        vm.expectRevert();
        escrow.createEscrow(buyer2, seller, AMOUNT, TASK_ID, EVIDENCE);
        vm.stopPrank();
    }

    function test_createEscrow_bothAddressesZeroReverts() public {
        vm.prank(buyer);
        vm.expectRevert("zero address");
        escrow.createEscrow(address(0), address(0), AMOUNT, TASK_ID, EVIDENCE);
    }

    // -------------------------------------------------------------------
    // confirmDelivery — additional state transition + emission tests
    // -------------------------------------------------------------------

    function test_confirmDelivery_emitsResolvedEvent() public {
        uint256 id = _create();
        vm.prank(buyer);
        vm.expectEmit(true, false, false, true);
        emit RecourseEscrow.DeliveryConfirmed(id, keccak256("confirm-ev"));
        escrow.confirmDelivery(id, keccak256("confirm-ev"));
    }

    function test_confirmDelivery_setsDeliveredAndResolved() public {
        uint256 id = _create();
        vm.prank(buyer);
        escrow.confirmDelivery(id, keccak256("ev"));
        (, , , , , , bool delivered, , bool resolved, , ) = escrow.escrows(id);
        assertTrue(delivered, "delivered flag set");
        assertTrue(resolved, "resolved flag set");
    }

    function test_confirmDelivery_setsPayoutToSeller() public {
        uint256 id = _create();
        vm.prank(buyer);
        escrow.confirmDelivery(id, keccak256("ev"));
        (, , , , , , , , , , address payoutTo) = escrow.escrows(id);
        assertEq(payoutTo, seller, "payoutTo set to seller");
    }

    function test_confirmDelivery_sellerCannotConfirm() public {
        uint256 id = _create();
        vm.prank(seller);
        vm.expectRevert("not buyer");
        escrow.confirmDelivery(id, EVIDENCE);
    }

    function test_confirmDelivery_afterResolvedReverts() public {
        uint256 id = _create();
        vm.prank(buyer);
        escrow.confirmDelivery(id, EVIDENCE);

        vm.prank(buyer);
        vm.expectRevert("disputed/resolved");
        escrow.confirmDelivery(id, EVIDENCE);
    }

    // -------------------------------------------------------------------
    // raiseDispute — edge cases
    // -------------------------------------------------------------------

    function test_raiseDispute_emitsDisputeRaisedEvent() public {
        uint256 id = _create();
        bytes32 dh = keccak256("dispute-ev-1");
        vm.prank(buyer);
        vm.expectEmit(true, true, false, true);
        emit RecourseEscrow.DisputeRaised(id, buyer, dh);
        escrow.raiseDispute(id, dh);
    }

    function test_raiseDispute_setsDisputeTimestamp() public {
        uint256 id = _create();
        vm.warp(2_500_000);
        vm.prank(buyer);
        escrow.raiseDispute(id, keccak256("d"));
        (, , , , , , , , , uint256 disputeRaisedAt, ) = escrow.escrows(id);
        assertEq(disputeRaisedAt, 2_500_000, "disputeRaisedAt set");
    }

    function test_raiseDispute_afterConfirmedThenResolvedReverts() public {
        uint256 id = _create();
        vm.prank(buyer);
        escrow.confirmDelivery(id, EVIDENCE);

        vm.prank(buyer);
        vm.expectRevert("not in progress");
        escrow.raiseDispute(id, keccak256("d"));
    }

    function test_raiseDispute_sellerCannotRaise() public {
        uint256 id = _create();
        vm.prank(seller);
        vm.expectRevert("not buyer");
        escrow.raiseDispute(id, keccak256("d"));
    }

    // -------------------------------------------------------------------
    // resolveDispute — additional edge cases
    // -------------------------------------------------------------------

    function test_resolveDispute_notDisputedReverts() public {
        uint256 id = _create();
        vm.prank(arbiter);
        vm.expectRevert("not disputed");
        escrow.resolveDispute(id, true, buyer);
    }

    function test_resolveDispute_arbiterCannotUseInvalidPayoutTo() public {
        uint256 id = _createAndDispute();
        vm.prank(arbiter);
        vm.expectRevert("invalid payout");
        escrow.resolveDispute(id, true, stranger);
    }

    function test_resolveDispute_setsPayoutTo() public {
        uint256 id = _createAndDispute();
        vm.prank(arbiter);
        escrow.resolveDispute(id, true, buyer);
        (, , , , , , , , , , address payoutTo) = escrow.escrows(id);
        assertEq(payoutTo, buyer, "payoutTo set to buyer");
    }

    function test_resolveDispute_emitsResolvedEvent() public {
        uint256 id = _createAndDispute();
        vm.prank(arbiter);
        vm.expectEmit(true, true, false, true);
        emit RecourseEscrow.Resolved(id, true, buyer, NET);
        escrow.resolveDispute(id, true, buyer);
    }

    function test_resolveDispute_buyerWinsAfterConfirmReverts_AsNotInDisputeFlow() public {
        // Create escrow, dispute, resolve in buyer's favor — alreadyResolved test
        uint256 id = _createAndDispute();
        vm.prank(arbiter);
        escrow.resolveDispute(id, true, buyer);

        // second resolution attempt with sellerWins should also revert (already resolved)
        vm.prank(arbiter);
        vm.expectRevert("already resolved");
        escrow.resolveDispute(id, false, seller);
    }

    function test_resolveDispute_drainsEscrowFully() public {
        uint256 id = _createAndDispute();
        vm.prank(arbiter);
        escrow.resolveDispute(id, false, seller);
        assertEq(usdc.balanceOf(address(escrow)), 0, "escrow fully drained");
    }

    // -------------------------------------------------------------------
    // autoRefund — edge cases
    // -------------------------------------------------------------------

    function test_autoRefund_canBeCalledByAnyone() public {
        uint256 id = _createAndDispute();
        vm.warp(block.timestamp + 14 days + 1);
        // stranger calls
        vm.prank(stranger);
        escrow.autoRefund(id);
        assertEq(uint(escrow.statusOf(id)), uint(RecourseEscrow.Status.Resolved), "Resolved");
    }

    function test_autoRefund_emitsAutoRefundAndResolved() public {
        uint256 id = _createAndDispute();
        vm.warp(block.timestamp + 14 days + 1);

        vm.expectEmit(true, false, false, false);
        emit RecourseEscrow.AutoRefund(id);
        escrow.autoRefund(id);
    }

    function test_autoRefund_afterResolvedReverts() public {
        uint256 id = _createAndDispute();
        vm.warp(block.timestamp + 15 days);
        escrow.autoRefund(id); // first call

        vm.expectRevert("already resolved");
        escrow.autoRefund(id); // second call should revert
    }

    function test_autoRefund_noFeeCharged() public {
        uint256 id = _createAndDispute();
        vm.warp(block.timestamp + 14 days + 1);
        uint256 ownerBefore = usdc.balanceOf(owner);

        escrow.autoRefund(id);

        assertEq(usdc.balanceOf(owner), ownerBefore, "no fee on autoRefund");
    }

    // -------------------------------------------------------------------
    // forceResolve — additional edge cases
    // -------------------------------------------------------------------

    function test_forceResolve_canBeCalledByBuyer() public {
        uint256 id = _createAndDispute();
        vm.warp(block.timestamp + 7 days + 1);
        vm.prank(buyer);
        escrow.forceResolve(id);
        assertEq(uint(escrow.statusOf(id)), uint(RecourseEscrow.Status.Resolved), "Resolved");
    }

    function test_forceResolve_afterResolvedReverts() public {
        uint256 id = _createAndDispute();
        vm.warp(block.timestamp + 8 days);
        escrow.forceResolve(id);

        vm.expectRevert("already resolved");
        escrow.forceResolve(id);
    }

    function test_forceResolve_noFeeCharged() public {
        uint256 id = _createAndDispute();
        vm.warp(block.timestamp + 8 days);
        uint256 ownerBefore = usdc.balanceOf(owner);

        escrow.forceResolve(id);

        assertEq(usdc.balanceOf(owner), ownerBefore, "no fee on forceResolve");
    }

    function test_forceResolve_nonExistentEscrowReverts() public {
        vm.warp(block.timestamp + 30 days);
        vm.expectRevert("no escrow");
        escrow.forceResolve(12345);
    }

    function test_forceResolve_emitsDisputeExpiredAndResolved() public {
        uint256 id = _createAndDispute();
        vm.warp(block.timestamp + 7 days + 1);

        vm.expectEmit(true, true, false, false);
        emit RecourseEscrow.DisputeExpired(id, buyer);
        escrow.forceResolve(id);
    }

    // -------------------------------------------------------------------
    // autoRefund vs forceResolve — timing edge cases
    // -------------------------------------------------------------------

    function test_forceResolve_timeBoundary_exactly7DaysReverts() public {
        // 7 days exactly should NOT pass (strictly greater-than)
        uint256 id = _createAndDispute();
        vm.warp(block.timestamp + 7 days);
        vm.expectRevert("dispute expiry not reached");
        escrow.forceResolve(id);
    }

    function test_autoRefund_timeBoundary_exactly14DaysReverts() public {
        uint256 id = _createAndDispute();
        vm.warp(block.timestamp + 14 days);
        vm.expectRevert("timeout not reached");
        escrow.autoRefund(id);
    }

    function test_forceResolve_worksBeforeAutoRefundWindow() public {
        // 8 days: forceResolve works but autoRefund (14d) does not
        uint256 id = _createAndDispute();
        vm.warp(block.timestamp + 8 days);
        escrow.forceResolve(id);
        assertEq(uint(escrow.statusOf(id)), uint(RecourseEscrow.Status.Resolved), "Resolved via forceResolve");
    }

    // -------------------------------------------------------------------
    // setArbiter — event emission + re-entrancy of permissions
    // -------------------------------------------------------------------

    function test_setArbiter_emitsEvent() public {
        address newArb = address(0xDEAD);
        vm.expectEmit(true, true, false, false);
        emit RecourseEscrow.ArbiterChanged(arbiter, newArb);
        escrow.setArbiter(newArb);
    }

    function test_setArbiter_newArbiterCanResolve() public {
        uint256 id = _createAndDispute();
        address newArb = address(0xFEED);

        escrow.setArbiter(newArb);

        // old arbiter no longer works
        vm.prank(arbiter);
        vm.expectRevert("not arbiter");
        escrow.resolveDispute(id, true, buyer);

        // new arbiter works
        vm.prank(newArb);
        escrow.resolveDispute(id, true, buyer);
        assertEq(uint(escrow.statusOf(id)), uint(RecourseEscrow.Status.Resolved), "Resolved by new arbiter");
    }

    function test_setArbiter_buyerCannotChange() public {
        vm.prank(buyer);
        vm.expectRevert("not owner");
        escrow.setArbiter(address(0xDEAD));
    }

    function test_setArbiter_sellerCannotChange() public {
        vm.prank(seller);
        vm.expectRevert("not owner");
        escrow.setArbiter(address(0xDEAD));
    }

    // -------------------------------------------------------------------
    // statusOf — complete state machine coverage
    // -------------------------------------------------------------------

    function test_statusOf_activeAfterCreate() public {
        uint256 id = _create();
        assertEq(uint(escrow.statusOf(id)), uint(RecourseEscrow.Status.Active), "Active");
    }

    function test_statusOf_confirmedAfterConfirmDelivery() public {
        uint256 id = _create();
        vm.prank(buyer);
        escrow.confirmDelivery(id, EVIDENCE);
        // resolveDispute short-circuits delivered+resolved → Resolved (not Confirmed)
        assertEq(uint(escrow.statusOf(id)), uint(RecourseEscrow.Status.Resolved), "Resolved after delivery");
    }

    function test_statusOf_disputedAfterRaiseDispute() public {
        uint256 id = _createAndDispute();
        assertEq(uint(escrow.statusOf(id)), uint(RecourseEscrow.Status.Disputed), "Disputed");
    }

    function test_statusOf_resolvedAfterArbiterResolution() public {
        uint256 id = _createAndDispute();
        vm.prank(arbiter);
        escrow.resolveDispute(id, true, buyer);
        assertEq(uint(escrow.statusOf(id)), uint(RecourseEscrow.Status.Resolved), "Resolved");
    }

    function test_statusOf_refundedAfterExpiryBeforeTimeout() public {
        // After DISPUTE_EXPIRY (7d) but before TIMEOUT (14d), statusOf still Disputed
        // because discrepancy: statusOf uses TIMEOUT for Refunded, forceResolve uses DISPUTE_EXPIRY
        uint256 id = _createAndDispute();
        vm.warp(block.timestamp + 10 days);
        // statusOf uses TIMEOUT=14d → Disputed still
        assertEq(uint(escrow.statusOf(id)), uint(RecourseEscrow.Status.Disputed), "still Disputed at 10d");
    }

    // -------------------------------------------------------------------
    // Multiple concurrent escrows — independent state
    // -------------------------------------------------------------------

    function test_multipleEscrows_independentState() public {
        // create three escrows
        uint256 id1 = _create();
        uint256 id2 = _create();
        uint256 id3 = _create();

        // Dispute id1
        vm.prank(buyer);
        escrow.raiseDispute(id1, keccak256("d1"));

        // Confirm id2 (delivered/resolved)
        vm.prank(buyer);
        escrow.confirmDelivery(id2, keccak256("c2"));

        // id3 stays Active

        assertEq(uint(escrow.statusOf(id1)), uint(RecourseEscrow.Status.Disputed), "id1 Disputed");
        assertEq(uint(escrow.statusOf(id2)), uint(RecourseEscrow.Status.Resolved), "id2 Resolved");
        assertEq(uint(escrow.statusOf(id3)), uint(RecourseEscrow.Status.Active), "id3 Active");
    }

    function test_multipleEscrows_resolveIndependently() public {
        uint256 id1 = _createAndDispute();
        uint256 id2 = _createAndDispute();

        // Resolve id1 in buyer's favor
        vm.prank(arbiter);
        escrow.resolveDispute(id1, true, buyer);

        // id2 still disputed
        assertEq(uint(escrow.statusOf(id1)), uint(RecourseEscrow.Status.Resolved), "id1 Resolved");
        assertEq(uint(escrow.statusOf(id2)), uint(RecourseEscrow.Status.Disputed), "id2 Disputed");
    }

    function test_multipleEscrows_feeAccumulatesCorrectly() public {
        uint256 ownerBefore = usdc.balanceOf(owner);

        uint256 id1 = _create();
        uint256 id2 = _createAndDispute();
        uint256 id3 = _createAndDispute();

        vm.prank(buyer);
        escrow.confirmDelivery(id1, EVIDENCE);

        vm.prank(arbiter);
        escrow.resolveDispute(id2, true, buyer);

        vm.prank(arbiter);
        escrow.resolveDispute(id3, false, seller);

        assertEq(usdc.balanceOf(owner), ownerBefore + 3 * FEE, "3x fee accumulated");
    }

    // -------------------------------------------------------------------
    // Fee calculation edge cases
    // -------------------------------------------------------------------

    function test_feeCalculation_smallAmount() public {
        uint256 smallAmt = 100;  // 100 wei (0.0001 USDC at 6 decimals)
        uint256 expectedFee = 1;   // 1% of 100 = 1

        usdc.mint(buyer, smallAmt);
        vm.prank(buyer);
        uint256 id = escrow.createEscrow(buyer, seller, smallAmt, TASK_ID, EVIDENCE);

        uint256 ownerBefore = usdc.balanceOf(owner);
        uint256 sellerBefore = usdc.balanceOf(seller);

        vm.prank(buyer);
        escrow.confirmDelivery(id, EVIDENCE);

        assertEq(usdc.balanceOf(owner), ownerBefore + expectedFee, "fee = 1 on small amount");
        assertEq(usdc.balanceOf(seller), sellerBefore + (smallAmt - expectedFee), "seller net");
    }

    function test_feeCalculation_largeAmount() public {
        uint256 largeAmt = 1_000_000e6;  // 1M USDC
        uint256 expectedFee = 10_000e6;  // 1% = 10K USDC

        usdc.mint(buyer, largeAmt);
        vm.prank(buyer);
        uint256 id = escrow.createEscrow(buyer, seller, largeAmt, TASK_ID, EVIDENCE);

        uint256 ownerBefore = usdc.balanceOf(owner);
        uint256 sellerBefore = usdc.balanceOf(seller);

        vm.prank(buyer);
        escrow.confirmDelivery(id, EVIDENCE);

        assertEq(usdc.balanceOf(owner), ownerBefore + expectedFee, "fee correct on large amount");
        assertEq(usdc.balanceOf(seller), sellerBefore + (largeAmt - expectedFee), "seller net large");
    }

    function test_feeCalculation_amountOf1Wei() public {
        // Amount = 1 → fee = 1*100/10000 = 0 (integer division truncates)
        usdc.mint(buyer, 1);
        vm.prank(buyer);
        uint256 id = escrow.createEscrow(buyer, seller, 1, TASK_ID, EVIDENCE);

        uint256 ownerBefore = usdc.balanceOf(owner);

        vm.prank(buyer);
        escrow.confirmDelivery(id, EVIDENCE);

        // Fee rounds to 0; seller still receives 1
        assertEq(usdc.balanceOf(owner), ownerBefore, "no fee on 1 wei (truncated)");
        assertEq(usdc.balanceOf(seller), 1, "seller gets full 1 wei back");
    }

    // -------------------------------------------------------------------
    // Evidence bundle hash verification (immutability + freshness)
    // -------------------------------------------------------------------

    function test_evidenceBundleHash_setOnCreate() public {
        bytes32 custom = keccak256("custom-evidence");
        vm.prank(buyer);
        uint256 id = escrow.createEscrow(buyer, seller, AMOUNT, TASK_ID, custom);

        (, , , , bytes32 evHash, , , , , , ) = escrow.escrows(id);
        assertEq(evHash, custom, "evidence hash matches create input");
    }

    function test_evidenceBundleHash_overwrittenOnConfirmDelivery() public {
        uint256 id = _create();
        bytes32 newEv = keccak256("delivery-evidence");

        vm.prank(buyer);
        escrow.confirmDelivery(id, newEv);

        (, , , , bytes32 evHash, , , , , , ) = escrow.escrows(id);
        assertEq(evHash, newEv, "evidence hash updated to delivery bundle");
        assertNotEq(evHash, EVIDENCE, "evidence hash changed from create");
    }

    function test_evidenceBundleHash_overwrittenOnRaiseDispute() public {
        uint256 id = _create();
        bytes32 dEv = keccak256("dispute-evidence-2");

        vm.prank(buyer);
        escrow.raiseDispute(id, dEv);

        (, , , , bytes32 evHash, , , , , , ) = escrow.escrows(id);
        assertEq(evHash, dEv, "evidence hash updated to dispute bundle");
    }

    function test_evidenceBundleHashes_distinguishAcrossEscrows() public {
        bytes32 e1 = keccak256("ev-1");
        bytes32 e2 = keccak256("ev-2");

        vm.prank(buyer);
        uint256 id1 = escrow.createEscrow(buyer, seller, AMOUNT, TASK_ID, e1);
        vm.prank(buyer);
        uint256 id2 = escrow.createEscrow(buyer, seller, AMOUNT, TASK_ID, e2);

        (, , , , bytes32 h1, , , , , , ) = escrow.escrows(id1);
        (, , , , bytes32 h2, , , , , , ) = escrow.escrows(id2);

        assertEq(h1, e1, "id1 evidence");
        assertEq(h2, e2, "id2 evidence");
        assertNotEq(h1, h2, "evidence hashes differ");
    }

    // -------------------------------------------------------------------
    // ID/sequencing — non-existent escrows & nextId
    // -------------------------------------------------------------------

    function test_escrows_nonExistentReturnsZero() public {
        // mapping returns default-initialized Escrow (all zero)
        (address b, , , , , , , , , , ) = escrow.escrows(999);
        assertEq(b, address(0), "non-existent escrow has zero buyer");
    }

    function test_nextId_startsAt1() public {
        assertEq(escrow.nextId(), 1, "nextId starts at 1");
    }

    // -------------------------------------------------------------------
    // Immutability of USDC address
    // -------------------------------------------------------------------

    function test_USDC_addressImmutable() public {
        assertEq(escrow.USDC(), address(usdc), "USDC address matches");
    }

    // -------------------------------------------------------------------
    // Order-of-operations: dispute before delivery
    // -------------------------------------------------------------------

    function test_raiseDispute_thenArbiterResolvesDrainsEscrow() public {
        uint256 id = _createAndDispute();
        vm.prank(arbiter);
        escrow.resolveDispute(id, true, buyer);
        assertEq(usdc.balanceOf(address(escrow)), 0, "escrow drained after arbiter resolve");
    }

    function test_raiseDispute_thenBuyerCannotConfirmDelivery() public {
        uint256 id = _createAndDispute();
        vm.prank(buyer);
        vm.expectRevert("disputed/resolved");
        escrow.confirmDelivery(id, EVIDENCE);
    }

    // -------------------------------------------------------------------
    // forceResolve vs autoRefund interaction (forceResolve wins earlier)
    // -------------------------------------------------------------------

    function test_forceResolve_thenAutoRefundReverts() public {
        uint256 id = _createAndDispute();
        vm.warp(block.timestamp + 8 days);
        escrow.forceResolve(id);

        vm.warp(block.timestamp + 20 days);
        vm.expectRevert("already resolved");
        escrow.autoRefund(id);
    }

    function test_autoRefund_thenForceResolveReverts() public {
        uint256 id = _createAndDispute();
        vm.warp(block.timestamp + 15 days);
        escrow.autoRefund(id);

        vm.warp(block.timestamp + 30 days);
        vm.expectRevert("already resolved");
        escrow.forceResolve(id);
    }

    // -------------------------------------------------------------------
    // Owner immutability / arbitrary-change denial
    // -------------------------------------------------------------------

    function test_ownerIsDeployer() public {
        assertEq(escrow.owner(), address(this), "owner is deployer");
    }
}
